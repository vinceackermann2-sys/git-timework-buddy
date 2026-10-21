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
  // A new owner: terms accepted, identity not checked yet.
  const owner = async () => {
    const user = await local.user({ email: "ada@example.com" });
    await ok("POST", "/v1/account/terms", { token: user.session, body: { version: terms } });
    return user;
  };
  net.on("POST", /api\.privy\.io\/v1\/wallets$/, () => ({ id: "w_1", address: WALLET, chain_type: "ethereum" }));
  const liveWallet = async (user, name = "Treasurer") => {
    const agent = (await ok("POST", "/v1/agents", { token: user.session, body: { name } })).agent;
    await ok("POST", `/v1/agents/${agent.id}/resources`, { token: user.session, body: { kind: "wallet", mode: "live" } });
    return agent;
  };
  // Bridge approves the owner at once, for dollars and euros.
  const verify = async (user, { customer = "cus_1", country = "SWE" } = {}) => {
    const kyc = { id: `kyc_${customer}`, customer_id: customer, kyc_link: "https://bridge.withpersona.com/verify?x=1", tos_link: "https://dashboard.bridge.xyz/accept-terms?x=1", kyc_status: "approved", tos_status: "approved" };
    net.on("POST", /\/v0\/kyc_links$/, () => kyc);
    net.on("GET", new RegExp(`/v0/kyc_links/${kyc.id}$`), () => kyc);
    net.on("GET", new RegExp(`/v0/customers/${customer}$`), () => ({ id: customer, status: "active", first_name: "Ada", last_name: "Lovelace", residential_address: { country }, endorsements: [{ name: "base", status: "approved" }, { name: "sepa", status: "approved" }] }));
    await ok("POST", "/v1/account/bank/verify", { token: user.session, body: {} });
  };
  // Bridge's signed webhooks (its key set on first use).
  let keys = null;
  const hook = event => {
    if (!keys) {
      keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      local.setEnv({ BRIDGE_WEBHOOK_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }) });
    }
    const raw = JSON.stringify(event), at = String(Date.now());
    const signature = crypto.sign("sha256", crypto.createHash("sha256").update(`${at}.${raw}`).digest(), keys.privateKey).toString("base64");
    return local.call("POST", "/webhooks/bridge", { raw, headers: { "content-type": "application/json", "x-webhook-signature": `t=${at},v0=${signature}` } });
  };
  return { local, net, ok, owner, liveWallet, verify, hook };
}

