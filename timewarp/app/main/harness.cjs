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

// A chat's first title: the start of its first message without what isn't
// the user's own words: a quoted message it replies to ("> …"), card answers
// (shown by their summary) and other tags, and Markdown marks.
function titleFrom(text, quoted = false) {
  const own = String(text || "")
    .replace(/^(?:>[^\n]*(?:\n|$))+/, quoted ? match => match.replace(/^> ?/gm, "") : "")
    .replace(/<widget-interaction\b[^>]*\bsummary="([^"]*)"[^>]*>[\s\S]*?<\/widget-interaction>/g, " $1 ")
    .replace(/<widget-trigger-event\b[^>]*>([\s\S]*?)<\/widget-trigger-event>/g, " $1 ")
    .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<\/?[a-z][\w-]*\b[^>]*\/?>/gi, " ")
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/gm, "").replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
    .replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const line = own.replace(/\s+/g, " ").trim();
  // A message that only quotes is named by what it quotes.
  if (!line && !quoted && /^>/.test(String(text || ""))) return titleFrom(text, true);
  return line.length > TITLE_LENGTH ? line.slice(0, TITLE_LENGTH - 1).trimEnd() + "…" : line || "New conversation";
}

const HISTORY_MESSAGES = 60, HISTORY_CHARS = 60000;
// Marks the part of a message that lists attached files (paths in the workspace).
const ATTACHED = "[Attached files, saved in your workspace]";

