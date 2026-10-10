"use strict";
// Runs a real conversation through the official Codex app server against a
// local fake Responses API, without accounts, credits or network access.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { CodexClient } = require("../app/main/codex-client.cjs");
const { codexExecutable, codexEnv, vendorRoot } = require("../app/main/codex-paths.cjs");
const { openStore } = require("../app/main/store.cjs");
const { createHarness } = require("../app/main/harness.cjs");

const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");

function fakeResponses(replyText) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      if (req.method === "POST" && req.url.endsWith("/responses")) {
        const id = "resp_" + requests.length, item = "msg_" + requests.length;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse([
          { type: "response.created", response: { id } },
          { type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant", id: item, content: [] } },
          { type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: replyText.slice(0, 6) },
          { type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: replyText.slice(6) },
          { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id: item, content: [{ type: "output_text", text: replyText }] } },
          { type: "response.completed", response: { id, usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 6, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 18 } } },
        ]));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  return { server, requests };
}

let available = true;
try { codexExecutable(); } catch { available = false; }

test("a conversation streams through the official Codex harness and saves both messages", { skip: !available && "Codex runtime is not installed", timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.homedir(), ".timewarp-engine-test-"));
  // Clean up in reverse order: stop Codex before removing the files it holds.
  const cleanup = [() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })];
  t.after(async () => { for (const step of cleanup.reverse()) { try { await step(); } catch (error) { console.warn("cleanup:", error.message); } } });
  const fake = fakeResponses("Hello from Timewarp.");
  await new Promise(resolve => fake.server.listen(0, "127.0.0.1", resolve));
  // Codex keeps its HTTP connection alive; close it so the test process exits.
  cleanup.push(() => { fake.server.closeAllConnections(); fake.server.close(); });
  const port = fake.server.address().port;

  const store = openStore(path.join(root, "timewarp.sqlite"));
  cleanup.push(() => store.close());
  const agent = store.agents.create({ ownerId: "user-1", name: "Orbit", instructions: "Be brief.", workspace: path.join(root, "agents", "orbit") });
  const vendor = vendorRoot();
  const client = new CodexClient({
    executable: codexExecutable(vendor),
    args: ["-c", `model_providers.fake={name="Fake",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",env_key="TIMEWARP_TEST_TOKEN"}`, "-c", 'model_provider="fake"', "-c", 'model="test-model"'],
    env: { CODEX_HOME: path.join(root, "codex"), TIMEWARP_TEST_TOKEN: "device-token", ...codexEnv(vendor) },
    clientInfo: { name: "timewarp", title: "Timewarp", version: "0.0.0-test" },
  });
  fs.mkdirSync(path.join(root, "codex"), { recursive: true });
  cleanup.push(() => client.stop());

  const events = [];
  const harness = createHarness({
    store, client, userId: () => "user-1",
    instructionsFor: value => value.instructions + "\nTIMEWARP-TEST-MARKER",
    modelSettings: () => ({ name: "test-model" }),
    notify: (name, payload) => events.push({ name, ...payload }),
  });
  const conversation = harness.conversations.create({ agentId: agent.id });
  const completed = new Promise(resolve => client.on("notification", event => { if (event.method === "turn/completed") resolve(event.params); }));
  const sent = await harness.send(conversation.id, { text: "Say hello" });
  assert.equal(sent.message.text, "Say hello");
  const turn = await completed;
  assert.equal(turn.turn.status, "completed");

  const messages = store.messages.list(conversation.id);
  assert.deepEqual(messages.map(m => [m.authorId, m.text]), [["user-1", "Say hello"], [agent.id, "Hello from Timewarp."]]);
  const saved = store.conversations.get(conversation.id);
  assert.ok(saved.codexThreadId);
  assert.equal(saved.title, "Say hello");
  assert.equal(saved.read, false, "A finished reply marks the chat unread until it is viewed");

  const deltas = events.filter(e => e.name === "conversation.event" && e.method === "item/agentMessage/delta").map(e => e.params.delta).join("");
  assert.equal(deltas, "Hello from Timewarp.");
  const call = fake.requests.find(r => r.method === "POST" && r.url.endsWith("/responses"));
  assert.equal(call.authorization, "Bearer device-token");
  assert.ok(JSON.stringify(call.body).includes("TIMEWARP-TEST-MARKER"), "Agent instructions reach the model");
  assert.ok(fs.existsSync(agent.workspace), "The agent workspace is created");

  const history = await harness.history(conversation.id);
  const items = history.turns.flatMap(item => item.items || []);
  assert.ok(items.some(item => item.type === "userMessage"));
  assert.ok(items.some(item => item.type === "agentMessage" && item.text === "Hello from Timewarp."));
});

