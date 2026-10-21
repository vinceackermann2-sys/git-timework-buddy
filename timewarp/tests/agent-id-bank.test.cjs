"use strict";
// Bank transfers in and out of live wallets through Bridge: the owner
// verifies once with Bridge, adds a bank account, gets bank details for a
// wallet, and withdraws to the bank (Bridge's deposit address gets the USDC).
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

const LIVE = { AGENT_ID_LIVE: "wallet", PRIVY_APP_ID: "privy-app", PRIVY_APP_SECRET: "privy-secret", BRIDGE_API_KEY: "sk-test-bridge" };
const WALLET = "0x" + "ab".repeat(20), BRIDGE_DEPOSIT = "0x" + "b7".repeat(20);
const HOME = { line1: "Drottninggatan 1", city: "Stockholm", postalCode: "111 51" };

async function setup(t, env = LIVE) {
  const net = network();
  const local = await startLocal({ fetch: net.fetch, env });
  t.after(() => local.close());
  const terms = (await local.call("GET", "/v1/config")).body.legal.termsVersion;
  const ok = async (method, url, init) => { const r = await local.call(method, url, init); assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const owner = async () => {
    const user = await local.user({ email: "ada@example.com" });
    await ok("POST", "/v1/account/terms", { token: user.session, body: { version: terms } });
    const reviewer = await local.user();
    local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
    await ok("POST", "/v1/account/verification", { token: user.session, body: { kind: "person", consent: true, legalName: "Ada Lovelace", country: "SE" } });
    await ok("POST", `/v1/reviews/person/${user.id}`, { token: reviewer.session, body: { decision: "approve" } });
    return user;
  };
  net.on("POST", /api\.privy\.io\/v1\/wallets$/, () => ({ id: "w_1", address: WALLET, chain_type: "ethereum" }));
  const liveWallet = async (user, name = "Treasurer") => {
    const agent = (await ok("POST", "/v1/agents", { token: user.session, body: { name } })).agent;
    await ok("POST", `/v1/agents/${agent.id}/resources`, { token: user.session, body: { kind: "wallet", mode: "live" } });
    return agent;
  };
  return { local, net, ok, owner, liveWallet };
}

test("bank transfers: verify once with Bridge, add an IBAN, get a wallet's bank details, withdraw to the bank", async t => {
  const { local, net, ok, owner, liveWallet } = await setup(t);
  let now = Date.now();
  local.setClock(() => now);
  const bridgeKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  local.setEnv({ BRIDGE_WEBHOOK_PUBLIC_KEY: bridgeKeys.publicKey.export({ type: "spki", format: "pem" }) });
  const ada = await owner();
  const bot = await liveWallet(ada);
  assert.equal((await ok("GET", "/v1/config")).bank.available, true);
  assert.equal((await ok("GET", `/v1/agents/${bot.id}/wallet/add-money`, { token: ada.session })).bank.available, true);
  assert.deepEqual(await ok("GET", "/v1/account/bank", { token: ada.session }), { available: true, status: "not_started", currencies: [], accounts: [] });

  // Verifying: Bridge's hosted link, for the person Agent ID verified.
  let kyc = { id: "kyc_1", customer_id: "cus_1", kyc_link: "https://bridge.withpersona.com/verify?x=1", tos_link: "https://dashboard.bridge.xyz/accept-terms?x=1", kyc_status: "not_started", tos_status: "pending" };
  net.on("POST", /api\.sandbox\.bridge\.xyz\/v0\/kyc_links$/, () => kyc);
  net.on("GET", /\/v0\/kyc_links\/kyc_1$/, () => kyc);
  const ownerKey = (await ok("POST", "/v1/keys", { token: ada.session, body: { name: "cli" } })).secret;
  assert.equal((await local.call("POST", "/v1/account/bank/verify", { token: ownerKey, body: {} })).body.error.code, "session_required");
  const started = await ok("POST", "/v1/account/bank/verify", { token: ada.session, body: {} });
  assert.deepEqual([started.status, started.link], ["pending", kyc.kyc_link]);
  const created = net.find("POST", /kyc_links$/)[0];
  assert.deepEqual(JSON.parse(created.body), { full_name: "Ada Lovelace", email: "ada@example.com", type: "individual", endorsements: ["base", "sepa"], redirect_uri: "https://timewarpdev.com/agent-id/dashboard" });
  assert.equal(created.headers.get("api-key"), "sk-test-bridge");
  assert.equal(created.headers.get("idempotency-key"), `agent-id-kyc-${ada.id}`);
  // Not approved yet: no bank accounts, no deposit details.
  assert.equal((await local.call("POST", "/v1/account/bank/accounts", { token: ada.session, body: { kind: "iban", ownerName: "Ada Lovelace", iban: "SE4550000000058398257466", address: HOME } })).body.error.code, "bank_not_verified");

  // Bridge approves, for euros (SEPA) and dollars, and says so (signed) right away.
  kyc = { ...kyc, kyc_status: "approved", tos_status: "approved" };
  net.on("GET", /\/v0\/customers\/cus_1$/, () => ({ id: "cus_1", status: "active", endorsements: [{ name: "base", status: "approved" }, { name: "sepa", status: "approved" }] }));
  const hook = (event, key = bridgeKeys.privateKey) => {
    const raw = JSON.stringify(event), at = String(now);
    const signature = crypto.sign("sha256", crypto.createHash("sha256").update(`${at}.${raw}`).digest(), key).toString("base64");
    return local.call("POST", "/webhooks/bridge", { raw, headers: { "content-type": "application/json", "x-webhook-signature": `t=${at},v0=${signature}` } });
  };
  const stranger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.equal((await hook({ event_category: "kyc_link", event_object: { id: "kyc_1" } }, stranger)).status, 400, "Not signed by Bridge.");
  assert.equal((await hook({ event_category: "kyc_link", event_type: "kyc_link.updated.status_transitioned", event_object: { id: "kyc_1", kyc_status: "approved" } })).status, 200);
  const approved = await ok("GET", "/v1/account/bank", { token: ada.session });
  assert.deepEqual([approved.status, approved.currencies, approved.link], ["approved", ["eur", "usd"], undefined]);

  // An IBAN: checked here first, then saved at Bridge; only the last four stay here.
  assert.equal((await local.call("POST", "/v1/account/bank/accounts", { token: ada.session, body: { kind: "iban", ownerName: "Ada Lovelace", iban: "SE4550000000058398257467", address: HOME } })).body.error.message, "That IBAN isn't valid. Check it against your bank app.");
  net.on("POST", /\/v0\/customers\/cus_1\/external_accounts$/, () => ({ id: "ea_1", last_4: "7466", bank_name: "Swedbank", active: true }));
  const { account } = await ok("POST", "/v1/account/bank/accounts", { token: ada.session, body: { kind: "iban", ownerName: "Ada Lovelace", iban: "SE45 5000 0000 0583 9825 7466", address: HOME } });
  assert.deepEqual([account.bankName, account.last4, account.currency, account.rail], ["Swedbank", "7466", "eur", "sepa"]);
  assert.deepEqual(JSON.parse(net.find("POST", /external_accounts$/)[0].body), {
    currency: "eur", account_type: "iban", account_owner_name: "Ada Lovelace", account_owner_type: "individual", first_name: "Ada", last_name: "Lovelace",
    address: { street_line_1: "Drottninggatan 1", city: "Stockholm", postal_code: "111 51", country: "SWE" },
    iban: { account_number: "SE4550000000058398257466", country: "SWE" },
  });
  assert.doesNotMatch(JSON.stringify(await ok("GET", "/v1/account/bank", { token: ada.session })), /58398257466/, "The full IBAN isn't kept or shown.");

  // The wallet's own bank details for deposits, made once.
  net.on("POST", /\/v0\/customers\/cus_1\/virtual_accounts$/, () => ({ id: "va_1", status: "activated", source_deposit_instructions: { currency: "eur", iban: "DE89370400440532013000", bic: "COBADEFFXXX", account_holder_name: "Bridge Building Sp. z.o.o.", bank_name: "Commerzbank", payment_rails: ["sepa"] } }));
  const deposit = (await ok("POST", `/v1/agents/${bot.id}/wallet/bank-deposit`, { token: ada.session, body: { currency: "eur" } })).deposit;
  assert.deepEqual([deposit.iban, deposit.bic, deposit.beneficiary, deposit.rails], ["DE89370400440532013000", "COBADEFFXXX", "Bridge Building Sp. z.o.o.", ["sepa"]]);
  assert.deepEqual(JSON.parse(net.find("POST", /virtual_accounts$/)[0].body), { source: { currency: "eur" }, destination: { payment_rail: "base", currency: "usdc", address: WALLET } });
  await ok("POST", `/v1/agents/${bot.id}/wallet/bank-deposit`, { token: ada.session, body: { currency: "eur" } });
  assert.equal(net.find("POST", /virtual_accounts$/).length, 1, "Asked again, the same details.");

  // Withdrawing to the bank: Bridge opens the payout, the wallet sends it the USDC.
  net.on("GET", /wallets\/w_1\/balance\?/, () => ({ balances: [{ chain: "base", asset: "usdc", raw_value: "80000000", raw_value_decimals: 6 }, { chain: "base", asset: "usdt", raw_value: "50000000", raw_value_decimals: 6 }] }));
  net.on("GET", /wallets\/w_1\/transactions\?/, () => ({ transactions: [] }));
  net.on("POST", /\/v0\/transfers$/, () => ({ id: "tr_1", state: "awaiting_funds", source_deposit_instructions: { payment_rail: "base", currency: "usdc", amount: "60.00", to_address: BRIDGE_DEPOSIT } }));
  net.on("POST", /wallets\/w_1\/transfer$/, () => ({ id: "act_1", status: "pending" }));
  net.on("GET", /actions\/act_1\?include=steps$/, () => ({ id: "act_1", status: "succeeded", steps: [{ transaction_hash: "0x" + "c".repeat(64) }] }));
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: ownerKey, body: { bankAccount: account.id, value: "60" } })).body.error.code, "session_required");
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: ada.session, body: { bankAccount: account.id, value: "90" } })).body.error.code, "insufficient", "Only USDC pays out.");
  const out = await ok("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: ada.session, body: { bankAccount: account.id, value: "60" } });
  assert.deepEqual([out.status, out.transfer.counterparty, out.transfer.data.bank.transfer, out.transfer.data.bank.state, out.bank.account.id], ["completed", "Swedbank ••7466", "tr_1", "awaiting_funds", account.id]);
  const payout = JSON.parse(net.find("POST", /\/v0\/transfers$/)[0].body);
  assert.match(payout.client_reference_id, /^agent-id-[a-z0-9]{16}$/);
  assert.deepEqual(payout, {
    on_behalf_of: "cus_1", amount: "60.00", client_reference_id: payout.client_reference_id,
    source: { payment_rail: "base", currency: "usdc", from_address: WALLET },
    destination: { payment_rail: "sepa", currency: "eur", external_account_id: "ea_1" },
  });
  assert.deepEqual(JSON.parse(net.find("POST", /wallets\/w_1\/transfer$/).at(-1).body), { source: { asset: "usdc", chain: "base" }, destination: { address: BRIDGE_DEPOSIT }, amount: "60.00" });

  // Bridge sends it on (looked up when the history is read), then says it arrived.
  net.on("GET", /\/v0\/transfers\/tr_1$/, () => ({ id: "tr_1", state: "payment_submitted" }));
  now += 61_000;
  const stateOf = async () => (await ok("GET", `/v1/agents/${bot.id}/events?kind=wallet`, { token: ada.session })).events.find(e => e.id === out.transfer.id).data.bank.state;
  assert.equal(await stateOf(), "payment_submitted");
  assert.equal((await hook({ event_category: "transfer", event_object_id: "tr_1", event_object: { id: "tr_1", state: "payment_processed" } })).status, 200);
  assert.equal(await stateOf(), "payment_processed");

  // A payout whose USDC never left is cancelled at Bridge.
  net.on("POST", /\/v0\/transfers$/, () => ({ id: "tr_2", state: "awaiting_funds", source_deposit_instructions: { to_address: BRIDGE_DEPOSIT } }));
  net.on("POST", /wallets\/w_1\/transfer$/, () => new Response(JSON.stringify({ message: "Privy is down" }), { status: 500 }));
  net.on("DELETE", /\/v0\/transfers\/tr_2$/, () => ({ id: "tr_2", state: "canceled" }));
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: ada.session, body: { bankAccount: account.id, value: "5" } })).status, 503);
  assert.equal(net.find("DELETE", /\/v0\/transfers\/tr_2$/).length, 1);

  // Removing the account removes it at Bridge too.
  net.on("DELETE", /\/v0\/customers\/cus_1\/external_accounts\/ea_1$/, () => ({ id: "ea_1" }));
  await ok("DELETE", `/v1/account/bank/accounts/${account.id}`, { token: ada.session });
  assert.deepEqual((await ok("GET", "/v1/account/bank", { token: ada.session })).accounts, []);
  const log = (await ok("GET", "/v1/audit", { token: ada.session })).entries.map(e => e.action);
  for (const action of ["bank.verification_started", "bank.account_added", "bank.deposit_details", "wallet.withdraw", "bank.account_removed"]) assert.ok(log.includes(action), action);
});