// tools: { version, call(conversationId, params, agent), finished(conversationId) }. Timewarp's
// tools reach every thread as MCP servers (tool-server.cjs); call answers
// dynamic tool calls from chats started before that, and specs, when given,
// are passed to new threads as dynamic tools.
// approvalsReviewer: "auto_review" lets Codex's reviewer decide requests for
// extra access, as the previous app did; "user" asks the user each time.
// permissions: a named Codex permission profile for each chat (defined in
// threadConfig); without one, chats use the workspace-write sandbox.
// toolsReady: resolves once Timewarp's tool servers are in the Codex config,
// so a chat never starts without them.
// baseInstructions: Timewarp's base prompt (base-instructions.cjs), replacing
// Codex's own on each thread. turnContext(agent, conversation, { sentAt }):
// context for one message (its time, the account, memory) as Codex's
// additional context; Codex adds an entry again only when it changed, so the
// cached prompt stays as it was. workspaceRoots(agent, conversation): the
// folders the chat's commands may write without a review.
function createHarness({ store, client, userId, instructionsFor, threadConfig = () => ({}), permissions = null, toolsReady = () => null, modelSettings, approvalsReviewer = () => "user", tools = null, notify = () => {}, log = () => {}, baseInstructions = null, turnContext = null, workspaceRoots = null }) {
  const toolsVersion = tools?.version || 0;
  const threadOwner = new Map(); // codex thread id -> root conversation id (includes sub-agent threads)
  const workers = new Set(); // sub-agent threads seen in this Codex session
  const loaded = new Set(); // threads resumed or started in this Codex session
  // conversation id -> { threadId, turnId, stopRequested, started }; set as a
  // message is sent, before Codex has the turn (turnId null until then).
  const active = new Map();
  const approvals = new Map(); // request id -> pending server request
  const preparing = new Map(); // conversation id -> thread start or resume in flight
  // A chat's new main thread until the chat records it: its events are the
  // chat's own, not a worker's.
  const starting = new Map(); // codex thread id -> conversation id
  // Messages steered into a running turn until Codex adds them to it: turn id
  // -> Map(message id -> { conversationId, images, files }). Codex drops
  // the ones still waiting when the turn is stopped.
  const steered = new Map();
  // Turns an automation run started (send with run), and those whose agent
  // reported nothing new (quietRun): a quiet run leaves the chat's read state
  // as it was. The last quiet turn ids are kept for isQuietRun after the turn ends.
  const runTurns = new Set(), quietTurns = new Set();

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

  // Only a Codex that stopped or failed ends the runs. "starting" is also the
  // first request starting Codex, whose reply is already being set up here.
  client.on("status", state => {
    if (state.status === "ready" || state.status === "starting") return;
    loaded.clear();
    workers.clear();
    steered.clear();
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
  function addWorker(threadId, conversationId) {
    if (!threadId || !conversationId || conversationForThread(threadId)) return;
    threadOwner.set(threadId, conversationId);
    workers.add(threadId);
  }
  // A worker that Codex hasn't announced (multi-agent workers have no
  // thread/started): its parent threads say whose it is.
  async function ownerFromParents(threadId) {
    const seen = [];
    for (let id = threadId; id && seen.length < 8; ) {
      seen.push(id);
      let thread;
      try { thread = (await client.request("thread/read", { threadId: id, includeTurns: false })).thread; } catch { return null; }
      id = thread?.parentThreadId;
      const owner = conversationForThread(id);
      if (owner) { for (const worker of seen) addWorker(worker, owner); return owner; }
    }
    return null;
  }

  // Attachments of messages that weren't delivered, kept so Retry sends them again.
  const failedKey = conversationId => "failedFiles:" + conversationId;
  function keepFiles(conversationId, messageId, { images = [], files = [] }) {
    if (!images.length && !files.length) return;
    const saved = { ...(store.settings.get(failedKey(conversationId), {}) || {}), [messageId]: { images, files } };
    for (const old of Object.keys(saved).slice(0, -50)) delete saved[old];
    store.settings.set(failedKey(conversationId), saved);
  }
  function dropFiles(conversationId, messageId) {
    const saved = store.settings.get(failedKey(conversationId), {}) || {};
    if (!saved[messageId]) return;
    delete saved[messageId];
    store.settings.set(failedKey(conversationId), saved);
  }
  function undelivered(conversationId, messageId, message) {
    store.messages.update(messageId, { status: "failed" });
    keepFiles(conversationId, messageId, message);
  }

  client.on("notification", ({ method, params }) => {
    if (method === "thread/started" && params.thread?.parentThreadId) addWorker(params.thread.id, conversationForThread(params.thread.parentThreadId));
    // Multi-agent workers are announced only in their parent's items.
    const item = params.item;
    if (item?.type === "subAgentActivity" && item.agentThreadId) addWorker(item.agentThreadId, conversationForThread(params.threadId));
    if (item?.type === "collabAgentToolCall") for (const id of item.receiverThreadIds || []) addWorker(id, conversationForThread(params.threadId));
    const threadId = params.threadId || params.thread?.id;
    const conversationId = conversationForThread(threadId);
    if (!conversationId) return;
    const conversation = store.conversations.get(conversationId);
    if (!conversation) return;
    // The chat's earlier main threads aren't workers.
    if (conversation.previousThreadIds?.includes(threadId)) return;
    const root = threadId === conversation.codexThreadId || starting.get(threadId) === conversationId;
    if (root && method === "turn/started") {
      const entry = active.get(conversationId);
      if (entry) Object.assign(entry, { threadId: params.threadId, turnId: params.turn.id, running: true });
      else active.set(conversationId, { threadId: params.threadId, turnId: params.turn.id, running: true });
      // Stop pressed while the reply was starting: Codex runs the turn now, so
      // the interrupt takes effect (one sent earlier can arrive before the turn runs).
      if (entry?.stopRequested) sendStop(conversationId, entry);
    }
    if (root && (method === "item/started" || method === "item/completed") && item?.type === "userMessage" && item.clientId) steered.get(params.turnId)?.delete(item.clientId);
    if (root && method === "turn/completed") {
      // An earlier turn's late completion leaves the current one running.
      if (active.get(conversationId)?.turnId === params.turn.id) active.delete(conversationId);
      for (const [messageId, message] of steered.get(params.turn.id) || []) undelivered(message.conversationId, messageId, message);
      steered.delete(params.turn.id);
      runTurns.delete(params.turn.id);
      if (!quietTurns.has(params.turn.id)) store.conversations.update(conversationId, { read: false });
      tools?.finished?.(conversationId);
    }
    // Interim notes ("commentary") show only while the agent works, as before;
    // the chat keeps its replies.
    if (root && method === "item/completed" && params.item?.type === "agentMessage" && params.item.text && params.item.phase !== "commentary") {
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
    const threadId = message.params?.threadId || message.params?.conversationId;
    void Promise.resolve(conversationForThread(threadId) || ownerFromParents(threadId)).then(conversationId => {
      if (!conversationId) {
        client.respondError(message.id, "No conversation is waiting for this request.");
        return;
      }
      const pending = { id: message.id, method: message.method, params: message.params, conversationId, requestedAt: Date.now() };
      approvals.set(message.id, pending);
      notify("approval.requested", pending);
    }).catch(error => log("A request could not be shown.", error.message));
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
    const conversationId = conversationForThread(params.threadId) || await ownerFromParents(params.threadId);
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

  // The chat's writable folders, given again with each message so a change
  // (memory turned off, say) applies to its next turn.
  function rootsFor(agent, conversation) {
    const roots = workspaceRoots?.(agent, conversation);
    return roots?.length ? { runtimeWorkspaceRoots: roots } : {};
  }
  // A message's context, which never holds up sending for long: a part that
  // isn't ready in time is left out of this message.
  async function contextFor(conversation, sentAt) {
    if (!turnContext || !conversation) return {};
    let timer;
    try {
      const agent = store.agents.get(conversation.agentId);
      const late = new Promise(resolve => { timer = setTimeout(resolve, 2500, null); timer.unref?.(); });
      const value = await Promise.race([turnContext(agent, conversation, { sentAt }), late]);
      // Codex takes { kind, value } per entry; Timewarp's own context is "application".
      const entries = Object.entries(value || {}).filter(([, entry]) => typeof entry === "string" ? entry : entry?.value)
        .map(([key, entry]) => [key, typeof entry === "string" ? { kind: "application", value: entry } : entry]);
      return entries.length ? { additionalContext: Object.fromEntries(entries) } : {};
    } catch (error) { log("A message's context could not be added.", error.message); return {}; }
    finally { clearTimeout(timer); }
  }

  async function ensureThread(conversation, { exceptMessageId } = {}) {
    await toolsReady();
    const agent = ownedAgent(conversation.agentId);
    fs.mkdirSync(agent.workspace, { recursive: true });
    const base = {
      cwd: agent.workspace, approvalPolicy: "on-request", approvalsReviewer: approvalsReviewer(), ...(permissions ? { permissions } : { sandbox: "workspace-write" }),
      ...(baseInstructions ? { baseInstructions: typeof baseInstructions === "function" ? baseInstructions(agent, conversation) : baseInstructions } : {}),
      ...rootsFor(agent, conversation),
      developerInstructions: instructionsFor(agent, conversation), config: threadConfig(agent, conversation),
    };
    const current = conversation.codexThreadId && conversation.toolsVersion >= toolsVersion;
    if (current && loaded.has(conversation.codexThreadId)) return conversation.codexThreadId;
    // A thread Codex unloaded to change its AI funding (provider-changed) resumes once more.
    for (let attempt = 0; current; attempt++) {
      try {
        await client.request("thread/resume", { threadId: conversation.codexThreadId, ...base, excludeTurns: true });
        loaded.add(conversation.codexThreadId);
        threadOwner.set(conversation.codexThreadId, conversation.id);
        return conversation.codexThreadId;
      } catch (error) {
        if (error.code === "provider-changed" && !attempt) continue;
        log("Codex could not resume thread; starting a new one.", error.message);
        break;
      }
    }
    const settings = modelSettings();
    const result = await client.request("thread/start", { ...base, model: settings?.name || null, threadSource: "user", ...(tools?.specs ? { dynamicTools: tools.specs(agent, conversation) } : {}) });
    const threadId = result.thread.id;
    starting.set(threadId, conversation.id);
    try {
      loaded.add(threadId);
      threadOwner.set(threadId, conversation.id);
      const history = historyItems(conversation, exceptMessageId);
      if (history.length) await client.request("thread/inject_items", { threadId, items: history }).catch(error => log("Earlier messages could not be added to the new thread.", error.message));
      const previousThreadIds = conversation.codexThreadId ? [...conversation.previousThreadIds, conversation.codexThreadId] : conversation.previousThreadIds;
      store.conversations.update(conversation.id, { codexThreadId: threadId, toolsVersion, previousThreadIds });
    } finally { starting.delete(threadId); }
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

  function inputOf({ text = "", images = [], attached = [], skills = [] }) {
    const input = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
    if (attached.length) input.push({ type: "text", text: ATTACHED + "\n" + attached.map(file => "- " + file).join("\n"), text_elements: [] });
    for (const image of images) input.push({ type: "localImage", path: image });
    // Skills chosen with @ or $ in the composer, for Codex to load.
    for (const skill of skills) input.push({ type: "skill", name: skill.name, path: skill.path });
    if (!input.length) throw fail(400, "Write a message first.");
    return input;
  }

  // A message sent while the agent works joins its current turn, as before.
  // Codex adds it at the next step, or drops it if the turn is stopped first.
  async function steer(id, running, input, userMessage, message) {
    if (!steered.has(running.turnId)) steered.set(running.turnId, new Map());
    steered.get(running.turnId).set(userMessage.id, { conversationId: id, images: message.images || [], files: message.files || [] });
    try {
      const context = await contextFor(store.conversations.get(id), userMessage.createdAt);
      const result = await client.request("turn/steer", { threadId: running.threadId, expectedTurnId: running.turnId, input, clientUserMessageId: userMessage.id, ...context });
      store.messages.update(userMessage.id, { turnId: result.turnId || running.turnId, status: "sent" });
      return { message: store.messages.get(userMessage.id), turnId: result.turnId || running.turnId, steered: true };
    } catch (error) {
      steered.get(running.turnId)?.delete(userMessage.id);
      throw error;
    }
  }
  // Codex takes a moment to register a turn it has just started: Stop is
  // tried again briefly while the turn is still the chat's.
  async function stopTurn(id, threadId, turnId) {
    for (let attempt = 0; ; attempt++) {
      try { await client.request("turn/interrupt", { threadId, turnId }); return true; }
      catch (error) {
        if (attempt >= 20 || !/no active turn|not found|unknown turn/i.test(error.message || "")) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      if (active.get(id)?.turnId !== turnId) return false;
    }
  }
  // A turn asked to stop while it was starting gets an interrupt as soon as
  // Codex has it, and one more once Codex reports it running: one that reaches
  // Codex before the turn runs may find nothing to stop.
  function sendStop(id, entry) {
    const sent = entry.running ? "stopSentRunning" : "stopSentEarly";
    if (entry[sent] || !entry.turnId) return;
    entry[sent] = true;
    void stopTurn(id, entry.threadId, entry.turnId).catch(error => log("The reply could not be stopped.", error.message));
  }
  // The turn ended (or another one runs) as the message was steered.
  const turnEnded = error => error.code === "provider-changed" || /no active turn|expected active turn/i.test(error.message || "");

  async function start(id, conversation, input, userMessage, message) {
    const entry = { threadId: null, turnId: null, stopRequested: false, started: null };
    let started;
    entry.started = new Promise(resolve => { started = resolve; });
    active.set(id, entry);
    try {
      // Prepared while the thread opens.
      const context = contextFor(conversation, userMessage.createdAt);
      const turnStart = async threadId => {
        entry.threadId = threadId;
        const settings = conversation.modelSettings?.name ? conversation.modelSettings : modelSettings();
        const agent = store.agents.get(conversation.agentId);
        return client.request("turn/start", {
          threadId, input, clientUserMessageId: userMessage.id, approvalsReviewer: approvalsReviewer(), ...await context, ...(agent ? rootsFor(agent, conversation) : {}),
          ...settings?.name ? { model: settings.name } : {},
          ...settings?.reasoningEffort ? { effort: settings.reasoningEffort } : {},
          // The chosen speed (null is Standard); codex-funding.cjs checks it
          // against the model's tiers. Older chats without one use the model's default.
          ...settings && settings.serviceTier !== undefined ? { serviceTier: settings.serviceTier } : {},
        });
      };
      let threadId = await threadFor(id, { exceptMessageId: userMessage.id });
      let result;
      try { result = await turnStart(threadId); }
      catch (error) {
        if (error.code !== "provider-changed") throw error;
        // Codex unloaded the thread to change its AI funding: resume it on the new one and start again.
        loaded.delete(threadId);
        threadId = await threadFor(id, { exceptMessageId: userMessage.id });
        result = await turnStart(threadId);
      }
      const turnId = result.turn?.id || null;
      if (active.get(id) === entry && !entry.turnId) entry.turnId = turnId;
      store.messages.update(userMessage.id, { turnId, status: "sent" });
      // Stop pressed while the reply was starting (sent again once Codex reports the turn running).
      if (entry.stopRequested && turnId) { if (!entry.turnId) entry.turnId = turnId; sendStop(id, entry); }
      return { message: store.messages.get(userMessage.id), turnId };
    } catch (error) {
      if (active.get(id) === entry) active.delete(id);
      undelivered(id, userMessage.id, message);
      throw error;
    } finally { started(); }
  }

  return {
    agents: {
      list: () => store.agents.list(owner()),
      get: id => ownedAgent(id),
    },
    conversations: {
      list: options => store.conversations.list(owner(), options),
      get: id => ownedConversation(id),
      // A new chat keeps the model settings current when it starts, so a later
      // change to the default (Settings → General → Model) leaves it as it was.
      create({ agentId, title = null }) {
        ownedAgent(agentId);
        const settings = modelSettings?.();
        return store.conversations.create({ ownerId: owner(), agentId, title, modelSettings: settings?.name ? { ...settings } : null });
      },
      rename(id, title) {
        ownedConversation(id);
        const value = String(title || "").trim().slice(0, 200);
        if (!value) throw fail(400, "Enter a name.");
        return store.conversations.update(id, { title: value });
      },
      archive(id, archived) { ownedConversation(id); return store.conversations.update(id, { archivedAt: archived ? new Date().toISOString() : null }); },
      markRead(id) { const c = ownedConversation(id); return c.read ? c : store.conversations.update(id, { read: true }, { touch: false }); },
      markUnread(id) { const c = ownedConversation(id); return c.read ? store.conversations.update(id, { read: false }, { touch: false }) : c; },
      messages: id => { ownedConversation(id); return store.messages.list(id); },
      status: id => { ownedConversation(id); return { running: active.has(id), approvals: [...approvals.values()].filter(item => item.conversationId === id) }; },
      usage: id => { ownedConversation(id); return store.turnUsage.list(id); },
      // A worker's transcript, for following it from the chat. The worker
      // must belong to this conversation.
      async worker(id, threadId) {
        const conversation = ownedConversation(id);
        if (typeof threadId !== "string" || !threadId) throw fail(400, "Choose a worker.");
        const roots = new Set([conversation.codexThreadId, ...(conversation.previousThreadIds || [])].filter(Boolean));
        if (roots.has(threadId)) throw fail(404, "This worker isn't part of the conversation.");
        let result;
        try { result = await client.request("thread/read", { threadId, includeTurns: true }); }
        catch (error) {
          // A worker that has just started has nothing saved yet.
          if (conversationForThread(threadId) === id && /is empty/i.test(error.message || "")) return { threadId, name: null, status: null, turns: [] };
          throw error;
        }
        const thread = result.thread || {};
        const owned = conversationForThread(threadId) === id || roots.has(thread.parentThreadId);
        if (!owned) throw fail(404, "This worker isn't part of the conversation.");
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
      // A turn Codex still lists as running but this app isn't running (it
      // was cut off when Timewarp or Codex quit) shows as interrupted.
      const live = active.get(id), last = turns.at(-1);
      for (const [index, turn] of turns.entries()) {
        const running = live && (live.turnId ? live.turnId === turn.id : turn === last);
        if (turn.status === "inProgress" && !running) turns[index] = { ...turn, status: "interrupted", stale: true };
      }
      // Messages from before the first local transcript turn (for example a
      // chat restored from the cloud) are shown ahead of the turns.
      const turnIds = new Set(turns.map(turn => turn.id));
      const firstTurn = turns[0]?.startedAt ? turns[0].startedAt * 1000 : Infinity;
      const shown = messages.filter(message => message.status !== "replaced");
      const earlier = shown.filter(message => !turnIds.has(message.turnId) && message.status !== "failed" && Date.parse(message.createdAt) < firstTurn - 2000);
      // Messages that never reached the agent, offered for retry after the last turn.
      const lastTurn = turns.at(-1)?.startedAt ? turns.at(-1).startedAt * 1000 : 0;
      const files = store.settings.get(failedKey(id), {}) || {};
      const failed = shown.filter(message => message.status === "failed" && Date.parse(message.createdAt) >= lastTurn - 2000).map(message => ({ ...message, ...files[message.id] }));
      return { turns, messages: shown, earlier, failed, thread, ...(unavailable ? { transcriptUnavailable: unavailable } : {}) };
    },
    // Opens the chat's thread ahead of the first message so sending starts at once.
    async warm(id) {
      const conversation = ownedConversation(id);
      if (active.has(id) || (conversation.codexThreadId && conversation.toolsVersion >= toolsVersion && loaded.has(conversation.codexThreadId))) return { ready: true };
      await threadFor(id);
      return { ready: true };
    },
    // settings: { name, reasoningEffort, serviceTier } (serviceTier null is Standard).
    setModel(id, settings) {
      ownedConversation(id);
      return store.conversations.update(id, { modelSettings: settings }, { touch: false });
    },
    // While the agent works, a message the user sends (steer) joins its
    // current turn; otherwise, such as an automation's run, it waits (409).
    // run: { text } is an automation's run. The agent gets run.text (the
    // instructions in a note saying Timewarp started the turn) while the chat
    // keeps message.text; the chat's read state stays as it was, since the user
    // didn't write it.
    async send(id, message, { steer: join = false, run = null } = {}) {
      const conversation = ownedConversation(id);
      if (!join && active.has(id)) throw fail(409, "Wait for the current reply or stop it first.");
      // A reply still starting is waited for, so the message joins it. From
      // here to start() nothing waits, so two sends at once can't both start a turn.
      for (let entry = active.get(id), seen = null; entry && !entry.turnId && entry !== seen; entry = active.get(id)) { seen = entry; await entry.started; }
      const attached = attach(ownedAgent(conversation.agentId), message.files || []);
      const input = inputOf({ ...message, ...(run?.text ? { text: run.text } : {}), attached });
      // A retried message replaces the one that failed to send.
      const retried = message.retryOf ? store.messages.get(message.retryOf) : null;
      if (retried?.conversationId === id && retried.status === "failed") { store.messages.update(retried.id, { status: "replaced" }); dropFiles(id, retried.id); }
      const userMessage = store.messages.append({ id: message.clientId || crypto.randomUUID(), conversationId: id, authorId: owner(), text: message.text || "" });
      if (!conversation.title) store.conversations.update(id, { title: titleFrom(message.text || attached.map(file => path.basename(file)).join(", ")) });
      if (!run) store.conversations.update(id, { read: true });
      const running = active.get(id);
      if (running?.turnId) {
        // The user joined a run's turn: it's theirs now, and its reply counts.
        if (!run) { runTurns.delete(running.turnId); quietTurns.delete(running.turnId); }
        try { return await steer(id, running, input, userMessage, message); }
        catch (error) {
          if (!turnEnded(error)) { undelivered(id, userMessage.id, message); throw error; }
          // The turn ended as the message arrived: it starts the next one.
          if (active.get(id) === running) active.delete(id);
        }
      }
      const result = await start(id, conversation, input, userMessage, message);
      if (run && result.turnId) { runTurns.add(result.turnId); for (const old of [...runTurns].slice(0, -100)) runTurns.delete(old); }
      return result;
    },
    // The agent reported that its automation run found nothing for the user
    // (automation-tools nothing_to_report): the chat isn't marked unread when
    // the turn ends. False when the chat isn't in a run's turn.
    quietRun(id) {
      const turnId = active.get(id)?.turnId;
      if (!turnId || !runTurns.has(turnId)) return false;
      quietTurns.add(turnId);
      for (const old of [...quietTurns].slice(0, -100)) quietTurns.delete(old);
      return true;
    },
    isQuietRun: turnId => quietTurns.has(turnId),
    async interrupt(id) {
      ownedConversation(id);
      const turn = active.get(id);
      if (!turn) return { interrupted: false };
      // Before Codex has the turn: it is stopped as soon as it starts.
      if (!turn.turnId) { turn.stopRequested = true; return { interrupted: true }; }
      return { interrupted: await stopTurn(id, turn.threadId, turn.turnId) };
    },
    // Unloads the chats that aren't replying, with their workers, so their
    // next message resumes them (on the current AI funding source).
    async unloadIdle() {
      const busy = new Set(active.keys());
      const threads = [...loaded, ...workers].filter(threadId => !busy.has(conversationForThread(threadId)));
      for (const threadId of threads) { loaded.delete(threadId); workers.delete(threadId); }
      for (const threadId of threads) await client.request("thread/unsubscribe", { threadId }).catch(() => {});
      return { unloaded: threads.length };
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
    // Whether any chat is replying (Codex restarts only when none is).
    busy: () => active.size > 0,
    // The chat a Codex thread belongs to, including its workers' threads.
    conversationFor: threadId => conversationForThread(threadId),
    reset() { active.clear(); approvals.clear(); loaded.clear(); threadOwner.clear(); workers.clear(); steered.clear(); },
  };
}

function agentWorkspace(root, name, id) {
  const slug = String(name || "agent").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "agent";
  return path.join(root, `${slug}-${id}`);
}

module.exports = { createHarness, agentWorkspace, titleFrom, APPROVAL_METHODS, ATTACHED };
