"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createModelBridge } = require("../app/main/model-bridge.cjs");

async function start(t, overrides = {}) {
  const calls = [];
  const bridge = createModelBridge({
    token: "run-token", port: 0,
    cloud: async (route, input, method) => { calls.push({ route, input, method }); return Response.json({ ok: true, route }); },
    funding: { current: async () => ({ source: "timewarp" }) },
    chatgpt: { catalog: async () => ({ object: "list", data: [{ id: "gpt-x" }] }) },
    ...overrides,
  });
  await new Promise(resolve => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(() => bridge.close());
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  return { calls, base };
}

test("model requests need this run's token and never accept browser pages", async t => {
  const { base, calls } = await start(t);
  assert.equal((await fetch(base + "/v1/responses", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(base + "/v1/responses", { method: "POST", headers: { authorization: "Bearer wrong-token" }, body: "{}" })).status, 401);
  assert.equal((await fetch(base + "/v1/responses", { method: "POST", headers: { authorization: "Bearer run-token", origin: "https://evil.example" }, body: "{}" })).status, 403);
  const ok = await fetch(base + "/v1/responses", { method: "POST", headers: { authorization: "Bearer run-token", "content-type": "application/json" }, body: JSON.stringify({ model: "m", input: "hi", client_metadata: { at: 1712345678901234 } }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.at(-1), { route: "/v1/responses", input: { model: "m", input: "hi" }, method: "POST" });
  assert.equal(calls.length, 1, "Rejected requests never reach the cloud");
});

test("secrets in model input stay on the device", async t => {
  const { base, calls } = await start(t);
  const response = await fetch(base + "/v1/responses", { method: "POST", headers: { authorization: "Bearer run-token" }, body: JSON.stringify({ input: "my card is 4242 4242 4242 4242" }) });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("a connected ChatGPT plan lists its own models and refuses proxied inference", async t => {
  const { base, calls } = await start(t, { funding: { current: async () => ({ source: "chatgpt" }) } });
  const models = await fetch(base + "/v1/models", { headers: { authorization: "Bearer run-token" } }).then(r => r.json());
  assert.deepEqual(models.data.map(m => m.id), ["gpt-x"]);
  assert.equal((await fetch(base + "/v1/responses", { method: "POST", headers: { authorization: "Bearer run-token" }, body: "{}" })).status, 409);
  assert.equal(calls.length, 0);
});

test("the bridge only answers its loopback host", async t => {
  const { base } = await start(t);
  const health = await fetch(base + "/healthz").then(r => r.json());
  assert.equal(health.name, "timewarp-device-bridge");
  const http = require("node:http");
  const status = await new Promise(resolve => http.get(base + "/healthz", { headers: { host: "attacker.example" } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(status, 403);
});

test("the bridge moves to a free port when another app uses its port", async t => {
  const net = require("node:net");
  const taken = net.createServer();
  await new Promise(resolve => taken.listen(0, "127.0.0.1", resolve));
  t.after(() => taken.close());
  const busy = taken.address().port;
  const bridge = createModelBridge({ token: "run-token", port: busy, cloud: async () => Response.json({}), funding: { current: async () => ({ source: "timewarp" }) } });
  t.after(() => bridge.close());
  const port = await bridge.listen();
  assert.notEqual(port, busy);
  assert.equal(bridge.port, port);
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then(response => response.json());
  assert.equal(health.name, "timewarp-device-bridge");
});
