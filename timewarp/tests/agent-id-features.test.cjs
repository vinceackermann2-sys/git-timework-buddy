"use strict";
// Agent ID's mailbox (folders, bin, search, attachments), where agents come
// from, card early access, missed calls, machine files and the operator's
// one-step webhook setup.
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
  const ok = async (method, url, init) => { const r = await local.call(method, url, init); assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const agent = async (owner, name, extra = {}) => { const c = await ok("POST", "/v1/agents", { token: owner.session, body: { name, ...extra } }); return { ...c.agent, key: c.secret }; };
  const upload = async (key, name, text, type = "text/plain") => (await (await local.handle(new Request("http://127.0.0.1:54329/agent-id/v1/me/files", { method: "POST", body: text, headers: { authorization: `Bearer ${key}`, "content-type": type, "x-filename": encodeURIComponent(name) } }))).json());
  return { local, net, ok, agent, upload };
}

test("a mailbox like Gmail: inbox, sent, bin, search, unread and attachments", async t => {
  const { local, ok, agent, upload } = await setup(t);
  const alice = await local.user();
  const a = await agent(alice, "Writer"), b = await agent(alice, "Reader");
  await ok("POST", `/v1/agents/${a.id}/resources`, { token: alice.session, body: { kind: "mail" } });
  const inbox = (await ok("POST", `/v1/agents/${b.id}/resources`, { token: alice.session, body: { kind: "mail" } })).resource;
  const file = (await upload(a.key, "notes.txt", "hello file")).file;
  assert.deepEqual([file.filename, file.contentType, file.size], ["notes.txt", "text/plain", 10]);
  await ok("POST", "/v1/me/mail", { token: a.key, body: { to: inbox.address, subject: "Quarterly numbers", text: "See the attachment.", attachments: [file.id] } });
  await ok("POST", "/v1/me/mail", { token: a.key, body: { to: inbox.address, subject: "Lunch", text: "Pizza at noon?" } });
  let list = await ok("GET", "/v1/me/mail", { token: b.key });
  assert.deepEqual(list.messages.map(m => m.subject), ["Lunch", "Quarterly numbers"]);
  assert.deepEqual(list.messages[1].attachments.map(f => f.filename), ["notes.txt"]);
  assert.deepEqual(await ok("GET", "/v1/me/mail/counts", { token: b.key }), { inbox: { total: 2, unread: 2 }, sent: { total: 0 }, trash: { total: 0 } });
  // The recipient downloads the attachment; nobody else can.
  const download = await local.handle(new Request(`http://127.0.0.1:54329/agent-id/v1/me/files/${list.messages[1].attachments[0].id}`, { headers: { authorization: `Bearer ${b.key}` } }));
  assert.equal(await download.text(), "hello file");
  const stranger = await agent(await local.user(), "Stranger");
  assert.equal((await local.handle(new Request(`http://127.0.0.1:54329/agent-id/v1/me/files/${list.messages[1].attachments[0].id}`, { headers: { authorization: `Bearer ${stranger.key}` } }))).status, 404);
  // Search, read, unread.
  assert.deepEqual((await ok("GET", "/v1/me/mail?q=pizza", { token: b.key })).messages.map(m => m.subject), ["Lunch"]);
  assert.deepEqual((await ok("GET", "/v1/me/mail?q=quarterly", { token: b.key })).messages.map(m => m.subject), ["Quarterly numbers"]);
  await ok("GET", `/v1/me/mail/${list.messages[0].id}`, { token: b.key });
  assert.equal((await ok("GET", "/v1/me/mail/counts", { token: b.key })).inbox.unread, 1);
  await ok("POST", `/v1/me/mail/${list.messages[0].id}/read`, { token: b.key, body: { read: false } });
  assert.equal((await ok("GET", "/v1/me/mail/counts", { token: b.key })).inbox.unread, 2);
  // The bin: move, restore, delete forever (only from the bin).
  const lunch = list.messages[0].id;
  assert.equal((await local.call("DELETE", `/v1/me/mail/${lunch}`, { token: b.key })).body.error.code, "not_in_trash");
  assert.equal((await ok("POST", `/v1/me/mail/${lunch}/move`, { token: b.key, body: { folder: "trash" } })).folder, "trash");
  assert.deepEqual((await ok("GET", "/v1/me/mail?folder=trash", { token: b.key })).messages.map(m => m.subject), ["Lunch"]);
  assert.equal((await ok("GET", "/v1/me/mail", { token: b.key })).messages.length, 1);
  assert.equal((await ok("POST", `/v1/me/mail/${lunch}/move`, { token: b.key, body: { folder: "inbox" } })).folder, "inbox", "Restored to where it was.");
  const quarterly = list.messages[1].id;
  await ok("POST", `/v1/me/mail/${quarterly}/move`, { token: b.key, body: { folder: "trash" } });
  await ok("DELETE", `/v1/me/mail/${quarterly}`, { token: b.key });
  assert.equal((await local.call("GET", `/v1/me/mail/${quarterly}`, { token: b.key })).status, 404);
  assert.equal(local.files.size, 1, "The sender's copy still uses the bytes, so they stay.");
  assert.deepEqual((await ok("GET", "/v1/me/mail?folder=sent", { token: a.key })).messages.map(m => m.attachments.length), [0, 1]);
  // Browsers may send the file name header (CORS preflight).
  const preflight = await local.handle(new Request("http://127.0.0.1:54329/agent-id/v1/me/files", { method: "OPTIONS" }));
  assert.match(preflight.headers.get("access-control-allow-headers"), /x-filename/);
  // Limits on files.
  const big = await local.handle(new Request("http://127.0.0.1:54329/agent-id/v1/me/files", { method: "POST", body: new Uint8Array(10 * 1024 * 1024 + 1), headers: { authorization: `Bearer ${a.key}`, "x-filename": "big.bin" } }));
  assert.equal(big.status, 413);
  assert.equal((await local.call("POST", "/v1/me/mail", { token: a.key, body: { to: inbox.address, subject: "x", text: "y", attachments: [crypto.randomUUID()] } })).status, 404, "Only the agent's own uploads can be attached.");
});

