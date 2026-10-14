"use strict";
// Timewarp's own questions in a chat (harness confirm), shown with Codex's
// approval requests, and messages from other agents in a chat's history.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { openStore } = require("../app/main/store.cjs");
const { createHarness } = require("../app/main/harness.cjs");
const { agentMessage } = require("../app/main/team-tools.cjs");

function setup(t, userId = () => "user-1") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-confirm-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  store.agents.create({ id: "agent-2", ownerId: "user-1", name: "Nova", workspace: path.join(root, "nova") });
  const client = new EventEmitter(), calls = [], answered = [];
  let turns = 0, threads = 0;
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-" + ++threads } };
    if (method === "turn/start") return { turn: { id: "turn-" + ++turns } };
    return {};
  };
  client.respond = (id, response) => answered.push({ id, response });
  const events = [];
  const harness = createHarness({ store, client, userId, modelSettings: () => ({ name: "m" }), instructionsFor: () => "", notify: (name, payload) => events.push({ name, ...payload }) });
  const chat = harness.conversations.create({ agentId: "agent-1" });
  const emit = (method, params) => client.emit("notification", { method, params });
  return { store, harness, client, calls, answered, events, chat, emit };
}

test("a question Timewarp asks shows with the chat's approvals and resolves with the user's answer", async t => {
  const { harness, answered, events, chat } = setup(t);
  const asked = harness.confirm(chat.id, { kind: "settings", title: "Change theme?" });
  const [pending] = harness.pendingApprovals();
  assert.equal(pending.method, "timewarp/confirm");
  assert.equal(pending.conversationId, chat.id);
  assert.deepEqual(harness.conversations.status(chat.id).approvals.map(item => item.id), [pending.id]);
  assert.ok(events.some(event => event.name === "approval.requested" && event.id === pending.id));
  // Only Allow counts as yes; anything else is a no.
  harness.respond(pending.id, { decision: "accept" });
  assert.deepEqual(await asked, { decision: "accept" });
  assert.deepEqual(answered, [], "nothing goes to Codex");
  assert.deepEqual(harness.pendingApprovals(), []);
  assert.ok(events.some(event => event.name === "approval.resolved" && event.id === pending.id));
  const other = harness.confirm(chat.id, { kind: "settings" });
  harness.respond(harness.pendingApprovals()[0].id, { decision: "acceptForSession" });
  assert.deepEqual(await other, { decision: "decline" });
  assert.throws(() => harness.respond(pending.id, { decision: "accept" }), /already answered/);
});

test("the question goes when its turn ends, when Codex stops, or after its time", async t => {
  const { harness, client, chat, emit } = setup(t);
  await harness.send(chat.id, { text: "Go" });
  const threadId = harness.conversations.get(chat.id).codexThreadId;
  emit("turn/started", { threadId, turn: { id: "turn-1" } });
  const asked = harness.confirm(chat.id, { kind: "settings" });
  emit("turn/completed", { threadId, turn: { id: "turn-1", status: "interrupted" } });
  assert.deepEqual(await asked, { decision: "cancel" });
  assert.deepEqual(harness.pendingApprovals(), []);
  const stopped = harness.confirm(chat.id, { kind: "settings" });
  client.emit("status", { status: "stopped" });
  assert.deepEqual(await stopped, { decision: "cancel" });
  assert.deepEqual(await harness.confirm(chat.id, { kind: "settings" }, { timeoutMs: 20 }), { decision: "timeout" });
  assert.deepEqual(harness.pendingApprovals(), []);
});

test("only the chat's account can be asked", async t => {
  let user = "user-1";
  const { harness, chat } = setup(t, () => user);
  user = "user-2";
  assert.throws(() => harness.confirm(chat.id, { kind: "settings" }), /unavailable for this account/);
  user = "user-1";
  void harness.confirm(chat.id, { kind: "settings" });
  const [pending] = harness.pendingApprovals();
  user = "user-2";
  assert.throws(() => harness.respond(pending.id, { decision: "accept" }), /unavailable for this account/);
});

test("waitForTurn ends with the turn, at once for one that isn't running, or after its time", async t => {
  const { harness, chat, emit } = setup(t);
  assert.deepEqual(await harness.waitForTurn(chat.id, "turn-x"), { status: "ended" });
  const sent = await harness.send(chat.id, { text: "Go" });
  const threadId = harness.conversations.get(chat.id).codexThreadId;
  assert.deepEqual(harness.activeTurn(chat.id), { turnId: sent.turnId, run: false });
  assert.deepEqual(await harness.waitForTurn(chat.id, sent.turnId, 20), { status: "timeout" });
  const waiting = harness.waitForTurn(chat.id, sent.turnId);
  emit("turn/completed", { threadId, turn: { id: sent.turnId, status: "completed" } });
  assert.deepEqual(await waiting, { status: "completed", error: null });
  assert.equal(harness.activeTurn(chat.id), null);
});

test("another agent's message is kept as its own and goes into a new thread as the chat's input", async t => {
  const { store, harness, calls, chat } = setup(t);
  const from = harness.conversations.create({ agentId: "agent-2" });
  const text = agentMessage({ from: { id: "agent-2", name: "Nova" }, conversation: { id: from.id, title: "Budget" }, hop: 1, mode: "message", request: null, body: "Budget is 900" });
  store.conversations.update(chat.id, { read: true });
  await harness.send(chat.id, { text }, { author: "agent-2" });
  assert.equal(store.messages.list(chat.id).at(-1).authorId, "agent-2");
  assert.equal(store.conversations.get(chat.id).read, true);
  store.messages.append({ conversationId: chat.id, authorId: "agent-1", text: "Thanks, noted." });
  // The chat continues in a new thread (restored elsewhere, say): its history goes with it.
  store.conversations.update(chat.id, { codexThreadId: null, toolsVersion: 0 });
  harness.reset();
  await harness.send(chat.id, { text: "And now?" });
  const injected = calls.find(call => call.method === "thread/inject_items").params.items;
  assert.deepEqual(injected.map(item => item.role), ["user", "assistant"]);
  assert.equal(injected[0].content[0].text, text);
});
