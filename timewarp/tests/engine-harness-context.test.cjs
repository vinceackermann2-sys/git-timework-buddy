"use strict";
// What each chat thread is given besides the user's words: Timewarp's base
// prompt, each message's context (its time, the account, memory), writable
// folders and its workers' instructions; and turns cut off by a quit.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { CodexClient } = require("../app/main/codex-client.cjs");
const { codexExecutable, codexEnv, vendorRoot } = require("../app/main/codex-paths.cjs");
const { openStore } = require("../app/main/store.cjs");
const { createHarness, titleFrom } = require("../app/main/harness.cjs");
const { CODEX_FEATURES, PERMISSIONS, agentThreadConfig, workspaceRoots } = require("../app/main/codex-config.cjs");
const { workerInstructions, engineInstructions, WORKER } = require("../app/main/instructions.cjs");
const { BASE_INSTRUCTIONS } = require("../app/main/base-instructions.cjs");

const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const usage = { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 };
const reply = (id, text) => sse([
  { type: "response.created", response: { id } },
  { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id: "m" + id, content: [{ type: "output_text", text }] } },
  { type: "response.completed", response: { id, usage } },
]);
const textOf = item => (item.content || []).map(part => part.text || "").join("");

let available = true;
try { codexExecutable(); } catch { available = false; }
const skip = !available && "Codex runtime is not installed";

// The official Codex against a fake Responses API that records each request;
// a message with HOLD gets no answer.
async function official(t, options = {}) {
  const bodies = [], held = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      if (!(req.method === "POST" && req.url.endsWith("/responses"))) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
      const body = JSON.parse(raw), id = "r" + bodies.push(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const last = (body.input || []).filter(item => item.role === "user").at(-1), all = JSON.stringify(body.input);
      const outputs = (body.input || []).filter(item => item.type === "function_call_output" || item.type === "custom_tool_call_output");
      if (last && textOf(last).includes("HOLD")) { held.push(res); res.write(sse([{ type: "response.created", response: { id } }])); return; }
      // "SPAWN" starts a worker with a task; the worker answers at once.
      if (all.includes("WORKER-TASK") && !all.includes("SPAWN")) { res.end(reply(id, "Worker done.")); return; }
      if (last && textOf(last).includes("SPAWN") && !outputs.length) {
        const call = { type: "function_call", id: "fc" + id, call_id: "c" + id, name: "spawn_agent", namespace: "collaboration", arguments: JSON.stringify({ task_name: "helper", message: "WORKER-TASK check the inbox", fork_turns: "none" }) };
        res.end(sse([{ type: "response.created", response: { id } }, { type: "response.output_item.done", output_index: 0, item: call }, { type: "response.completed", response: { id, usage } }]));
        return;
      }
      res.end(reply(id, "Done."));
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
    args: ["-c", `model_providers.fake={name="Fake",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",env_key="TIMEWARP_TEST_TOKEN"}`, "-c", 'model_provider="fake"', "-c", 'model="openai/gpt-5.6-sol"', ...CODEX_FEATURES.flatMap(setting => ["-c", setting])],
    env: { CODEX_HOME: path.join(root, "codex"), TIMEWARP_TEST_TOKEN: "device-token", ...codexEnv(vendor) },
    clientInfo: { name: "timewarp", title: "Timewarp", version: "0.0.0-test" },
  });
  fs.mkdirSync(path.join(root, "codex"), { recursive: true });
  cleanup.push(() => client.stop());
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "Be brief.", modelSettings: () => ({ name: "openai/gpt-5.6-sol" }), permissions: PERMISSIONS, ...options(root) });
  const completed = () => new Promise(resolve => { const listener = event => { if (event.method === "turn/completed") { client.off("notification", listener); resolve(event.params.turn); } }; client.on("notification", listener); });
  return { root, store, client, harness, agent, bodies, held, completed };
}

