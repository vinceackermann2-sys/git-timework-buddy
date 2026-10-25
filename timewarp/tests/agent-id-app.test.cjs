"use strict";
// The Timewarp app's Agent ID (app/main/agent-id.cjs and agent-id-tools.cjs)
// against the real service, run locally (agent-id-local.cjs) with simulated
// Privy and Bridge: everything the agent page asks, the owner's identity
// check, the website signed in from the app, and the agent's chat tools.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startLocal } = require("../scripts/agent-id-local.cjs");
const { simulatedMoney } = require("../scripts/agent-id-dev-money.cjs");
const { createAgentIds, agentIdApi } = require("../app/main/agent-id.cjs");
const { createAgentIdTools } = require("../app/main/agent-id-tools.cjs");

async function setup(t, env = {}) {
  const money = simulatedMoney({ apiUrl: "http://127.0.0.1:54329" });
  let later = 0;
  const local = await startLocal({ fetch: money.fetch, now: () => Date.now() + later, env: { AGENT_ID_AUTO_GIVE: "mail,wallet", AGENT_ID_LIVE: "wallet", PRIVY_APP_ID: "dev-privy", PRIVY_APP_SECRET: "dev-privy", BRIDGE_API_KEY: "sk-test-dev", AGENT_ID_PHONES: "waitlist", ...env } });
  t.after(() => local.close());
  const owner = await local.user({ email: "owner@timewarp.test", plan: "pro", credits: 100 });
  // The app's own client, its requests answered by the local service.
  const request = agentIdApi({
    config: { supabaseUrl: "http://127.0.0.1:54329", publishableKey: "publishable" }, auth: { accessToken: async () => owner.session },
    fetch: async (url, init) => local.handle(new Request(String(url).replace("/functions/v1/agent-id", "/agent-id"), init)),
  });
  let stored = null;
  const opened = [];
  const desk = { id: "desk-agent-1", name: "Orbit" };
  const ids = createAgentIds({
    request, storage: { load: () => stored, save: value => { stored = JSON.parse(JSON.stringify(value)); } }, encryption: { isEncryptionAvailable: () => true },
    agents: { get: id => { if (id !== desk.id) throw Object.assign(new Error("No such agent."), { status: 404 }); return desk; } },
    userId: () => owner.id, hostname: () => "desk", openPage: async url => { opened.push(url); return { opened: true }; },
  });
  return { local, money, owner, request, ids, desk, opened, stored: () => stored, later: ms => { later += ms; } };
}

test("the agent page's requests are the service's own: an Agent ID, its mail, wallet, computer, vault, applications and activity", async t => {
  const { local, owner, ids, desk, stored } = await setup(t);
  assert.equal((await ids.get(desk.id)).linked, false);
  const made = await ids.create(desk.id);
  await local.settle();
  assert.equal(made.linked, true);
  assert.match(made.id, /^agt_/);
  assert.equal(made.keyStored, true);
  assert.match(stored()[owner.id][desk.id].key, /^twa_/);

  const shown = await ids.get(desk.id);
  assert.equal(shown.owner.status, "unverified");
  assert.equal(shown.owner.check, "bridge");
  assert.match(shown.resources.mail.address, /^[a-z0-9-]+@/);
  assert.equal(shown.available.card.waitlist, true);
  const glance = await ids.glance(desk.id, ["mail", "wallet"]);
  assert.equal(glance.mail.unread, 0);
  assert.equal(glance.wallet.balance.currency, "USD");

  const ok = (op, input) => ids.call(desk.id, op, input);
  await ok("mail.send", { to: "friend@example.com", subject: "Hello", text: "Hi there" });
  const sent = await ok("mail.list", { folder: "sent" });
  assert.equal(sent.messages[0].subject, "Hello");
  assert.equal((await ok("mail.read", { id: sent.messages[0].id })).message.text, "Hi there");
  assert.equal((await ok("wallet.get")).wallet.currency, "USD");
  assert.deepEqual((await ok("wallet.transactions")).transactions, []);
  assert.equal((await ok("card.apply", { useCase: "Software", monthlySpend: 20000, country: "se" })).application.country, "SE");
  assert.equal((await ok("card.application")).application.status, "submitted");
  assert.equal((await ok("phone.apply", { useCase: "Bookings", country: "SE", uses: ["sms"] })).application.uses[0], "sms");
  assert.equal((await ok("vault.setup")).vault.ready, true);
  assert.equal((await ok("computer.get")).machine.state, "stopped");
  assert.deepEqual((await ok("approvals.list")).approvals, []);
  assert.equal((await ok("activity")).events[0].kind, "mail");
  await assert.rejects(ok("card.get"), error => error.status === 404 && error.code === "no_card");
});