test("the deployment registers its own Bridge webhook and switches it on", async t => {
  const { local, net, ok } = await setup(t);
  const operator = await local.user();
  local.setEnv({ AGENT_ID_REVIEWERS: operator.id });
  net.on("POST", /\/v0\/webhooks$/, () => ({ id: "wh_1", public_key: "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----", status: "disabled" }));
  net.on("PUT", /\/v0\/webhooks\/wh_1$/, () => ({ id: "wh_1", status: "active" }));
  const done = await ok("POST", "/v1/admin/setup", { token: operator.session });
  assert.equal(done.setup.bridge, "registered");
  assert.equal(done.status.webhooks.bridge.registered, true);
  const created = JSON.parse(net.find("POST", /\/v0\/webhooks$/)[0].body);
  assert.match(created.url, /\/webhooks\/bridge$/);
  assert.deepEqual([created.event_epoch, created.event_categories], ["webhook_creation", ["kyc_link", "customer", "transfer"]]);
  assert.deepEqual(JSON.parse(net.find("PUT", /\/v0\/webhooks\/wh_1$/)[0].body), { status: "active" });
  assert.equal(net.find("PUT", /\/v0\/webhooks\/wh_1$/)[0].headers.get("idempotency-key"), null, "Bridge takes idempotency keys on POST only.");
  assert.equal((await ok("POST", "/v1/admin/setup", { token: operator.session })).setup.bridge, "kept");
});

test("bank transfers stay hidden without Bridge, and need a verified person", async t => {
  const { local, ok } = await setup(t, { AGENT_ID_LIVE: "wallet", PRIVY_APP_ID: "privy-app", PRIVY_APP_SECRET: "privy-secret" });
  const user = await local.user();
  assert.equal((await ok("GET", "/v1/config")).bank.available, false);
  assert.deepEqual(await ok("GET", "/v1/account/bank", { token: user.session }), { available: false, status: "unavailable", currencies: [], accounts: [] });
  assert.equal((await local.call("POST", "/v1/account/bank/verify", { token: user.session, body: {} })).body.error.code, "bank_unavailable");
  local.setEnv({ BRIDGE_API_KEY: "sk-test-bridge" });
  assert.equal((await local.call("POST", "/v1/account/bank/verify", { token: user.session, body: {} })).body.error.code, "verification_required");
});
