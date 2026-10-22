"use strict";
// Agent ID's live providers, against scripted provider APIs: what each
// request looks like (and how it is authenticated), and how each provider's
// webhooks are checked and recorded. Nothing here reaches a real account.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { startLocal } = require("../scripts/agent-id-local.cjs");

// A provider network: [method, url pattern, handler(url, init, body)].
function network() {
  const routes = [], calls = [];
  const fetch = async (url, init = {}) => {
    const href = String(url), method = init.method || "GET";
    const call = { url: href, method, headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : init.body ? String(init.body) : "" };
    calls.push(call);
    for (const [m, pattern, handler] of routes) {
      if (m !== method || !pattern.test(href)) continue;
      const result = await handler(new URL(href), call);
      return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected provider request: ${method} ${href}`);
  };
  return { fetch, calls, on: (method, pattern, handler) => routes.unshift([method, pattern, handler]), find: (method, pattern) => calls.filter(c => c.method === method && pattern.test(c.url)) };
}

async function setup(t, env = {}) {
  const net = network();
  const local = await startLocal({ fetch: net.fetch, env });
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
  const agent = async (owner, name) => { const created = await ok("POST", "/v1/agents", { token: owner.session, body: { name } }); return { ...created.agent, key: created.secret }; };
  // Verifies an owner through the reviewer flow.
  const verify = async owner => {
    const reviewer = await local.user();
    local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
    await ok("POST", "/v1/account/verification", { token: owner.session, body: { kind: "person", consent: true, legalName: "Ada Lovelace", country: "SE" } });
    await ok("POST", `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: "approve" } });
  };
  return { local, net, ok, agent, verify };
}
const formOf = body => Object.fromEntries(new URLSearchParams(body));
const hmac = (key, text, encoding) => crypto.createHmac("sha256", key).update(text).digest(encoding);