test("where an agent comes from: set by its owner, or told by the app it connects with", async t => {
  const { local, ok, agent } = await setup(t);
  const alice = await local.user();
  const coder = await agent(alice, "Coder", { origin: { app: "cursor", detail: "project ~/shop" } });
  assert.deepEqual(coder.origin, { app: "cursor", label: "Cursor", detail: "project ~/shop", client: null });
  const unknown = await agent(alice, "Helper");
  assert.equal(unknown.origin.app, "custom");
  await local.call("POST", "/mcp", { token: unknown.key, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.4.1" } } } });
  const seen = (await ok("GET", `/v1/agents/${unknown.id}`, { token: alice.session })).agent.origin;
  assert.deepEqual([seen.app, seen.label, seen.client.name, seen.client.version], ["claude-code", "Claude Code", "claude-code", "2.4.1"]);
  // An origin the owner set isn't overwritten; the client is still recorded.
  await local.call("POST", "/mcp", { token: coder.key, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "codex-mcp-client", version: "0.160.1" } } } });
  const kept = (await ok("GET", `/v1/agents/${coder.id}`, { token: alice.session })).agent.origin;
  assert.deepEqual([kept.app, kept.client.name], ["cursor", "codex-mcp-client"]);
  const renamed = await ok("PATCH", `/v1/agents/${coder.id}`, { token: alice.session, body: { origin: { app: "grok", detail: null } } });
  assert.deepEqual([renamed.agent.origin.app, renamed.agent.origin.label, renamed.agent.origin.detail], ["grok", "Grok", null]);
  assert.equal((await ok("PATCH", `/v1/agents/${coder.id}`, { token: alice.session, body: { origin: { app: "strawberry" } } })).agent.origin.label, "Strawberry");
  assert.equal((await local.call("PATCH", `/v1/agents/${coder.id}`, { token: alice.session, body: { origin: { app: "Not An App!" } } })).status, 400);
});

