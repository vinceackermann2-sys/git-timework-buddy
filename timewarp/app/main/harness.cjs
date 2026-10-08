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

function createHarness({ store, client, userId, instructionsFor, threadConfig = () => ({}), modelSettings, notify = () => {}, log = () => {} }) {
  const threadOwner = new Map(); // codex thread id -> root conversation id (includes sub-agent threads)
  const loaded = new Set(); // threads resumed or started in this Codex session
  const active = new Map(); // conversation id -> { threadId, turnId }
  const approvals = new Map(); // request id -> pending server request

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
    }
    if (root && method === "item/completed" && params.item?.type === "agentMessage" && params.item.text) {
      store.messages.append({ id: params.item.id, conversationId, authorId: conversation.agentId, text: params.item.text, turnId: params.turnId });
    }
    if (root && method === "thread/name/updated" && params.threadName) store.conversations.update(conversationId, { title: params.threadName });
    emit(conversationId, method, { ...params, subAgent: !root });
  });

  client.on("request", message => {
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

  async function ensureThread(conversation) {
    const agent = ownedAgent(conversation.agentId);
    fs.mkdirSync(agent.workspace, { recursive: true });
    const base = { cwd: agent.workspace, approvalPolicy: "on-request", sandbox: "workspace-write", developerInstructions: instructionsFor(agent, conversation), config: threadConfig(agent, conversation) };
    if (conversation.codexThreadId && loaded.has(conversation.codexThreadId)) return conversation.codexThreadId;
    if (conversation.codexThreadId) {
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
    const result = await client.request("thread/start", { ...base, model: settings?.name || null, threadSource: "user" });
    const threadId = result.thread.id;
    loaded.add(threadId);
    threadOwner.set(threadId, conversation.id);
    store.conversations.update(conversation.id, { codexThreadId: threadId });
    return threadId;
  }

  function inputOf({ text = "", images = [] }) {
    const input = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
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
    },
    async history(id) {
      const conversation = ownedConversation(id);
      const messages = store.messages.list(id);
      if (!conversation.codexThreadId) return { turns: [], messages };
      try {
        const result = await client.request("thread/read", { threadId: conversation.codexThreadId, includeTurns: true });
        return { turns: result.thread?.turns || [], messages, thread: { id: result.thread?.id, model: result.thread?.model, status: result.thread?.status } };
      } catch (error) {
        // A restored chat may have no Codex transcript on this device.
        return { turns: [], messages, transcriptUnavailable: error.message };
      }
    },
    async send(id, message) {
      const conversation = ownedConversation(id);
      if (active.has(id)) throw fail(409, "Wait for the current reply or stop it first.");
      const input = inputOf(message);
      const userMessage = store.messages.append({ id: message.clientId || crypto.randomUUID(), conversationId: id, authorId: owner(), text: message.text || "" });
      if (!conversation.title) store.conversations.update(id, { title: titleFrom(message.text) });
      store.conversations.update(id, { read: true });
      const threadId = await ensureThread(store.conversations.get(id));
      const settings = modelSettings();
      active.set(id, { threadId, turnId: null });
      try {
        const result = await client.request("turn/start", {
          threadId, input, clientUserMessageId: userMessage.id,
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
      const turn = active.get(id);
      if (!turn?.turnId) return { interrupted: false };
      await client.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId });
      return { interrupted: true };
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

module.exports = { createHarness, agentWorkspace, titleFrom, APPROVAL_METHODS };