test("live mail: sent through Resend from the agent's own address; signed inbound mail lands in its inbox", async t => {
  const svixSecret = "whsec_" + crypto.randomBytes(24).toString("base64");
  const { local, net, ok, agent } = await setup(t, { AGENT_ID_LIVE: "mail", RESEND_API_KEY: "re_live_key", AGENT_ID_RESEND_WEBHOOK_SECRET: svixSecret });
  const alice = await local.user();
  const bot = await agent(alice, "Sales Bot");
  // An address the previous Timewarp app already gave out is refused.
  await local.db.exec("create table public.timewarp_personal_agents(id text, email text)");
  await local.db.query("insert into public.timewarp_personal_agents values('old', $1)", [`${bot.handle}@agents.timewarpdev.com`]);
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "mail", mode: "live" } })).body.error.code, "address_taken");
  await local.db.exec("delete from public.timewarp_personal_agents");
  const mail = (await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "mail", mode: "live" } })).resource;
  assert.equal(mail.address, `${bot.handle}@agents.timewarpdev.com`);
  assert.equal(mail.provider, "resend");

  net.on("POST", /^https:\/\/api\.resend\.com\/emails$/, () => ({ id: "em_out_1" }));
  const sent = await ok("POST", "/v1/me/mail", { token: bot.key, body: { to: ["buyer@example.com"], subject: "Offer", text: "Hello!" } });
  assert.equal(sent.message.status, "sent");
  const [request] = net.find("POST", /api\.resend\.com\/emails$/);
  assert.equal(request.headers.get("authorization"), "Bearer re_live_key");
  assert.match(request.headers.get("idempotency-key"), new RegExp(`^agent-id/${bot.id}/`));
  const payload = JSON.parse(request.body);
  assert.equal(payload.from, `Sales Bot <${mail.address}>`);
  assert.equal(payload.reply_to, mail.address);
  assert.deepEqual(payload.to, ["buyer@example.com"]);
  assert.deepEqual(payload.tags, [{ name: "agent_id", value: bot.id }]);

  const deliver = async (event, signature) => {
    const body = JSON.stringify(event), id = "msg_" + crypto.randomUUID(), timestamp = String(Math.floor(Date.now() / 1000));
    const sig = signature || "v1," + hmac(Buffer.from(svixSecret.slice(6), "base64"), `${id}.${timestamp}.${body}`, "base64");
    return local.call("POST", "/webhooks/resend", { raw: body, headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": sig } });
  };
  assert.equal((await deliver({ type: "email.delivered", data: { email_id: "em_out_1" } })).status, 200);
  assert.equal((await ok("GET", "/v1/me/mail?folder=sent", { token: bot.key })).messages[0].status, "delivered");
  net.on("GET", /emails\/receiving\/em_in_1$/, () => ({ from: "Buyer <buyer@example.com>", to: [mail.address, "other@example.com"], subject: "Re: Offer", text: "Deal.", message_id: "<abc@example.com>", attachments: [{ id: "a1", filename: "po.pdf", content_type: "application/pdf", size: 9 }] }));
  net.on("GET", /emails\/receiving\/em_in_1\/attachments\/a1$/, () => ({ id: "a1", filename: "po.pdf", content_type: "application/pdf", size: 9, download_url: "https://cdn.resend.example/a1?signature=x" }));
  net.on("GET", /^https:\/\/cdn\.resend\.example\/a1/, () => new Response("%PDF-1.7\n", { status: 200 }));
  const inbound = { type: "email.received", data: { email_id: "em_in_1", to: [mail.address] } };
  assert.equal((await deliver(inbound, "v1,forged")).status, 401, "Unsigned mail is refused.");
  assert.equal((await deliver(inbound)).body.delivered, 1);
  assert.equal((await deliver(inbound)).status, 200);
  const inbox = await ok("GET", "/v1/me/mail", { token: bot.key });
  assert.equal(inbox.messages.length, 1, "A repeated delivery is recorded once.");
  const message = (await ok("GET", `/v1/me/mail/${inbox.messages[0].id}`, { token: bot.key })).message;
  assert.equal(message.counterparty, "buyer@example.com");
  assert.equal(message.folder, "inbox");
  assert.deepEqual(message.attachments.map(a => [a.filename, a.contentType, a.size]), [["po.pdf", "application/pdf", 9]], "Attachments are kept with the message.");
  const file = await local.handle(new Request(`http://127.0.0.1:54329/agent-id/v1/me/files/${message.attachments[0].id}`, { headers: { authorization: `Bearer ${bot.key}` } }));
  assert.equal(await file.text(), "%PDF-1.7\n");
  assert.match(file.headers.get("content-disposition"), /attachment; filename\*=UTF-8''po\.pdf/);
  // Sending with an attachment carries the file to Resend.
  const upload = await local.handle(new Request("http://127.0.0.1:54329/agent-id/v1/me/files", { method: "POST", body: "quote,qty\nwidget,3\n", headers: { authorization: `Bearer ${bot.key}`, "content-type": "text/csv", "x-filename": encodeURIComponent("quote list.csv") } }));
  const uploaded = (await upload.json()).file;
  assert.equal(uploaded.filename, "quote list.csv");
  net.on("POST", /^https:\/\/api\.resend\.com\/emails$/, () => ({ id: "em_out_3" }));
  await ok("POST", "/v1/me/mail", { token: bot.key, body: { to: "buyer@example.com", subject: "Quote", text: "Attached.", attachments: [uploaded.id] } });
  const withFile = JSON.parse(net.find("POST", /api\.resend\.com\/emails$/).at(-1).body);
  assert.deepEqual(withFile.attachments, [{ filename: "quote list.csv", content: Buffer.from("quote,qty\nwidget,3\n").toString("base64"), content_type: "text/csv" }]);
  // A reply goes into the same thread.
  net.on("POST", /^https:\/\/api\.resend\.com\/emails$/, () => ({ id: "em_out_2" }));
  await ok("POST", "/v1/me/mail", { token: bot.key, body: { replyTo: message.id, text: "Great, invoice attached." } });
  const reply = JSON.parse(net.find("POST", /api\.resend\.com\/emails$/).at(-1).body);
  assert.deepEqual(reply.to, ["buyer@example.com"]);
  assert.equal(reply.subject, "Re: Offer");
  assert.equal(reply.headers["In-Reply-To"], "<abc@example.com>");
});

