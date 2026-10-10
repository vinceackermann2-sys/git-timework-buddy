"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { openStore } = require("../app/main/store.cjs");
const { createHarness, ATTACHED } = require("../app/main/harness.cjs");

// A stand-in for the Codex app server that records requests.
function fakeClient({ failTurns = 0, startDelay = 0 } = {}) {
  const client = new EventEmitter(), calls = [];
  let threads = 0, turns = 0;
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") { await new Promise(resolve => setTimeout(resolve, startDelay)); return { thread: { id: "thread-" + ++threads } }; }
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "turn/start") { if (turns++ < failTurns) throw Object.assign(new Error("No credits left."), { status: 402 }); return { turn: { id: "turn-" + turns } }; }
    if (method === "thread/read") return { thread: { id: params.threadId, turns: [] } };
    return {};
  };
  return { client, calls };
}

function setup(t, options, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-chat-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const conversation = store.conversations.create({ ownerId: "user-1", agentId: "agent-1" });
  const { client, calls } = fakeClient(options);
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "", modelSettings: () => ({ name: "openai/gpt-5.6-sol", reasoningEffort: "low" }), ...extra });
  return { root, store, harness, client, calls, id: conversation.id };
}

test("warming a chat and sending at once share one thread", async t => {
  const { harness, calls, id } = setup(t, { startDelay: 50 });
  const warm = harness.warm(id);
  await harness.send(id, { text: "Hello" });
  await warm;
  assert.equal(calls.filter(call => call.method === "thread/start").length, 1);
  await harness.warm(id);
  assert.equal(calls.filter(call => call.method === "thread/start").length, 1, "A warm thread isn't started again");
});

test("a chat's own model is used for its turns", async t => {
  const { harness, calls, id } = setup(t);
  harness.setModel(id, { name: "openai/gpt-5.6-luna", reasoningEffort: "medium" });
  await harness.send(id, { text: "Hi" });
  const turn = calls.find(call => call.method === "turn/start").params;
  assert.deepEqual([turn.model, turn.effort], ["openai/gpt-5.6-luna", "medium"]);
});

test("a failed message can be retried and is replaced, not duplicated", async t => {
  const { harness, store, id } = setup(t, { failTurns: 1 });
  await assert.rejects(harness.send(id, { text: "Plan my week", clientId: "m1" }), /No credits/);
  let history = await harness.history(id);
  assert.deepEqual(history.failed.map(message => message.id), ["m1"]);
  await harness.send(id, { text: "Plan my week", clientId: "m2", retryOf: "m1" });
  history = await harness.history(id);
  assert.equal(store.messages.get("m1").status, "replaced");
  assert.deepEqual(history.messages.map(message => message.id), ["m2"]);
  assert.deepEqual(history.failed, []);
});

test("attached files are copied into the workspace and named in the message", async t => {
  const { root, harness, calls, id } = setup(t);
  const source = path.join(root, "report.pdf");
  fs.writeFileSync(source, "%PDF-1.4 sample");
  fs.mkdirSync(path.join(root, "orbit", "attachments"), { recursive: true });
  await harness.send(id, { text: "Read this", files: [source] });
  await harness.send(id, { text: "And again", files: [source] }).catch(() => {});
  const input = calls.find(call => call.method === "turn/start").params.input;
  const note = input.find(part => part.type === "text" && part.text.startsWith(ATTACHED));
  const [relative] = note.text.split("\n").slice(1).map(line => line.slice(2));
  assert.match(relative, /^attachments\/\d{4}-\d{2}-\d{2}\/report\.pdf$/);
  assert.equal(fs.readFileSync(path.join(root, "orbit", relative), "utf8"), "%PDF-1.4 sample");
});

