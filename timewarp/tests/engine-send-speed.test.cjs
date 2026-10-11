"use strict";
// What keeps sending fast: no instructions rebuilt for an open thread, cached
// thread lookups, a spare thread for the next new chat, AI funding kept for a
// moment, titles beside memory jobs, and compressed large model requests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const { openStore } = require("../app/main/store.cjs");
const { createHarness } = require("../app/main/harness.cjs");

function fakeClient() {
  const client = new EventEmitter(), calls = [];
  let threads = 0, turns = 0;
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-" + ++threads } };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "turn/start") return { turn: { id: "turn-" + ++turns } };
    return {};
  };
  return { client, calls };
}

function setup(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-speed-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  store.agents.create({ id: "agent-2", ownerId: "user-1", name: "Nova", workspace: path.join(root, "nova") });
  const { client, calls } = fakeClient();
  const counts = { instructions: 0, byThread: 0, prepared: [] };
  const lookup = store.conversations.byThread;
  store.conversations.byThread = threadId => { counts.byThread++; return lookup(threadId); };
  const settings = { instructions: "Be brief." };
  const events = [];
  const harness = createHarness({
    store, client, userId: () => "user-1", modelSettings: () => ({ name: "openai/gpt-5.6-sol" }),
    instructionsFor: agent => { counts.instructions++; return agent.name + ": " + settings.instructions; },
    prepareContext: agent => counts.prepared.push(agent.id),
    notify: (name, payload) => events.push({ name, ...payload }),
    ...extra,
  });
  const chat = () => harness.conversations.create({ agentId: "agent-1" }).id;
  const starts = () => calls.filter(call => call.method === "thread/start");
  return { root, store, harness, client, calls, counts, settings, events, chat, starts };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("a message to an open thread doesn't build the thread's instructions again", async t => {
  const { harness, client, calls, counts, chat } = setup(t);
  const id = chat();
  await harness.send(id, { text: "Hello" });
  client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
  const built = counts.instructions;
  await harness.send(id, { text: "Again" });
  assert.equal(counts.instructions, built);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 2);
});

