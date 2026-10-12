"use strict";
// Share invites between members of an organization: a copy of a chat, an agent
// or an automation, sent through the cloud to the members the sender chooses.
// Nothing is shared live and nothing else becomes shared by being in an
// organization. The recipient accepts the invite and gets a personal copy,
// made here with their own agents; connected apps, the vault, memory, files
// and the sender's accounts never go with it.
const fs = require("node:fs");
const path = require("node:path");

const fail = (status, message) => Object.assign(new Error(message), { status });
const KINDS = new Set(["chat", "agent", "automation"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The cloud takes requests of up to 2 MB, so a share's content stays below this.
const MAX_PAYLOAD = 1_500_000;
const MAX_MESSAGE = 100_000, MAX_MESSAGES = 2000;
const MAX_AVATAR = 600_000;
const MAX_WORKFLOWS = 20, MAX_WORKFLOW_FILES = 40, MAX_WORKFLOW_FILE = 256 * 1024, MAX_WORKFLOW_BYTES = 600_000;
const MASCOT = /\/mascots\/(orbit|nova|cosmo)\.png$/;
// A safe file or folder name inside a shared workflow.
const SEGMENT = /^[\w][\w .-]{0,99}$/;
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
const preview = value => String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);

function createShares({ store, agents, harness, automations, accountRpc: cloudRpc, userId }) {
  const owner = () => { const value = userId(); if (!value) throw fail(401, "Sign in to Timewarp."); return value; };
  // A cloud without sharing yet answers 410.
  const accountRpc = (name, input) => cloudRpc(name, input).catch(error => { throw error?.status === 410 ? fail(503, "Sharing isn't available yet. Try again later.") : error; });
  // Shares accepted on this computer, so accepting again after a lost answer
  // doesn't make a second copy.
  const acceptedKey = "sharesAccepted";
  const accepted = () => store.settings.get(acceptedKey, {}) || {};
  const remember = (shareId, value) => {
    const all = { ...accepted(), [shareId]: { ...value, ownerId: owner(), at: new Date().toISOString() } };
    const keys = Object.keys(all);
    for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete all[key];
    store.settings.set(acceptedKey, all);
  };
  // Content opened for the accept dialog, kept until it is answered.
  const opened = new Map();

  // The chat's messages as text, newest kept when it is too long to send whole.
  function exportChat(id) {
    const conversation = harness.conversations.get(id);
    const agent = store.agents.get(conversation.agentId);
    const all = store.messages.list(id).filter(message => message.status !== "failed" && message.status !== "replaced"
      && message.text.trim() && !message.text.startsWith("<agent-introduction>"));
    const messages = [];
    let size = 0;
    for (const message of [...all].reverse()) {
      const attached = [...(message.images || []), ...(message.files || [])].map(file => path.basename(file));
      const body = (message.text.length > MAX_MESSAGE ? message.text.slice(0, MAX_MESSAGE) + "…" : message.text) + (attached.length ? `\n\n(Attached: ${attached.join(", ")})` : "");
      const item = { role: message.authorId === conversation.ownerId ? "user" : "agent", text: body, createdAt: message.createdAt };
      if (messages.length >= MAX_MESSAGES || size + bytes(item) > MAX_PAYLOAD) break;
      size += bytes(item);
      messages.unshift(item);
    }
    if (!messages.length) throw fail(400, "This conversation has no messages to share yet.");
    const title = conversation.title?.trim() || agent?.name || "Conversation";
    const omitted = all.length - messages.length;
    return {
      title,
      summary: { agentName: agent?.name || null, messages: messages.length, omitted, preview: preview(messages.find(item => item.role === "user")?.text || messages[0].text) },
      payload: { version: 1, title, agentName: agent?.name || null, messages, omitted },
    };
  }

  // A workflow folder's text files, relative to it with "/" between parts.
  function workflowFiles(folder) {
    const files = [];
    let total = 0;
    const walk = (dir, prefix, depth) => {
      if (depth > 5) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= MAX_WORKFLOW_FILES || !SEGMENT.test(entry.name) || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name), relative = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.isDirectory()) { walk(full, relative, depth + 1); continue; }
        if (!entry.isFile()) continue;
        const stat = fs.statSync(full);
        if (stat.size > MAX_WORKFLOW_FILE || total + stat.size > MAX_WORKFLOW_BYTES) continue;
        const data = fs.readFileSync(full);
        if (data.includes(0)) continue;
        total += stat.size;
        files.push({ path: relative, content: data.toString("utf8") });
      }
    };
    walk(folder, "", 0);
    return files;
  }
  function exportWorkflows(agent) {
    const root = path.join(agent.workspace, ".agents", "skills");
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
    const workflows = [];
    for (const entry of entries.filter(item => item.isDirectory() && SEGMENT.test(item.name)).slice(0, MAX_WORKFLOWS)) {
      try {
        const files = workflowFiles(path.join(root, entry.name));
        if (files.some(file => file.path === "SKILL.md")) workflows.push({ name: entry.name, files });
      } catch {}
    }
    return workflows;
  }
  // Its name, picture, responsibilities, AGENTS.md and workflows.
  function exportAgent(id) {
    const agent = agents.get(id);
    const mascot = MASCOT.exec(agent.avatarUrl || "");
    const avatar = mascot ? { mascot: mascot[1] } : agent.avatarType === "uploaded" && String(agent.avatarUrl || "").length <= MAX_AVATAR ? { imageUrl: agent.avatarUrl } : null;
    const workflows = exportWorkflows(agent);
    const payload = { version: 1, name: agent.name, responsibilities: agent.instructions || "", instructions: agents.workspaceInstructions(id), avatar, workflows };
    if (bytes(payload) > MAX_PAYLOAD) throw fail(413, "This agent is too large to share. Its instructions and workflows must be under 1.5 MB.");
    return {
      title: agent.name,
      summary: { mascot: mascot ? mascot[1] : null, description: preview(agent.instructions), workflows: workflows.map(item => item.name) },
      payload,
    };
  }
  // Its name, instructions and schedule. The time zone is the recipient's.
  function exportAutomation(id) {
    const automation = automations.get(id);
    const agent = store.agents.get(automation.agentId);
    const { tz, start, ...schedule } = automation.schedule || {};
    return {
      title: automation.name,
      summary: { agentName: agent?.name || null, schedule, preview: preview(automation.instructions) },
      payload: { version: 1, name: automation.name, instructions: automation.instructions, schedule, agentName: agent?.name || null },
    };
  }
  const exporters = { chat: exportChat, agent: exportAgent, automation: exportAutomation };

  function materializeChat(share, agentId) {
    const agent = harness.agents.get(agentId);
    const messages = (Array.isArray(share.payload.messages) ? share.payload.messages : []).filter(item => typeof item?.text === "string" && item.text.trim()).slice(0, MAX_MESSAGES);
    if (!messages.length) throw fail(400, "This shared conversation has no messages.");
    const me = owner();
    const conversation = store.transaction(() => {
      const created = harness.conversations.create({ agentId: agent.id, title: text(share.payload.title, 200).trim() || share.title });
      let last = null;
      for (const item of messages) {
        const at = Date.parse(item.createdAt);
        last = store.messages.append({ conversationId: created.id, authorId: item.role === "user" ? me : agent.id, text: text(item.text, MAX_MESSAGE + 200), createdAt: Number.isFinite(at) ? new Date(at).toISOString() : undefined, status: "sent" });
      }
      store.settings.set("sharedChat:" + created.id, { from: share.sender || null, sharedAt: share.createdAt || null, through: last?.id || null, omitted: Number(share.payload.omitted) || 0 });
      return store.conversations.update(created.id, { read: false }, { touch: false });
    });
    return { kind: "chat", conversationId: conversation.id, agentId: agent.id };
  }
  function writeWorkflows(workspace, workflows) {
    const root = path.join(workspace, ".agents", "skills");
    for (const workflow of (Array.isArray(workflows) ? workflows : []).slice(0, MAX_WORKFLOWS)) {
      if (typeof workflow?.name !== "string" || !SEGMENT.test(workflow.name)) continue;
      const files = (Array.isArray(workflow.files) ? workflow.files : []).slice(0, MAX_WORKFLOW_FILES)
        .filter(file => typeof file?.path === "string" && typeof file.content === "string" && file.path.split("/").length <= 6 && file.path.split("/").every(part => SEGMENT.test(part) && part !== "." && part !== ".."));
      if (!files.some(file => file.path === "SKILL.md")) continue;
      const folder = path.join(root, workflow.name);
      if (fs.existsSync(folder)) continue;
      for (const file of files) {
        const target = path.join(folder, ...file.path.split("/"));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content.slice(0, MAX_WORKFLOW_FILE), { flag: "wx" });
      }
    }
  }
  function materializeAgent(share) {
    const payload = share.payload;
    const input = { name: text(payload.name, 60) || share.title, instructions: text(payload.responsibilities, 20000) };
    let agent;
    try { agent = agents.create({ ...input, avatar: payload.avatar && typeof payload.avatar === "object" ? payload.avatar : undefined }); }
    catch (error) { if (error.status !== 400 || !payload.avatar) throw error; agent = agents.create(input); }
    const instructions = text(payload.instructions, 50000).replace(/\r\n/g, "\n").trim();
    if (instructions) fs.writeFileSync(path.join(agent.workspace, "AGENTS.md"), `# ${agent.name}\n\n${instructions}\n`);
    writeWorkflows(agent.workspace, payload.workflows);
    return { kind: "agent", agentId: agent.id };
  }
  function materializeAutomation(share, agentId, enabled) {
    const payload = share.payload;
    const automation = automations.create({ agentId, name: text(payload.name, 80) || share.title, instructions: text(payload.instructions, 20000), schedule: payload.schedule, enabled: enabled !== false });
    return { kind: "automation", automationId: automation.id, agentId, conversationId: automation.conversationId };
  }

  async function open(shareId) {
    owner();
    if (!UUID.test(String(shareId))) throw fail(400, "Choose a share.");
    const share = await accountRpc("product.shares.open", { shareId });
    if (!share || !KINDS.has(share.kind) || !share.payload || typeof share.payload !== "object") throw fail(404, "This share is no longer available.");
    opened.set(shareId, share);
    return share;
  }

  return {
    exportItem(kind, id) {
      if (!exporters[kind]) throw fail(400, "Choose a chat, an agent or an automation to share.");
      return exporters[kind](id);
    },
    async send({ kind, id, organizationId, recipientUserIds }) {
      owner();
      if (!exporters[kind] || typeof id !== "string") throw fail(400, "Choose a chat, an agent or an automation to share.");
      if (!UUID.test(String(organizationId))) throw fail(400, "Create or join an organization first.");
      const recipients = [...new Set((Array.isArray(recipientUserIds) ? recipientUserIds : []).filter(value => UUID.test(String(value))))];
      if (!recipients.length) throw fail(400, "Choose who to share with.");
      if (recipients.length > 20) throw fail(400, "Share with up to 20 people at a time.");
      const item = exporters[kind](id);
      const result = await accountRpc("product.shares.create", { organizationId, kind, recipientUserIds: recipients, title: item.title, summary: item.summary, payload: item.payload });
      return { sent: Array.isArray(result?.ids) ? result.ids.length : recipients.length };
    },
    async list() {
      owner();
      const value = await accountRpc("product.shares.list");
      const done = accepted();
      return {
        incoming: (Array.isArray(value?.incoming) ? value.incoming : []).map(share => ({ ...share, acceptedHere: !!done[share.id] })),
        outgoing: Array.isArray(value?.outgoing) ? value.outgoing : [],
      };
    },
    open,
    // agentId: the recipient's agent a chat or automation goes to; enabled:
    // whether an automation starts running.
    async accept({ shareId, agentId, enabled }) {
      const me = owner();
      let result = accepted()[shareId];
      if (result?.ownerId !== me) result = null;
      if (!result) {
        const share = opened.get(shareId) || await open(shareId);
        if (share.kind === "chat") result = materializeChat(share, agentId);
        else if (share.kind === "agent") result = materializeAgent(share);
        else result = materializeAutomation(share, agentId, enabled);
        remember(shareId, result);
      }
      opened.delete(shareId);
      // A share the sender withdrew meanwhile is already copied: the copy stays.
      try { await accountRpc("product.shares.respond", { shareId, response: "accept" }); }
      catch (error) { if (error.status !== 404) throw error; }
      const { ownerId, at, ...copy } = result;
      return copy;
    },
    async decline({ shareId }) {
      owner();
      if (!UUID.test(String(shareId))) throw fail(400, "Choose a share.");
      opened.delete(shareId);
      await accountRpc("product.shares.respond", { shareId, response: "decline" });
      return { declined: true };
    },
    async cancel({ shareId }) {
      owner();
      if (!UUID.test(String(shareId))) throw fail(400, "Choose a share.");
      await accountRpc("product.shares.respond", { shareId, response: "cancel" });
      return { canceled: true };
    },
    // Who shared a chat that was accepted on this computer, for the chat's first line.
    chatInfo(conversationId) {
      harness.conversations.get(conversationId);
      return store.settings.get("sharedChat:" + conversationId, null);
    },
  };
}

module.exports = { createShares, MAX_PAYLOAD };