test("the model gets Timewarp's base prompt and each message's context, which the chat doesn't show", { skip, timeout: 180000 }, async t => {
  let notes = "NOTES-ONE";
  const extra = [];
  const { store, harness, agent, bodies, completed } = await official(t, root => {
    extra.push(path.join(root, "memories"));
    return {
      baseInstructions: "TIMEWARP-BASE-PROMPT",
      threadConfig: value => agentThreadConfig(workerInstructions(value)),
      workspaceRoots: value => workspaceRoots(value.workspace, { memories: extra[0], memoryWrite: true }),
      turnContext: async (_agent, _conversation, { sentAt }) => ({ timewarp_message_time: "SENT " + sentAt, timewarp_memory: notes }),
    };
  });
  fs.mkdirSync(extra[0], { recursive: true });
  const { id } = harness.conversations.create({ agentId: agent.id });
  let done = completed();
  await harness.send(id, { text: "Hello", clientId: "m1" });
  await done;
  done = completed();
  await harness.send(id, { text: "Again", clientId: "m2" });
  await done;

  const [first, second] = bodies.filter(body => (body.input || []).some(item => item.role === "user" && /Hello|Again/.test(textOf(item))));
  const developer = first.input.filter(item => item.type === "message" && item.role === "developer").map(textOf);
  assert.equal(developer[0], "TIMEWARP-BASE-PROMPT", "Timewarp's base prompt replaces Codex's");
  assert.doesNotMatch(JSON.stringify(first), /You are Codex/);
  const permissions = developer.join("\n").split("\n").find(line => /The writable roots are/.test(line)) || "";
  assert.ok(permissions.includes(extra[0]), "The memory folder is writable: " + permissions);
  const sentAt = store.messages.get("m1").createdAt;
  const contextTexts = second.input.filter(item => item.type === "message" && item.role === "developer").map(textOf);
  assert.ok(contextTexts.includes(`<timewarp_message_time>SENT ${sentAt}</timewarp_message_time>`), "The first message's time");
  assert.ok(contextTexts.includes(`<timewarp_message_time>SENT ${store.messages.get("m2").createdAt}</timewarp_message_time>`), "The second message's time");
  assert.equal(contextTexts.filter(text => text === "<timewarp_memory>NOTES-ONE</timewarp_memory>").length, 1, "Unchanged memory isn't sent again");
  assert.equal(JSON.stringify(first.input), JSON.stringify(second.input.slice(0, first.input.length)), "The second request starts with the first one: the prompt cache holds");

  const history = await harness.history(id);
  const shown = history.turns.flatMap(turn => turn.items).filter(item => item.type === "userMessage").map(item => item.content.map(part => part.text).join(""));
  assert.deepEqual(shown, ["Hello", "Again"], "The chat shows only what the user wrote");

  // Changed notes reach the next message.
  notes = "NOTES-TWO";
  done = completed();
  await harness.send(id, { text: "Third", clientId: "m3" });
  await done;
  assert.ok(bodies.at(-1).input.some(item => textOf(item) === "<timewarp_memory>NOTES-TWO</timewarp_memory>"));
});

test("a chat's workers get the base prompt and learn the agent they work for", { skip, timeout: 180000 }, async t => {
  const { harness, agent, bodies } = await official(t, () => ({ baseInstructions: "TIMEWARP-BASE-PROMPT", threadConfig: value => agentThreadConfig(workerInstructions(value)) }));
  const { id } = harness.conversations.create({ agentId: agent.id });
  await harness.send(id, { text: "SPAWN a helper", clientId: "w1" });
  const isWorker = body => { const all = JSON.stringify(body.input); return all.includes("WORKER-TASK") && !all.includes("SPAWN"); };
  for (const end = Date.now() + 60000; !bodies.some(isWorker) && Date.now() < end; ) await new Promise(resolve => setTimeout(resolve, 50));
  const worker = bodies.find(isWorker);
  assert.ok(worker, "The worker reached the model");
  const developer = worker.input.filter(item => item.type === "message" && item.role === "developer").map(textOf);
  assert.equal(developer[0], "TIMEWARP-BASE-PROMPT", "Workers keep Timewarp's base prompt");
  assert.ok(developer.some(text => text.startsWith(WORKER) && text.includes(`Its agent ID is ${agent.id}`)), "The worker knows its agent's ID for connected apps");
});

test("a turn cut off when Codex stopped shows as interrupted afterwards", { skip, timeout: 180000 }, async t => {
  const { client, harness, agent, held } = await official(t, () => ({ threadConfig: () => agentThreadConfig() }));
  const { id } = harness.conversations.create({ agentId: agent.id });
  await harness.send(id, { text: "HOLD: research flights", clientId: "s1" });
  for (const end = Date.now() + 30000; !held.length && Date.now() < end; ) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await harness.history(id)).turns.at(-1).status, "inProgress", "Still running");
  // As when Timewarp quits mid-reply: Codex stops; the next app start reads the thread.
  await client.stop();
  const history = await harness.history(id);
  assert.equal(history.turns.at(-1).status, "interrupted");
  assert.equal(harness.conversations.status(id).running, false);
});