test("live phone: a Twilio number with forge-proof webhooks for texts, calls and voicemail", async t => {
  const { local, net, ok, agent } = await setup(t, { AGENT_ID_LIVE: "phone", TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "twilio-token" });
  const alice = await local.user({ plan: "pro" });
  const bot = await agent(alice, "Receptionist");
  net.on("GET", /AvailablePhoneNumbers\/US\/Local\.json/, () => ({ available_phone_numbers: [{ phone_number: "+14155550100" }] }));
  net.on("POST", /IncomingPhoneNumbers\.json$/, () => ({ sid: "PN1", phone_number: "+14155550100", friendly_name: "(415) 555-0100" }));
  const phone = (await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "phone", mode: "live", options: { areaCode: "415" }, settings: { greeting: "Hi, this is Acme's assistant." } } })).resource;
  assert.equal(phone.address, "+14155550100");
  const [search] = net.find("GET", /AvailablePhoneNumbers/);
  assert.equal(search.headers.get("authorization"), "Basic " + Buffer.from("AC123:twilio-token").toString("base64"));
  assert.match(search.url, /AreaCode=415/);
  const bought = formOf(net.find("POST", /IncomingPhoneNumbers\.json$/)[0].body);
  const hook = new RegExp(`^http://127\\.0\\.0\\.1:54329/agent-id/webhooks/twilio/${phone.id}/([A-Za-z0-9_-]{32})/sms$`).exec(bought.SmsUrl);
  assert.ok(hook, bought.SmsUrl);
  const token = hook[1];
  assert.equal(bought.VoiceUrl, bought.SmsUrl.replace(/sms$/, "voice"));

  const twilioHook = (path, params) => local.call("POST", `/webhooks/twilio/${phone.id}/${path}`, { raw: new URLSearchParams(params).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal((await twilioHook(`${"x".repeat(32)}/sms`, { MessageSid: "SMin", From: "+46701234567", Body: "Forged" })).status, 404, "A forged webhook is refused.");
  const sms = await twilioHook(`${token}/sms`, { MessageSid: "SMin1", From: "+46701234567", To: phone.address, Body: "Is the shop open?" });
  assert.equal(sms.status, 200);
  assert.match(sms.headers.get("content-type"), /text\/xml/);
  await twilioHook(`${token}/sms`, { MessageSid: "SMin1", From: "+46701234567", Body: "Is the shop open?" });
  const texts = await ok("GET", "/v1/me/sms", { token: bot.key });
  assert.equal(texts.messages.length, 1, "Twilio's retries are recorded once.");
  assert.equal(texts.messages[0].text, "Is the shop open?");

  net.on("POST", /Messages\.json$/, () => ({ sid: "SMout1", status: "queued" }));
  await ok("POST", "/v1/me/sms", { token: bot.key, body: { to: "+46701234567", text: "Yes, until 6." } });
  const message = formOf(net.find("POST", /Messages\.json$/)[0].body);
  assert.deepEqual([message.From, message.To, message.Body], [phone.address, "+46701234567", "Yes, until 6."]);
  await twilioHook(`${token}/status`, { MessageSid: "SMout1", MessageStatus: "delivered" });
  assert.equal((await ok("GET", "/v1/me/sms?direction=out", { token: bot.key })).messages[0].status, "delivered");

  const voice = await twilioHook(`${token}/voice`, { CallSid: "CAin1", From: "+46701234567" });
  assert.match(voice.body, /<Say>Hi, this is Acme&apos;s assistant\.<\/Say><Record maxLength="120"/);
  assert.match(voice.body, new RegExp(`recordingStatusCallback="[^"]+/${phone.id}/${token}/recording"`));
  await twilioHook(`${token}/recording`, { CallSid: "CAin1", RecordingUrl: "https://api.twilio.com/rec/RE1", RecordingDuration: "14" });
  const calls = await ok("GET", "/v1/me/calls", { token: bot.key });
  assert.equal(calls.calls[0].status, "voicemail");
  assert.equal(calls.calls[0].data.recordingUrl, "https://api.twilio.com/rec/RE1");

  net.on("POST", /Calls\.json$/, () => ({ sid: "CAout1", status: "queued" }));
  await ok("POST", "/v1/me/calls", { token: bot.key, body: { to: "+46701234567", say: "Your order <b>shipped</b> & arrives Friday." } });
  assert.equal(formOf(net.find("POST", /Calls\.json$/)[0].body).Twiml, "<Response><Say>Your order &lt;b&gt;shipped&lt;/b&gt; &amp; arrives Friday.</Say></Response>", "The agent's words can't inject TwiML.");

  net.on("DELETE", /IncomingPhoneNumbers\/PN1\.json$/, () => new Response(null, { status: 204 }));
  await ok("DELETE", `/v1/agents/${bot.id}/resources/phone`, { token: alice.session });
  assert.equal(net.find("DELETE", /IncomingPhoneNumbers\/PN1/).length, 1, "The number goes back to Twilio.");
  assert.match((await twilioHook(`${token}/sms`, { MessageSid: "SMlate", From: "+46701234567", Body: "Hello?" })).body, /<Reject\/>/);
});

