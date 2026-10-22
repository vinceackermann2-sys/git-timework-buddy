"use strict";
// Agent ID: the edge function (supabase/functions/agent-id) end to end, on the
// real migration in PGlite, with test resources. Live providers and their
// webhooks are in agent-id-providers.test.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const { startLocal } = require("../scripts/agent-id-local.cjs");

async function setup(t, options) {
  const local = await startLocal(options);
  t.after(() => local.close());
  const makeUser = local.user.bind(local);
  local.user = async (options = {}) => {
    const user = await makeUser(options);
    if (options.terms !== false) { const config = await (await local.handle(new Request("http://127.0.0.1:54329/agent-id/v1/config"))).json(); await local.call("POST", "/v1/account/terms", { token: user.session, body: { version: config.legal.termsVersion } }); }
    return user;
  };
  const ok = async (method, url, init) => {
    const response = await local.call(method, url, init);
    assert.ok(response.status < 300, `${method} ${url} → ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const agent = async (owner, name, extra = {}) => {
    const created = await ok("POST", "/v1/agents", { token: owner.session, body: { name, ...extra } });
    return { ...created.agent, key: created.secret };
  };
  const give = (owner, agentRow, kind, body = {}) => ok("POST", `/v1/agents/${agentRow.id}/resources`, { token: owner.session, body: { kind, ...body } });
  return { local, ok, agent, give };
}

test("an owner creates agents, each with its own key, and only sees their own", async t => {
  const { local, ok, agent } = await setup(t);
  const alice = await local.user(), bob = await local.user();
  const research = await agent(alice, "Research Bot", { runtime: "claude" });
  assert.match(research.id, /^agt_[a-z0-9]{24}$/);
  assert.match(research.key, /^twa_[A-Za-z0-9_-]{43}$/);
  assert.match(research.handle, /^research-bot-[a-z0-9]{4}$/);
  assert.equal(research.runtime, "claude");
  await agent(alice, "Coder", { runtime: "codex" });
  assert.equal((await ok("GET", "/v1/agents", { token: alice.session })).agents.length, 2);
  assert.equal((await ok("GET", "/v1/agents", { token: bob.session })).agents.length, 0);
  assert.equal((await local.call("GET", `/v1/agents/${research.id}`, { token: bob.session })).status, 404, "Another account's agent doesn't exist for you.");
  const me = await ok("GET", "/v1/me", { token: research.key });
  assert.equal(me.agent.id, research.id);
  assert.equal(me.owner.verified, false);
  // Only the hash is stored.
  const { rows } = await local.db.query("select hash, prefix from agent_id_keys where agent_id=$1", [research.id]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].hash, research.key);
  assert.equal(research.key.startsWith(rows[0].prefix), true);
});

test("credentials only open their own doors", async t => {
  const { local, ok, agent } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Bot");
  assert.equal((await local.call("GET", "/v1/agents", { token: bot.key })).body.error.code, "wrong_credential", "Agent keys can't use owner routes.");
  assert.equal((await local.call("GET", "/v1/me", { token: alice.session })).body.error.code, "wrong_credential", "Owners act as an agent only by naming it.");
  assert.equal((await local.call("GET", "/v1/me", { token: alice.session, headers: { "timewarp-agent": bot.id } })).status, 200);
  const stranger = await local.user();
  assert.equal((await local.call("GET", "/v1/me", { token: stranger.session, headers: { "timewarp-agent": bot.id } })).status, 404);
  assert.equal((await local.call("GET", "/v1/me", {})).status, 401);
  assert.equal((await local.call("GET", "/v1/me", { token: "twa_" + "x".repeat(43) })).status, 401);
  assert.equal((await local.call("GET", "/v1/me", { token: "session:not-a-user" })).status, 401);
  // Owner keys come only from a signed-in session, so a leaked key can't mint more.
  const { secret } = await ok("POST", "/v1/keys", { token: alice.session, body: { name: "CLI" } });
  assert.match(secret, /^two_/);
  assert.equal((await ok("GET", "/v1/agents", { token: secret })).agents.length, 1);
  assert.equal((await local.call("POST", "/v1/keys", { token: secret, body: {} })).body.error.code, "session_required");
  assert.equal((await local.call("POST", "/v1/verify", { token: secret, body: { passport: "x" } })).body.error.code, "wrong_credential");
});

test("pausing and revoking an agent stop its key; revoking is final", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Bot");
  await give(alice, bot, "mail");
  await ok("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { status: "suspended" } });
  assert.equal((await local.call("GET", "/v1/me", { token: bot.key })).body.error.code, "agent_suspended");
  await ok("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { status: "active" } });
  assert.equal((await local.call("GET", "/v1/me", { token: bot.key })).status, 200);
  const second = await ok("POST", `/v1/agents/${bot.id}/keys`, { token: alice.session, body: { name: "CI" } });
  await ok("DELETE", `/v1/agents/${bot.id}/keys/${second.key.id}`, { token: alice.session });
  assert.equal((await local.call("GET", "/v1/me", { token: second.secret })).status, 401, "A revoked key stops working.");
  await ok("DELETE", `/v1/agents/${bot.id}`, { token: alice.session });
  assert.equal((await local.call("GET", "/v1/me", { token: bot.key })).status, 401);
  assert.equal((await local.call("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { status: "active" } })).body.error.code, "agent_revoked");
  const { rows } = await local.db.query("select status from agent_id_resources where agent_id=$1", [bot.id]);
  assert.deepEqual(rows.map(r => r.status), ["released"]);
  // Its mail address is never handed to anyone else.
  const { rows: [mail] } = await local.db.query("select address from agent_id_resources where agent_id=$1", [bot.id]);
  await assert.rejects(local.db.query("insert into agent_id_resources(agent_id,owner_user_id,kind,provider,mode,address) values($1,$2,'mail','test','test',$3)", [(await agent(alice, "Other")).id, alice.id, mail.address]));
});

test("test mail goes between agents' inboxes; replies stay in the thread", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user(), bob = await local.user();
  const a = await agent(alice, "Sender"), b = await agent(bob, "Receiver");
  const mailA = (await give(alice, a, "mail")).resource, mailB = (await give(bob, b, "mail")).resource;
  assert.match(mailA.address, /@agents\.timewarp\.test$/);
  assert.equal(mailA.mode, "test");
  const sent = await ok("POST", "/v1/me/mail", { token: a.key, body: { to: mailB.address, subject: "Quote", text: "How much for 3 widgets?" } });
  assert.equal(sent.message.status, "delivered");
  const outside = await ok("POST", "/v1/me/mail", { token: a.key, body: { to: "someone@example.com", subject: "Hi", text: "Hello" } });
  assert.equal(outside.message.status, "simulated", "Test mail never leaves Agent ID.");
  const inbox = await ok("GET", "/v1/me/mail?unread=1", { token: b.key });
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].counterparty, mailA.address);
  assert.equal(inbox.messages[0].preview, "How much for 3 widgets?");
  // The owner reading on the dashboard doesn't mark it read; the agent does.
  await ok("GET", `/v1/me/mail/${inbox.messages[0].id}`, { token: bob.session, headers: { "timewarp-agent": b.id } });
  assert.equal((await ok("GET", "/v1/me/mail?unread=1", { token: b.key })).messages.length, 1);
  const read = await ok("GET", `/v1/me/mail/${inbox.messages[0].id}`, { token: b.key });
  assert.equal(read.message.text, "How much for 3 widgets?");
  assert.equal((await ok("GET", "/v1/me/mail?unread=1", { token: b.key })).messages.length, 0);
  const reply = await ok("POST", "/v1/me/mail", { token: b.key, body: { replyTo: read.message.id, text: "12.50 each." } });
  assert.equal(reply.message.subject, "Re: Quote");
  assert.equal(reply.message.counterparty, mailA.address);
  assert.equal(reply.message.thread, read.message.id);
  assert.equal((await ok("GET", "/v1/me/mail?folder=sent", { token: a.key })).messages.length, 2);
  // The owner sees it all in the agent's activity.
  const events = await ok("GET", `/v1/agents/${b.id}/events?kind=mail`, { token: bob.session });
  assert.equal(events.events.length, 2);
  assert.equal((await local.call("GET", `/v1/agents/${b.id}/events`, { token: alice.session })).status, 404);
  assert.equal((await local.call("POST", "/v1/me/mail", { token: a.key, body: { to: "not an address", subject: "x", text: "y" } })).status, 400);
});

test("test phone numbers text and call each other; others are simulated", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user();
  const a = await agent(alice, "Caller"), b = await agent(alice, "Callee");
  const phoneA = (await give(alice, a, "phone")).resource, phoneB = (await give(alice, b, "phone")).resource;
  assert.match(phoneA.address, /^\+1[2-9]\d{2}55501\d{2}$/, "Fictional 555-01xx numbers.");
  assert.equal((await ok("POST", "/v1/me/sms", { token: a.key, body: { to: phoneB.address, text: "Running late" } })).message.status, "delivered");
  assert.equal((await ok("POST", "/v1/me/sms", { token: a.key, body: { to: "+14155550123", text: "Hi" } })).message.status, "simulated");
  assert.equal((await ok("GET", "/v1/me/sms", { token: b.key })).messages[0].text, "Running late");
  assert.equal((await ok("POST", "/v1/me/calls", { token: a.key, body: { to: phoneB.address, say: "Your order shipped." } })).call.status, "completed");
  assert.equal((await ok("GET", "/v1/me/calls", { token: b.key })).calls[0].direction, "in");
  assert.equal((await local.call("POST", "/v1/me/sms", { token: a.key, body: { to: "0701234567", text: "x" } })).body.error.code, "invalid");
});

test("wallets: test money, transfers between agents, owner limits and approvals", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user(), bob = await local.user();
  const payer = await agent(alice, "Payer"), payee = await agent(bob, "Payee");
  const wallet = (await give(alice, payer, "wallet")).resource;
  await give(bob, payee, "wallet");
  assert.deepEqual(wallet.settings, { perTransfer: 5000, daily: 10000, approvalAbove: 2500 }, "New wallets start with modest limits.");
  assert.equal((await local.call("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.id, value: "5" } })).body.error.code, "insufficient");
  await ok("POST", `/v1/agents/${payer.id}/wallet/test-funds`, { token: alice.session, body: { amount: 20000 } });
  const sent = await ok("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.handle, value: "12.50", memo: "widgets" } });
  assert.equal(sent.status, "completed");
  assert.equal(sent.balance.amount, 18750);
  assert.equal((await ok("GET", "/v1/me/wallet", { token: payee.key })).wallet.balance.amount, 1250);
  // Over the approval amount: the owner decides.
  const pending = await ok("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.id, value: "30" } });
  assert.equal(pending.status, "needs_approval");
  const approvals = await ok("GET", "/v1/approvals", { token: alice.session });
  assert.equal(approvals.approvals.length, 1);
  assert.equal(approvals.approvals[0].request.amount, 3000);
  assert.equal((await local.call("POST", `/v1/approvals/${pending.approval}`, { token: bob.session, body: { decision: "approve" } })).status, 404, "Only the owner approves.");
  const approved = await ok("POST", `/v1/approvals/${pending.approval}`, { token: alice.session, body: { decision: "approve" } });
  assert.equal(approved.status, "completed");
  assert.equal((await local.call("POST", `/v1/approvals/${pending.approval}`, { token: alice.session, body: { decision: "approve" } })).body.error.code, "already_decided", "An approval pays once.");
  assert.equal((await ok("GET", "/v1/me/wallet", { token: payee.key })).wallet.balance.amount, 4250);
  // Caps: per transfer, then daily (4250 sent so far, of 10000).
  const capped = await local.call("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.id, value: "60" } });
  assert.equal(capped.body.error.code, "over_limit", "Caps hold before asking the owner: no approval for a transfer that would fail.");
  assert.equal(capped.body.error.limit, "perTransfer");
  await ok("PATCH", `/v1/agents/${payer.id}/resources/wallet`, { token: alice.session, body: { settings: { approvalAbove: null } } });
  await ok("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.id, value: "50" } });
  const daily = await local.call("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.id, value: "10" } });
  assert.equal(daily.body.error.code, "over_limit");
  assert.equal(daily.body.error.limit, "daily");
  // Test money can't leave Agent ID or go to a live wallet.
  await ok("PATCH", `/v1/agents/${payer.id}/resources/wallet`, { token: alice.session, body: { settings: { daily: 100000 } } });
  assert.equal((await local.call("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: "0x" + "1".repeat(40), value: "1" } })).body.error.code, "unknown_recipient");
  // Contacts with a wallet are recipients too.
  await ok("POST", "/v1/me/contacts", { token: payer.key, body: { name: "Supplier", wallet: payee.id } });
  assert.equal((await ok("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: "Supplier", value: "1" } })).status, "completed");
  // A paused wallet can't pay.
  await ok("PATCH", `/v1/agents/${payer.id}/resources/wallet`, { token: alice.session, body: { status: "suspended" } });
  assert.equal((await local.call("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.id, value: "1" } })).body.error.code, "wallet_suspended");
});

test("concurrent transfers can't spend the same money twice", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user();
  const payer = await agent(alice, "Payer"), payee = await agent(alice, "Payee");
  await give(alice, payer, "wallet", { settings: { approvalAbove: null, perTransfer: 100000, daily: 1000000 } });
  await give(alice, payee, "wallet");
  await ok("POST", `/v1/agents/${payer.id}/wallet/test-funds`, { token: alice.session, body: { amount: 1000 } });
  const results = await Promise.all(Array.from({ length: 6 }, () => local.call("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.id, amount: 300 } })));
  assert.equal(results.filter(r => r.status === 200).length, 3);
  assert.equal(results.filter(r => r.body?.error?.code === "insufficient").length, 3);
  const { rows: [from] } = await local.db.query("select balance_minor from agent_id_resources where agent_id=$1 and kind='wallet'", [payer.id]);
  const { rows: [to] } = await local.db.query("select balance_minor from agent_id_resources where agent_id=$1 and kind='wallet'", [payee.id]);
  assert.equal(Number(from.balance_minor) + Number(to.balance_minor), 1000, "Money is neither made nor lost.");
});

test("cards: every payment is checked against the owner's limits and categories", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user();
  const shopper = await agent(alice, "Shopper");
  const card = (await give(alice, shopper, "card", { settings: { perTransaction: 2000, daily: 3000, blockedCategories: ["gambling"] } })).resource;
  assert.equal(card.details.last4, "4242");
  assert.equal(card.details.cvc, undefined, "The security code isn't in listings.");
  const charge = (value, extra = {}) => ok("POST", "/v1/me/card/test-charge", { token: shopper.key, body: { value, ...extra } });
  assert.equal((await charge("15", { merchant: "Hardware store" })).approved, true);
  assert.equal((await charge("25")).reason, "over_transaction_limit");
  assert.equal((await charge("20")).reason, "over_daily_limit", "15 + 20 is over the 30 daily cap.");
  assert.equal((await charge("1", { category: "gambling" })).reason, "blocked_category");
  const shown = await ok("GET", "/v1/me/card", { token: shopper.key });
  assert.equal(shown.card.spent.last24Hours.amount, 1500);
  assert.equal(shown.card.cvc, undefined);
  const revealed = await ok("POST", "/v1/me/card/reveal", { token: shopper.key });
  assert.equal(revealed.card.number, "4242424242424242");
  assert.match(String(revealed.card.cvc), /^\d{3}$/);
  const { rows } = await local.db.query("select action from agent_id_audit where agent_id=$1 and action='card.reveal'", [shopper.id]);
  assert.equal(rows.length, 1, "Every reveal is on the audit log.");
  const txs = await ok("GET", "/v1/me/card/transactions", { token: shopper.key });
  assert.equal(txs.transactions.filter(tx => tx.status === "declined").length, 3);
  // The same authorization answered twice gives the same decision.
  const resource = (await local.db.query("select id from agent_id_resources where agent_id=$1 and kind='card'", [shopper.id])).rows[0].id;
  const first = (await local.admin.rpc("agent_id_card_authorize", { p_resource: resource, p_amount: 100, p_currency: "USD", p_merchant: "X", p_category: null, p_provider_ref: "iauth_1", p_data: {} })).data;
  const again = (await local.admin.rpc("agent_id_card_authorize", { p_resource: resource, p_amount: 100, p_currency: "USD", p_merchant: "X", p_category: null, p_provider_ref: "iauth_1", p_data: {} })).data;
  assert.equal(again.status, "duplicate");
  assert.equal(again.approved, first.approved);
  // A paused agent's card declines.
  await ok("PATCH", `/v1/agents/${shopper.id}`, { token: alice.session, body: { status: "suspended" } });
  assert.equal((await local.admin.rpc("agent_id_card_authorize", { p_resource: resource, p_amount: 1, p_currency: "USD", p_merchant: "X", p_category: null, p_provider_ref: "iauth_2", p_data: {} })).data.reason, "card_inactive");
});

test("test machines have a state but don't run commands", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Builder");
  await give(alice, bot, "vm", { options: { size: "small" } });
  assert.equal((await ok("GET", "/v1/me/vm", { token: bot.key })).machine.state, "stopped");
  assert.equal((await ok("POST", "/v1/me/vm/start", { token: bot.key })).machine.state, "running");
  assert.equal((await local.call("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "uname -a" } })).body.error.code, "test_machine");
  assert.equal((await ok("POST", "/v1/me/vm/stop", { token: bot.key })).machine.state, "stopped");
});

test("one of each kind per agent; a removed resource can be replaced", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Bot");
  await give(alice, bot, "phone");
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "phone" } })).body.error.code, "already_has");
  await ok("DELETE", `/v1/agents/${bot.id}/resources/phone`, { token: alice.session });
  await give(alice, bot, "phone");
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "spaceship" } })).status, 400);
});

test("live resources are opt-in per kind and gated by verification and plan", async t => {
  const { local, ok, agent } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Bot");
  const live = kind => local.call("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind, mode: "live" } });
  assert.equal((await live("mail")).body.error.code, "live_unavailable", "Nothing is live until listed.");
  local.setEnv({ AGENT_ID_LIVE: "mail,phone,wallet,card,vm" });
  assert.equal((await live("mail")).body.error.code, "provider_unavailable", "Listed but without its secrets.");
  local.setEnv({ RESEND_API_KEY: "re_test", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", PRIVY_APP_ID: "p", PRIVY_APP_SECRET: "s", STRIPE_SECRET_KEY: "sk_test_x" });
  assert.equal((await live("card")).body.error.code, "verification_required", "A live card needs a verified owner up front.");
  // No subscription is needed by default; a deployment can still reserve kinds for paid plans.
  local.setEnv({ AGENT_ID_PAID_PLAN_KINDS: "phone" });
  assert.equal((await live("phone")).body.error.code, "plan_required", "A live number needs a paid plan where one is set.");
  local.setEnv({ AGENT_ID_PAID_PLAN_KINDS: "" });
  assert.equal((await ok("GET", "/v1/config", {})).resources.phone.paidPlanRequired, false);
  const config = await ok("GET", "/v1/config", {});
  assert.equal(config.resources.wallet.verificationRequired, false, "Wallets come unverified; money leaving one needs a verified owner.");
  assert.equal(config.resources.card.verificationRequired, true);
  assert.equal(config.resources.vm.live, false);
  assert.equal(config.resources.vm.unavailable, "not_configured", "Listed, but without Azure's secrets.");
  assert.equal(config.resources.mail.unavailable, undefined);
  // The future default: verification before any agent.
  local.setEnv({ AGENT_ID_REQUIRE_VERIFICATION: "agent,wallet,card" });
  assert.equal((await local.call("POST", "/v1/agents", { token: alice.session, body: { name: "Another" } })).body.error.code, "verification_required");
});

test("KYC and KYB: manual reviews by reviewers, business checks by org admins", async t => {
  const { local, ok } = await setup(t);
  const owner = await local.user(), reviewer = await local.user(), lead = await local.user();
  const org = await local.organization("Acme", [[owner, "owner"], [lead, "lead"]]);
  local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
  const submitted = await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "person", consent: true, legalName: "Ada Lovelace", country: "se" } });
  assert.equal(submitted.person.status, "pending");
  assert.equal(submitted.person.country, "SE");
  assert.equal((await local.call("GET", "/v1/reviews", { token: owner.session })).status, 403);
  const queue = await ok("GET", "/v1/reviews", { token: reviewer.session });
  assert.equal(queue.people.length, 1);
  await ok("POST", `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: "approve" } });
  assert.equal((await ok("GET", "/v1/account", { token: owner.session })).person.status, "verified");
  assert.equal((await local.call("POST", "/v1/account/verification", { token: lead.session, body: { kind: "business", representativeRole: "CEO", attestation: true, organizationId: org, legalName: "Acme AB", registrationNumber: "556000-0000", country: "SE" } })).status, 403, "Only owners and admins verify the organization.");
  await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "business", representativeRole: "CEO", attestation: true, organizationId: org, legalName: "Acme AB", registrationNumber: "556000-0000", country: "SE", website: "https://acme.example" } });
  await ok("POST", `/v1/reviews/business/${org}`, { token: reviewer.session, body: { decision: "approve" } });
  const account = await ok("GET", "/v1/account", { token: owner.session });
  assert.equal(account.organizations[0].business.status, "verified");
  // A reviewer's owner key can't review: reviews need a signed-in session.
  const { secret } = await ok("POST", "/v1/keys", { token: reviewer.session, body: {} });
  assert.equal((await local.call("GET", "/v1/reviews", { token: secret })).status, 403);
});

