"use strict";
// A new Agent ID comes ready to use: its mail and wallet at once, and on paid
// plans its phone number and machine too. Anything that can't be given right
// now is skipped with a reason and never stops the agent being made.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startLocal } = require("../scripts/agent-id-local.cjs");

function network() {
  const routes = [], calls = [];
  const fetch = async (url, init = {}) => {
    const href = String(url), method = init.method || "GET";
    calls.push({ url: href, method, body: typeof init.body === "string" ? init.body : "" });
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(href)) { const r = await handler(new URL(href)); return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } }); }
    throw new Error(`Unexpected provider request: ${method} ${href}`);
  };
  return { fetch, calls, on: (method, pattern, handler) => routes.unshift([method, pattern, handler]) };
}

const AUTO = { AGENT_ID_AUTO_GIVE: "mail,wallet", AGENT_ID_AUTO_GIVE_PAID: "phone,vm" };
async function setup(t, env = {}) {
  const net = network();
  const local = await startLocal({ fetch: net.fetch, env: { ...AUTO, ...env } });
  t.after(() => local.close());
  const config = async () => (await local.call("GET", "/v1/config")).body;
  const makeUser = local.user.bind(local);
  local.user = async (options = {}) => {
    const user = await makeUser(options);
    await local.call("POST", "/v1/account/terms", { token: user.session, body: { version: (await config()).legal.termsVersion } });
    return user;
  };
  const ok = async (method, url, init) => { const r = await local.call(method, url, init); assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const resources = async (owner, id) => { await local.settle(); return (await ok("GET", `/v1/agents/${id}`, { token: owner.session })).agent.resources; };
  return { local, net, ok, resources };
}

test("a new Agent ID has its mail and wallet at once; a paid plan adds its number and machine", async t => {
  const { local, ok, resources } = await setup(t);
  const free = await local.user();
  const made = await ok("POST", "/v1/agents", { token: free.session, body: { name: "Helper" } });
  assert.deepEqual(made.setup, { given: ["mail", "wallet"], skipped: [] });
  const mine = await resources(free, made.agent.id);
  assert.deepEqual(Object.keys(mine).sort(), ["mail", "wallet"]);
  assert.ok(Object.values(mine).every(r => r.status === "active"));
  assert.match(mine.mail.address, /^helper-[a-z0-9]{4}@/);
  // The agent can use them straight away with its key.
  assert.equal((await ok("GET", "/v1/me/wallet", { token: made.secret })).wallet.balance.amount, 0);
  assert.equal((await ok("GET", "/v1/me/mail", { token: made.secret })).messages.length, 0);

  const pro = await local.user({ plan: "pro" });
  const paid = await ok("POST", "/v1/agents", { token: pro.session, body: { name: "Closer" } });
  assert.deepEqual(paid.setup.given, ["mail", "wallet", "phone", "vm"]);
  const theirs = await resources(pro, paid.agent.id);
  assert.deepEqual(Object.keys(theirs).sort(), ["mail", "phone", "vm", "wallet"]);
  assert.match(theirs.phone.address, /^\+1/);

  // Asked for exactly: some, or none.
  const bare = await ok("POST", "/v1/agents", { token: pro.session, body: { name: "Bare", resources: [] } });
  assert.deepEqual(bare.setup, { given: [], skipped: [] });
  assert.deepEqual(await resources(pro, bare.agent.id), {});
  const picked = await ok("POST", "/v1/agents", { token: free.session, body: { name: "Picked", resources: ["vm"] } });
  assert.deepEqual(Object.keys(await resources(free, picked.agent.id)), ["vm"]);
  const before = (await ok("GET", "/v1/agents", { token: free.session })).agents.length;
  assert.equal((await local.call("POST", "/v1/agents", { token: free.session, body: { name: "Wrong", resources: ["fax"] } })).status, 400);
  assert.equal((await ok("GET", "/v1/agents", { token: free.session })).agents.length, before, "A bad list makes no agent.");
  // Adding one by hand still works, and says it's already there.
  assert.equal((await local.call("POST", `/v1/agents/${made.agent.id}/resources`, { token: free.session, body: { kind: "mail" } })).body.error.code, "already_has");
});

test("in production, what can't be given yet is skipped with a reason; a provider failure frees the slot to add later", async t => {
  const { local, net, ok, resources } = await setup(t, { AGENT_ID_ALLOW_TEST: "false", AGENT_ID_LIVE: "mail,wallet", RESEND_API_KEY: "re_live", PRIVY_APP_ID: "privy-app", PRIVY_APP_SECRET: "privy-secret" });
  const pro = await local.user({ plan: "pro" });
  const made = await ok("POST", "/v1/agents", { token: pro.session, body: { name: "Scout" } });
  assert.deepEqual(made.setup.given, ["mail"]);
  assert.deepEqual(made.setup.skipped.map(s => [s.kind, s.code]), [["wallet", "verification_required"], ["phone", "waitlist"], ["vm", "live_unavailable"]], "Phone numbers are an application until live numbers open.");
  assert.equal(Object.keys(await resources(pro, made.agent.id)).join(), "mail");

  // Verified: the wallet comes too, unless Privy fails, which leaves the agent and a free slot.
  const reviewer = await local.user();
  local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
  await ok("POST", "/v1/account/verification", { token: pro.session, body: { kind: "person", consent: true, legalName: "Ada Lovelace", country: "SE" } });
  await ok("POST", `/v1/reviews/person/${pro.id}`, { token: reviewer.session, body: { decision: "approve" } });
  net.on("POST", /api\.privy\.io\/v1\/wallets$/, () => new Response(JSON.stringify({ message: "Privy is down" }), { status: 500 }));
  const second = await ok("POST", "/v1/agents", { token: pro.session, body: { name: "Buyer" } });
  assert.deepEqual(second.setup.given, ["mail", "wallet"]);
  assert.deepEqual(Object.keys(await resources(pro, second.agent.id)), ["mail"]);
  const log = (await ok("GET", `/v1/audit?agent=${second.agent.id}`, { token: pro.session })).entries.map(e => [e.action, e.detail.kind]);
  assert.ok(log.some(([action, kind]) => action === "resource.auto_failed" && kind === "wallet"));
  // Added later, once Privy answers.
  net.on("POST", /api\.privy\.io\/v1\/wallets$/, () => ({ id: "w_later", address: "0x" + "ab".repeat(20) }));
  assert.equal((await ok("POST", `/v1/agents/${second.agent.id}/resources`, { token: pro.session, body: { kind: "wallet" } })).resource.status, "active");
});

test("an Agent ID claimed by link comes ready too, and the page and the CLI see what it has", async t => {
  const { local, ok } = await setup(t, { AGENT_ID_KYC: "test" });
  const started = await ok("POST", "/v1/claims", { body: { name: "Concierge", app: "claude-code" } });
  const code = started.claim.code;
  const sent = await ok("POST", `/v1/claims/${code}/email`, { body: { email: "kim@example.com" } });
  const confirmed = await ok("POST", `/v1/claims/${code}/email/confirm`, { body: { code: sent.devCode } });
  const terms = (await ok("GET", "/v1/config")).legal.termsVersion;
  await ok("POST", `/v1/claims/${code}/identity`, { headers: { "timewarp-claim-session": confirmed.session }, body: { terms, consent: true, legalName: "Kim Lee", country: "SE" } });
  await local.settle();
  const claim = (await ok("GET", `/v1/claims/${code}`, { headers: { "timewarp-claim-session": confirmed.session } })).claim;
  assert.deepEqual(Object.keys(claim.agent.resources).sort(), ["mail", "wallet"]);
  assert.match(claim.agent.resources.mail.address, /^concierge-[a-z0-9]{4}@/);
  const collected = await ok("POST", "/v1/claims/collect", { body: { secret: started.secret } });
  assert.equal(collected.agent.resources.mail.address, claim.agent.resources.mail.address);
  assert.equal((await ok("GET", "/v1/me/wallet", { token: collected.key })).wallet.balance.amount, 0);
});

test("phone numbers are an application until live numbers open; then they're given as usual", async t => {
  const { local, net, ok } = await setup(t, { AGENT_ID_ALLOW_TEST: "false", AGENT_ID_LIVE: "mail", RESEND_API_KEY: "re_live" });
  assert.equal((await ok("GET", "/v1/config")).resources.phone.waitlist, true);
  const pro = await local.user({ plan: "pro" });
  const made = await ok("POST", "/v1/agents", { token: pro.session, body: { name: "Caller", resources: ["mail"] } });
  const id = made.agent.id;
  assert.equal((await local.call("POST", `/v1/agents/${id}/resources`, { token: pro.session, body: { kind: "phone" } })).body.error.code, "waitlist");
  assert.equal((await ok("GET", `/v1/agents/${id}/phone-application`, { token: pro.session })).application, null);
  assert.equal((await local.call("POST", `/v1/agents/${id}/phone-application`, { token: pro.session, body: { useCase: "Book tables", uses: ["fax"] } })).status, 400);
  assert.equal((await local.call("POST", `/v1/agents/${id}/phone-application`, { token: pro.session, body: { uses: ["sms"] } })).status, 400, "It says what the number is for.");
  const applied = (await ok("POST", `/v1/agents/${id}/phone-application`, { token: pro.session, body: { useCase: "Book restaurant tables by phone", uses: ["calls"], country: "se" } })).application;
  assert.deepEqual([applied.status, applied.useCase, applied.uses, applied.country], ["submitted", "Book restaurant tables by phone", ["calls"], "SE"]);
  assert.deepEqual((await ok("GET", `/v1/agents/${id}/phone-application`, { token: pro.session })).application.uses, ["calls"]);
  const stranger = await local.user();
  assert.equal((await local.call("GET", `/v1/agents/${id}/phone-application`, { token: stranger.session })).status, 404, "Only its owner sees it.");
  assert.ok((await ok("GET", `/v1/audit?agent=${id}`, { token: pro.session })).entries.some(e => e.action === "phone.apply"));

  // Once live numbers are switched on and set up, the agent gets one.
  local.setEnv({ AGENT_ID_LIVE: "mail,phone", TELNYX_API_KEY: "KEY", TELNYX_PUBLIC_KEY: Buffer.alloc(32).toString("base64") });
  assert.equal((await ok("GET", "/v1/config")).resources.phone.waitlist, undefined);
  net.on("POST", /messaging_profiles$/, () => ({ data: { id: "mp" } }));
  net.on("POST", /outbound_voice_profiles$/, () => ({ data: { id: "ovp" } }));
  net.on("POST", /texml_applications$/, () => ({ data: { id: "app" } }));
  net.on("GET", /available_phone_numbers/, () => ({ data: [{ phone_number: "+14155550199" }] }));
  net.on("POST", /number_orders$/, () => ({ data: { id: "ord", phone_numbers: [{ phone_number: "+14155550199" }] } }));
  assert.equal((await ok("POST", `/v1/agents/${id}/resources`, { token: pro.session, body: { kind: "phone" } })).resource.address, "+14155550199");
  // AGENT_ID_PHONES=waitlist keeps the application even then.
  local.setEnv({ AGENT_ID_PHONES: "waitlist" });
  assert.equal((await ok("GET", "/v1/config")).resources.phone.waitlist, true);
});