test("KYC with Stripe Identity: the verified name and country come from Stripe's signed answer", async t => {
  const { local, net, ok } = await setup(t, { AGENT_ID_KYC: "stripe_identity", STRIPE_SECRET_KEY: "sk_test_identity", AGENT_ID_STRIPE_WEBHOOK_SECRET: "whsec_stripe" });
  const alice = await local.user({ email: "ada@example.com" });
  net.on("POST", /\/v1\/identity\/verification_sessions$/, () => ({ id: "vs_1", url: "https://verify.stripe.com/start/vs_1" }));
  const started = await ok("POST", "/v1/account/verification", { token: alice.session, body: { kind: "person", consent: true } });
  assert.equal(started.url, "https://verify.stripe.com/start/vs_1");
  assert.equal(started.person.status, "pending");
  const sent = formOf(net.find("POST", /verification_sessions$/)[0].body);
  assert.equal(sent.type, "document");
  assert.equal(sent["options[document][require_matching_selfie]"], "true");
  assert.equal(sent["metadata[agent_id_user]"], alice.id);
  assert.equal(sent["provided_details[email]"], "ada@example.com");
  const stripeHook = (event, secret = "whsec_stripe") => {
    const body = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000);
    return local.call("POST", "/webhooks/stripe", { raw: body, headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${hmac(secret, `${timestamp}.${body}`, "hex")}` } });
  };
  const verified = { type: "identity.verification_session.verified", data: { object: { id: "vs_1", metadata: { agent_id_user: alice.id } } } };
  assert.equal((await stripeHook(verified, "whsec_wrong")).status, 400, "Unsigned events are refused.");
  net.on("GET", /verification_sessions\/vs_1\?expand\[\]=verified_outputs$/, () => ({ id: "vs_1", verified_outputs: { first_name: "Ada", last_name: "Lovelace", address: { country: "SE" } } }));
  assert.equal((await stripeHook(verified)).status, 200);
  const account = await ok("GET", "/v1/account", { token: alice.session });
  assert.deepEqual([account.person.status, account.person.legalName, account.person.country], ["verified", "Ada Lovelace", "SE"]);
  // An older session's events don't change the outcome.
  await stripeHook({ type: "identity.verification_session.requires_input", data: { object: { id: "vs_old", metadata: { agent_id_user: alice.id }, last_error: { code: "document_expired" } } } });
  assert.equal((await ok("GET", "/v1/account", { token: alice.session })).person.status, "verified");
});

test("live cards: Stripe Issuing cards to the verified owner, every payment decided by Agent ID", async t => {
  const { local, net, ok, agent, verify } = await setup(t, { AGENT_ID_LIVE: "card", STRIPE_SECRET_KEY: "sk_test_issuing", AGENT_ID_STRIPE_WEBHOOK_SECRET: "whsec_stripe" });
  const alice = await local.user({ plan: "pro", email: "ada@example.com" });
  const bot = await agent(alice, "Buyer");
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "card", mode: "live" } })).body.error.code, "verification_required");
  await verify(alice);
  assert.equal((await local.call("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "card", mode: "live" } })).body.error.code, "billing_required");
  net.on("POST", /\/v1\/issuing\/cardholders$/, () => ({ id: "ich_1" }));
  net.on("POST", /\/v1\/issuing\/cards$/, () => ({ id: "ic_1", last4: "1234", brand: "Visa", exp_month: 8, exp_year: 2029 }));
  const card = (await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "card", mode: "live", options: { billing: { line1: "Drottninggatan 1", city: "Stockholm", postal_code: "11151", country: "SE" } }, settings: { perTransaction: 3000 } } })).resource;
  assert.equal(card.label, "Visa •••• 1234");
  const holder = formOf(net.find("POST", /cardholders$/)[0].body);
  assert.deepEqual([holder.type, holder.name, holder["individual[first_name]"], holder["individual[last_name]"], holder["billing[address][country]"]], ["individual", "Ada Lovelace", "Ada", "Lovelace", "SE"]);
  const issued = formOf(net.find("POST", /issuing\/cards$/)[0].body);
  assert.equal(issued.type, "virtual");
  assert.equal(issued.cardholder, "ich_1");
  assert.equal(issued["spending_controls[spending_limits][0][amount]"], "3000");
  assert.equal(issued["spending_controls[spending_limits][0][interval]"], "per_authorization");
  assert.equal(issued["metadata[agent_id]"], bot.id);

  const stripeHook = event => {
    const body = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000);
    return local.call("POST", "/webhooks/stripe", { raw: body, headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${hmac("whsec_stripe", `${timestamp}.${body}`, "hex")}` } });
  };
  const authorize = (id, amount, extra = {}) => stripeHook({ type: "issuing_authorization.request", data: { object: { id, card: { id: "ic_1" }, pending_request: { amount, currency: "usd" }, merchant_data: { name: "Cloud Hosting Inc", category: "computer_network_services" }, ...extra } } });
  const approved = await authorize("iauth_1", 2500);
  assert.deepEqual(approved.body, { approved: true });
  assert.ok(approved.headers.get("stripe-version"), "The decision is Stripe's synchronous response.");
  assert.deepEqual((await authorize("iauth_2", 4000)).body, { approved: false }, "Over the per-payment limit.");
  assert.deepEqual((await stripeHook({ type: "issuing_authorization.request", data: { object: { id: "iauth_3", card: { id: "ic_unknown" }, pending_request: { amount: 1, currency: "usd" } } } })).body, { approved: false }, "Unknown cards decline.");
  await stripeHook({ type: "issuing_transaction.created", data: { object: { id: "ipi_1", card: "ic_1", authorization: "iauth_1", amount: -2500, currency: "usd", type: "capture" } } });
  const txs = await ok("GET", "/v1/me/card/transactions", { token: bot.key });
  assert.equal(txs.transactions.find(tx => tx.status === "approved").data.captured, 2500);
  assert.equal(txs.transactions.find(tx => tx.status === "declined").data.reason, "over_transaction_limit");

  net.on("GET", /issuing\/cards\/ic_1\?expand\[\]=number&expand\[\]=cvc$/, () => ({ number: "4000009990000001", cvc: "123", exp_month: 8, exp_year: 2029 }));
  const revealed = await ok("POST", "/v1/me/card/reveal", { token: bot.key });
  assert.deepEqual([revealed.card.number, revealed.card.name, revealed.card.test], ["4000009990000001", "Ada Lovelace", false]);
  net.on("POST", /issuing\/cards\/ic_1$/, () => ({ id: "ic_1" }));
  await ok("PATCH", `/v1/agents/${bot.id}/resources/card`, { token: alice.session, body: { status: "suspended", settings: { daily: 5000 } } });
  const update = formOf(net.find("POST", /issuing\/cards\/ic_1$/)[0].body);
  assert.equal(update.status, "inactive");
  assert.equal(update["spending_controls[spending_limits][1][interval]"], "daily");
  assert.deepEqual((await authorize("iauth_4", 100)).body, { approved: false }, "A frozen card declines even if Stripe asks.");
  await ok("DELETE", `/v1/agents/${bot.id}/resources/card`, { token: alice.session });
  assert.equal(formOf(net.find("POST", /issuing\/cards\/ic_1$/).at(-1).body).status, "canceled");
});

