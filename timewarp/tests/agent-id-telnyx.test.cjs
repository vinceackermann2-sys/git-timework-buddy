"use strict";
// Live phone numbers through Telnyx, against a scripted Telnyx API: the
// account's texting and calling set up once, numbers bought and released,
// texts and calls both ways, and Ed25519-signed webhooks that can't be forged.
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

// The account's webhook signing key pair; Agent ID gets the public half.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const sign = (body, timestamp = Math.floor(Date.now() / 1000), key = privateKey) => ({ "telnyx-timestamp": String(timestamp), "telnyx-signature-ed25519": crypto.sign(null, Buffer.from(`${timestamp}|${body}`), key).toString("base64") });

async function setup(t, env = {}) {
  const net = network();
  const local = await startLocal({ fetch: net.fetch, env: { AGENT_ID_LIVE: "phone", TELNYX_API_KEY: "KEY_telnyx", TELNYX_PUBLIC_KEY: PUBLIC_KEY, ...env } });
  t.after(() => local.close());
  const makeUser = local.user.bind(local);
  local.user = async (options = {}) => {
    const user = await makeUser(options);
    const config = (await local.call("GET", "/v1/config")).body;
    await local.call("POST", "/v1/account/terms", { token: user.session, body: { version: config.legal.termsVersion } });
    return user;
  };
  const ok = async (method, url, init) => { const r = await local.call(method, url, init); assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const agent = async (owner, name) => { const c = await ok("POST", "/v1/agents", { token: owner.session, body: { name } }); return { ...c.agent, key: c.secret }; };
  // Telnyx's side of the account.
  net.on("POST", /api\.telnyx\.com\/v2\/messaging_profiles$/, () => ({ data: { id: "mp_1" } }));
  net.on("POST", /api\.telnyx\.com\/v2\/outbound_voice_profiles$/, () => ({ data: { id: "ovp_1" } }));
  net.on("POST", /api\.telnyx\.com\/v2\/texml_applications$/, () => ({ data: { id: "texml_1" } }));
  let numbers = ["+14155550100", "+14155550111"];
  net.on("GET", /api\.telnyx\.com\/v2\/available_phone_numbers\?/, () => ({ data: [{ phone_number: numbers[0] }] }));
  net.on("POST", /api\.telnyx\.com\/v2\/number_orders$/, (_url, call) => { const number = JSON.parse(call.body).phone_numbers[0].phone_number; numbers = numbers.slice(1); return { data: { id: `order_${number.slice(-4)}`, status: "pending", phone_numbers: [{ id: "onum_1", phone_number: number, status: "pending" }] } }; });
  const hook = (event, body, headers = sign(body)) => local.call("POST", `/webhooks/telnyx/${event}`, { raw: body, headers: { "content-type": event === "messaging" ? "application/json" : "application/x-www-form-urlencoded", ...headers } });
  return { local, net, ok, agent, hook };
}

test("live phone through Telnyx: a number with texts and calls both ways, voicemail and missed calls", async t => {
  const { local, net, ok, agent, hook } = await setup(t);
  const alice = await local.user({ plan: "pro" });
  const bot = await agent(alice, "Receptionist");
  const phone = (await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "phone", mode: "live", options: { areaCode: "415" }, settings: { greeting: "Hi, this is Acme's assistant." } } })).resource;
  assert.deepEqual([phone.address, phone.provider], ["+14155550100", "telnyx"]);
  // The account was set up for Agent ID: texts and calls report to its webhooks.
  const [profile] = net.find("POST", /messaging_profiles$/);
  assert.equal(profile.headers.get("authorization"), "Bearer KEY_telnyx");
  assert.deepEqual(JSON.parse(profile.body), { name: "Timewarp Agent ID", enabled: true, whitelisted_destinations: ["US", "CA"], webhook_url: "http://127.0.0.1:54329/agent-id/webhooks/telnyx/messaging", webhook_api_version: "2" });
  const app = JSON.parse(net.find("POST", /texml_applications$/)[0].body);
  assert.deepEqual([app.voice_url, app.status_callback, app.outbound.outbound_voice_profile_id], ["http://127.0.0.1:54329/agent-id/webhooks/telnyx/voice", "http://127.0.0.1:54329/agent-id/webhooks/telnyx/status", "ovp_1"]);
  const search = net.find("GET", /available_phone_numbers/)[0].url;
  for (const part of ["filter%5Bcountry_code%5D=US", "filter%5Bfeatures%5D%5B%5D=sms", "filter%5Bfeatures%5D%5B%5D=voice", "filter%5Bnational_destination_code%5D=415"]) assert.ok(search.includes(part), search);
  assert.deepEqual(JSON.parse(net.find("POST", /number_orders$/)[0].body), { phone_numbers: [{ phone_number: "+14155550100" }], connection_id: "texml_1", messaging_profile_id: "mp_1", customer_reference: bot.id });

  // Incoming text, signed; forged and stale ones are refused.
  const inbound = JSON.stringify({ data: { event_type: "message.received", id: "evt1", payload: { id: "msg_in_1", from: { phone_number: "+46701234567" }, to: [{ phone_number: phone.address }], text: "Is the shop open?" } } });
  assert.equal((await hook("messaging", inbound, { "telnyx-timestamp": String(Math.floor(Date.now() / 1000)), "telnyx-signature-ed25519": Buffer.alloc(64).toString("base64") })).status, 401, "A forged signature is refused.");
  assert.equal((await hook("messaging", inbound, sign(inbound, Math.floor(Date.now() / 1000) - 600))).status, 401, "A replayed old webhook is refused.");
  const other = crypto.generateKeyPairSync("ed25519").privateKey;
  assert.equal((await hook("messaging", inbound, sign(inbound, undefined, other))).status, 401, "Another account's signature is refused.");
  assert.equal((await hook("messaging", inbound)).status, 200);
  await hook("messaging", inbound);
  const texts = await ok("GET", "/v1/me/sms", { token: bot.key });
  assert.equal(texts.messages.length, 1, "Retries are recorded once.");
  assert.deepEqual([texts.messages[0].text, texts.messages[0].counterparty], ["Is the shop open?", "+46701234567"]);

  // Real texts and calls wait for the owner unless they say otherwise.
  assert.equal((await ok("POST", "/v1/me/sms", { token: bot.key, body: { to: "+46701234567", text: "Yes, until 6." } })).status, "needs_approval");
  await ok("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { askFirst: { sms: false, call: false } } });

  // Outgoing text and its delivery report.
  net.on("POST", /api\.telnyx\.com\/v2\/messages$/, () => ({ data: { id: "msg_out_1", to: [{ phone_number: "+46701234567", status: "queued" }] } }));
  await ok("POST", "/v1/me/sms", { token: bot.key, body: { to: "+46701234567", text: "Yes, until 6." } });
  assert.deepEqual(JSON.parse(net.find("POST", /\/v2\/messages$/)[0].body), { from: phone.address, to: "+46701234567", text: "Yes, until 6.", messaging_profile_id: "mp_1" });
  const finalized = JSON.stringify({ data: { event_type: "message.finalized", payload: { id: "msg_out_1", to: [{ phone_number: "+46701234567", status: "delivered" }] } } });
  await hook("messaging", finalized);
  assert.equal((await ok("GET", "/v1/me/sms?direction=out", { token: bot.key })).messages[0].status, "delivered");
  assert.equal(net.find("POST", /messaging_profiles$/).length, 1, "The account is set up once.");

  // Incoming call: the greeting, then a voicemail.
  const voice = await hook("voice", new URLSearchParams({ CallSid: "v3:in1", From: "+46701234567", To: phone.address, CallStatus: "ringing" }).toString());
  assert.equal(voice.status, 200);
  assert.match(voice.body, /<Say>Hi, this is Acme&apos;s assistant\.<\/Say><Record maxLength="120"/);
  assert.match(voice.body, /recordingStatusCallback="http:\/\/127\.0\.0\.1:54329\/agent-id\/webhooks\/telnyx\/recording"/);
  await hook("recording", new URLSearchParams({ CallSid: "v3:in1", RecordingUrl: "https://api.telnyx.com/rec/1.mp3", RecordingDuration: "14", RecordingStatus: "completed" }).toString());
  await hook("status", new URLSearchParams({ CallSid: "v3:in1", CallStatus: "completed", CallDuration: "20" }).toString());
  let calls = (await ok("GET", "/v1/me/calls", { token: bot.key })).calls;
  assert.deepEqual([calls[0].status, calls[0].data.recordingUrl], ["voicemail", "https://api.telnyx.com/rec/1.mp3"]);
  // One that hangs up without a message is missed.
  await hook("voice", new URLSearchParams({ CallSid: "v3:in2", From: "+46709999999", To: phone.address }).toString());
  await hook("status", new URLSearchParams({ CallSid: "v3:in2", CallStatus: "no-answer" }).toString());
  calls = (await ok("GET", "/v1/me/calls", { token: bot.key })).calls;
  assert.equal(calls.find(c => c.counterparty === "+46709999999").status, "missed");
  // A call to a number Agent ID doesn't have is turned away.
  assert.match((await hook("voice", new URLSearchParams({ CallSid: "v3:x", From: "+1", To: "+19999999999" }).toString())).body, /<Reject\/>/);

  // Outgoing call that speaks the agent's words, which can't inject markup.
  net.on("POST", /api\.telnyx\.com\/v2\/texml\/calls\/texml_1$/, () => ({ call_sid: "v3:out1", from: phone.address, to: "+46701234567", status: "queued" }));
  await ok("POST", "/v1/me/calls", { token: bot.key, body: { to: "+46701234567", say: "Your order <b>shipped</b> & arrives Friday." } });
  const placed = JSON.parse(net.find("POST", /texml\/calls\/texml_1$/)[0].body);
  assert.deepEqual([placed.From, placed.To], [phone.address, "+46701234567"]);
  assert.match(placed.Texml, /<Say>Your order &lt;b&gt;shipped&lt;\/b&gt; &amp; arrives Friday\.<\/Say>/);
  await hook("status", new URLSearchParams({ CallSid: "v3:out1", CallStatus: "completed", CallDuration: "9" }).toString());
  assert.equal((await ok("GET", "/v1/me/calls?direction=out", { token: bot.key })).calls[0].status, "completed");

  // Removing it gives the number back to Telnyx.
  net.on("GET", /api\.telnyx\.com\/v2\/phone_numbers\?/, url => ({ data: url.searchParams.get("filter[phone_number]") === "14155550100" ? [{ id: "pn_42", phone_number: "+14155550100" }] : [] }));
  net.on("DELETE", /api\.telnyx\.com\/v2\/phone_numbers\/pn_42$/, () => ({ data: { id: "pn_42" } }));
  await ok("DELETE", `/v1/agents/${bot.id}/resources/phone`, { token: alice.session });
  assert.equal(net.find("DELETE", /phone_numbers\/pn_42$/).length, 1);
  assert.match((await hook("voice", new URLSearchParams({ CallSid: "v3:late", From: "+46701234567", To: phone.address }).toString())).body, /<Reject\/>/, "A released number takes no calls.");
});

test("Telnyx is used when its key is set; it needs its public key, and Twilio can still be chosen", async t => {
  const { local, ok, agent } = await setup(t, { TELNYX_PUBLIC_KEY: "" });
  const config = (await local.call("GET", "/v1/config")).body;
  assert.deepEqual([config.resources.phone.live, config.resources.phone.unavailable], [false, "not_configured"], "Without the public key webhooks couldn't be checked, so phones stay off.");
  local.setEnv({ TELNYX_PUBLIC_KEY: PUBLIC_KEY });
  assert.equal((await local.call("GET", "/v1/config")).body.resources.phone.provider, "telnyx");
  local.setEnv({ AGENT_ID_PHONE_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok" });
  assert.equal((await local.call("GET", "/v1/config")).body.resources.phone.provider, "twilio");
  const alice = await local.user({ plan: "pro" });
  const bot = await agent(alice, "Caller");
  assert.equal((await local.call("POST", "/webhooks/telnyx/messaging", { raw: "{}", headers: { "content-type": "application/json" } })).status, 401, "Unsigned Telnyx webhooks are refused whichever provider is chosen.");
  void bot; void ok;
});
