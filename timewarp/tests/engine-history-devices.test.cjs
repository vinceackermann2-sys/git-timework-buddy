"use strict";
// One account on two computers: a chat continued on one is there, in order,
// on the other, and its agent there carries on from it (desktop/local-history.cjs,
// history-adapter.cjs, harness.cjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { stripTypeScriptTypes } = require("node:module");
const { openStore } = require("../app/main/store.cjs");
const { createHistoryAdapter, entryId } = require("../app/main/history-adapter.cjs");
const { createHarness } = require("../app/main/harness.cjs");
const { createLocalHistory } = require("../desktop/local-history.cjs");

// The cloud's own check of a chat (cloud/nativeHistory.ts), and its merge:
// entries by id, the newer conversation, a new version on every save.
const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, "../cloud/nativeHistory.ts"), "utf8"), { mode: "strip" }).replace(/^import[^\n]*\n/gm, "").replace(/export /g, "");
const checks = vm.createContext({ assertCloudSafe: require("../shared/privacy.cjs").assertCloudSafe });
vm.runInContext(source, checks);
function historyCloud(user) {
  const rows = new Map(), saves = [];
  let clock = 0;
  const cloud = async (_route, input) => {
    if (input.operation === "list") return { protocol: 2, manifest: [...rows.values()].map(row => ({ id: row.conversation.id, version: row.version })), nextOffset: null };
    if (input.operation === "get") return { protocol: 2, chats: input.ids.map(id => structuredClone(rows.get(id))) };
    let chat;
    try { chat = checks.historySnapshot(user, input.snapshot); } catch (error) { throw Object.assign(new Error(error.message), { status: error.status }); }
    saves.push(chat);
    const row = rows.get(chat.conversation.id);
    if (row) {
      if (chat.conversation.updatedAt >= row.conversation.updatedAt) row.conversation = chat.conversation;
      const entries = new Map(row.entries.map(entry => [entry.id, entry]));
      for (const entry of chat.entries) entries.set(entry.id, entry);
      row.entries = [...entries.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      row.agents = chat.agents;
      row.version = "v" + ++clock;
    } else rows.set(chat.conversation.id, { ...structuredClone(chat), version: "v" + ++clock });
    return { saved: true };
  };
  return { rows, saves, cloud };
}

const USER = "11111111-1111-4111-8111-111111111111", AGENT = "22222222-2222-4222-8222-222222222222", CHAT = "33333333-3333-4333-8333-333333333333";
function computer(t, cloud, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-devices-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  const adapter = createHistoryAdapter({ store, settings: store.settings, createAgent: input => store.agents.create({ ...input, workspace: path.join(root, input.id) }) });
  const restored = [], logged = [];
  const history = createLocalHistory({ ...adapter, userId: () => USER, cloud, intervalMs: 3600000, onRestored: ids => restored.push(...ids), log: message => logged.push(message), ...options });
  t.after(() => { history.stop(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, history, restored, logged };
}
const at = minutes => new Date(Date.UTC(2026, 9, 24, 10, minutes)).toISOString();

test("a reply from Claude, whose id isn't a UUID, reaches the other computer once and isn't added twice on the way back", async t => {
  const remote = historyCloud(USER);
  const desk = computer(t, remote.cloud), laptop = computer(t, remote.cloud);
  desk.store.agents.create({ id: AGENT, ownerId: USER, name: "Orbit", workspace: path.join(desk.root, "orbit") });
  desk.store.conversations.create({ id: CHAT, ownerId: USER, agentId: AGENT, title: "Trip" });
  desk.store.messages.append({ id: crypto.randomUUID(), conversationId: CHAT, authorId: USER, text: "Find a night train", createdAt: at(1), turnId: "turn-1", status: "sent" });
  desk.store.messages.append({ id: "msg_02AbCdEf_0", conversationId: CHAT, authorId: AGENT, text: "The 21:40 to Berlin.", createdAt: at(2), turnId: "turn-1" });
  await desk.history.sync();
  assert.equal(desk.logged.length, 0, "The cloud took the chat");
  assert.deepEqual(remote.rows.get(CHAT).entries.map(entry => entry.parts[0].text), ["Find a night train", "The 21:40 to Berlin."]);
  assert.equal(remote.rows.get(CHAT).entries[1].id, entryId(CHAT, "msg_02AbCdEf_0"));
  assert.match(entryId(CHAT, "msg_02AbCdEf_0"), /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);

  // The laptop gets the chat, its reply included, and says which chat came.
  await laptop.history.sync();
  assert.deepEqual(laptop.store.messages.list(CHAT).map(message => message.text), ["Find a night train", "The 21:40 to Berlin."]);
  assert.deepEqual(laptop.restored, [CHAT]);
  // It continues there; the desk gets that and nothing twice.
  laptop.store.messages.append({ id: crypto.randomUUID(), conversationId: CHAT, authorId: USER, text: "Any sleeper cabins?", createdAt: at(5), status: "sent" });
  await laptop.history.sync();
  await desk.history.sync();
  assert.deepEqual(desk.store.messages.list(CHAT).map(message => message.text), ["Find a night train", "The 21:40 to Berlin.", "Any sleeper cabins?"]);
  assert.deepEqual(desk.restored, [CHAT]);
  await laptop.history.sync();
  assert.equal(laptop.store.messages.list(CHAT).length, 3);
});

test("a chat the cloud refuses stays here until it changes, without holding up the rest", async t => {
  const remote = historyCloud(USER);
  const statuses = [];
  const desk = computer(t, remote.cloud, { onStatus: state => statuses.push(state.state) });
  desk.store.agents.create({ id: AGENT, ownerId: USER, name: "Orbit", workspace: path.join(desk.root, "orbit") });
  // A chat id the cloud doesn't take, and a chat it does.
  desk.store.conversations.create({ id: "not-a-uuid", ownerId: USER, agentId: AGENT, title: "Odd" });
  desk.store.messages.append({ conversationId: "not-a-uuid", authorId: USER, text: "Hello", createdAt: at(1) });
  desk.store.conversations.create({ id: CHAT, ownerId: USER, agentId: AGENT, title: "Fine" });
  desk.store.messages.append({ conversationId: CHAT, authorId: USER, text: "Hello", createdAt: at(1) });
  await desk.history.sync();
  assert.deepEqual([...remote.rows.keys()], [CHAT]);
  assert.equal(statuses.at(-1), "synced", "The refused chat doesn't make the pass fail");
  assert.equal(desk.logged.length, 1);
  const saves = remote.saves.length;
  await desk.history.sync();
  assert.equal(desk.logged.length, 1, "It isn't sent again unchanged");
  assert.equal(remote.saves.length, saves);
  desk.store.messages.append({ conversationId: "not-a-uuid", authorId: USER, text: "Again", createdAt: at(2) });
  await desk.history.sync();
  assert.equal(desk.logged.length, 2, "Changed, it's tried again");
});

test("a change goes to the cloud a moment later, without waiting for the next pass", async t => {
  const remote = historyCloud(USER);
  const desk = computer(t, remote.cloud, { pushDelayMs: 20 });
  desk.store.agents.create({ id: AGENT, ownerId: USER, name: "Orbit", workspace: path.join(desk.root, "orbit") });
  desk.store.conversations.create({ id: CHAT, ownerId: USER, agentId: AGENT, title: "Trip" });
  await desk.history.sync();
  const before = remote.saves.length;
  desk.store.messages.append({ id: crypto.randomUUID(), conversationId: CHAT, authorId: USER, text: "One more thing", createdAt: at(3), status: "sent" });
  desk.store.conversations.update(CHAT, { read: true });
  for (let waited = 0; remote.saves.length === before && waited < 2000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(remote.saves.length, before + 1, "Both changes go in one save");
  assert.deepEqual(remote.saves.at(-1).entries.map(entry => entry.parts[0].text), ["One more thing"]);
  // A pass asked for while it's sending still runs.
  desk.store.messages.append({ id: crypto.randomUUID(), conversationId: CHAT, authorId: USER, text: "And another", createdAt: at(4), status: "sent" });
  await new Promise(resolve => setTimeout(resolve, 25));
  await desk.history.sync();
  assert.equal(remote.rows.get(CHAT).entries.length, 2);
});

// A stand-in for the Codex app server: its turns as thread/read gives them.
function fakeCodex() {
  const client = new EventEmitter(), calls = [], turns = new Map();
  let threads = 0, count = 0;
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-" + ++threads } };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "turn/start") { const id = "turn-" + ++count; (turns.get(params.threadId) || turns.set(params.threadId, []).get(params.threadId)).push({ id, startedAt: Date.now() / 1000, status: "completed", items: [] }); return { turn: { id } }; }
    if (method === "thread/read") return { thread: { id: params.threadId, turns: turns.get(params.threadId) || [] } };
    return {};
  };
  return { client, calls };
}

test("back on this computer, the chat shows what was written on the other one and the agent is given it before the next message", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-devices-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: AGENT, ownerId: USER, name: "Orbit", workspace: path.join(root, "orbit") });
  const { id } = store.conversations.create({ ownerId: USER, agentId: AGENT });
  const { client, calls } = fakeCodex();
  const harness = createHarness({ store, client, userId: () => USER, instructionsFor: () => "", modelSettings: () => null });
  const injections = () => calls.filter(call => call.method === "thread/inject_items");
  const { turnId } = await harness.send(id, { text: "Find a night train" });
  client.emit("notification", { method: "item/completed", params: { threadId: "thread-1", turnId, item: { type: "agentMessage", id: "msg_1", text: "The 21:40 to Berlin." } } });
  client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "completed" } } });
  assert.equal(injections().length, 0);

  // History sync brings what was written on the laptop: sent, with no turn here.
  const later = new Date(Date.now() + 60000).toISOString();
  store.messages.append({ conversationId: id, authorId: USER, text: "Any sleeper cabins?", createdAt: later, status: "sent" });
  store.messages.append({ conversationId: id, authorId: AGENT, text: "Yes, two left.", createdAt: later, status: "sent" });
  const history = await harness.history(id);
  assert.deepEqual(history.elsewhere.map(message => message.text), ["Any sleeper cabins?", "Yes, two left."]);
  assert.deepEqual(history.earlier, []);

  await harness.send(id, { text: "Book one" });
  const [given] = injections();
  assert.equal(given.params.threadId, "thread-1");
  assert.deepEqual(given.params.items.map(item => [item.role, item.content[0].text]), [["user", "Any sleeper cabins?"], ["assistant", "Yes, two left."]]);
  const order = calls.map(call => call.method);
  assert.ok(order.lastIndexOf("thread/inject_items") < order.lastIndexOf("turn/start"), "Given before the message");
  // Once given, never again; a restart doesn't give them twice either.
  client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-2", status: "completed" } } });
  await harness.send(id, { text: "Thanks" });
  client.emit("status", { status: "stopped" });
  client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-3", status: "completed" } } });
  await harness.send(id, { text: "One more" });
  assert.equal(injections().length, 1);
});

test("a chat that only came from the cloud starts its thread with its history, given once", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-devices-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: AGENT, ownerId: USER, name: "Orbit", workspace: path.join(root, "orbit") });
  const { id } = store.conversations.create({ ownerId: USER, agentId: AGENT });
  store.messages.append({ conversationId: id, authorId: USER, text: "Find a night train", createdAt: at(1), status: "sent" });
  store.messages.append({ conversationId: id, authorId: AGENT, text: "The 21:40 to Berlin.", createdAt: at(2), status: "sent" });
  const { client, calls } = fakeCodex();
  const harness = createHarness({ store, client, userId: () => USER, instructionsFor: () => "", modelSettings: () => null });
  await harness.warm(id);
  // More arrives from the laptop after the thread opened.
  store.messages.append({ conversationId: id, authorId: USER, text: "Any sleeper cabins?", createdAt: at(3), status: "sent" });
  await harness.send(id, { text: "Book one" });
  const given = calls.filter(call => call.method === "thread/inject_items").map(call => call.params.items.map(item => item.content[0].text));
  assert.deepEqual(given, [["Find a night train", "The 21:40 to Berlin."], ["Any sleeper cabins?"]]);
});
