"use strict";
// The owner choosing which of an agent's actions wait for their yes, and each
// action running as asked, once, when they approve it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startLocal, loadModule } = require("../scripts/agent-id-local.cjs");

async function setup(t, env = {}) {
  const local = await startLocal({ env });
  t.after(() => local.close());
  const ok = async (method, url, init) => {
    const response = await local.call(method, url, init);
    assert.ok(response.status < 300, `${method} ${url} → ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const terms = (await ok("GET", "/v1/config")).legal.termsVersion;
  const user = async () => { const u = await local.user(); await ok("POST", "/v1/account/terms", { token: u.session, body: { version: terms } }); return u; };
  const agent = async (owner, name) => { const created = await ok("POST", "/v1/agents", { token: owner.session, body: { name } }); return { ...created.agent, key: created.secret }; };
  return { local, ok, user, agent };
}

test("asking first: the owner chooses what waits for them, and it runs as asked once approved", async t => {
  const { local, ok, user, agent } = await setup(t);
  const alice = await user();
  const bot = await agent(alice, "Bot"), friend = await agent(alice, "Friend");
  const give = (a, kind) => ok("POST", `/v1/agents/${a.id}/resources`, { token: alice.session, body: { kind } });
  await local.settle();
  for (const a of [bot, friend]) { await give(a, "mail"); await give(a, "phone"); }
  await local.settle();
  const botView = await ok("GET", `/v1/agents/${bot.id}`, { token: alice.session });
  const friendView = await ok("GET", `/v1/agents/${friend.id}`, { token: alice.session });
  const friendMail = friendView.agent.resources.mail.address;
  // Test numbers and test mail don't ask unless the owner says so.
  assert.deepEqual(botView.agent.askFirst, { mail: false, sms: false, call: false, contacts: false, vault: false });
  const direct = await ok("POST", "/v1/me/mail", { token: bot.key, body: { to: friendMail, subject: "Hi", text: "Straight through." } });
  assert.equal(direct.message.status, "delivered");

  // The owner turns asking on; turning it off again takes the website.
  const ownerKey = (await ok("POST", "/v1/keys", { token: alice.session, body: { name: "cli" } })).secret;
  const on = await ok("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { askFirst: { mail: true, contacts: true, sms: true } } });
  assert.deepEqual(on.agent.askFirst, { mail: true, sms: true, call: false, contacts: true, vault: false });
  const offByKey = await local.call("PATCH", `/v1/agents/${bot.id}`, { token: ownerKey, body: { askFirst: { mail: false } } });
  assert.deepEqual([offByKey.status, offByKey.body.error.code], [403, "session_required"]);
  assert.equal((await local.call("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { askFirst: { nonsense: true } } })).status, 400);

  // Mail waits: nothing goes until the owner approves, then exactly that goes, once.
  const asked = await ok("POST", "/v1/me/mail", { token: bot.key, body: { to: friendMail, subject: "Quote for 500 units", text: "Please send your best price." } });
  assert.equal(asked.status, "needs_approval");
  assert.deepEqual([asked.summary.subject, asked.summary.to], ["Quote for 500 units", [friendMail]]);
  assert.match(asked.approveUrl, /\/agent-id\/approvals\?id=/);
  const inbox = async () => (await ok("GET", "/v1/me/mail?folder=inbox", { token: friend.key })).messages.map(m => m.subject);
  assert.ok(!(await inbox()).includes("Quote for 500 units"), "Not sent yet.");
  const pending = (await ok("GET", "/v1/approvals", { token: alice.session })).approvals.find(a => a.id === asked.approval);
  assert.deepEqual([pending.kind, pending.request.kind, pending.request.summary.subject], ["action", "mail", "Quote for 500 units"]);
  assert.equal((await local.call("POST", `/v1/approvals/${asked.approval}`, { token: bot.key, body: { decision: "approve" } })).status, 403, "Never by the agent.");
  const approved = await ok("POST", `/v1/approvals/${asked.approval}`, { token: alice.session, body: { decision: "approve" } });
  assert.deepEqual([approved.status, approved.message.status], ["completed", "delivered"]);
  assert.ok((await inbox()).includes("Quote for 500 units"));
  assert.equal((await local.call("POST", `/v1/approvals/${asked.approval}`, { token: alice.session, body: { decision: "approve" } })).status, 409, "Only once.");
  const status = await ok("GET", `/v1/me/approvals/${asked.approval}`, { token: bot.key });
  assert.deepEqual([status.approval.status, status.approval.kind], ["completed", "mail"]);

  // A text waits; the agent can take it back.
  const text = await ok("POST", "/v1/me/sms", { token: bot.key, body: { to: friendView.agent.resources.phone.address, text: "Running late" } });
  assert.equal(text.status, "needs_approval", JSON.stringify(text));
  assert.equal((await ok("POST", `/v1/me/approvals/${text.approval}/withdraw`, { token: bot.key })).approval.status, "denied");

  // A contact waits; declined, nothing changes.
  const contact = await ok("POST", "/v1/me/contacts", { token: bot.key, body: { name: "Nordic Parts", email: "orders@nordic.example" } });
  assert.deepEqual([contact.status, contact.summary.change, contact.summary.name], ["needs_approval", "add", "Nordic Parts"]);
  await ok("POST", `/v1/approvals/${contact.approval}`, { token: alice.session, body: { decision: "deny" } });
  assert.equal((await ok("GET", "/v1/me/contacts", { token: bot.key })).contacts.length, 0);
  assert.equal((await ok("GET", `/v1/me/approvals/${contact.approval}`, { token: bot.key })).approval.status, "denied");

  // Through MCP the agent hears it waits, and why.
  const rpc = body => local.call("POST", "/mcp", { token: bot.key, body: { jsonrpc: "2.0", ...body } });
  const viaMcp = JSON.parse((await rpc({ id: 1, method: "tools/call", params: { name: "mail_send", arguments: { to: friendMail, subject: "Via MCP", text: "Hello" } } })).body.result.content[0].text);
  assert.equal(viaMcp.status, "needs_approval");
  assert.match(viaMcp.message, /asked to approve this first/);

  // Unless the owner chose, texts and calls to real numbers ask first.
  const { asksFirst } = loadModule("shared.ts");
  assert.equal(asksFirst({ ask_first: {} }, "sms", "live"), true);
  assert.equal(asksFirst({ ask_first: {} }, "call", "test"), false);
  assert.equal(asksFirst({ ask_first: { call: false } }, "call", "live"), false);
  assert.equal(asksFirst({ ask_first: {} }, "mail", "live"), false);
});