// A model that answers at once, except for a message with HOLD: its answer
// waits until release().
function heldResponses() {
  const held = [], bodies = [];
  const answer = (res, id, text) => res.end(sse([
    { type: "response.created", response: { id } },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id: "msg_" + id, content: [{ type: "output_text", text }] } },
    { type: "response.completed", response: { id, usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } } },
  ]));
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      if (!(req.method === "POST" && req.url.endsWith("/responses"))) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
      const body = JSON.parse(raw), id = "resp_" + (bodies.push(body));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const last = JSON.stringify((body.input || []).filter(item => item.role === "user").at(-1) || {});
      if (last.includes("HOLD")) { held.push({ res, id }); res.write(sse([{ type: "response.created", response: { id } }])); return; }
      answer(res, id, "Done.");
    });
  });
  const release = () => { for (const entry of held.splice(0)) answer(entry.res, entry.id, "Held answer."); };
  return { server, held, bodies, release, drop: () => { for (const entry of held.splice(0)) entry.res.destroy(); } };
}

async function codexHarness(t, model) {
  const root = fs.mkdtempSync(path.join(os.homedir(), ".timewarp-engine-test-"));
  const cleanup = [() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })];
  t.after(async () => { for (const step of cleanup.reverse()) { try { await step(); } catch (error) { console.warn("cleanup:", error.message); } } });
  await new Promise(resolve => model.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => { model.drop(); model.server.closeAllConnections(); model.server.close(); });
  const port = model.server.address().port;
  const store = openStore(path.join(root, "timewarp.sqlite"));
  cleanup.push(() => store.close());
  const agent = store.agents.create({ ownerId: "user-1", name: "Orbit", instructions: "Be brief.", workspace: path.join(root, "agents", "orbit") });
  const vendor = vendorRoot();
  const client = new CodexClient({
    executable: codexExecutable(vendor),
    args: ["-c", `model_providers.fake={name="Fake",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",env_key="TIMEWARP_TEST_TOKEN"}`, "-c", 'model_provider="fake"', "-c", 'model="test-model"'],
    env: { CODEX_HOME: path.join(root, "codex"), TIMEWARP_TEST_TOKEN: "device-token", ...codexEnv(vendor) },
    clientInfo: { name: "timewarp", title: "Timewarp", version: "0.0.0-test" },
  });
  fs.mkdirSync(path.join(root, "codex"), { recursive: true });
  cleanup.push(() => client.stop());
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "Be brief.", modelSettings: () => ({ name: "test-model" }) });
  const completed = turnId => new Promise(resolve => client.on("notification", event => { if (event.method === "turn/completed" && (!turnId || event.params.turn.id === turnId)) resolve(event.params.turn); }));
  return { store, client, harness, agent, completed };
}
const until = async (check, ms = 30000) => { for (const end = Date.now() + ms; !check(); ) { if (Date.now() > end) throw new Error("Timed out"); await new Promise(resolve => setTimeout(resolve, 50)); } };

test("a message sent while the agent works joins its turn in the official Codex", { skip: !available && "Codex runtime is not installed", timeout: 120000 }, async t => {
  const model = heldResponses();
  const { store, harness, agent, completed } = await codexHarness(t, model);
  const { id } = harness.conversations.create({ agentId: agent.id });
  const first = await harness.send(id, { text: "HOLD: plan my week", clientId: "m1" });
  await until(() => model.held.length);
  const done = completed(first.turnId);
  const second = await harness.send(id, { text: "Add Friday too", clientId: "m2" }, { steer: true });
  assert.deepEqual([second.steered, second.turnId], [true, first.turnId]);
  model.release();
  const turn = await done;
  assert.equal(turn.status, "completed");
  const history = await harness.history(id);
  assert.equal(history.turns.length, 1, "One turn");
  assert.deepEqual(history.turns[0].items.filter(item => item.type === "userMessage").map(item => item.clientId), ["m1", "m2"]);
  assert.ok(model.bodies.some(body => JSON.stringify(body.input).includes("Add Friday too")), "The model saw the added message");
  assert.deepEqual(["m1", "m2"].map(message => store.messages.get(message).status), ["sent", "sent"]);
  assert.equal(harness.conversations.status(id).running, false);
});

test("Stop while a chat's first reply is starting stops it in the official Codex", { skip: !available && "Codex runtime is not installed", timeout: 120000 }, async t => {
  const model = heldResponses();
  const { client, harness, agent } = await codexHarness(t, model);
  const { id } = harness.conversations.create({ agentId: agent.id });
  const stopped = new Promise(resolve => client.on("notification", event => { if (event.method === "turn/completed") resolve(event.params.turn); }));
  const sending = harness.send(id, { text: "HOLD: research flights", clientId: "m1" });
  // The thread is still starting: Codex has no turn yet.
  assert.deepEqual(await harness.interrupt(id), { interrupted: true });
  await sending;
  const turn = await stopped;
  assert.equal(turn.status, "interrupted");
  assert.equal(harness.conversations.status(id).running, false);
});

