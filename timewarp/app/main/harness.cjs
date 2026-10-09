"use strict";
// Runs Timewarp conversations on the Codex app server. Each agent works in its
// own workspace folder; each conversation is one Codex thread. Codex keeps the
// full transcript; the store keeps chat messages for history sync and search.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval",
  "item/tool/requestUserInput", "mcpServer/elicitation/request", "applyPatchApproval", "execCommandApproval",
]);
const TITLE_LENGTH = 60;
const fail = (status, message) => Object.assign(new Error(message), { status });

function titleFrom(text) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  return line.length > TITLE_LENGTH ? line.slice(0, TITLE_LENGTH - 1).trimEnd() + "…" : line || "New conversation";
}

const HISTORY_MESSAGES = 60, HISTORY_CHARS = 60000;
// Marks the part of a message that lists attached files (paths in the workspace).
const ATTACHED = "[Attached files, saved in your workspace]";

// tools: { version, specs(agent, conversation), call(conversationId, params, agent), finished(conversationId) }
// approvalsReviewer: "auto_review" lets Codex's reviewer decide requests for
// extra access, as the previous app did; "user" asks the user each time.
function createHarness({ store, client, userId, instructionsFor, threadConfig = () => ({}), modelSettings, approvalsReviewer = () => "user", tools = null, notify = () => {}, log = () => {} }) {
  const toolsVersion = tools?.version || 0;
  const threadOwner = new Map(); // codex thread id -> root conversation id (includes sub-agent threads)
  const loaded = new Set(); // threads resumed or started in this Codex session
  const active = new Map(); // conversation id -> { threadId, turnId }
  const approvals = new Map(); // request id -> pending server request
  const preparing = new Map(); // conversation id -> thread start or resume in flight

  const owner = () => { const value = userId(); if (!value) throw fail(401, "Sign in to Timewarp."); return value; };
  const ownedConversation = id => {
    const conversation = store.conversations.get(id);
    if (!conversation || conversation.ownerId !== owner()) throw fail(404, "This conversation is unavailable for this account.");
    return conversation;
  };
  const ownedAgent = id => {
    const agent = store.agents.get(id);
    if (!agent || agent.ownerId !== owner() || agent.archivedAt) throw fail(404, "This agent is unavailable for this account.");
    return agent;
  };
  const emit = (conversationId, method, params) => notify("conversation.event", { conversationId, method, params });

  client.on("status", state => {
    if (state.status === "ready") return;
    loaded.clear();
    for (const [conversationId] of active) emit(conversationId, "turn/aborted", { reason: "Codex stopped." });
    active.clear();
    for (const [id, pending] of approvals) { approvals.delete(id); notify("approval.resolved", { id, conversationId: pending.conversationId }); }
  });

  function conversationForThread(threadId) {
    if (!threadId) return null;
    if (threadOwner.has(threadId)) return threadOwner.get(threadId);
    const conversation = store.conversations.byThread(threadId);
    if (conversation) threadOwner.set(threadId, conversation.id);
    return conversation?.id || null;
  }

  client.on("notification", ({ method, params }) => {
    if (method === "thread/started" && params.thread?.parentThreadId) {
      const parent = conversationForThread(params.thread.parentThreadId);
      if (parent) threadOwner.set(params.thread.id, parent);
    }
    const conversationId = conversationForThread(params.threadId || params.thread?.id);
    if (!conversationId) return;
    const conversation = store.conversations.get(conversationId);
    if (!conversation) return;
    const root = params.threadId === conversation.codexThreadId || params.thread?.id === conversation.codexThreadId;
    if (root && method === "turn/started") active.set(conversationId, { threadId: params.threadId, turnId: params.turn.id });
    if (root && method === "turn/completed") {
      active.delete(conversationId);
      store.conversations.update(conversationId, { read: false });
      tools?.finished?.(conversationId);
    }
    if (root && method === "item/completed" && params.item?.type === "agentMessage" && params.item.text) {
      store.messages.append({ id: params.item.id, conversationId, authorId: conversation.agentId, text: params.item.text, turnId: params.turnId });
    }
    if (root && method === "thread/name/updated" && params.threadName) store.conversations.update(conversationId, { title: params.threadName });
    if (method === "thread/tokenUsage/updated" && params.turnId && params.tokenUsage?.total) {
      try { store.turnUsage.record(conversationId, params.threadId, params.turnId, params.tokenUsage.total); } catch {}
    }
    emit(conversationId, method, { ...params, subAgent: !root });
  });

  client.on("request", message => {
    if (message.method === "item/tool/call") return void callTool(message);
    if (!APPROVAL_METHODS.has(message.method)) {
      client.respondError(message.id, "Timewarp does not support this request.", -32601);
      return;
    }
    const conversationId = conversationForThread(message.params?.threadId || message.params?.conversationId);
    if (!conversationId) {
      client.respondError(message.id, "No conversation is waiting for this request.");
      return;
    }
    const pending = { id: message.id, method: message.method, params: message.params, conversationId, requestedAt: Date.now() };
    approvals.set(message.id, pending);
    notify("approval.requested", pending);
  });
  client.on("notification", ({ method, params }) => {
    if (method !== "serverRequest/resolved") return;
    const pending = approvals.get(params.requestId);
    if (!pending) return;
    approvals.delete(params.requestId);
    notify("approval.resolved", { id: params.requestId, conversationId: pending.conversationId });
  });

  async function callTool(message) {
    const params = message.params || {};
    const conversationId = conversationForThread(params.threadId);
    const conversation = conversationId && store.conversations.get(conversationId);
    try {
      if (!tools || !conversation || conversation.ownerId !== userId()) throw fail(404, "This tool is unavailable here.");
      const result = await tools.call(conversationId, params, store.agents.get(conversation.agentId));
      client.respond(message.id, result);
    } catch (error) {
      try { client.respond(message.id, { contentItems: [{ type: "inputText", text: error.message || "The tool failed." }], success: false }); } catch {}
    }
  }

  // Earlier messages for a chat that continues in a new thread: restored from
  // the cloud without a local transcript, or started before the current tools.
  function historyItems(conversation, exceptId) {
    const items = [];
    let size = 0;
    for (const message of store.messages.list(conversation.id).filter(item => item.id !== exceptId && item.status !== "failed" && item.status !== "replaced").slice(-HISTORY_MESSAGES).reverse()) {
      if (size + message.text.length > HISTORY_CHARS) break;
      size += message.text.length;
      const user = message.authorId === conversation.ownerId;
      items.unshift({ type: "message", role: user ? "user" : "assistant", content: [{ type: user ? "input_text" : "output_text", text: message.text }] });
    }
    return items;
  }

  async function ensureThread(conversation, { exceptMessageId } = {}) {
    const agent = ownedAgent(conversation.agentId);
    fs.mkdirSync(agent.workspace, { recursive: true });
    const base = { cwd: agent.workspace, approvalPolicy: "on-request", approvalsReviewer: approvalsReviewer(), sandbox: "workspace-write", developerInstructions: instructionsFor(agent, conversation), config: threadConfig(agent, conversation) };
    const current = conversation.codexThreadId && conversation.toolsVersion >= toolsVersion;
    if (current && loaded.has(conversation.codexThreadId)) return conversation.codexThreadId;
    if (current) {
      try {
        await client.request("thread/resume", { threadId: conversation.codexThreadId, ...base, excludeTurns: true });
        loaded.add(conversation.codexThreadId);
        threadOwner.set(conversation.codexThreadId, conversation.id);
        return conversation.codexThreadId;
      } catch (error) {
        log("Codex could not resume thread; starting a new one.", error.message);
      }
    }
    const settings = modelSettings();
    const result = await client.request("thread/start", { ...base, model: settings?.name || null, threadSource: "user", ...(tools ? { dynamicTools: tools.specs(agent, conversation) } : {}) });
    const threadId = result.thread.id;
    loaded.add(threadId);
    threadOwner.set(threadId, conversation.id);
    const history = historyItems(conversation, exceptMessageId);
    if (history.length) await client.request("thread/inject_items", { threadId, items: history }).catch(error => log("Earlier messages could not be added to the new thread.", error.message));
    const previousThreadIds = conversation.codexThreadId ? [...conversation.previousThreadIds, conversation.codexThreadId] : conversation.previousThreadIds;
    store.conversations.update(conversation.id, { codexThreadId: threadId, toolsVersion, previousThreadIds });
    return threadId;
  }

  // One start or resume per conversation at a time: a chat warmed on open
  // and a message sent right away share the same thread.
  function threadFor(conversationId, options) {
    if (preparing.has(conversationId)) return preparing.get(conversationId);
    const pending = ensureThread(store.conversations.get(conversationId), options).finally(() => preparing.delete(conversationId));
    preparing.set(conversationId, pending);
    return pending;
  }

  // Files other than images are copied into the agent's workspace and named
  // in the message, so the agent can open them with its tools.
  function attach(agent, files) {
    if (!files.length) return [];
    const today = new Date(), day = [today.getFullYear(), today.getMonth() + 1, today.getDate()].map(part => String(part).padStart(2, "0")).join("-");
    const folder = path.join(agent.workspace, "attachments", day);
    fs.mkdirSync(folder, { recursive: true });
    return files.map(file => {
      const extension = path.extname(file), stem = path.basename(file, extension);
      let name = path.basename(file), index = 1;
      while (fs.existsSync(path.join(folder, name))) name = `${stem} (${++index})${extension}`;
      fs.copyFileSync(file, path.join(folder, name));
      return path.relative(agent.workspace, path.join(folder, name)).split(path.sep).join("/");
    });
  }

  function inputOf({ text = "", images = [], attached = [] }) {
    const input = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
    if (attached.length) input.push({ type: "text", text: ATTACHED + "\n" + attached.map(file => "- " + file).join("\n"), text_elements: [] });
    for (const image of images) input.push({ type: "localImage", path: image });
    if (!input.length) throw fail(400, "Write a message first.");
    return input;
  }

  return {
    agents: {
      list: () => store.agents.list(owner()),
      get: id => ownedAgent(id),
    },
    conversations: {
      list: options => store.conversations.list(owner(), options),
      get: id => ownedConversation(id),
      create({ agentId, title = null }) {
        ownedAgent(agentId);
        return store.conversations.create({ ownerId: owner(), agentId, title });
      },
      rename(id, title) {
        ownedConversation(id);
        const value = String(title || "").trim().slice(0, 200);
        if (!value) throw fail(400, "Enter a name.");
        return store.conversations.update(id, { title: value });
      },
      archive(id, archived) { ownedConversation(id); return store.conversations.update(id, { archivedAt: archived ? new Date().toISOString() : null }); },
      markRead(id) { const c = ownedConversation(id); return c.read ? c : store.conversations.update(id, { read: true }, { touch: false }); },
      messages: id => { ownedConversation(id); return store.messages.list(id); },
      status: id => { ownedConversation(id); return { running: active.has(id), approvals: [...approvals.values()].filter(item => item.conversationId === id) }; },
      usage: id => { ownedConversation(id); return store.turnUsage.list(id); },
      // A worker's transcript, for following it from the chat. The worker
      // must belong to this conversation.
      async worker(id, threadId) {
        const conversation = ownedConversation(id);
        if (typeof threadId !== "string" || !threadId) throw fail(400, "Choose a worker.");
        const result = await client.request("thread/read", { threadId, includeTurns: true });
        const thread = result.thread || {};
        const roots = new Set([conversation.codexThreadId, ...(conversation.previousThreadIds || [])].filter(Boolean));
        const owned = conversationForThread(threadId) === id || roots.has(thread.parentThreadId);
        if (!owned || roots.has(threadId)) throw fail(404, "This worker isn't part of the conversation.");
        return { threadId, name: thread.agentNickname || thread.name || thread.agentRole || null, status: thread.status || null, turns: thread.turns || [] };
      },
    },
    async history(id) {
      const conversation = ownedConversation(id);
      const messages = store.messages.list(id);
      const threadIds = [...conversation.previousThreadIds, conversation.codexThreadId].filter(Boolean);
      const turns = [];
      let thread = null, unavailable = null;
      for (const threadId of threadIds) {
        try {
          const result = await client.request("thread/read", { threadId, includeTurns: true });
          turns.push(...(result.thread?.turns || []));
          if (threadId === conversation.codexThreadId) thread = { id: result.thread?.id, model: result.thread?.model, status: result.thread?.status };
        } catch (error) { unavailable = error.message; }
      }
      // Messages from before the first local transcript turn (for example a
      // chat restored from the cloud) are shown ahead of the turns.
      const turnIds = new Set(turns.map(turn => turn.id));
      const firstTurn = turns[0]?.startedAt ? turns[0].startedAt * 1000 : Infinity;
      const shown = messages.filter(message => message.status !== "replaced");
      const earlier = shown.filter(message => !turnIds.has(message.turnId) && message.status !== "failed" && Date.parse(message.createdAt) < firstTurn - 2000);
      // Messages that never reached the agent, offered for retry after the last turn.
      const lastTurn = turns.at(-1)?.startedAt ? turns.at(-1).startedAt * 1000 : 0;
      const failed = shown.filter(message => message.status === "failed" && Date.parse(message.createdAt) >= lastTurn - 2000);
      return { turns, messages: shown, earlier, failed, thread, ...(unavailable ? { transcriptUnavailable: unavailable } : {}) };
    },
    // Opens the chat's thread ahead of the first message so sending starts at once.
    async warm(id) {
      const conversation = ownedConversation(id);
      if (active.has(id) || (conversation.codexThreadId && conversation.toolsVersion >= toolsVersion && loaded.has(conversation.codexThreadId))) return { ready: true };
      await threadFor(id);
      return { ready: true };
    },
    setModel(id, settings) {
      ownedConversation(id);
      return store.conversations.update(id, { modelSettings: settings }, { touch: false });
    },
    async send(id, message) {
      const conversation = ownedConversation(id);
      if (active.has(id)) throw fail(409, "Wait for the current reply or stop it first.");
      const attached = attach(ownedAgent(conversation.agentId), message.files || []);
      const input = inputOf({ ...message, attached });
      // A retried message replaces the one that failed to send.
      const retried = message.retryOf ? store.messages.get(message.retryOf) : null;
      if (retried?.conversationId === id && retried.status === "failed") store.messages.update(retried.id, { status: "replaced" });
      const userMessage = store.messages.append({ id: message.clientId || crypto.randomUUID(), conversationId: id, authorId: owner(), text: message.text || "" });
      if (!conversation.title) store.conversations.update(id, { title: titleFrom(message.text || attached.map(file => path.basename(file)).join(", ")) });
      store.conversations.update(id, { read: true });
      let threadId = null;
      try {
        threadId = await threadFor(id, { exceptMessageId: userMessage.id });
        const settings = conversation.modelSettings?.name ? conversation.modelSettings : modelSettings();
        active.set(id, { threadId, turnId: null });
        const result = await client.request("turn/start", {
          threadId, input, clientUserMessageId: userMessage.id, approvalsReviewer: approvalsReviewer(),
          ...settings?.name ? { model: settings.name } : {},
          ...settings?.reasoningEffort ? { effort: settings.reasoningEffort } : {},
        });
        if (active.get(id)?.threadId === threadId) active.set(id, { threadId, turnId: result.turn?.id || active.get(id)?.turnId });
        store.messages.update(userMessage.id, { turnId: result.turn?.id || null, status: "sent" });
        return { message: store.messages.get(userMessage.id), turnId: result.turn?.id || null };
      } catch (error) {
        active.delete(id);
        store.messages.update(userMessage.id, { status: "failed" });
        throw error;
      }
    },
    async interrupt(id) {
      ownedConversation(id);
      // Stop can arrive just before Codex registers the turn; try again
      // briefly while the reply is still starting.
      for (let attempt = 0; ; attempt++) {
        const turn = active.get(id);
        if (!turn) return { interrupted: false };
        try {
          if (turn.turnId) { await client.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId }); return { interrupted: true }; }
        } catch (error) {
          if (attempt >= 20 || !/no active turn|not found|unknown turn/i.test(error.message || "")) throw error;
        }
        if (attempt >= 20) return { interrupted: false };
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    },
    respond(requestId, response) {
      const pending = approvals.get(requestId);
      if (!pending) throw fail(404, "This request was already answered.");
      ownedConversation(pending.conversationId);
      approvals.delete(requestId);
      client.respond(requestId, response);
      notify("approval.resolved", { id: requestId, conversationId: pending.conversationId });
      return { answered: true };
    },
    pendingApprovals: () => [...approvals.values()],
    reset() { active.clear(); approvals.clear(); loaded.clear(); threadOwner.clear(); },
  };
}

function agentWorkspace(root, name, id) {
  const slug = String(name || "agent").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "agent";
  return path.join(root, `${slug}-${id}`);
}

module.exports = { createHarness, agentWorkspace, titleFrom, APPROVAL_METHODS, ATTACHED };
