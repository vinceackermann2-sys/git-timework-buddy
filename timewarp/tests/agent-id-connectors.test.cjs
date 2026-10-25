"use strict";
// An agent's connected apps and automations in its Agent ID: the apps its
// owner lets it use (the same setting as its Timewarp agent's, through the
// account's synced data), used anywhere through Agent ID; and its Timewarp
// automations, shown here, with pause, resume and run-now requests that
// Timewarp picks up.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startLocal } = require("../scripts/agent-id-local.cjs");

// Composio as Agent ID calls it: the owner's working accounts, an app's
// actions, and running one.
function composio(owner) {
  const calls = [];
  const accounts = () => [
    { id: "ca_gmail", status: "ACTIVE", user_id: owner(), toolkit: { slug: "gmail" }, auth_config: { id: "ac_gmail" }, data: { email: "me@example.com" } },
    { id: "ca_slack", status: "ACTIVE", user_id: owner(), toolkit: { slug: "slack" }, auth_config: { id: "ac_slack" } },
    { id: "ca_old", status: "EXPIRED", user_id: owner(), toolkit: { slug: "notion" } },
  ];
  const fetch = async (url, init = {}) => {
    const href = new URL(String(url));
    const call = { url: href, method: init.method || "GET", key: new Headers(init.headers).get("x-api-key"), body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
    if (href.pathname.endsWith("/connected_accounts")) return json({ items: accounts().filter(a => a.user_id === href.searchParams.get("user_ids")) });
    if (href.pathname.endsWith("/tools")) return json({ items: [{ slug: "GMAIL_SEND_EMAIL", name: "Send email", description: "Send an email.", input_parameters: { type: "object", properties: { to: { type: "string" } } } }, { slug: "bad slug" }] });
    if (/\/tools\/execute\/GMAIL_SEND_EMAIL$/.test(href.pathname)) return json({ successful: true, data: { id: "msg_1" } });
    throw new Error(`Unexpected request: ${call.method} ${href}`);
  };
  return { fetch, calls };
}

async function setup(t) {
  let owner = null;
  const net = composio(() => owner);
  const local = await startLocal({ fetch: net.fetch, env: { COMPOSIO_API_KEY: "composio-key" } });
  t.after(() => local.close());
  const config = await (await local.handle(new Request("http://127.0.0.1:54329/agent-id/v1/config"))).json();
  const user = async () => {
    const created = await local.user();
    await local.call("POST", "/v1/account/terms", { token: created.session, body: { version: config.legal.termsVersion } });
    owner = created.id;
    return created;
  };
  const ok = async (method, url, init) => { const r = await local.call(method, url, init); assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const agent = async (who, name, extra = {}) => { const made = await ok("POST", "/v1/agents", { token: who.session, body: { name, ...extra } }); return { ...made.agent, key: made.secret }; };
  // What Timewarp has synced for its agent's connected-app access.
  const synced = async (who, key) => (await local.db.query("select value, revision from public.timewarp_energy_account_data where user_id=$1 and kind='connector-access' and key=$2", [who.id, key])).rows[0] || null;
  return { local, net, config, user, ok, agent, synced };
}

test("a Timewarp agent's Agent ID uses the apps its Timewarp agent may use, and changes here reach Timewarp", async t => {
  const { local, net, config, user, ok, agent, synced } = await setup(t);
  assert.equal(config.connectors.available, true);
  const alice = await user();
  const desk = await agent(alice, "Desk", { desktopAgentId: "11111111-1111-4111-8111-111111111111" });
  // Nothing set in Timewarp: every working account, as there.
  let view = await ok("GET", `/v1/agents/${desk.id}/connectors`, { token: alice.session });
  assert.equal(view.all, true);
  assert.equal(view.timewarp, true);
  assert.deepEqual(view.connectors.map(c => [c.app, c.label, c.allowed]), [["Gmail", "me@example.com", true], ["Slack", null, true]]);
  assert.ok(net.calls.every(call => call.key === "composio-key"));

  // Timewarp narrowed it to Gmail (as account sync writes it).
  await local.db.query("select public.timewarp_energy_put_account_data($1, $2)", [alice.id, JSON.stringify([{ kind: "connector-access", key: "11111111-1111-4111-8111-111111111111", value: { items: [{ kind: "integration", integrationId: "composio-gmail", accountId: "ca_gmail", owner: "user" }] }, base: 0 }])]);
  assert.deepEqual((await ok("GET", "/v1/me/connectors", { token: desk.key })).connectors.map(c => c.id), ["ca_gmail"]);

  // Changed on the website: written the way Timewarp reads it, over the latest revision.
  view = await ok("PUT", `/v1/agents/${desk.id}/connectors`, { token: alice.session, body: { connections: ["ca_gmail", "ca_slack"] } });
  assert.deepEqual(view.connectors.filter(c => c.allowed).map(c => c.id), ["ca_gmail", "ca_slack"]);
  const row = await synced(alice, "11111111-1111-4111-8111-111111111111");
  assert.equal(Number(row.revision), 2);
  assert.deepEqual(row.value.items.map(i => [i.integrationId, i.accountId]), [["composio-gmail", "ca_gmail"], ["composio-slack", "ca_slack"]]);
  await ok("PUT", `/v1/agents/${desk.id}/connectors`, { token: alice.session, body: { all: true } });
  assert.deepEqual((await synced(alice, "11111111-1111-4111-8111-111111111111")).value, { items: null });

  // Only working accounts the owner has can be given.
  const refused = await local.call("PUT", `/v1/agents/${desk.id}/connectors`, { token: alice.session, body: { connections: ["ca_old"] } });
  assert.equal(refused.status, 403);
});

test("an Agent ID made outside Timewarp starts with no apps, and runs only what it was given", async t => {
  const { net, user, ok, agent, local, synced } = await setup(t);
  const alice = await user();
  const cli = await agent(alice, "Coder");
  assert.deepEqual((await ok("GET", "/v1/me/connectors", { token: cli.key })).connectors, []);
  const none = await local.call("POST", "/v1/me/connectors/run", { token: cli.key, body: { tool: "GMAIL_SEND_EMAIL", arguments: { to: "a@example.com" } } });
  assert.equal(none.status, 403);

  await ok("PUT", `/v1/agents/${cli.id}/connectors`, { token: alice.session, body: { connections: ["ca_gmail"] } });
  assert.ok(await synced(alice, cli.id), "kept under its own agt_ id");
  const tools = await ok("GET", "/v1/me/connectors/tools?app=gmail&query=send", { token: cli.key });
  assert.deepEqual(tools.tools.map(tool => tool.slug), ["GMAIL_SEND_EMAIL"]);
  const listed = net.calls.find(call => call.url.pathname.endsWith("/tools"));
  assert.equal(listed.url.searchParams.get("toolkit_slug"), "gmail");
  assert.equal(listed.url.searchParams.get("auth_config_ids"), "ac_gmail");
  assert.equal((await local.call("GET", "/v1/me/connectors/tools?app=slack", { token: cli.key })).status, 404);

  const ran = await ok("POST", "/v1/me/connectors/run", { token: cli.key, body: { tool: "GMAIL_SEND_EMAIL", arguments: { to: "a@example.com" } } });
  assert.deepEqual([ran.successful, ran.app, ran.data], [true, "Gmail", { id: "msg_1" }]);
  const executed = net.calls.find(call => /execute/.test(call.url.pathname));
  assert.deepEqual([executed.body.user_id, executed.body.connected_account_id, executed.body.arguments], [alice.id, "ca_gmail", { to: "a@example.com" }]);
  // Another app's action, or a made-up one, isn't run.
  assert.equal((await local.call("POST", "/v1/me/connectors/run", { token: cli.key, body: { tool: "SLACK_SEND_MESSAGE" } })).status, 403);
  assert.equal((await local.call("POST", "/v1/me/connectors/run", { token: cli.key, body: { tool: "rm -rf" } })).status, 400);
  const audit = await ok("GET", "/v1/audit", { token: alice.session });
  assert.ok(audit.entries.some(entry => entry.action === "connector.run" && entry.detail.tool === "GMAIL_SEND_EMAIL"));
});

test("the MCP server offers connected apps and automations as tools", async t => {
  const { user, agent, local } = await setup(t);
  const alice = await user();
  const desk = await agent(alice, "Desk", { desktopAgentId: "22222222-2222-4222-8222-222222222222" });
  const rpc = async (method, params = {}) => (await local.call("POST", "/mcp", { token: desk.key, body: { jsonrpc: "2.0", id: 1, method, params } })).body;
  const names = (await rpc("tools/list")).result.tools.map(tool => tool.name);
  for (const name of ["connectors_list", "connector_tools", "connector_run", "automations_list"]) assert.ok(names.includes(name), name);
  const listed = await rpc("tools/call", { name: "connectors_list", arguments: {} });
  assert.deepEqual(JSON.parse(listed.result.content[0].text).connectors.map(c => c.app), ["Gmail", "Slack"]);
  // Every tool, for apps that describe them before an agent connects; no sign-in needed.
  const open = await local.call("GET", "/v1/mcp/tools");
  assert.equal(open.status, 200);
  const all = open.body.tools.map(tool => tool.name);
  for (const name of ["mail_send", "wallet_get", "card_get", "vm_exec", "vault_request", "connector_run", "automations_list"]) assert.ok(all.includes(name), name);
});

test("Timewarp's automations show on the Agent ID, and the website's requests wait for Timewarp", async t => {
  const { user, ok, agent, local } = await setup(t);
  const alice = await user(), bob = await user();
  const desk = await agent(alice, "Desk", { desktopAgentId: "33333333-3333-4333-8333-333333333333" });
  const snapshot = [
    { id: "auto-1", name: "Morning inbox", schedule: { kind: "weekdays", time: "08:30" }, summary: "Weekdays at 08:30", enabled: true, nextRunAt: "2026-10-27T07:30:00.000Z", lastRun: { status: "completed", at: "2026-10-24T06:30:00.000Z" } },
    { id: "auto-2", name: "Weekly report", schedule: { kind: "weekly", time: "09:00", days: [1] }, summary: "Mondays at 09:00", enabled: false },
  ];
  let view = await ok("PUT", `/v1/agents/${desk.id}/automations`, { token: alice.session, body: { device: "DESK-PC", automations: snapshot } });
  assert.deepEqual(view.automations.map(a => [a.id, a.name, a.enabled, a.device]), [["auto-1", "Morning inbox", true, "DESK-PC"], ["auto-2", "Weekly report", false, "DESK-PC"]]);
  assert.deepEqual(view.automations[0].lastRun, { status: "completed", at: "2026-10-24T06:30:00.000Z" });

  // The website asks; asking twice is one request.
  const first = await ok("POST", `/v1/agents/${desk.id}/automations/auto-2/requests`, { token: alice.session, body: { action: "resume" } });
  const again = await ok("POST", `/v1/agents/${desk.id}/automations/auto-2/requests`, { token: alice.session, body: { action: "resume" } });
  assert.equal(first.request.id, again.request.id);
  await ok("POST", `/v1/agents/${desk.id}/automations/auto-1/requests`, { token: alice.session, body: { action: "run" } });
  assert.equal((await local.call("POST", `/v1/agents/${desk.id}/automations/auto-1/requests`, { token: alice.session, body: { action: "delete" } })).status, 400);
  assert.equal((await local.call("POST", `/v1/agents/${desk.id}/automations/nope/requests`, { token: alice.session, body: { action: "run" } })).status, 404);
  // Nobody else sees or asks.
  assert.equal((await local.call("GET", `/v1/agents/${desk.id}/automations`, { token: bob.session })).status, 404);

  // Timewarp picks them up with its own agent's id, and says how they went.
  const pending = (await ok("GET", "/v1/automation-requests", { token: alice.session })).requests;
  assert.deepEqual(pending.map(r => [r.automationId, r.action, r.desktopAgentId]), [["auto-2", "resume", "33333333-3333-4333-8333-333333333333"], ["auto-1", "run", "33333333-3333-4333-8333-333333333333"]]);
  assert.deepEqual((await ok("GET", "/v1/automation-requests", { token: bob.session })).requests, []);
  await ok("POST", `/v1/automation-requests/${pending[0].id}`, { token: alice.session, body: { status: "done" } });
  assert.equal((await local.call("POST", `/v1/automation-requests/${pending[0].id}`, { token: alice.session, body: { status: "done" } })).status, 404);

  // An automation removed in Timewarp goes, and what waited for it fails.
  view = await ok("PUT", `/v1/agents/${desk.id}/automations`, { token: alice.session, body: { device: "DESK-PC", automations: [snapshot[1]] } });
  assert.deepEqual(view.automations.map(a => a.id), ["auto-2"]);
  assert.deepEqual(view.pending, []);
  assert.deepEqual((await ok("GET", "/v1/automation-requests", { token: alice.session })).requests, []);

  // The agent sees its own.
  assert.deepEqual((await ok("GET", "/v1/me/automations", { token: desk.key })).automations.map(a => a.name), ["Weekly report"]);
});