// Multi-agent workers have no thread/started in this Codex: their requests
// still reach the chat that started them.
test("a worker's approval request reaches its chat in the official Codex", { skip: !available && "Codex runtime is not installed", timeout: 120000 }, async t => {
  const { CODEX_FEATURES, PERMISSIONS, THREAD_CONFIG } = require("../app/main/codex-config.cjs");
  const MODEL = "openai/gpt-5.6-sol";
  const usage = { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 };
  const reply = (id, item) => sse([{ type: "response.created", response: { id } }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id, usage } }]);
  const held = [];
  let count = 0;
  // The chat's agent starts a worker; the worker runs a command that needs approval.
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      if (!(req.method === "POST" && req.url.endsWith("/responses"))) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
      const body = JSON.parse(raw), text = JSON.stringify(body.input), id = "r" + ++count;
      const outputs = (body.input || []).filter(item => item.type === "function_call_output" || item.type === "custom_tool_call_output");
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (text.includes("WORKER-TASK") && !text.includes("ROOT-GO")) {
        if (!outputs.length) { res.end(reply(id, { type: "custom_tool_call", id: "ctc" + id, call_id: "c" + id, name: "exec", input: 'const r = await tools.exec_command({ cmd: "echo hi", sandbox_permissions: "require_escalated", justification: "needed" }); text(JSON.stringify(r));' })); return; }
        res.end(reply(id, { type: "message", role: "assistant", id: "m" + id, content: [{ type: "output_text", text: "worker done" }] }));
        return;
      }
      if (!outputs.length) { res.end(reply(id, { type: "function_call", id: "fc" + id, call_id: "c" + id, name: "spawn_agent", namespace: "collaboration", arguments: JSON.stringify({ task_name: "helper", message: "WORKER-TASK do work", fork_turns: "none" }) })); return; }
      held.push(res);
      res.write(sse([{ type: "response.created", response: { id } }]));
    });
  });
  const root = fs.mkdtempSync(path.join(os.homedir(), ".timewarp-engine-test-"));
  const cleanup = [() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })];
  t.after(async () => { for (const step of cleanup.reverse()) { try { await step(); } catch (error) { console.warn("cleanup:", error.message); } } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => { for (const res of held) res.destroy(); server.closeAllConnections(); server.close(); });
  const store = openStore(path.join(root, "timewarp.sqlite"));
  cleanup.push(() => store.close());
  const agent = store.agents.create({ ownerId: "user-1", name: "Orbit", instructions: "", workspace: path.join(root, "agents", "orbit") });
  const vendor = vendorRoot();
  const client = new CodexClient({
    executable: codexExecutable(vendor),
    args: ["-c", `model_providers.fake={name="Fake",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",env_key="TIMEWARP_TEST_TOKEN"}`, "-c", 'model_provider="fake"', "-c", `model="${MODEL}"`, ...CODEX_FEATURES.flatMap(setting => ["-c", setting])],
    env: { CODEX_HOME: path.join(root, "codex"), TIMEWARP_TEST_TOKEN: "device-token", ...codexEnv(vendor) },
    clientInfo: { name: "timewarp", title: "Timewarp", version: "0.0.0-test" },
  });
  fs.mkdirSync(path.join(root, "codex"), { recursive: true });
  cleanup.push(() => client.stop());
  const events = [];
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "Be brief.", permissions: PERMISSIONS, threadConfig: () => ({ ...THREAD_CONFIG }),
    modelSettings: () => ({ name: MODEL }), notify: (name, payload) => events.push({ name, ...payload }) });
  const refused = [];
  const respondError = client.respondError.bind(client);
  client.respondError = (requestId, message, code) => { refused.push(message); return respondError(requestId, message, code); };
  const { id } = harness.conversations.create({ agentId: agent.id });
  await harness.send(id, { text: "ROOT-GO" });
  for (const end = Date.now() + 60000; !harness.pendingApprovals().length && !refused.length; ) {
    if (Date.now() > end) throw new Error("No request from the worker");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(refused, []);
  const [request] = harness.pendingApprovals();
  assert.equal(request.conversationId, id);
  assert.notEqual(request.params.threadId, store.conversations.get(id).codexThreadId, "The request is the worker's");
  assert.ok(events.some(event => event.name === "conversation.event" && event.params?.subAgent && event.params.threadId === request.params.threadId), "The worker's activity reaches the chat");
});