test("live wallets: Privy server wallets holding USDC and USDT, shown as US dollars", async t => {
  const { local, net, ok, agent, verify } = await setup(t, { AGENT_ID_LIVE: "wallet", PRIVY_APP_ID: "privy-app", PRIVY_APP_SECRET: "privy-secret" });
  const basic = "Basic " + Buffer.from("privy-app:privy-secret").toString("base64");
  const alice = await local.user();
  const bot = await agent(alice, "Treasurer");
  const address = "0x" + "ab".repeat(20);
  net.on("POST", /api\.privy\.io\/v1\/wallets$/, () => ({ id: "w_treasurer", address, chain_type: "ethereum" }));
  // Given before the owner is verified: it can receive, but nothing leaves it yet.
  const wallet = (await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "wallet", mode: "live", settings: { approvalAbove: null } } })).resource;
  const early = (await local.call("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to: "0x" + "12".repeat(20), value: "1" } })).body.error;
  assert.equal(early.code, "verification_required", "Money leaves a live wallet only once its owner is verified.");
  assert.match(early.message, /Your owner needs to verify/);
  await verify(alice);
  assert.deepEqual([wallet.address, wallet.provider, wallet.currency, wallet.details.chain], [address, "privy", "USD", "base"]);
  const [create] = net.find("POST", /v1\/wallets$/);
  assert.equal(create.headers.get("authorization"), basic);
  assert.equal(create.headers.get("privy-app-id"), "privy-app");
  assert.ok(create.headers.get("privy-idempotency-key"));
  assert.equal(JSON.parse(create.body).chain_type, "ethereum");

  net.on("GET", /wallets\/w_treasurer\/balance\?asset=usdc&asset=usdt&chain=base$/, () => ({ balances: [
    { chain: "base", asset: "usdc", raw_value: "123456789", raw_value_decimals: 6, display_values: { usd: "123.46" } },
    { chain: "base", asset: "usdt", raw_value: "5000000", raw_value_decimals: 6, display_values: { usd: "5" } },
  ] }));
  net.on("GET", /wallets\/w_treasurer\/transactions\?/, () => ({ transactions: [
    { caip2: "eip155:8453", transaction_hash: "0x" + "d".repeat(64), status: "confirmed", created_at: Date.now(), details: { type: "transfer_received", sender: "0x" + "99".repeat(20), recipient: address, asset: "usdc", raw_value: "100000000", raw_value_decimals: 6 } },
  ], next_cursor: null }));
  const shown = (await ok("GET", "/v1/me/wallet", { token: bot.key })).wallet;
  assert.equal(shown.balance.amount, 12845, "123.45 USDC and 5.00 USDT show as 128.45 USD.");
  assert.deepEqual(shown.assets.map(a => [a.asset, a.amount.amount]), [["USDC", 12345], ["USDT", 500]]);
  assert.equal(shown.network, "base");
  const deposits = (await ok("GET", "/v1/me/wallet/transactions", { token: bot.key })).transactions;
  assert.deepEqual(deposits.map(tx => [tx.direction, tx.amount.amount, tx.data.asset]), [["in", 10000, "USDC"]], "Money that arrived is in the history.");

  const to = "0x" + "12".repeat(20), hash = "0x" + "f".repeat(64);
  net.on("POST", /wallets\/w_treasurer\/transfer$/, () => ({ id: "act_1", status: "pending", type: "transfer" }));
  let polls = 0;
  net.on("GET", /wallets\/w_treasurer\/actions\/act_1\?include=steps$/, () => (++polls < 2 ? { id: "act_1", status: "pending" } : { id: "act_1", status: "succeeded", steps: [{ transaction_hash: hash }] }));
  const sent = await ok("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to, value: "12.34", memo: "API credits" } });
  assert.equal(sent.status, "completed");
  assert.equal(sent.transfer.data.explorer, `https://basescan.org/tx/${hash}`);
  const transfer = JSON.parse(net.find("POST", /\/transfer$/)[0].body);
  assert.deepEqual(transfer, { source: { asset: "usdc", chain: "base" }, destination: { address: to }, amount: "12.34" }, "Paid in USDC, which covers it, as a decimal amount.");
  assert.equal(net.find("POST", /\/transfer$/)[0].headers.get("privy-idempotency-key"), `agent-id-transfer-${sent.transfer.id}`);
  // USDT when asked for.
  net.on("POST", /wallets\/w_treasurer\/transfer$/, () => ({ id: "act_2", status: "pending" }));
  net.on("GET", /actions\/act_2\?include=steps$/, () => ({ id: "act_2", status: "pending" }));
  const slow = await ok("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to, value: "1", asset: "usdt" } });
  assert.equal(slow.status, "pending", "Still on its way after a few seconds: reported as pending.");
  assert.equal(JSON.parse(net.find("POST", /\/transfer$/).at(-1).body).source.asset, "usdt");
  // It finishes on a later look at the wallet.
  net.on("GET", /actions\/act_2\?include=steps$/, () => ({ id: "act_2", status: "failed", failure_reason: "Gas sponsorship is off" }));
  local.setClock(() => Date.now() + 60_000);
  const history = (await ok("GET", "/v1/me/wallet/transactions", { token: bot.key })).transactions;
  assert.equal(history.find(tx => tx.id === slow.transfer.id).status, "failed");
  assert.equal(history.find(tx => tx.id === slow.transfer.id).data.error, "Gas sponsorship is off");
  local.setClock(null);
  // Over the cap: refused before Privy is asked.
  const before = net.find("POST", /\/transfer$/).length;
  assert.equal((await local.call("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to, value: "60" } })).body.error.code, "over_limit");
  assert.equal(net.find("POST", /\/transfer$/).length, before);
  // A transfer that fails on chain fails for the agent too, and frees its share of the limit.
  assert.equal((await local.call("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to, value: "40" } })).body.error.code, "wallet_failed");
  net.on("POST", /wallets\/w_treasurer\/transfer$/, () => ({ id: "act_3", status: "succeeded" }));
  net.on("GET", /actions\/act_3\?include=steps$/, () => ({ id: "act_3", status: "succeeded", steps: [{ transaction_hash: "0x" + "e".repeat(64) }] }));
  assert.equal((await ok("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to, value: "40" } })).status, "completed", "USDC still covers 40.");
  // Neither stablecoin alone covers 130.
  await ok("PATCH", `/v1/agents/${bot.id}/resources/wallet`, { token: alice.session, body: { settings: { perTransfer: 50000, daily: 100000 } } });
  assert.equal((await local.call("POST", "/v1/me/wallet/transfers", { token: bot.key, body: { to, value: "130" } })).body.error.code, "insufficient");
  assert.equal((await local.call("DELETE", `/v1/agents/${bot.id}/resources/wallet`, { token: alice.session })).body.error.code, "wallet_not_empty");
  assert.ok(net.calls.every(call => !call.url.includes("privy") || call.headers.get("authorization") === basic), "Every Privy call authenticates as the app.");
});

test("live machines: Azure sandboxes started for each command and charged in credits", async t => {
  let state = "Creating";
  const azure = { AZURE_TENANT_ID: "tenant", AZURE_CLIENT_ID: "client", AZURE_CLIENT_SECRET: "secret", AZURE_SUBSCRIPTION_ID: "sub", AZURE_SANDBOX_RESOURCE_GROUP: "rg", AZURE_SANDBOX_GROUP: "agents" };
  // Credits from the first second here (the free hours are their own test).
  const { local, net, ok, agent } = await setup(t, { AGENT_ID_LIVE: "vm", AGENT_ID_FREE_COMPUTE_HOURS: "0", ...azure });
  net.on("POST", /login\.microsoftonline\.com\/tenant\/oauth2\/v2\.0\/token$/, () => ({ access_token: "azure-token", expires_in: 3600 }));
  net.on("PUT", /\/sandboxGroups\/agents\/sandboxes\?api-version=/, () => ({ id: "sbx-1", state }));
  net.on("GET", /\/sandboxes\/sbx-1\?api-version=/, () => ({ id: "sbx-1", state }));
  net.on("POST", /\/sandboxes\/sbx-1\/resume\?/, () => { state = "Running"; return {}; });
  net.on("POST", /\/sandboxes\/sbx-1\/stop\?/, () => { state = "Suspended"; return {}; });
  net.on("POST", /\/sandboxes\/sbx-1\/executeShellCommand\?/, () => ({ exitCode: 0, stdout: "Linux sbx-1\n", stderr: "" }));
  const alice = await local.user({ credits: 100 });
  const bot = await agent(alice, "Builder");
  const machine = (await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "vm", mode: "live", options: { size: "small" } } })).resource;
  assert.equal(machine.status, "provisioning");
  const created = JSON.parse(net.find("PUT", /sandboxes\?/)[0].body);
  assert.deepEqual(created.resources, { cpu: "500m", memory: "1024Mi" });
  assert.equal(created.lifecycle.autoSuspendPolicy.enabled, true, "Idle machines suspend themselves.");
  assert.equal(created.labels.agent, bot.id);
  assert.equal(formOf(net.find("POST", /oauth2/)[0].body).scope, "https://dynamicsessions.io/.default");
  assert.equal((await local.call("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "uname -a" } })).body.error.code, "machine_not_ready");
  state = "Suspended";
  assert.equal((await ok("GET", "/v1/me/vm", { token: bot.key })).machine.status, "active");
  const run = await ok("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "uname -a", cwd: "/root" } });
  assert.deepEqual([run.exitCode, run.stdout], [0, "Linux sbx-1\n"]);
  assert.deepEqual(JSON.parse(net.find("POST", /executeShellCommand/)[0].body), { command: "uname -a", workingDirectory: "/root" });
  assert.equal(state, "Suspended", "The machine stops after the command.");
  assert.equal(net.find("POST", /\/resume\?/)[0].headers.get("authorization"), "Bearer azure-token");
  const { rows: [reservation] } = await local.db.query("select status, model, cost, credits from test_reservations");
  assert.deepEqual([reservation.status, reservation.model], ["settled", "agent-id-vm"]);
  assert.ok(Number(reservation.cost) > 0 && Number(reservation.cost) * 20 <= Number(reservation.credits));
  const { rows: [balance] } = await local.db.query("select credits from test_credits where user_id=$1", [alice.id]);
  assert.ok(Math.abs(100 - Number(balance.credits) - Number(reservation.cost) * 20) < 1e-9, "Only the time used is charged, at 2.5 × cost.");
  const history = await ok("GET", "/v1/me/vm/commands", { token: bot.key });
  assert.equal(history.commands[0].subject, "uname -a");
  // Without credits nothing runs.
  await local.db.query("update test_credits set credits=0 where user_id=$1", [alice.id]);
  const before = net.find("POST", /executeShellCommand/).length;
  assert.equal((await local.call("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "ls" } })).body.error.code, "credits_required");
  assert.equal(net.find("POST", /executeShellCommand/).length, before);
  // One command at a time: a second while the first holds the machine waits its turn.
  await local.db.query("update test_credits set credits=100 where user_id=$1", [alice.id]);
  await local.db.query("update agent_id_resources set state = state || jsonb_build_object('lease','other','leaseUntil', now() + interval '1 minute') where kind='vm'");
  assert.equal((await local.call("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "ls" } })).body.error.code, "machine_busy");
  const { rows: released } = await local.db.query("select status from test_reservations where status='released'");
  assert.equal(released.length, 1, "A busy machine gives the credits back.");
  net.on("DELETE", /\/sandboxes\/sbx-1\?/, () => new Response(null, { status: 204 }));
  await ok("DELETE", `/v1/agents/${bot.id}/resources/vm`, { token: alice.session });
  assert.equal(net.find("DELETE", /sandboxes\/sbx-1/).length, 1);
});

test("free machine hours: an account's first hours are free, then machine time is paid in credits", async t => {
  let state = "Suspended";
  const azure = { AZURE_TENANT_ID: "tenant", AZURE_CLIENT_ID: "client", AZURE_CLIENT_SECRET: "secret", AZURE_SUBSCRIPTION_ID: "sub", AZURE_SANDBOX_RESOURCE_GROUP: "rg", AZURE_SANDBOX_GROUP: "agents" };
  const { local, net, ok, agent } = await setup(t, { AGENT_ID_LIVE: "vm", ...azure });
  net.on("POST", /login\.microsoftonline\.com\/tenant\/oauth2\/v2\.0\/token$/, () => ({ access_token: "azure-token", expires_in: 3600 }));
  net.on("PUT", /\/sandboxes\?api-version=/, () => ({ id: "sbx-1", state: "Suspended" }));
  net.on("GET", /\/sandboxes\/sbx-1\?api-version=/, () => ({ id: "sbx-1", state }));
  net.on("POST", /\/sandboxes\/sbx-1\/resume\?/, () => { state = "Running"; return {}; });
  net.on("POST", /\/sandboxes\/sbx-1\/stop\?/, () => { state = "Suspended"; return {}; });
  net.on("POST", /\/sandboxes\/sbx-1\/executeShellCommand\?/, () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }));
  const config = await ok("GET", "/v1/config");
  assert.equal(config.pricing.computeFreeHours, 5, "Five free hours by default.");
  assert.ok(config.pricing.computeCreditsPerHour > 0);
  assert.deepEqual(config.pricing.creditPacks[0], { credits: 180, priceUsd: 15 });
  const alice = await local.user({ credits: 0 });
  const bot = await agent(alice, "Builder");
  await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "vm", mode: "live" } });
  await ok("GET", "/v1/me/vm", { token: bot.key });
  // No credits at all, and the command still runs: it's free time.
  const run = await ok("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "echo ok" } });
  assert.equal(run.stdout, "ok\n");
  assert.equal((await local.db.query("select count(*)::int as n from test_reservations")).rows[0].n, 0, "Nothing reserved from credits.");
  const used = async () => (await local.db.query("select used_seconds from agent_id_compute_allowance where user_id=$1", [alice.id])).rows[0].used_seconds;
  const afterOne = await used();
  assert.ok(afterOne >= 1 && afterOne < 60, `Only the time used counts (${afterOne} s), not the most it could have taken.`);
  const account = await ok("GET", "/v1/account", { token: alice.session });
  assert.deepEqual(account.compute, { freeSeconds: 5 * 3600, usedSeconds: afterOne });
  const history = (await ok("GET", "/v1/me/vm/commands", { token: bot.key })).commands[0];
  assert.deepEqual([history.data.freeSeconds > 0, history.data.credits], [true, 0]);
  // The free hours used up: without credits nothing runs, and nothing is taken.
  await local.db.query("update agent_id_compute_allowance set used_seconds = $2 where user_id=$1", [alice.id, 5 * 3600]);
  const refused = await local.call("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "ls" } });
  assert.equal(refused.body.error.code, "credits_required");
  assert.match(refused.body.error.message, /5 free machine hours are used up/);
  assert.equal(await used(), 5 * 3600);
  // With credits, the time beyond the free hours is charged.
  await local.db.query("update test_credits set credits=100 where user_id=$1", [alice.id]);
  await ok("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "ls" } });
  const { rows: [reservation] } = await local.db.query("select status, cost from test_reservations");
  assert.equal(reservation.status, "settled");
  assert.ok(Number(reservation.cost) > 0);
  // The last free seconds go first, then credits; what isn't used goes back.
  await local.db.query("update agent_id_compute_allowance set used_seconds = $2 where user_id=$1", [alice.id, 5 * 3600 - 2]);
  await ok("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "ls" } });
  assert.ok(await used() <= 5 * 3600 && await used() >= 5 * 3600 - 2);
});