test("passports: signed, audience-bound, checked online against the agent's current state", async t => {
  const { local, ok, agent, give } = await setup(t);
  const owner = await local.user(), reviewer = await local.user(), company = await local.user();
  const org = await local.organization("Acme", [[owner, "owner"]]);
  local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
  const bot = await agent(owner, "Buyer", { organizationId: org, runtime: "codex" });
  await give(owner, bot, "mail");
  const rp = await ok("POST", "/v1/relying-parties", { token: company.session, body: { name: "Widget API", audience: "https://api.widgets.example", policy: { require: "verified" } } });
  assert.match(rp.secret, /^twrp_/);
  const issued = await ok("POST", "/v1/me/passport", { token: bot.key, body: { audience: "https://api.widgets.example" } });
  const [header, claims] = issued.passport.split(".").slice(0, 2).map(part => JSON.parse(Buffer.from(part, "base64url")));
  assert.equal(header.alg, "ES256");
  assert.equal(claims.sub, bot.id);
  assert.equal(claims.aud, "https://api.widgets.example");
  assert.equal(claims.exp - claims.iat, 300);
  assert.equal(claims.owner.verified, false);
  assert.match(claims.owner.ref, /^own_/);
  assert.equal(claims.owner.name, undefined, "A person's name never goes to companies.");
  assert.deepEqual(claims.resources, ["mail"]);
  // Offline: the signature checks against the published key.
  const jwks = await ok("GET", "/.well-known/jwks.json", {});
  const key = await crypto.subtle.importKey("jwk", jwks.keys[0], { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const [h, p, s] = issued.passport.split(".");
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(s, "base64url"), Buffer.from(`${h}.${p}`)), true);
  // Online: valid, but the owner isn't verified yet.
  let checked = await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: issued.passport } });
  assert.equal(checked.valid, true);
  assert.equal(checked.allowed, false);
  assert.deepEqual(checked.reasons, ["owner_not_verified"]);
  await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "person", consent: true, legalName: "Olivia Owner", country: "SE" } });
  await ok("POST", `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: "approve" } });
  await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "business", representativeRole: "CEO", attestation: true, organizationId: org, legalName: "Acme AB", registrationNumber: "1", country: "SE" } });
  await ok("POST", `/v1/reviews/business/${org}`, { token: reviewer.session, body: { decision: "approve" } });
  checked = await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: issued.passport } });
  assert.equal(checked.allowed, true);
  assert.equal(checked.owner.level, "kyb");
  assert.equal(checked.owner.business, "Acme AB");
  // Another audience's passport is refused; a tampered one too.
  const other = await ok("POST", "/v1/me/passport", { token: bot.key, body: { audience: "https://elsewhere.example" } });
  assert.equal((await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: other.passport } })).reason, "wrong_audience");
  const tampered = [h, Buffer.from(JSON.stringify({ ...claims, sub: "agt_" + "a".repeat(24) })).toString("base64url"), s].join(".");
  assert.equal((await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: tampered } })).reason, "bad_signature");
  // Audiences aren't owned, so nobody can claim another company's first; a
  // leaked secret is replaced without changing the audience.
  const second = await ok("POST", "/v1/relying-parties", { token: (await local.user()).session, body: { name: "Widget API staging", audience: "https://api.widgets.example" } });
  assert.match(second.secret, /^twrp_/);
  const rotated = await ok("POST", `/v1/relying-parties/${rp.relyingParty.id}/secret`, { token: company.session });
  assert.equal((await local.call("POST", "/v1/verify", { token: rp.secret, body: { passport: issued.passport } })).status, 401, "The old secret stops working.");
  rp.secret = rotated.secret;
  assert.equal((await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: issued.passport } })).allowed, true);
  // Policies can name organizations.
  await ok("PATCH", `/v1/relying-parties/${rp.relyingParty.id}`, { token: company.session, body: { policy: { organizations: ["00000000-0000-4000-8000-00000000ffff"] } } });
  assert.deepEqual((await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: issued.passport } })).reasons, ["organization_not_allowed"]);
  // Revoking the agent fails its unexpired passports online at once.
  await ok("DELETE", `/v1/agents/${bot.id}`, { token: owner.session });
  checked = await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: issued.passport } });
  assert.equal(checked.valid, false);
  // Expired passports fail.
  local.setClock(() => Date.now() + 10 * 60_000);
  assert.equal((await ok("POST", "/v1/verify", { token: rp.secret, body: { passport: issued.passport } })).reason, "expired");
  // Every check is on the agent owner's audit log.
  local.setClock(null);
  const log = await ok("GET", `/v1/audit?agent=${bot.id}`, { token: owner.session });
  assert.ok(log.entries.some(entry => entry.action === "passport.checked" && entry.detail.company === "Widget API"));
});

test("Git: an organization's verified agents are its allowed signers, and only while active", async t => {
  const { local, ok, agent } = await setup(t);
  const owner = await local.user(), reviewer = await local.user(), outsider = await local.user();
  const org = await local.organization("Acme", [[owner, "owner"]]);
  local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
  const coder = await agent(owner, "Coder", { organizationId: org }), helper = await agent(owner, "Helper", { organizationId: org });
  const stranger = await agent(outsider, "Stranger");
  const sshKey = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-id-ssh-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    try { execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-q", "-C", "test", "-f", path.join(dir, "key")], { stdio: "ignore" }); }
    catch { return null; }
    return fs.readFileSync(path.join(dir, "key.pub"), "utf8").trim();
  };
  const keyA = sshKey(), keyB = sshKey(), keyC = sshKey();
  if (!keyA) { t.skip("ssh-keygen is not available"); return; }
  const added = await ok("POST", "/v1/me/signing-keys", { token: coder.key, body: { publicKey: keyA, name: "laptop" } });
  assert.match(added.key.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(added.principal, `${coder.id}@agents.timewarpdev.com`);
  const fingerprint = execFileSync("ssh-keygen", ["-lf", "-"], { input: keyA }).toString().split(" ")[1];
  assert.equal(added.key.fingerprint, fingerprint, "The same fingerprint ssh-keygen prints.");
  assert.equal((await local.call("POST", "/v1/me/signing-keys", { token: stranger.key, body: { publicKey: keyA } })).body.error.code, "key_in_use", "A key belongs to one agent.");
  await ok("POST", "/v1/me/signing-keys", { token: helper.key, body: { publicKey: keyB } });
  await ok("POST", "/v1/me/signing-keys", { token: stranger.key, body: { publicKey: keyC } });
  assert.equal((await local.call("POST", "/v1/me/signing-keys", { token: coder.key, body: { publicKey: "ssh-rsa AAAA" } })).status, 400);
  const rp = await ok("POST", "/v1/relying-parties", { token: owner.session, body: { name: "Acme repo", audience: "github.com/acme/app", organizationId: org, policy: { require: "verified" } } });
  let file = (await local.call("GET", "/v1/allowed-signers", { token: rp.secret })).body;
  assert.equal(file.split("\n").filter(line => line && !line.startsWith("#")).length, 0, "Unverified owners' agents aren't allowed.");
  await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "person", consent: true, legalName: "Olivia Owner", country: "SE" } });
  await ok("POST", `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: "approve" } });
  await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "business", representativeRole: "CEO", attestation: true, organizationId: org, legalName: "Acme AB", registrationNumber: "1", country: "SE" } });
  await ok("POST", `/v1/reviews/business/${org}`, { token: reviewer.session, body: { decision: "approve" } });
  file = (await local.call("GET", "/v1/allowed-signers", { token: rp.secret })).body;
  const lines = file.split("\n").filter(line => line && !line.startsWith("#"));
  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => line.includes('namespaces="git"')));
  assert.ok(lines.some(line => line.startsWith(`${coder.id}@agents.timewarpdev.com namespaces="git" ${keyA.split(" ").slice(0, 2).join(" ")}`)));
  assert.ok(!file.includes(keyC.split(" ")[1]), "Agents outside the organization never appear.");
  await ok("PATCH", `/v1/agents/${helper.id}`, { token: owner.session, body: { status: "suspended" } });
  const keys = await ok("GET", "/v1/me/signing-keys", { token: coder.key });
  await ok("DELETE", `/v1/me/signing-keys/${keys.keys[0].id}`, { token: coder.key });
  file = (await local.call("GET", "/v1/allowed-signers", { token: rp.secret })).body;
  assert.equal(file.split("\n").filter(line => line && !line.startsWith("#")).length, 0, "Paused agents and removed keys drop off at once.");
  const companyWithoutOrg = await ok("POST", "/v1/relying-parties", { token: outsider.session, body: { name: "Solo", audience: "solo.example" } });
  assert.equal((await local.call("GET", "/v1/allowed-signers", { token: companyWithoutOrg.secret })).body.error.code, "no_organization");
  assert.equal((await local.call("POST", "/v1/relying-parties", { token: outsider.session, body: { name: "Hijack", audience: "x.example", organizationId: org } })).status, 403);
});