test("bank transfers: one identity check (Bridge's), then an IBAN, a wallet's bank details, and withdrawing to the bank", async t => {
  const { local, net, ok, owner, liveWallet } = await setup(t);
  let now = Date.now();
  local.setClock(() => now);
  const bridgeKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  local.setEnv({ BRIDGE_WEBHOOK_PUBLIC_KEY: bridgeKeys.publicKey.export({ type: "spki", format: "pem" }) });
  const ada = await owner();
  const bot = await liveWallet(ada);
  const config = await ok("GET", "/v1/config");
  assert.deepEqual([config.bank.available, config.verification.person], [true, "bridge"], "Where Bridge moves money, its check is the identity check.");
  assert.equal((await ok("GET", `/v1/agents/${bot.id}/wallet/add-money`, { token: ada.session })).bank.available, true);
  assert.deepEqual(await ok("GET", "/v1/account/bank", { token: ada.session }), { available: true, status: "not_started", currencies: [], accounts: [] });
  // The wallet was given unverified; money doesn't leave it yet.
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/wallet/withdraw`, { token: ada.session, body: { to: "0x" + "34".repeat(20), value: "1" } })).body.error.code, "verification_required");

  // Verifying: Bridge's hosted page, started from the wallet or the Verification page alike.
  let kyc = { id: "kyc_1", customer_id: "cus_1", kyc_link: "https://bridge.withpersona.com/verify?x=1", tos_link: "https://dashboard.bridge.xyz/accept-terms?x=1", kyc_status: "not_started", tos_status: "pending" };
  net.on("POST", /api\.sandbox\.bridge\.xyz\/v0\/kyc_links$/, () => kyc);
  net.on("GET", /\/v0\/kyc_links\/kyc_1$/, () => kyc);
  const ownerKey = (await ok("POST", "/v1/keys", { token: ada.session, body: { name: "cli" } })).secret;
  assert.equal((await local.call("POST", "/v1/account/bank/verify", { token: ownerKey, body: {} })).body.error.code, "session_required");
  const started = await ok("POST", "/v1/account/bank/verify", { token: ada.session, body: {} });
  assert.deepEqual([started.status, started.link], ["pending", kyc.kyc_link]);
  const created = net.find("POST", /kyc_links$/)[0];
  assert.deepEqual(JSON.parse(created.body), { email: "ada@example.com", type: "individual", endorsements: ["base", "sepa"], redirect_uri: "https://timewarpdev.com/agent-id/dashboard" });
  assert.equal(created.headers.get("api-key"), "sk-test-bridge");
  assert.equal(created.headers.get("idempotency-key"), `agent-id-kyc-${ada.id}`);
  const fromVerifyPage = await ok("POST", "/v1/account/verification", { token: ada.session, body: { kind: "person" } });
  assert.deepEqual([fromVerifyPage.url, fromVerifyPage.person.status, fromVerifyPage.person.provider], [kyc.kyc_link, "pending", "bridge"]);
  assert.equal(net.find("POST", /kyc_links$/).length, 1, "One check, not a second one.");
  // Not approved yet: no bank accounts, no deposit details.
  assert.equal((await local.call("POST", "/v1/account/bank/accounts", { token: ada.session, body: { kind: "iban", ownerName: "Ada Lovelace", iban: "SE4550000000058398257466", address: HOME } })).body.error.code, "bank_not_verified");

  // Bridge approves, for euros (SEPA) and dollars, and says so (signed) right away.
  kyc = { ...kyc, kyc_status: "approved", tos_status: "approved" };
  net.on("GET", /\/v0\/customers\/cus_1$/, () => ({ id: "cus_1", status: "active", first_name: "Ada", last_name: "Lovelace", residential_address: { country: "SWE" }, endorsements: [{ name: "base", status: "approved" }, { name: "sepa", status: "approved" }] }));
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
  const person = (await ok("GET", "/v1/account", { token: ada.session })).person;
  assert.deepEqual([person.status, person.provider, person.legalName, person.country], ["verified", "bridge", "Ada Lovelace", "SE"], "Bridge's approval verifies Ada on Agent ID too.");

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
  for (const action of ["verification.person.start", "verification.person.verified", "bank.account_added", "bank.deposit_details", "wallet.withdraw", "bank.account_removed"]) assert.ok(log.includes(action), action);
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

test("bank transfers stay hidden without Bridge, where Stripe Identity stays the identity check", async t => {
  const { local, ok } = await setup(t, { AGENT_ID_LIVE: "wallet", PRIVY_APP_ID: "privy-app", PRIVY_APP_SECRET: "privy-secret" });
  const user = await local.user();
  assert.equal((await ok("GET", "/v1/config")).bank.available, false);
  assert.deepEqual(await ok("GET", "/v1/account/bank", { token: user.session }), { available: false, status: "unavailable", currencies: [], accounts: [] });
  assert.equal((await local.call("POST", "/v1/account/bank/verify", { token: user.session, body: {} })).body.error.code, "bank_unavailable");
  local.setEnv({ AGENT_ID_KYC: "stripe_identity" });
  assert.equal((await ok("GET", "/v1/config")).verification.person, "stripe_identity");
  local.setEnv({ BRIDGE_API_KEY: "sk-test-bridge" });
  assert.equal((await ok("GET", "/v1/config")).verification.person, "bridge", "With Bridge, one check covers both.");
});

test("adding money by SEPA: an amount in a form opens one transfer to the wallet, followed until it arrives", async t => {
  const { local, net, ok, owner, liveWallet, verify, hook } = await setup(t);
  let now = Date.now();
  local.setClock(() => now);
  const ada = await owner();
  const bot = await liveWallet(ada);
  const payins = `/v1/agents/${bot.id}/wallet/bank-payins`;
  assert.equal((await local.call("POST", payins, { token: ada.session, body: { amount: 5000 } })).body.error.code, "bank_not_verified", "The one identity check comes first.");
  await verify(ada);
  now += 6_000;
  assert.deepEqual((await ok("GET", "/v1/account/bank", { token: ada.session })).currencies, ["eur", "usd"], "Approved, and its rails known soon after.");

  let transfer = { id: "tr_in1", state: "awaiting_funds", source_deposit_instructions: { payment_rail: "sepa", currency: "eur", amount: "50.00", deposit_message: "BRGABC123", iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX", account_holder_name: "Bridge Building Sp. z o.o.", bank_name: "Commerzbank", bank_address: "Berlin, DE" } };
  net.on("POST", /\/v0\/transfers$/, () => transfer);
  const ownerKey = (await ok("POST", "/v1/keys", { token: ada.session, body: { name: "cli" } })).secret;
  assert.equal((await local.call("POST", payins, { token: ownerKey, body: { amount: 5000 } })).body.error.code, "session_required");
  assert.equal((await local.call("POST", payins, { token: ada.session, body: { amount: 50 } })).status, 400, "At least one euro.");
  const { payin } = await ok("POST", payins, { token: ada.session, body: { amount: 5000 } });
  assert.match(payin.id, /^pay_[a-z0-9]{24}$/);
  assert.deepEqual([payin.amount, payin.currency, payin.state], [5000, "eur", "awaiting_funds"]);
  assert.deepEqual(payin.instructions, { currency: "eur", amount: "50.00", beneficiary: "Bridge Building Sp. z o.o.", iban: "DE89370400440532013000", bic: "COBADEFFXXX", bankName: "Commerzbank", bankAddress: "Berlin, DE", reference: "BRGABC123" });
  const sent = net.find("POST", /\/v0\/transfers$/)[0];
  assert.deepEqual(JSON.parse(sent.body), {
    on_behalf_of: "cus_1", amount: "50.00", client_reference_id: payin.id,
    source: { payment_rail: "sepa", currency: "eur" }, destination: { payment_rail: "base", currency: "usdc", to_address: WALLET },
  });
  assert.equal(sent.headers.get("idempotency-key"), `agent-id-payin-${payin.id}`);

  // Bridge says the euros arrived (signed); then it's looked up now and then.
  assert.equal((await hook({ event_category: "transfer", event_object_id: "tr_in1", event_object: { id: "tr_in1", state: "funds_received" } })).status, 200);
  assert.equal((await ok("GET", payins, { token: ada.session })).payins[0].state, "funds_received");
  net.on("GET", /\/v0\/transfers\/tr_in1$/, () => ({ id: "tr_in1", state: "payment_processed" }));
  now += 31_000;
  assert.equal((await ok("GET", payins, { token: ada.session })).payins[0].state, "payment_processed");

  // Changed their mind: one still waiting is closed at Bridge too; one on its way can't be.
  transfer = { ...transfer, id: "tr_in2" };
  const second = (await ok("POST", payins, { token: ada.session, body: { amount: 2500 } })).payin;
  net.on("DELETE", /\/v0\/transfers\/tr_in2$/, () => ({ id: "tr_in2", state: "canceled" }));
  await ok("DELETE", `${payins}/${second.id}`, { token: ada.session });
  assert.equal(net.find("DELETE", /\/v0\/transfers\/tr_in2$/).length, 1);
  assert.deepEqual((await ok("GET", payins, { token: ada.session })).payins.map(p => p.id), [payin.id]);
  assert.equal((await local.call("DELETE", `${payins}/${payin.id}`, { token: ada.session })).body.error.code, "too_late");
  const eve = await local.user({ email: "eve@example.com" });
  assert.equal((await local.call("GET", payins, { token: eve.session })).status, 404, "Only the owner sees them.");
  const log = (await ok("GET", "/v1/audit", { token: ada.session })).entries.map(e => e.action);
  for (const action of ["bank.payin_started", "bank.payin_canceled"]) assert.ok(log.includes(action), action);
});

test("card payments through MoonPay: a signed page that pays into this wallet, for this buyer, in their money", async t => {
  const { local, ok, owner, liveWallet, verify } = await setup(t, { ...LIVE, AGENT_ID_CARD_PROVIDER: "moonpay", MOONPAY_API_KEY: "pk_test_abc", MOONPAY_SECRET_KEY: "sk_test_secret" });
  let now = Date.now();
  local.setClock(() => now);
  const ada = await owner();
  const bot = await liveWallet(ada);
  const addMoney = `/v1/agents/${bot.id}/wallet/add-money`;
  assert.deepEqual((await ok("GET", addMoney, { token: ada.session })).card, { available: true, provider: "moonpay" });
  const hmac = message => crypto.createHmac("sha256", "sk_test_secret").update(message).digest("base64");
  const open = async () => {
    const { provider, url } = await ok("POST", addMoney, { token: ada.session, body: {}, headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
    assert.equal(provider, "moonpay");
    const page = new URL(url);
    const [query, signature] = page.search.split("&signature=");
    assert.equal(decodeURIComponent(signature), hmac(query), "Signed with the secret key: the wallet can't be changed on the way.");
    return { origin: page.origin, params: Object.fromEntries(page.searchParams) };
  };
  const { origin, params } = await open();
  assert.equal(origin, "https://buy-sandbox.moonpay.com");
  assert.deepEqual(
    [params.apiKey, params.currencyCode, params.walletAddress, params.baseCurrencyCode, params.email, params.externalCustomerId],
    ["pk_test_abc", "usdc_base", WALLET, "usd", "ada@example.com", ada.id],
  );
  assert.match(params.externalTransactionId, /^card_[a-z0-9]{24}$/);
  assert.equal(params.allowedIpAddress, hmac("203.0.113.9"), "Bound to the buyer's IP address.");
  assert.equal(params.redirectURL, `https://timewarpdev.com/agent-id/agents/${bot.id}?tab=wallet`);
  // Verified as living in Sweden: paying in crowns.
  await verify(ada);
  now += 6_000;
  await ok("GET", "/v1/account/bank", { token: ada.session });
  assert.equal((await open()).params.baseCurrencyCode, "sek");
  const log = (await ok("GET", "/v1/audit", { token: ada.session })).entries.filter(e => e.action === "wallet.add_money_card");
  assert.equal(log.length, 2);
  // Keys from different modes don't count.
  local.setEnv({ MOONPAY_SECRET_KEY: "sk_live_secret" });
  assert.equal((await ok("GET", addMoney, { token: ada.session })).card.available, false);
});

