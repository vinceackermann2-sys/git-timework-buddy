"use strict";
// Agent ID without an account (claims), one Agent ID used from many apps,
// owner withdrawals and adding money, evidence for business checks, and the
// webhooks a deployment registers by itself.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { startLocal } = require("../scripts/agent-id-local.cjs");

function network() {
  const routes = [], calls = [];
  const fetch = async (url, init = {}) => {
    const href = String(url), method = init.method || "GET";
    const call = { url: href, method, headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : "" };
    calls.push(call);
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(href)) { const r = await handler(new URL(href), call); return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } }); }
    throw new Error(`Unexpected provider request: ${method} ${href}`);
  };
  return { fetch, calls, on: (method, pattern, handler) => routes.unshift([method, pattern, handler]), find: (method, pattern) => calls.filter(c => c.method === method && pattern.test(c.url)) };
}

async function setup(t, env = {}) {
  const net = network();
  const local = await startLocal({ fetch: net.fetch, env });
  t.after(() => local.close());
  const config = async () => (await local.call("GET", "/v1/config")).body;
  const makeUser = local.user.bind(local);
  local.user = async (options = {}) => {
    const user = await makeUser(options);
    if (options.terms !== false) await local.call("POST", "/v1/account/terms", { token: user.session, body: { version: (await config()).legal.termsVersion } });
    return user;
  };
  const ok = async (method, url, init) => { const r = await local.call(method, url, init); assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const agent = async (owner, name, extra = {}) => { const c = await ok("POST", "/v1/agents", { token: owner.session, body: { name, ...extra } }); return { ...c.agent, key: c.secret }; };
  const verify = async owner => {
    const reviewer = await local.user();
    local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
    await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "person", consent: true, legalName: "Ada Lovelace", country: "SE" } });
    await ok("POST", `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: "approve" } });
    return reviewer;
  };
  return { local, net, ok, agent, verify, config };
}
const hmac = (key, text, encoding) => crypto.createHmac("sha256", key).update(text).digest(encoding);

test("an agent asks for an Agent ID; a person confirms their email and verifies, which makes their account, and the agent collects its key once", async t => {
  const { local, ok, config } = await setup(t, { AGENT_ID_KYC: "test" });
  // The CLI asks, with no account and no key.
  const started = await ok("POST", "/v1/claims", { body: { name: "Travel Planner", app: "claude-code", device: "MacBook Pro" } });
  assert.match(started.url, /\/agent-id\/claim\/[a-z0-9]{24}$/);
  assert.match(started.secret, /^twc_/);
  assert.match(started.claim.matchCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = started.claim.code;
  assert.equal((await ok("POST", "/v1/claims/collect", { body: { secret: started.secret } })).status, "waiting");
  // Anyone with the link sees what is asking, not who answered.
  const shown = (await ok("GET", `/v1/claims/${code}`)).claim;
  assert.deepEqual([shown.name, shown.app.label, shown.device, shown.status, shown.step], ["Travel Planner", "Claude Code", "MacBook Pro", "pending", undefined]);

  // The email code (returned directly on a development deployment without mail).
  assert.equal((await local.call("POST", `/v1/claims/${code}/email`, { body: { email: "not-an-email" } })).status, 400);
  const sent = await ok("POST", `/v1/claims/${code}/email`, { body: { email: "Grace@Example.com" } });
  assert.equal(sent.email, "grace@example.com");
  assert.match(sent.devCode, /^\d{6}$/);
  assert.equal((await local.call("POST", `/v1/claims/${code}/email`, { body: { email: "grace@example.com" } })).body.error.code, "rate_limited", "Codes can't be asked for back to back.");
  const wrong = sent.devCode === "000000" ? "111111" : "000000";
  assert.equal((await local.call("POST", `/v1/claims/${code}/email/confirm`, { body: { code: wrong } })).body.error.code, "wrong_code");
  const confirmed = await ok("POST", `/v1/claims/${code}/email/confirm`, { body: { code: sent.devCode } });
  assert.match(confirmed.session, /^twcs_/);
  assert.equal(confirmed.claim.step, "terms", "The terms weren't ticked with the code, so they come next.");
  assert.equal(confirmed.claim.email, "grace@example.com");
  // The confirmed email made an account, and the browser is signed in to it.
  const account = await ok("GET", "/v1/account", { token: confirmed.auth.access_token });
  assert.equal(account.user.email, "grace@example.com");
  assert.equal(account.agents.count, 0);
  assert.equal(account.terms.accepted, false);
  // Somebody else's code can't be reused, and the link alone doesn't open the full view.
  assert.equal((await local.call("POST", `/v1/claims/${code}/email/confirm`, { body: { code: sent.devCode } })).body.error.code, "invalid");
  assert.equal((await local.call("GET", `/v1/claims/${code}`, { headers: { "timewarp-claim-session": "twcs_guess" } })).body.error.code, "claim_session");

  // The terms, and the agent is made. No identity check here: that comes the
  // first time money leaves a wallet.
  const headers = { "timewarp-claim-session": confirmed.session };
  assert.equal((await local.call("POST", `/v1/claims/${code}/terms`, { headers, body: {} })).body.error.code, "terms_required");
  const { legal } = await config();
  const finished = await ok("POST", `/v1/claims/${code}/terms`, { headers, body: { terms: legal.termsVersion } });
  assert.equal(finished.claim.step, "done");
  assert.equal(finished.claim.status, "claimed");
  assert.equal(finished.claim.agent.name, "Travel Planner");

  // The agent collects its key once.
  const collected = await ok("POST", "/v1/claims/collect", { body: { secret: started.secret } });
  assert.equal(collected.status, "claimed");
  assert.match(collected.key, /^twa_/);
  const me = await ok("GET", "/v1/me", { token: collected.key });
  assert.equal(me.agent.name, "Travel Planner");
  assert.equal((await local.call("POST", "/v1/claims/collect", { body: { secret: started.secret } })).body.error.code, "already_collected");
  // The person owns it, with the app it asked from; not verified yet.
  const mine = await ok("GET", "/v1/agents", { token: confirmed.auth.access_token });
  assert.deepEqual(mine.agents.map(a => [a.name, a.apps.map(x => x.app)]), [["Travel Planner", ["claude-code"]]]);
  const after = await ok("GET", "/v1/account", { token: confirmed.auth.access_token });
  assert.deepEqual([after.person.status, after.terms.accepted], ["unverified", true]);
  assert.equal((await local.call("POST", `/v1/claims/${code}/email`, { body: { email: "x@example.com" } })).body.error.code, "already_claimed");
  const log = (await ok("GET", "/v1/audit", { token: confirmed.auth.access_token })).entries.map(e => e.action);
  for (const action of ["account.create_by_claim", "terms.accept", "agent.create", "agent_key.create"]) assert.ok(log.includes(action), action);
});

test("claims: an existing verified account finishes at once; links expire; wrong codes and floods are stopped", async t => {
  const { local, ok, verify } = await setup(t);
  const ada = await local.user({ email: "ada@example.com" });
  await verify(ada);
  const started = await ok("POST", "/v1/claims", { body: { name: "Scout", app: "codex" } });
  const sent = await ok("POST", `/v1/claims/${started.claim.code}/email`, { body: { email: "ada@example.com" } });
  const confirmed = await ok("POST", `/v1/claims/${started.claim.code}/email/confirm`, { body: { code: sent.devCode } });
  assert.equal(confirmed.claim.step, "done", "Already verified: nothing more to do.");
  assert.equal((await ok("GET", "/v1/agents", { token: ada.session })).agents[0].name, "Scout");

  // Five wrong codes and the code is spent.
  const other = await ok("POST", "/v1/claims", { body: { name: "Other" } });
  const otherCode = (await ok("POST", `/v1/claims/${other.claim.code}/email`, { body: { email: "eve@example.com" } })).devCode;
  const wrong = otherCode === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.equal((await local.call("POST", `/v1/claims/${other.claim.code}/email/confirm`, { body: { code: wrong } })).body.error.code, "wrong_code");
  assert.equal((await local.call("POST", `/v1/claims/${other.claim.code}/email/confirm`, { body: { code: otherCode } })).body.error.code, "rate_limited");

  // An hour later an unanswered link has expired.
  local.setClock(() => Date.now() + 61 * 60_000);
  assert.equal((await ok("GET", `/v1/claims/${other.claim.code}`)).claim.status, "expired");
  assert.equal((await local.call("POST", `/v1/claims/${other.claim.code}/email`, { body: { email: "eve@example.com" } })).body.error.code, "expired");
  local.setClock(null);
  assert.equal((await local.call("GET", "/v1/claims/doesnotexistdoesnotexist")).status, 404);

  // At most 20 claims an hour from one network.
  const headers = { "x-forwarded-for": "203.0.113.9" };
  for (let i = 0; i < 20; i++) await ok("POST", "/v1/claims", { headers, body: { name: `Bot ${i}` } });
  assert.equal((await local.call("POST", "/v1/claims", { headers, body: { name: "One too many" } })).status, 429);
  assert.equal((await local.call("POST", "/v1/claims", { headers: { "x-forwarded-for": "198.51.100.7" }, body: { name: "Elsewhere" } })).status, 200);
});

test("from the website: no agent name asked, the terms ticked with the email, and the agent is ready at once, named after its owner", async t => {
  const { local, ok, config } = await setup(t, { AGENT_ID_AUTO_GIVE: "mail,wallet" });
  const started = await ok("POST", "/v1/claims", { body: { startedBy: "person" } });
  const code = started.claim.code;
  const sent = await ok("POST", `/v1/claims/${code}/email`, { body: { email: "lin.wu@example.com" } });
  const confirmed = await ok("POST", `/v1/claims/${code}/email/confirm`, { body: { code: sent.devCode, terms: (await config()).legal.termsVersion } });
  assert.deepEqual([confirmed.claim.step, confirmed.claim.status, confirmed.claim.agent.name], ["done", "claimed", "Lin's agent"]);
  await local.settle();
  const shown = (await ok("GET", `/v1/claims/${code}`, { headers: { "timewarp-claim-session": confirmed.session } })).claim;
  assert.ok(shown.agent.resources.mail && shown.agent.resources.wallet, "Mail and a wallet, ready to use.");
  assert.equal((await ok("GET", "/v1/account", { token: confirmed.auth.access_token })).person.status, "unverified", "Nobody is asked for an ID to get started.");
  assert.equal((await ok("POST", "/v1/claims/collect", { body: { secret: started.secret } })).status, "claimed");
});

test("one Agent ID, many apps: each app it connects from or is set up in is listed, most recent first", async t => {
  const { local, ok, agent } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Research", { origin: { app: "claude-code" } });
  assert.deepEqual((await ok("GET", `/v1/agents/${bot.id}`, { token: alice.session })).agent.apps.map(a => a.app), ["claude-code"], "The app it was made for counts.");
  const mcp = (name, n) => local.call("POST", "/mcp", { token: bot.key, body: { jsonrpc: "2.0", id: n, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name, version: "1.2.3" } } } });
  await mcp("claude-code", 1);
  local.setClock(() => Date.now() + 1000);
  await mcp("codex-mcp-client", 2);
  local.setClock(() => Date.now() + 2000);
  await ok("POST", "/v1/me/apps", { token: bot.key, body: { app: "cursor" } });
  local.setClock(() => Date.now() + 3000);
  await mcp("My Own Agent", 3);
  local.setClock(null);
  const apps = (await ok("GET", "/v1/agents", { token: alice.session })).agents[0].apps;
  assert.deepEqual(apps.map(a => [a.app, a.label]), [["my-own-agent", "My Own Agent"], ["cursor", "Cursor"], ["codex", "Codex"], ["claude-code", "Claude Code"]]);
  assert.equal(apps.find(a => a.app === "codex").clientName, "codex-mcp-client");
  // Still one identity: same name, same id, wherever it runs.
  assert.equal((await ok("GET", "/v1/agents", { token: alice.session })).agents.length, 1);
  assert.equal((await local.call("POST", "/v1/me/apps", { token: bot.key, body: { app: "Not A Slug!" } })).status, 400);
});

test("wallets: owners add money (address or card) and withdraw, without using up their agent's limits", async t => {
  // Cards through Stripe's onramp here (Privy's funding is covered in agent-id-bank).
  const { local, net, ok, agent, verify } = await setup(t, { AGENT_ID_LIVE: "wallet", PRIVY_APP_ID: "privy-app", PRIVY_APP_SECRET: "privy-secret", AGENT_ID_CARD_PROVIDER: "stripe" });
  const alice = await local.user();
  const bot = await agent(alice, "Treasurer");
  await verify(alice);
  const address = "0x" + "ab".repeat(20);
  net.on("POST", /api\.privy\.io\/v1\/wallets$/, () => ({ id: "w_1", address, chain_type: "ethereum" }));
  await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "wallet", mode: "live", settings: { daily: 2000, perTransfer: 2000, approvalAbove: null } } });
  const info = await ok("GET", `/v1/agents/${bot.id}/wallet/add-money`, { token: alice.session });
  assert.deepEqual([info.address, info.network.name, info.assets, info.card.available], [address, "Base", ["USDC", "USDT"], false]);
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/add-money`, { token: alice.session, body: {} })).body.error.code, "card_unavailable");

  net.on("GET", /wallets\/w_1\/balance\?/, () => ({ balances: [{ chain: "base", asset: "usdc", raw_value: "100000000", raw_value_decimals: 6 }] }));
  net.on("GET", /wallets\/w_1\/transactions\?/, () => ({ transactions: [] }));
  net.on("POST", /wallets\/w_1\/transfer$/, () => ({ id: "act_w", status: "pending" }));
  net.on("GET", /actions\/act_w\?include=steps$/, () => ({ id: "act_w", status: "succeeded", steps: [{ transaction_hash: "0x" + "c".repeat(64) }] }));
  const mine = "0x" + "34".repeat(20);
  // A leaked CLI key can't move money out.
  const ownerKey = (await ok("POST", "/v1/keys", { token: alice.session, body: { name: "cli" } })).secret;
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: ownerKey, body: { to: mine, value: "50" } })).body.error.code, "session_required");
  // 50.00 is over the agent's 20.00 caps, but it's the owner's money.
  const out = await ok("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: alice.session, body: { to: mine, value: "50", remember: true } });
  assert.equal(out.status, "completed");
  assert.equal(out.transfer.data.withdrawal, true);
  assert.deepEqual(JSON.parse(net.find("POST", /\/transfer$/)[0].body), { source: { asset: "usdc", chain: "base" }, destination: { address: mine }, amount: "50.00" });
  assert.equal((await ok("GET", `/v1/agents/${bot.id}`, { token: alice.session })).agent.resources.wallet.settings.withdrawTo, mine, "Remembered for next time.");
  // The agent's own daily allowance is untouched.
  net.on("POST", /wallets\/w_1\/transfer$/, () => ({ id: "act_a", status: "pending" }));
  net.on("GET", /actions\/act_a\?include=steps$/, () => ({ id: "act_a", status: "succeeded", steps: [{ transaction_hash: "0x" + "d".repeat(64) }] }));
  assert.equal((await ok("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to: "0x" + "56".repeat(20), value: "20" } })).status, "completed");
  assert.equal((await ok("GET", "/v1/me/wallet", { token: bot.key })).wallet.sent.last24Hours.amount, 2000);
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: alice.session, body: { to: "nowhere", value: "1" } })).status, 400);
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: alice.session, body: { to: address, value: "1" } })).status, 400, "Not to itself.");
  const log = (await ok("GET", "/v1/audit", { token: alice.session })).entries.map(e => e.action);
  assert.ok(log.includes("wallet.withdraw"));

  // Buying with a card, where Stripe's onramp is switched on: USDC delivered on Base to this wallet only.
  local.setEnv({ STRIPE_SECRET_KEY: "sk_test_onramp", STRIPE_PUBLISHABLE_KEY: "pk_test_onramp", STRIPE_CRYPTO_ONRAMP_ENABLED: "true" });
  net.on("POST", /api\.stripe\.com\/v1\/crypto\/onramp_sessions$/, () => ({ id: "cos_1", client_secret: "cos_1_secret_x", redirect_url: null }));
  assert.equal((await ok("GET", `/v1/agents/${bot.id}/wallet/add-money`, { token: alice.session })).card.available, true);
  const card = await ok("POST", `/v1/agents/${bot.id}/wallet/add-money`, { token: alice.session, headers: { "x-forwarded-for": "198.51.100.4" }, body: { amount: "25" } });
  assert.deepEqual([card.clientSecret, card.publishableKey], ["cos_1_secret_x", "pk_test_onramp"]);
  const form = Object.fromEntries(new URLSearchParams(net.find("POST", /onramp_sessions$/)[0].body));
  assert.deepEqual([form["wallet_addresses[base_network]"], form.lock_wallet_address, form["destination_networks[]"], form["destination_currencies[]"], form.source_amount, form.customer_ip_address], [address, "true", "base", "usdc", "25.00", "198.51.100.4"]);
});