test("someone who leaves the organization takes no company standing along", async t => {
  const { local, ok, agent } = await setup(t);
  const owner = await local.user(), member = await local.user(), reviewer = await local.user();
  const org = await local.organization("Acme", [[owner, "owner"], [member, "lead"]]);
  local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
  await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "person", consent: true, legalName: "Olivia Owner", country: "SE" } });
  await ok("POST", `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: "approve" } });
  await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "business", representativeRole: "CEO", attestation: true, organizationId: org, legalName: "Acme AB", registrationNumber: "1", country: "SE" } });
  await ok("POST", `/v1/reviews/business/${org}`, { token: reviewer.session, body: { decision: "approve" } });
  const bot = await agent(member, "Contractor bot", { organizationId: org });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-id-ssh-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  try { execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-q", "-f", path.join(dir, "key")], { stdio: "ignore" }); } catch { t.skip("ssh-keygen is not available"); return; }
  await ok("POST", "/v1/me/signing-keys", { token: bot.key, body: { publicKey: fs.readFileSync(path.join(dir, "key.pub"), "utf8") } });
  const rp = await ok("POST", "/v1/relying-parties", { token: owner.session, body: { name: "Acme repo", audience: "github.com/acme/app", organizationId: org } });
  const signers = async () => (await local.call("GET", "/v1/allowed-signers", { token: rp.secret })).body.split("\n").filter(line => line && !line.startsWith("#"));
  assert.equal((await signers()).length, 1);
  assert.equal((await ok("GET", "/v1/me", { token: bot.key })).owner.level, "kyb");
  await local.db.query("update timewarp_workspace_members set status='removed' where user_id=$1", [member.id]);
  assert.equal((await signers()).length, 0, "A former member's agent can't sign the company's commits.");
  const me = await ok("GET", "/v1/me", { token: bot.key });
  assert.deepEqual([me.owner.level, me.organization], ["none", null]);
  const passport = (await ok("POST", "/v1/me/passport", { token: bot.key, body: { audience: "github.com/acme/app" } })).passport;
  const checked = await ok("POST", "/v1/verify", { token: rp.secret, body: { passport } });
  assert.equal(checked.allowed, false);
  assert.equal(checked.agent.organizationId, null);
});

test("MCP: an agent's own tools, only for what it has", async t => {
  const { local, ok, agent, give } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Bot"), friend = await agent(alice, "Friend");
  const rpc = (body, token = bot.key) => local.call("POST", "/mcp", { token, body: { jsonrpc: "2.0", ...body } });
  const init = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.body.result.serverInfo.name, "timewarp-agent-id");
  assert.match(init.body.result.instructions, /You are Bot/);
  assert.equal((await rpc({ method: "notifications/initialized" })).status, 202);
  let tools = (await rpc({ id: 2, method: "tools/list" })).body.result.tools.map(tool => tool.name);
  assert.ok(tools.includes("whoami") && tools.includes("passport_issue"));
  assert.ok(!tools.includes("wallet_send"), "No wallet tools without a wallet.");
  await give(alice, bot, "wallet", { settings: { approvalAbove: null } });
  await give(alice, friend, "wallet");
  await ok("POST", `/v1/agents/${bot.id}/wallet/test-funds`, { token: alice.session, body: { amount: 1000 } });
  tools = (await rpc({ id: 3, method: "tools/list" })).body.result.tools;
  const send = tools.find(tool => tool.name === "wallet_send");
  assert.deepEqual(send.inputSchema.required, ["to", "amount"]);
  const call = await rpc({ id: 4, method: "tools/call", params: { name: "wallet_send", arguments: { to: friend.id, amount: "2.50" } } });
  assert.equal(call.body.result.isError, undefined);
  assert.equal(JSON.parse(call.body.result.content[0].text).status, "completed");
  const failure = await rpc({ id: 5, method: "tools/call", params: { name: "wallet_send", arguments: { to: friend.id, amount: "500" } } });
  assert.equal(failure.body.result.isError, true);
  assert.match(failure.body.result.content[0].text, /over_limit|insufficient/);
  assert.equal((await rpc({ id: 6, method: "tools/call", params: { name: "nope" } })).body.error.code, -32602);
  assert.equal((await rpc({ id: 7, method: "tools/list" }, alice.session)).status, 403, "MCP acts as an agent.");
  assert.equal((await local.call("POST", "/mcp", { token: alice.session, headers: { "timewarp-agent": bot.id }, body: { jsonrpc: "2.0", id: 8, method: "ping" } })).status, 200);
  assert.equal((await local.call("GET", "/mcp", { token: bot.key })).status, 405);
});

test("Agent ID sells the Timewarp app's credit packs", () => {
  const pricing = fs.readFileSync(path.join(__dirname, "../supabase/functions/agent-id/pricing.ts"), "utf8");
  const credits = fs.readFileSync(path.join(__dirname, "../supabase/functions/_shared/credits.ts"), "utf8");
  assert.equal(/PACK_CREDITS_PER_USD = (\d+)/.exec(pricing)?.[1], /PACK_CREDITS_PER_USD = (\d+)/.exec(credits)?.[1]);
  const prices = source => /\[([\d,\s]+)\]\.map\(\(?priceUsd/.exec(source)?.[1] ?? /PACK_PRICES_USD = \[([\d,\s]+)\]/.exec(source)?.[1];
  assert.ok(prices(credits));
  assert.equal(prices(pricing).replace(/\s/g, ""), prices(credits).replace(/\s/g, ""), "The same packs at the same prices.");
});

test("machine time is charged in credits like AI usage", () => {
  const pricing = fs.readFileSync(path.join(__dirname, "../supabase/functions/agent-id/pricing.ts"), "utf8");
  const billing = fs.readFileSync(path.join(__dirname, "../cloud/nativeBilling.ts"), "utf8");
  for (const name of ["AI_COST_MARKUP", "USD_PER_CREDIT"]) {
    const value = source => new RegExp(`export const ${name} = ([0-9.]+);`).exec(source)?.[1];
    assert.ok(value(billing), `${name} is in nativeBilling.ts`);
    assert.equal(value(pricing), value(billing), `${name} matches the desktop surface's billing.`);
  }
});