test("skills chosen in the composer go to Codex as skill input with the text", async t => {
  const { harness, calls, id } = setup(t);
  await harness.send(id, { text: "Summarize it with $pdf", skills: [{ name: "pdf", path: "/skills/pdf/SKILL.md" }] });
  const input = calls.find(call => call.method === "turn/start").params.input;
  assert.deepEqual(input.map(part => part.type), ["text", "skill"]);
  assert.deepEqual(input[1], { type: "skill", name: "pdf", path: "/skills/pdf/SKILL.md" });
});

test("a chat's new main thread isn't shown as a worker while it starts", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-chat-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const { id } = store.conversations.create({ ownerId: "user-1", agentId: "agent-1" });
  // Saved by an older version: its thread is replaced on open.
  store.conversations.update(id, { codexThreadId: "old-thread", toolsVersion: 0 });
  store.messages.append({ id: "m1", conversationId: id, authorId: "user-1", text: "Earlier message" });
  const { client } = fakeClient();
  const plain = client.request;
  // Codex reports on the new thread while its history is still being added.
  client.request = async (method, params) => {
    if (method === "thread/inject_items") client.emit("notification", { method: "thread/status/changed", params: { threadId: params.threadId, status: { type: "idle" } } });
    return plain(method, params);
  };
  const events = [];
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "", modelSettings: () => null, tools: { version: 1 },
    notify: (name, payload) => { if (name === "conversation.event") events.push(payload); } });
  await harness.warm(id);
  assert.equal(store.conversations.get(id).codexThreadId, "thread-1");
  assert.deepEqual(events.map(event => [event.params.threadId, event.params.subAgent]), [["thread-1", false]]);
  // The earlier main thread's events aren't a worker's either, and neither thread can be opened as one.
  client.emit("notification", { method: "thread/status/changed", params: { threadId: "old-thread", status: { type: "notLoaded" } } });
  assert.equal(events.length, 1);
  await assert.rejects(harness.conversations.worker(id, "thread-1"), /isn't part of the conversation/);
  await assert.rejects(harness.conversations.worker(id, "old-thread"), /isn't part of the conversation/);
});


// Codex calls answered by answer(method, params) when it returns a value or
// throws; other calls get the fake's usual answer.
function script({ client, calls }, answer) {
  const plain = client.request;
  client.request = async (method, params) => {
    let value;
    try { value = await answer(method, params); } catch (error) { calls.push({ method, params }); throw error; }
    if (value === undefined) return plain(method, params);
    calls.push({ method, params });
    return value;
  };
}
const steers = calls => calls.filter(call => call.method === "turn/steer").map(call => call.params);

test("a message sent while the agent works steers its turn; one Codex drops when the turn stops can be retried with its files", async t => {
  const chat = setup(t), { root, harness, client, calls, store, id } = chat;
  script(chat, (method, params) => method === "turn/steer" ? { turnId: params.expectedTurnId } : undefined);
  await harness.send(id, { text: "Plan my week", clientId: "m1" });
  assert.equal(harness.conversations.status(id).running, true);
  const added = await harness.send(id, { text: "Add Friday", clientId: "m2" }, { steer: true });
  assert.equal(added.steered, true);
  const note = path.join(root, "notes.txt");
  fs.writeFileSync(note, "notes");
  await harness.send(id, { text: "And these notes", files: [note], clientId: "m3" }, { steer: true });
  assert.deepEqual(steers(calls).map(call => [call.threadId, call.expectedTurnId, call.clientUserMessageId]), [["thread-1", "turn-1", "m2"], ["thread-1", "turn-1", "m3"]]);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 1, "No second turn starts");
  // An automation's run doesn't join a reply; it is skipped.
  await assert.rejects(harness.send(id, { text: "Daily summary" }), error => error.status === 409);
  // Codex adds the first to the turn, then the turn is stopped before the second.
  client.emit("notification", { method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "userMessage", id: "u2", clientId: "m2", content: [] } } });
  client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted", items: [] } } });
  assert.equal(harness.conversations.status(id).running, false);
  assert.deepEqual(["m1", "m2", "m3"].map(message => store.messages.get(message).status), ["sent", "sent", "failed"]);
  const history = await harness.history(id);
  assert.deepEqual(history.failed.map(message => [message.id, message.files]), [["m3", [note]]]);
  // Retried, it starts the next turn and is no longer offered.
  await harness.send(id, { text: "And these notes", files: history.failed[0].files, clientId: "m4", retryOf: "m3" });
  assert.equal(store.messages.get("m3").status, "replaced");
  assert.deepEqual((await harness.history(id)).failed, []);
});