test("Codex events of threads that aren't a chat's are looked up once; a chat's new thread still gets its events", async t => {
  const { harness, client, counts, events, chat } = setup(t);
  for (let index = 0; index < 50; index++) client.emit("notification", { method: "item/agentMessage/delta", params: { threadId: "background-1", delta: "x" } });
  assert.equal(counts.byThread, 1);
  // A thread Codex reports before the chat records it as its own.
  client.emit("notification", { method: "thread/started", params: { thread: { id: "thread-1" } } });
  const id = chat();
  await harness.send(id, { text: "Hello" });
  client.emit("notification", { method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", delta: "Hi" } });
  assert.deepEqual(events.filter(event => event.method === "item/agentMessage/delta").map(event => event.conversationId), [id]);
  // Workers known only from their parent's items, after their own events arrived.
  client.emit("notification", { method: "item/agentMessage/delta", params: { threadId: "worker-1", delta: "early" } });
  client.emit("notification", { method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item: { type: "subAgentActivity", id: "s1", agentThreadId: "worker-1", kind: "started" } } });
  assert.equal(harness.conversationFor("worker-1"), id);
});

test("the running list names only this account's chats that are replying", async t => {
  const { harness, store, chat } = setup(t);
  const replying = chat(), idle = chat(), archived = chat();
  await harness.send(replying, { text: "Hello" });
  await harness.send(archived, { text: "Hello" });
  harness.conversations.archive(archived, true);
  assert.deepEqual(harness.conversations.running(), [replying]);
  assert.ok(store.conversations.get(idle));
});

test("a spare thread prepared on the home screen is the next new chat's thread", async t => {
  const { harness, store, calls, counts, chat, starts } = setup(t);
  harness.prepare("agent-1", { thread: true });
  assert.deepEqual(counts.prepared, ["agent-1"], "The agent's connected apps start loading");
  await tick(); await tick();
  assert.equal(starts().length, 1);
  const spare = starts()[0].params;
  const id = chat();
  await harness.send(id, { text: "Hello" });
  assert.equal(starts().length, 1, "No second thread started");
  assert.equal(store.conversations.get(id).codexThreadId, "thread-1");
  assert.equal(calls.find(call => call.method === "turn/start").params.threadId, "thread-1");
  // Exactly what the chat would have started with.
  const fresh = chat();
  await harness.send(fresh, { text: "Hello" });
  assert.deepEqual(starts()[1].params, spare);
  assert.equal(calls.filter(call => /unsubscribe|delete/.test(call.method)).length, 0);
});

test("a spare that no longer matches is closed and the chat starts its own thread", async t => {
  const { harness, calls, settings, chat, starts } = setup(t);
  harness.prepare("agent-1", { thread: true });
  await tick(); await tick();
  settings.instructions = "Answer in French.";
  const id = chat();
  await harness.send(id, { text: "Bonjour" });
  await tick();
  assert.equal(starts().length, 2);
  assert.match(starts()[1].params.developerInstructions, /French/);
  assert.deepEqual(calls.filter(call => /unsubscribe|delete/.test(call.method)).map(call => [call.method, call.params.threadId]), [["thread/unsubscribe", "thread-1"], ["thread/delete", "thread-1"]]);
});

test("spares are closed for another agent, a funding change or a tools change, and dropped when Codex stops", async t => {
  const { harness, client, calls, store, starts } = setup(t);
  const closed = () => calls.filter(call => call.method === "thread/delete").map(call => call.params.threadId);
  harness.prepare("agent-1", { thread: true });
  await tick(); await tick();
  harness.prepare("agent-2", { thread: true });
  await tick(); await tick();
  assert.deepEqual(closed(), ["thread-1"], "The other agent's spare is closed");
  await harness.unloadIdle();
  await tick(); await tick();
  assert.deepEqual(closed(), ["thread-1", "thread-2"]);
  harness.prepare("agent-1", { thread: true });
  await tick(); await tick();
  harness.discardSpares();
  await tick(); await tick();
  assert.deepEqual(closed(), ["thread-1", "thread-2", "thread-3"]);
  harness.prepare("agent-1", { thread: true });
  await tick(); await tick();
  client.emit("status", { status: "stopped" });
  const id = store.conversations.create({ ownerId: "user-1", agentId: "agent-1" }).id;
  await harness.send(id, { text: "Hello" });
  assert.equal(starts().length, 5, "A spare from a stopped Codex isn't used");
  assert.deepEqual(closed(), ["thread-1", "thread-2", "thread-3"], "Nothing is sent for threads Codex already dropped");
});

test("opening a chat starts loading its agent's context", async t => {
  const { harness, counts, chat } = setup(t);
  await harness.warm(chat());
  assert.deepEqual(counts.prepared, ["agent-1"]);
});

test("a kept funding balance lets turns start without the cloud, and a refusal is checked fresh", async () => {
  const { createAiFunding } = require("../desktop/ai-funding.cjs");
  const { bindCodexFunding } = require("../desktop/codex-funding.cjs");
  const balance = { plan: "pro", included: 0, purchased: 5 };
  let cloudCalls = 0;
  const funding = createAiFunding({ userId: () => "user-1", cacheMs: 30000, cloud: async () => { cloudCalls++; return Response.json(balance); }, chatgpt: { connection: () => ({ status: "disconnected" }), canUse: () => false } });
  const client = new EventEmitter();
  client.request = async (method, params) => method.startsWith("thread/") ? { thread: { id: params.threadId || "t1", modelProvider: params.modelProvider } } : { turn: { id: "turn" } };
  bindCodexFunding({ client, funding, userId: () => "user-1", chatgpt: { bindClient() {}, models: async () => [] } });
  await client.request("thread/start", { model: "openai/gpt-5.6-sol" });
  await client.request("turn/start", { threadId: "t1", input: [] });
  await client.request("turn/start", { threadId: "t1", input: [] });
  assert.equal(cloudCalls, 1, "One balance read for a thread and two turns");
  // Out of credits: refused, after asking the cloud again each time.
  balance.purchased = 0; funding.invalidate();
  await assert.rejects(client.request("turn/start", { threadId: "t1", input: [] }), error => error.status === 402);
  await assert.rejects(client.request("turn/start", { threadId: "t1", input: [] }), error => error.status === 402);
  assert.equal(cloudCalls, 3);
  // Credits bought meanwhile: the next turn starts.
  balance.purchased = 3;
  await client.request("turn/start", { threadId: "t1", input: [] });
  assert.equal(cloudCalls, 4);
});

test("the model bridge drops the kept balance when the cloud refuses the account, plan or credits", async t => {
  const { createModelBridge } = require("../app/main/model-bridge.cjs");
  let status = 200, invalidated = 0;
  const bridge = createModelBridge({ token: "run-token", port: 0, cloud: async () => Response.json({ ok: status === 200 }, { status }), funding: { current: async () => ({ source: "timewarp" }), invalidate: () => invalidated++ } });
  await new Promise(resolve => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(() => bridge.close());
  const post = () => fetch(`http://127.0.0.1:${bridge.server.address().port}/v1/responses`, { method: "POST", headers: { authorization: "Bearer run-token" }, body: JSON.stringify({ input: "hi" }) }).then(response => response.status);
  assert.equal(await post(), 200);
  assert.equal(invalidated, 0);
  for (status of [402, 403, 401]) assert.equal(await post(), status);
  assert.equal(invalidated, 3);
});

test("chat titles don't wait for a memory job", async () => {
  const { createBackgroundRunner } = require("../app/main/memory-writer.cjs");
  const client = new EventEmitter();
  let threads = 0;
  client.request = async (method, params) => {
    if (method === "thread/start") return { thread: { id: "job-" + ++threads } };
    if (method === "turn/start") {
      // The memory job never finishes here; a title answers at once.
      if (params.outputSchema?.properties?.title) setImmediate(() => {
        client.emit("notification", { method: "item/completed", params: { threadId: params.threadId, item: { type: "agentMessage", text: "{\"title\":\"Trip plans\"}" } } });
        client.emit("notification", { method: "turn/completed", params: { threadId: params.threadId, turn: { status: "completed" } } });
      });
      return { turn: { id: "turn-" + params.threadId } };
    }
    return {};
  };
  const runner = createBackgroundRunner({ client, cwd: os.tmpdir() });
  const memory = runner.run({ purpose: "memory", instructions: "", prompt: "", schema: { type: "object", properties: { notes: {} } }, timeoutMs: 300 });
  memory.catch(() => {});
  const title = await runner.run({ purpose: "title", instructions: "", prompt: "", schema: { type: "object", properties: { title: {} } }, timeoutMs: 2000 });
  assert.deepEqual(title, { title: "Trip plans" });
  await assert.rejects(memory, /took too long/);
});

test("imported memory files are listed for new threads without walking them each time, and changes show", async t => {
  const { createKnowledge } = require("../app/main/knowledge.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-knowledge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const knowledge = createKnowledge({ runtimeDir: path.join(root, "runtime"), codexHome: path.join(root, "codex"), home: path.join(root, "home"), env: {} });
  assert.doesNotMatch(knowledge.instructions("enabled"), /imported/);
  knowledge.saveImport("claude-code", "CLAUDE.md", "Prefers metric units.");
  assert.match(knowledge.instructions("enabled"), /- claude-code\/CLAUDE\.md/);
  // Added outside Timewarp (an agent or the user, in the memory folder).
  const folder = path.join(knowledge.importsRoot, "cursor", "rules");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "style.md"), "Tabs.");
  assert.match(knowledge.instructions("enabled"), /- cursor\/rules\/style\.md/);
  const before = fs.statSync(folder).mtimeMs;
  fs.writeFileSync(path.join(folder, "more.md"), "Spaces.");
  // Folder times can be coarse on some file systems; the list follows the folder's time.
  if (fs.statSync(folder).mtimeMs !== before) assert.match(knowledge.instructions("enabled"), /- cursor\/rules\/more\.md/);
  knowledge.removeImport("claude-code/CLAUDE.md");
  assert.doesNotMatch(knowledge.instructions("enabled"), /CLAUDE\.md/);
});

test("each message's memory follows the files, also an edit in place of the same size", async t => {
  const { createKnowledge } = require("../app/main/knowledge.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-knowledge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const knowledge = createKnowledge({ runtimeDir: path.join(root, "runtime"), codexHome: path.join(root, "codex"), home: path.join(root, "home"), env: {} });
  knowledge.saveNotes("# User\n- Likes tea");
  assert.match(knowledge.context("enabled"), /Likes tea/);
  assert.match(knowledge.context("enabled"), /Likes tea/);
  // An agent's edit, written in place.
  fs.writeFileSync(knowledge.notesFile, "# User\n- Likes tee\n");
  assert.match(knowledge.context("enabled"), /Likes tee/);
  const { day } = knowledge.dailyLog();
  knowledge.saveDailyLog(day, "# " + day + "\n\n- Booked the flight");
  assert.match(knowledge.context("enabled"), /Booked the flight/);
  fs.rmSync(knowledge.notesFile);
  assert.doesNotMatch(knowledge.context("enabled"), /Likes/);
});

// services.cjs needs Electron; a stand-in is enough for cloud().
function loadServices(t, fetchImpl) {
  const original = Module._load, fetchBefore = global.fetch;
  Module._load = function load(request, ...rest) {
    if (request === "electron") return { BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => false }, shell: {} };
    if (/desktop[\\/]auth\.cjs$/.test(request)) return { createAuth: () => ({ init: async () => {}, hasPendingFlow: () => false, user: () => ({ id: "user-1" }), userId: () => "user-1", accessToken: async () => "token", providers: async () => ({}) }) };
    return original.call(this, request, ...rest);
  };
  t.after(() => { Module._load = original; global.fetch = fetchBefore; });
  delete require.cache[require.resolve("../app/main/services.cjs")];
  const { createServices } = require("../app/main/services.cjs");
  Module._load = original;
  global.fetch = fetchImpl;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tw-services-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  return createServices({ profile, config: { supabaseUrl: "https://cloud.invalid", publishableKey: "key" }, agentsFor: () => ({}) });
}

test("large model requests go compressed, and uncompressed for the rest of the run if the cloud can't read them", async t => {
  const sent = [];
  let reads = true;
  const services = loadServices(t, async (url, init) => {
    const gzipped = init.headers["content-encoding"] === "gzip";
    const text = gzipped ? zlib.gunzipSync(init.body).toString("utf8") : init.body;
    sent.push({ route: new URL(url).pathname.split("timewarp-energy")[1], gzipped, size: Buffer.byteLength(init.body || ""), body: text && JSON.parse(text), signal: init.signal });
    if (gzipped && !reads) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    return Response.json({ ok: true });
  });
  const large = { model: "m", input: "x".repeat(100 * 1024) };
  assert.equal((await services.cloud("/v1/responses", large)).status, 200);
  assert.equal(sent[0].gzipped, true);
  assert.ok(sent[0].size < 10 * 1024);
  assert.deepEqual(sent[0].body, large);
  await services.cloud("/v1/responses", { model: "m", input: "short" });
  await services.cloud("/history", { text: "x".repeat(100 * 1024) });
  assert.deepEqual(sent.slice(1).map(item => item.gzipped), [false, false], "Small requests and other routes go as they are");
  // A cloud that can't read them yet.
  reads = false;
  const response = await services.cloud("/v1/responses", large);
  assert.equal(response.status, 200);
  assert.deepEqual(sent.slice(3).map(item => item.gzipped), [true, false]);
  assert.deepEqual(sent[4].body, large);
  assert.equal(sent[3].signal, sent[4].signal, "One time limit for both");
  await services.cloud("/v1/responses", large);
  assert.equal(sent.at(-1).gzipped, false);
});

test("a model request checked by the bridge isn't walked again; others still are", async t => {
  const services = loadServices(t, async () => Response.json({ ok: true }));
  let reads = 0;
  const payload = { input: "hello" };
  Object.defineProperty(payload, "model", { enumerable: true, get: () => { reads++; return "m"; } });
  services.cloudSafe(payload);
  await services.cloud("/v1/responses", payload);
  assert.equal(reads, 2, "One privacy walk and one serialization");
  await services.cloud("/v1/responses", payload);
  assert.equal(reads, 4, "Checked again when sent again");
  await assert.rejects(services.cloud("/history", { text: "card 4242 4242 4242 4242" }), /stay on this device/);
  assert.throws(() => services.cloudSafe({ input: "card 4242 4242 4242 4242" }), /stay on this device/);
});