// A stand-in for Codex that records requests.
function fakeClient(turns = []) {
  const client = new EventEmitter(), calls = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") return { turn: { id: "turn-live" } };
    if (method === "thread/read") return { thread: { id: params.threadId, turns } };
    return {};
  };
  return { client, calls };
}
function fakeSetup(t, turns, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-harness-context-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const conversation = store.conversations.create({ ownerId: "user-1", agentId: "agent-1" });
  const { client, calls } = fakeClient(turns);
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "", modelSettings: () => ({ name: "openai/gpt-5.6-sol" }), ...options });
  return { store, harness, client, calls, id: conversation.id, root };
}

test("only the turn this app is running shows as running", async t => {
  const turns = [{ id: "turn-old", status: "inProgress", items: [] }, { id: "turn-live", status: "inProgress", items: [] }];
  const { store, harness, id } = fakeSetup(t, turns);
  store.conversations.update(id, { codexThreadId: "thread-1" });
  const before = await harness.history(id);
  assert.deepEqual(before.turns.map(turn => turn.status), ["interrupted", "interrupted"], "Nothing runs before a message is sent");
  await harness.send(id, { text: "Go" });
  const after = await harness.history(id);
  assert.deepEqual(after.turns.map(turn => turn.status), ["interrupted", "inProgress"]);
});

test("context, base prompt and writable folders go with the thread and each message, and a slow context doesn't hold up sending", async t => {
  let slow = false;
  const { harness, calls, id, root } = fakeSetup(t, [], {
    baseInstructions: "BASE",
    workspaceRoots: agent => [agent.workspace, path.join(root, "skills")],
    turnContext: async () => slow ? new Promise(() => {}) : { timewarp_message_time: "now" },
  });
  await harness.send(id, { text: "One" });
  const start = calls.find(call => call.method === "thread/start").params;
  assert.equal(start.baseInstructions, "BASE");
  assert.deepEqual(start.runtimeWorkspaceRoots, [path.join(root, "orbit"), path.join(root, "skills")]);
  const turn = calls.find(call => call.method === "turn/start").params;
  assert.deepEqual(turn.additionalContext, { timewarp_message_time: { kind: "application", value: "now" } });
  assert.deepEqual(turn.runtimeWorkspaceRoots, start.runtimeWorkspaceRoots);
  slow = true;
  const started = Date.now();
  harness.reset();
  await harness.send(id, { text: "Two" });
  assert.ok(Date.now() - started < 4000, "Sent without its context");
  assert.equal(calls.filter(call => call.method === "turn/start").at(-1).params.additionalContext, undefined);
});

test("a first title leaves out a quoted reply, card markup and Markdown", () => {
  assert.equal(titleFrom("> **Flights** to Rome are 120 euros\n> on Friday\n\nBook the cheaper one"), "Book the cheaper one");
  assert.equal(titleFrom("> Only the quoted line"), "Only the quoted line");
  assert.equal(titleFrom('<widget-interaction summary="Chose Pricing" name="focus">Pricing</widget-interaction>'), "Chose Pricing");
  assert.equal(titleFrom("## Plan my **week** with [the calendar](https://example.com)"), "Plan my week with the calendar");
  assert.equal(titleFrom(""), "New conversation");
  assert.equal(titleFrom("x".repeat(80)).length, 60);
});

test("Timewarp's base prompt covers the previous app's rules and stays fixed", () => {
  for (const rule of [/never use em dashes/i, /⚠️/, /AccountChooser/, /citeturn/, /authorizes that action/, /Purchases and payments always need an explicit go-ahead/, /Signing in to a site the task needs doesn't need asking/, /reconnect/, /run count or an end date/, /Tell me when X/, /introduce yourself/i, /rg --files/, /secure field card/]) assert.match(BASE_INSTRUCTIONS, rule);
  assert.doesNotMatch(BASE_INSTRUCTIONS, /—|Energy|You are Codex/);
  assert.ok(BASE_INSTRUCTIONS.length < 12000, "Compact: it is sent with every request");
  assert.match(engineInstructions({ platform: "darwin" }), /timewarp_macos_protected_data/);
  assert.doesNotMatch(engineInstructions({ platform: "win32" }), /timewarp_macos_protected_data/);
  assert.doesNotMatch(engineInstructions({ platform: "win32" }), /Ask the user before purchases, sending messages/, "A request to send covers sending");
});