test("the owner verifies once through Bridge: its page opens in the Agent ID window, and the agent page sees the result", async t => {
  const { money, ids, desk, opened, later } = await setup(t);
  await ids.create(desk.id);
  const started = await ids.verify();
  assert.deepEqual(started, { status: "pending", opened: true });
  assert.match(opened[0], /\/dev\/bridge-kyc\?id=kyc_/);
  assert.equal((await ids.get(desk.id)).owner.status, "pending");
  // As if they finished Bridge's page.
  money.kycPage(new URL(opened[0]).search.slice(1));
  later(10000);
  assert.equal((await ids.get(desk.id)).owner.status, "verified");
});

test("without a provider, the owner's name and country are the check", async t => {
  const { ids, desk } = await setup(t, { AGENT_ID_KYC: "test", BRIDGE_API_KEY: "" });
  await ids.create(desk.id);
  assert.equal((await ids.get(desk.id)).owner.check, "test");
  assert.deepEqual(await ids.verify({ legalName: "Ada Lovelace", country: "gb" }), { status: "verified", opened: false });
  const owner = (await ids.get(desk.id)).owner;
  assert.equal(owner.legalName, "Ada Lovelace");
  assert.equal(owner.country, "GB");
});

test("the website is signed in from the app with a session of its own, never from an owner key", async t => {
  const { local, owner, ids, desk, opened } = await setup(t);
  await ids.create(desk.id);
  const { status, body } = await local.call("POST", "/v1/account/web-session", { token: owner.session, body: {} });
  assert.equal(status, 200);
  assert.ok(body.session.access_token && body.session.refresh_token);
  const key = (await local.call("POST", "/v1/keys", { token: owner.session, body: { name: "CLI" } })).body.secret;
  const refused = await local.call("POST", "/v1/account/web-session", { token: key, body: {} });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, "session_required");
  // Recorded where the owner sees what happened.
  const audit = (await local.call("GET", "/v1/audit", { token: owner.session })).body;
  assert.ok(JSON.stringify(audit).includes("account.web_session"));
  // "Open Agent ID" goes to the agent's own page there.
  const id = (await ids.get(desk.id)).id;
  await ids.openSite(desk.id, { tab: "wallet" });
  assert.equal(opened.at(-1), `https://timewarpdev.com/agent-id/agents/${id}?tab=wallet`);
});

test("the agent's chat tools act as it, with its own key, through the service's MCP", async t => {
  const { request, ids, desk } = await setup(t);
  await ids.create(desk.id);
  const tools = createAgentIdTools({ request, agentIds: ids, modelOf: () => "gpt-6.1-sol" });
  await tools.refresh();
  const found = JSON.parse((await tools.call("chat-1", { tool: "agent_id_tools", arguments: { query: "who am i" } }, desk)).contentItems[0].text);
  assert.ok(found.actions.some(action => action.name === "whoami"));
  const me = await tools.call("chat-1", { tool: "agent_id", arguments: { action: "whoami" } }, desk);
  assert.equal(me.success, true);
  assert.match(me.contentItems[0].text, /Orbit/);
});