test("a business is checked by Bridge too, started by a verified person who may act for it", async t => {
  const { local, net, ok, owner, verify, hook } = await setup(t);
  let now = Date.now();
  local.setClock(() => now);
  const ada = await owner();
  const org = await local.organization("Acme", [[ada, "owner"]]);
  assert.equal((await ok("GET", "/v1/config")).verification.business, "bridge");
  const body = { kind: "business", organizationId: org, legalName: "Acme AB", country: "SE", representativeRole: "CEO", attestation: true };
  assert.equal((await local.call("POST", "/v1/account/verification", { token: ada.session, body })).body.error.code, "person_verification_required");
  await verify(ada);
  let kyb = { id: "kyb_1", customer_id: "cus_b1", kyc_link: "https://bridge.withpersona.com/verify?b=1", tos_link: "https://dashboard.bridge.xyz/accept-terms?b=1", kyc_status: "not_started", tos_status: "pending" };
  net.on("POST", /\/v0\/kyc_links$/, () => kyb);
  net.on("GET", /\/v0\/kyc_links\/kyb_1$/, () => kyb);
  assert.equal((await local.call("POST", "/v1/account/verification", { token: ada.session, body: { ...body, attestation: false } })).body.error.code, "attestation_required");
  const started = await ok("POST", "/v1/account/verification", { token: ada.session, body });
  assert.deepEqual([started.url, started.business.status, started.business.provider, started.business.link], [kyb.kyc_link, "pending", "bridge", kyb.kyc_link]);
  const created = net.find("POST", /kyc_links$/).at(-1);
  assert.deepEqual(JSON.parse(created.body), { full_name: "Acme AB", email: "ada@example.com", type: "business", endorsements: ["base", "sepa"], redirect_uri: "https://timewarpdev.com/agent-id/verify?done=1" });
  assert.equal(created.headers.get("idempotency-key"), `agent-id-kyc-business-${org}`);
  const businessOf = async () => (await ok("GET", "/v1/account", { token: ada.session })).organizations.find(o => o.id === org).business;
  assert.equal((await businessOf()).link, kyb.kyc_link, "The Verification page can pick it up again.");
  await ok("POST", "/v1/account/verification", { token: ada.session, body });
  assert.equal(net.find("POST", /kyc_links$/).filter(c => JSON.parse(c.body).type === "business").length, 1, "One check per business.");

  // Bridge approves (signed webhook): the business is verified, and its agents show it.
  kyb = { ...kyb, kyc_status: "approved", tos_status: "approved" };
  assert.equal((await hook({ event_category: "kyc_link", event_object: { id: "kyb_1" } })).status, 200);
  const business = await businessOf();
  assert.deepEqual([business.status, business.link], ["verified", undefined]);
  const agent = (await ok("POST", "/v1/agents", { token: ada.session, body: { name: "Acme bot", organizationId: org } })).agent;
  const verification = (await ok("GET", `/v1/agents/${agent.id}`, { token: ada.session })).verification;
  assert.deepEqual([verification.verified, verification.level], [true, "kyb"]);
  const log = (await ok("GET", "/v1/audit", { token: ada.session })).entries.map(e => e.action);
  for (const action of ["verification.business.start", "verification.business.verified"]) assert.ok(log.includes(action), action);
});

