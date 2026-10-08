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

function setup(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-chat-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const conversation = store.conversations.create({ ownerId: "user-1", agentId: "agent-1" });
  const { client, calls } = fakeClient(options);
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "", modelSettings: () => ({ name: "openai/gpt-5.6-sol", reasoningEffort: "low" }) });
  return { root, store, harness, calls, id: conversation.id };
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