test("test wallets withdraw too, as a simulation inside Agent ID", async t => {
  const { local, ok, agent } = await setup(t);
  const alice = await local.user();
  const bot = await agent(alice, "Saver");
  await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "wallet" } });
  assert.equal((await ok("GET", `/v1/agents/${bot.id}/wallet/add-money`, { token: alice.session })).test, true);
  await ok("POST", `/v1/agents/${bot.id}/wallet/test-funds`, { token: alice.session, body: { amount: 5000 } });
  const out = await ok("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: alice.session, body: { to: "0x" + "34".repeat(20), value: "12.50" } });
  assert.deepEqual([out.status, out.balance.amount, out.transfer.data.withdrawal, out.transfer.data.test], ["completed", 3750, true, true]);
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: alice.session, body: { to: "0x" + "34".repeat(20), value: "100" } })).body.error.code, "insufficient");
});

test("payments above the approval amount wait for the owner: a link, an email, a status the agent can follow, and no way for the agent to approve", async t => {
  const { local, net, ok, agent } = await setup(t, { RESEND_API_KEY: "re_test", AGENT_ID_SITE_URL: "https://timewarpdev.com" });
  const alice = await local.user({ email: "alice@example.com" });
  const payer = await agent(alice, "Payer"), payee = await agent(alice, "Payee");
  for (const bot of [payer, payee]) await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "wallet" } });
  await ok("POST", `/v1/agents/${payer.id}/wallet/test-funds`, { token: alice.session, body: { amount: 10000 } });
  net.on("POST", /api\.resend\.com\/emails$/, () => ({ id: "email_1" }));
  const waiting = await ok("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.handle, value: "40", memo: "Supplier deposit" } });
  assert.equal(waiting.status, "needs_approval");
  assert.equal(waiting.approveUrl, `https://timewarpdev.com/agent-id/approvals?id=${waiting.approval}`);
  assert.doesNotMatch(waiting.message, /timewarp-id approve/, "The agent isn't told to approve it itself.");
  await local.settle();
  const [mail] = net.find("POST", /resend\.com\/emails$/);
  const sent = JSON.parse(mail.body);
  assert.deepEqual([sent.to, sent.subject], [["alice@example.com"], "Approve $40.00 from Payer?"]);
  assert.match(sent.html, new RegExp(waiting.approveUrl.replace(/[?.]/g, "\\$&")));
  // The agent follows it, and can't answer it.
  assert.equal((await ok("GET", `/v1/me/approvals/${waiting.approval}`, { token: payer.key })).approval.status, "pending");
  assert.equal((await local.call("POST", `/v1/approvals/${waiting.approval}`, { token: payer.key, body: { decision: "approve" } })).status, 403, "An agent key can't decide approvals.");
  assert.equal((await local.call("GET", `/v1/me/approvals/${waiting.approval}`, { token: payee.key })).status, 404, "Only the agent that asked sees it.");
  // The owner approves on the website: it's sent, and the agent sees that.
  assert.equal((await ok("POST", `/v1/approvals/${waiting.approval}`, { token: alice.session, body: { decision: "approve" } })).status, "completed");
  const done = await ok("GET", `/v1/me/approvals/${waiting.approval}`, { token: payer.key });
  assert.deepEqual([done.approval.status, done.transfer.amount.amount, done.transfer.status], ["completed", 4000, "completed"]);
  // A request the agent no longer needs, it takes back.
  const second = await ok("POST", "/v1/me/wallet/transfers", { token: payer.key, body: { to: payee.handle, value: "30" } });
  const withdrawn = await ok("POST", `/v1/me/approvals/${second.approval}/withdraw`, { token: payer.key });
  assert.deepEqual([withdrawn.approval.status, withdrawn.approval.reason], ["denied", "Withdrawn by the agent"]);
  assert.equal((await local.call("POST", `/v1/approvals/${second.approval}`, { token: alice.session, body: { decision: "approve" } })).body.error.code, "already_decided");
  // Both are in the MCP tools.
  const tools = (await ok("POST", "/mcp", { token: payer.key, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).result.tools.map(tool => tool.name);
  assert.ok(tools.includes("approval_status") && tools.includes("approval_withdraw"));
});

test("business checks: the VAT number is checked against the EU register and the registration document goes to reviewers", async t => {
  const { local, net, ok, verify } = await setup(t);
  const alice = await local.user();
  const org = await local.organization("Acme", [[alice, "owner"]]);
  const reviewer = await verify(alice);
  net.on("GET", /ec\.europa\.eu\/taxation_customs\/vies\/rest-api\/ms\/SE\/vat\/556000000001$/, () => ({ isValid: true, name: "ACME ROBOTICS AB", address: "STORGATAN 1\n111 22 STOCKHOLM" }));
  const upload = (body, type, token = alice.session) => local.handle(new Request(`http://127.0.0.1:54329/agent-id/v1/account/verification/document?organization=${org}`, { method: "POST", body, headers: { authorization: `Bearer ${token}`, "content-type": type, "x-filename": encodeURIComponent("Registreringsbevis.pdf") } }));
  assert.equal((await upload("not a document", "text/plain")).status, 400, "Only PDFs and photos.");
  const stored = await (await upload("%PDF-1.4 certificate", "application/pdf")).json();
  assert.equal(stored.business.document.name, "Registreringsbevis.pdf");
  const submitted = await ok("POST", "/v1/account/verification", { token: alice.session, body: { kind: "business", organizationId: org, legalName: "Acme Robotics AB", registrationNumber: "556000-0000", vatNumber: "SE 5560 0000 0001", country: "SE", representativeRole: "CEO", attestation: true } });
  assert.deepEqual([submitted.business.vatNumber, submitted.business.checks.vat.status, submitted.business.checks.vat.name, submitted.business.checks.vat.address], ["SE556000000001", "valid", "ACME ROBOTICS AB", "STORGATAN 1 111 22 STOCKHOLM"]);
  const queue = await ok("GET", "/v1/reviews", { token: reviewer.session });
  assert.equal(queue.businesses[0].checks.vat.status, "valid");
  assert.equal(queue.businesses[0].document.name, "Registreringsbevis.pdf");
  const doc = await local.handle(new Request(`http://127.0.0.1:54329/agent-id/v1/reviews/business/${org}/document`, { headers: { authorization: `Bearer ${reviewer.session}` } }));
  assert.equal(await doc.text(), "%PDF-1.4 certificate");
  assert.equal((await local.handle(new Request(`http://127.0.0.1:54329/agent-id/v1/reviews/business/${org}/document`, { headers: { authorization: `Bearer ${alice.session}` } }))).status, 403, "Only reviewers read documents.");
  // A register that can't be reached doesn't block the submission; the reviewer checks by hand.
  net.on("GET", /ec\.europa\.eu/, () => new Response("down", { status: 503 }));
  const again = await ok("POST", "/v1/account/verification", { token: alice.session, body: { kind: "business", organizationId: org, legalName: "Acme Robotics AB", registrationNumber: "556000-0000", vatNumber: "SE556000000001", country: "SE", representativeRole: "CEO", attestation: true } });
  assert.equal(again.business.checks.vat.status, "unavailable");
  // Outside the EU there's no VAT register to ask.
  const us = await ok("POST", "/v1/account/verification", { token: alice.session, body: { kind: "business", organizationId: org, legalName: "Acme Inc", registrationNumber: "123", vatNumber: "US123456", country: "US", representativeRole: "CEO", attestation: true } });
  assert.equal(us.business.checks.vat.status, "not_applicable");
});

test("a deployment registers its own Stripe and Resend webhooks on first use, once", async t => {
  const { local, net } = await setup(t, { AGENT_ID_AUTO_SETUP: "true", AGENT_ID_KYC: "stripe_identity", STRIPE_SECRET_KEY: "sk_test_auto", AGENT_ID_LIVE: "mail", RESEND_API_KEY: "re_auto" });
  net.on("POST", /api\.stripe\.com\/v1\/webhook_endpoints$/, () => ({ id: "we_auto", secret: "whsec_auto", enabled_events: [] }));
  net.on("POST", /api\.resend\.com\/webhooks$/, () => ({ id: "wh_auto", signing_secret: "whsec_resend" }));
  await local.call("GET", "/healthz");
  for (let i = 0; i < 20 && !(await local.db.query("select 1 from agent_id_settings where key='setup.auto'")).rows.length; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal(net.find("POST", /webhook_endpoints$/).length, 1);
  assert.equal(net.find("POST", /resend\.com\/webhooks$/).length, 1);
  const stored = (await local.db.query("select key, value from agent_id_settings order by key")).rows.map(r => r.key);
  assert.deepEqual(stored, ["resend.webhook", "setup.auto", "stripe.webhook"]);
  // A new instance (another deploy of the same configuration) leaves them be.
  local.setEnv({});
  await local.call("GET", "/healthz");
  await new Promise(r => setTimeout(r, 100));
  assert.equal(net.find("POST", /webhook_endpoints$/).length, 1);
  assert.equal(net.find("POST", /resend\.com\/webhooks$/).length, 1);
});
