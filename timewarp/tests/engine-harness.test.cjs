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