test("card payments through Privy's funding: the browser opens Privy's onramps for this wallet, recorded first", async t => {
  const { local, ok, owner, liveWallet, verify } = await setup(t);
  let now = Date.now();
  local.setClock(() => now);
  const ada = await owner();
  const bot = await liveWallet(ada);
  const addMoney = `/v1/agents/${bot.id}/wallet/add-money`;
  // Privy is the default wherever its wallets are; development buys in the sandbox.
  assert.deepEqual((await ok("GET", addMoney, { token: ada.session })).card, { available: true, provider: "privy", privy: { appId: "privy-app", environment: "sandbox" } });
  const ownerKey = (await ok("POST", "/v1/keys", { token: ada.session, body: { name: "cli" } })).secret;
  assert.equal((await local.call("POST", addMoney, { token: ownerKey, body: {} })).body.error.code, "session_required");
  const opened = await ok("POST", addMoney, { token: ada.session, body: {} });
  assert.deepEqual(
    [opened.provider, opened.appId, opened.environment, opened.address, opened.chain, opened.asset, opened.currency, opened.email],
    ["privy", "privy-app", "sandbox", WALLET, "eip155:8453", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "usd", "ada@example.com"],
  );
  assert.match(opened.reference, /^card_[a-z0-9]{24}$/);
  // Verified as living in Sweden: euros (Privy's onramps take dollars and euros).
  await verify(ada);
  now += 6_000;
  await ok("GET", "/v1/account/bank", { token: ada.session });
  assert.equal((await ok("POST", addMoney, { token: ada.session, body: {} })).currency, "eur");
  const log = (await ok("GET", "/v1/audit", { token: ada.session })).entries.filter(e => e.action === "wallet.add_money_card");
  assert.deepEqual(log.map(e => [e.detail.provider, e.detail.currency, e.agentId]).sort(), [["privy", "eur", bot.id], ["privy", "usd", bot.id]], "Each card payment is recorded for the agent.");
  // Production buys for real; a separate client app ID can be set for the browser.
  local.setEnv({ AGENT_ID_ALLOW_TEST: "false", PRIVY_CLIENT_APP_ID: "privy-client" });
  assert.deepEqual((await ok("GET", addMoney, { token: ada.session })).card.privy, { appId: "privy-client", environment: "production" });
  local.setEnv({ AGENT_ID_CARD_PAYMENTS: "off" });
  assert.equal((await ok("GET", addMoney, { token: ada.session })).card.available, false);
});