test("a message steered just as the turn ended starts the next turn", async t => {
  const chat = setup(t), { harness, client, calls, store, id } = chat;
  script(chat, method => { if (method === "turn/steer") throw Object.assign(new Error("no active turn to steer"), { code: -32600 }); });
  await harness.send(id, { text: "One", clientId: "m1" });
  const second = await harness.send(id, { text: "Two", clientId: "m2" }, { steer: true });
  assert.equal(second.steered, undefined);
  assert.equal(second.turnId, "turn-2");
  assert.deepEqual(calls.filter(call => call.method === "turn/start").map(call => call.params.clientUserMessageId), ["m1", "m2"]);
  assert.equal(store.messages.get("m2").status, "sent");
  // Any other refusal is a message that wasn't delivered.
  script(chat, method => { if (method === "turn/steer") throw Object.assign(new Error("Your AI funding changed."), { status: 409 }); });
  await assert.rejects(harness.send(id, { text: "Three", clientId: "m3" }, { steer: true }), /funding changed/);
  assert.equal(store.messages.get("m3").status, "failed");
  assert.equal(harness.conversations.status(id).running, true, "The running turn goes on");
});

test("Stop while a chat's first reply starts stops it as soon as Codex starts it, and a second message joins it", async t => {
  const chat = setup(t), { harness, client, calls, id } = chat;
  let release;
  const started = new Promise(resolve => { release = resolve; });
  script(chat, async (method, params) => {
    if (method === "turn/start") { await started; return { turn: { id: "turn-1", status: "inProgress" } }; }
    if (method === "turn/steer") return { turnId: params.expectedTurnId };
  });
  const first = harness.send(id, { text: "Research flights", clientId: "m1" });
  const second = harness.send(id, { text: "Only direct ones", clientId: "m2" }, { steer: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(harness.conversations.status(id).running, true, "The chat is busy before Codex has the turn");
  assert.deepEqual(await harness.interrupt(id), { interrupted: true });
  assert.equal(calls.filter(call => call.method === "turn/interrupt").length, 0);
  release();
  await first;
  assert.deepEqual(calls.filter(call => call.method === "turn/interrupt").map(call => call.params), [{ threadId: "thread-1", turnId: "turn-1" }]);
  assert.equal((await second).steered, true);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 1, "The second message didn't start its own turn");
});

test("a failed start leaves the chat free and keeps the message's images for Retry", async t => {
  const chat = setup(t, { failTurns: 1 }), { root, harness, id } = chat;
  const image = path.join(root, "shot.png");
  fs.writeFileSync(image, "png");
  await assert.rejects(harness.send(id, { text: "Look", images: [image], clientId: "m1" }), /No credits/);
  assert.equal(harness.conversations.status(id).running, false);
  assert.deepEqual((await harness.history(id)).failed.map(message => message.images), [[image]]);
});

test("workers Codex announces only in their parent's items get their approval requests", async t => {
  const chat = setup(t), { harness, client, id } = chat;
  const refused = [];
  client.respondError = requestId => refused.push(requestId);
  await harness.warm(id);
  client.emit("notification", { method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "collabAgentToolCall", id: "c1", tool: "spawnAgent", receiverThreadIds: ["worker-1"], senderThreadId: "thread-1", status: "completed", agentsStates: {} } } });
  client.emit("request", { id: 7, method: "item/commandExecution/requestApproval", params: { threadId: "worker-1", turnId: "w", itemId: "x" } });
  // A worker known only from Codex's record of its parent.
  script(chat, (method, params) => method === "thread/read" && params.threadId === "worker-2" ? { thread: { id: "worker-2", parentThreadId: "worker-1" } } : undefined);
  client.emit("request", { id: 8, method: "item/tool/requestUserInput", params: { threadId: "worker-2", turnId: "w", itemId: "y" } });
  client.emit("request", { id: 9, method: "item/tool/requestUserInput", params: { threadId: "stranger", turnId: "t", itemId: "z" } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(harness.pendingApprovals().map(item => [item.id, item.conversationId]), [[7, id], [8, id]]);
  assert.deepEqual(refused, [9]);
  assert.equal(harness.conversationFor("worker-2"), id);
});

test("idle chats and their workers are unloaded and resume on their next message; a funding change resumes once", async t => {
  const chat = setup(t), { harness, client, calls, id, store } = chat;
  const busy = store.conversations.create({ ownerId: "user-1", agentId: "agent-1" }).id;
  await harness.warm(id);
  await harness.send(busy, { text: "Busy" });
  client.emit("notification", { method: "item/started", params: { threadId: "thread-1", turnId: "t", item: { type: "subAgentActivity", id: "s1", agentThreadId: "worker-1", agentPath: "a", kind: "started" } } });
  assert.deepEqual(await harness.unloadIdle(), { unloaded: 2 });
  assert.deepEqual(calls.filter(call => call.method === "thread/unsubscribe").map(call => call.params.threadId).sort(), ["thread-1", "worker-1"], "The busy chat stays loaded");
  // Codex unloads a thread whose AI funding changed as its turn starts: it's resumed and started again, once.
  let refused = false;
  script(chat, method => { if (method === "turn/start" && !refused) { refused = true; throw Object.assign(new Error("AI funding changed."), { status: 409, code: "provider-changed" }); } });
  const resumes = () => calls.filter(call => call.method === "thread/resume").length;
  const before = resumes();
  await harness.send(id, { text: "Hello again" });
  assert.equal(resumes() - before, 2, "Resumed after unloading, and again after the funding change");
  assert.equal(calls.filter(call => call.method === "turn/start" && call.params.threadId === "thread-1").length, 2, "Refused once, then started");
  assert.equal(harness.conversations.status(id).running, true);
});

test("Codex starting for a chat's first message doesn't end that reply, and Stop pressed meanwhile reaches the turn, again once it runs", async t => {
  const { harness, client, calls, id } = setup(t, { startDelay: 30 });
  const sending = harness.send(id, { text: "Research flights", clientId: "m1" });
  // The first request starts Codex: it reports "starting" while the reply is set up.
  client.emit("status", { status: "starting" });
  assert.deepEqual(await harness.interrupt(id), { interrupted: true });
  const { turnId } = await sending;
  assert.equal(harness.conversations.status(id).running, true, "The reply is still there");
  const interrupts = () => calls.filter(call => call.method === "turn/interrupt").map(call => call.params);
  assert.deepEqual(interrupts(), [{ threadId: "thread-1", turnId }], "Stop is sent as soon as Codex has the turn");
  // An interrupt can reach Codex before the turn runs; it's sent once more when it does.
  client.emit("notification", { method: "turn/started", params: { threadId: "thread-1", turn: { id: turnId } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(interrupts(), [{ threadId: "thread-1", turnId }, { threadId: "thread-1", turnId }]);
  client.emit("notification", { method: "turn/started", params: { threadId: "thread-1", turn: { id: turnId } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(interrupts().length, 2, "Not more than once each way");
  // A Codex that stops does end it.
  client.emit("status", { status: "stopped" });
  assert.equal(harness.conversations.status(id).running, false);
});