test("cards are an early-access application for now", async t => {
  const { local, ok, agent } = await setup(t);
  const alice = await local.user(), bob = await local.user();
  const buyer = await agent(alice, "Buyer");
  assert.equal((await ok("GET", "/v1/config", {})).resources.card.waitlist, true);
  assert.equal((await ok("GET", `/v1/agents/${buyer.id}/card-application`, { token: alice.session })).application, null);
  const applied = await ok("POST", `/v1/agents/${buyer.id}/card-application`, { token: alice.session, body: { useCase: "Buy API credits and domains", monthlySpend: 20000, country: "se" } });
  assert.deepEqual([applied.application.status, applied.application.monthlySpend.amount, applied.application.country], ["submitted", 20000, "SE"]);
  const again = await ok("POST", `/v1/agents/${buyer.id}/card-application`, { token: alice.session, body: { useCase: "Also software subscriptions" } });
  assert.equal(again.application.useCase, "Also software subscriptions", "Applying again updates the application.");
  assert.equal((await local.call("POST", `/v1/agents/${buyer.id}/card-application`, { token: bob.session, body: { useCase: "x" } })).status, 404);
});

test("an incoming call that ends without a voicemail is a missed call", async t => {
  const { local, net, ok, agent } = await setup(t, { AGENT_ID_LIVE: "phone", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok" });
  const alice = await local.user({ plan: "pro" });
  const bot = await agent(alice, "Receptionist");
  net.on("GET", /AvailablePhoneNumbers/, () => ({ available_phone_numbers: [{ phone_number: "+14155550100" }] }));
  net.on("POST", /IncomingPhoneNumbers\.json$/, () => ({ sid: "PN1", phone_number: "+14155550100" }));
  const phone = (await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "phone", mode: "live" } })).resource;
  const token = /\/([A-Za-z0-9_-]{32})\/sms$/.exec(new URLSearchParams(net.find("POST", /IncomingPhoneNumbers/)[0].body).get("SmsUrl"))[1];
  const hook = (event, params) => local.call("POST", `/webhooks/twilio/${phone.id}/${token}/${event}`, { raw: new URLSearchParams(params).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  await hook("voice", { CallSid: "CA1", From: "+46701111111" });
  await hook("status", { CallSid: "CA1", CallStatus: "completed", CallDuration: "4" });
  await hook("voice", { CallSid: "CA2", From: "+46702222222" });
  await hook("recording", { CallSid: "CA2", RecordingUrl: "https://api.twilio.com/rec/RE2", RecordingDuration: "9" });
  await hook("status", { CallSid: "CA2", CallStatus: "completed" });
  const calls = (await ok("GET", "/v1/me/calls", { token: bot.key })).calls;
  assert.deepEqual(calls.map(c => [c.counterparty, c.status]).sort(), [["+46701111111", "missed"], ["+46702222222", "voicemail"]]);
});

test("a live machine lists its files, which stay between commands", async t => {
  const azure = { AZURE_TENANT_ID: "t", AZURE_CLIENT_ID: "c", AZURE_CLIENT_SECRET: "s", AZURE_SUBSCRIPTION_ID: "sub", AZURE_SANDBOX_RESOURCE_GROUP: "rg", AZURE_SANDBOX_GROUP: "g" };
  const { local, net, ok, agent } = await setup(t, { AGENT_ID_LIVE: "vm", ...azure });
  let state = "Suspended";
  net.on("POST", /oauth2\/v2\.0\/token$/, () => ({ access_token: "tok", expires_in: 3600 }));
  net.on("PUT", /\/sandboxes\?api-version=/, () => ({ id: "sbx", state: "Running" }));
  net.on("GET", /\/sandboxes\/sbx\?api-version=/, () => ({ id: "sbx", state }));
  net.on("POST", /\/resume\?/, () => { state = "Running"; return {}; });
  net.on("POST", /\/stop\?/, () => { state = "Suspended"; return {}; });
  net.on("POST", /executeShellCommand/, () => ({ exitCode: 0, stdout: "/root\nd\t4096\t1760000000.0\tprojects\nf\t120\t1760000100.5\tnotes.md\n", stderr: "" }));
  const alice = await local.user({ credits: 50 });
  const bot = await agent(alice, "Builder");
  await ok("POST", `/v1/agents/${bot.id}/resources`, { token: alice.session, body: { kind: "vm", mode: "live" } });
  await ok("GET", "/v1/me/vm", { token: bot.key });
  const listed = await ok("GET", "/v1/me/vm/files?path=~", { token: bot.key });
  assert.equal(listed.path, "/root");
  assert.deepEqual(listed.entries.map(e => [e.type, e.name, e.size]), [["dir", "projects", 4096], ["file", "notes.md", 120]]);
  const command = JSON.parse(net.find("POST", /executeShellCommand/)[0].body).command;
  assert.match(command, /^p='~';/);
  assert.match(command, /find \. -mindepth 1 -maxdepth 1 -printf/);
  await ok("GET", `/v1/me/vm/files?path=${encodeURIComponent("/tmp/it's here")}`, { token: bot.key });
  assert.match(JSON.parse(net.find("POST", /executeShellCommand/)[1].body).command, /^p='\/tmp\/it'\\''s here';/, "Paths are quoted for the shell.");
  assert.equal((await ok("GET", "/v1/me/vm/commands", { token: bot.key })).commands.length, 0, "Listing files isn't a command in the history.");
  const { rows } = await local.db.query("select status from test_reservations");
  assert.ok(rows.length === 2 && rows.every(r => r.status === "settled"), "Each listing is paid like a command.");
});

test("operators register Stripe and Resend webhooks in one step", async t => {
  const { local, net, ok } = await setup(t, { AGENT_ID_LIVE: "mail", RESEND_API_KEY: "re_key", AGENT_ID_KYC: "stripe_identity", STRIPE_SECRET_KEY: "sk_live_key" });
  const operator = await local.user(), someone = await local.user();
  local.setEnv({ AGENT_ID_REVIEWERS: operator.id });
  assert.equal((await local.call("POST", "/v1/admin/setup", { token: someone.session })).status, 403);
  let status = await ok("GET", "/v1/admin/status", { token: operator.session });
  assert.deepEqual([status.webhooks.stripe.needed, status.webhooks.stripe.registered, status.webhooks.resend.registered], [true, false, false]);
  net.on("POST", /api\.stripe\.com\/v1\/webhook_endpoints$/, () => ({ id: "we_1", secret: "whsec_stripe_auto" }));
  net.on("POST", /api\.resend\.com\/webhooks$/, () => ({ object: "webhook", id: "wh_1", signing_secret: "whsec_" + Buffer.from("resend-secret-bytes").toString("base64") }));
  const setup1 = await ok("POST", "/v1/admin/setup", { token: operator.session });
  assert.deepEqual(setup1.setup, { stripe: "registered", resend: "registered" });
  const stripeForm = new URLSearchParams(net.find("POST", /webhook_endpoints$/)[0].body);
  assert.equal(stripeForm.get("url"), "http://127.0.0.1:54329/agent-id/webhooks/stripe");
  assert.deepEqual(stripeForm.getAll("enabled_events[]"), ["identity.verification_session.verified", "identity.verification_session.requires_input", "identity.verification_session.canceled"]);
  assert.deepEqual(JSON.parse(net.find("POST", /resend\.com\/webhooks$/)[0].body).events.includes("email.received"), true);
  // Running it again keeps what works.
  net.on("GET", /webhook_endpoints\/we_1$/, () => ({ id: "we_1", status: "enabled", enabled_events: ["identity.verification_session.verified", "identity.verification_session.requires_input", "identity.verification_session.canceled"] }));
  assert.deepEqual((await ok("POST", "/v1/admin/setup", { token: operator.session })).setup, { stripe: "kept", resend: "kept" });
  // The stored secret now checks Stripe's events.
  const body = JSON.stringify({ type: "identity.verification_session.canceled", data: { object: { id: "vs_x", metadata: { agent_id_user: someone.id } } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = await local.call("POST", "/webhooks/stripe", { raw: body, headers: { "stripe-signature": `t=${timestamp},v1=${crypto.createHmac("sha256", "whsec_stripe_auto").update(`${timestamp}.${body}`).digest("hex")}` } });
  assert.equal(signed.status, 200);
  status = await ok("GET", "/v1/admin/status", { token: operator.session });
  assert.deepEqual([status.webhooks.stripe.registered, status.webhooks.resend.registered], [true, true]);
});
