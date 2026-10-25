"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentIds, agentIdApi } = require("../app/main/agent-id.cjs");

const CONFIG = { resources: {
  mail: { live: true }, wallet: { live: true, verificationRequired: true }, card: { live: false, waitlist: true },
  vm: { live: true }, phone: { live: false, waitlist: true },
}, verification: { person: "stripe_identity" } };

// Agent ID as its API answers an account, with what each call was.
function fakeAgentId({ termsAccepted = false, user = () => "user-1" } = {}) {
  const calls = [], identities = [];
  let down = null, nextId = 1, person = { status: "unverified" };
  const request = async (method, route, { body, query, agent } = {}) => {
    calls.push({ method, route, body, query, agent });
    if (down) throw Object.assign(new Error("Agent ID could not be reached."), { status: down });
    if (method === "GET" && route === "/v1/agents") return { agents: identities.filter(item => item.ownerId === user() && item.status !== "revoked").map(({ ownerId, ...item }) => item) };
    if (method === "GET" && route === "/v1/account") return { person, config: CONFIG, terms: { accepted: termsAccepted, current: "2026-10-20" } };
    if (method === "POST" && route === "/v1/account/terms") { termsAccepted = body.version === "2026-10-20"; return { terms: { accepted: termsAccepted } }; }
    if (method === "POST" && route === "/v1/account/verification") { person = { status: "pending" }; return { person, ...(body.legalName ? {} : { url: "https://verify.stripe.com/start/test" }) }; }
    if (method === "POST" && route === "/v1/agents") {
      if (!termsAccepted) throw Object.assign(new Error("Accept the Agent ID Terms first."), { status: 403 });
      const { ownerId, ...item } = { id: `agt_${nextId++}`, ownerId: user(), handle: "orbit-1", name: body.name, status: "active", desktopAgentId: body.desktopAgentId,
        resources: { mail: { kind: "mail", status: "active", mode: "live", address: "orbit-1@agents.timewarpdev.com", settings: { secret: "x" }, details: { provider: "state" } } } };
      identities.push({ ownerId, ...item });
      return { agent: item, key: { id: `key-${item.id}` }, secret: `twa_secret_${item.id}` };
    }
    if (method === "DELETE") return { revoked: true };
    if (method === "POST" && /^\/v1\/agents\/[^/]+\/keys$/.test(route)) return { key: { id: "key-here" }, secret: "twa_secret_here" };
    if (route === "/v1/me/mail/counts") return { inbox: { total: 2, unread: 1 } };
    if (route === "/v1/me/mail") return method === "GET" ? { messages: [], more: false } : { message: { id: "m1" } };
    if (/^\/v1\/agents\/[^/]+\/(card|phone)-application$/.test(route)) return { application: null };
    if (/^\/v1\/agents\/[^/]+\/resources$/.test(route)) return { resource: { kind: body.kind } };
    throw Object.assign(new Error("Not found."), { status: 404 });
  };
  return { request, calls, identities, setDown: status => { down = status; } };
}

// A protectedStore whose saved value can be read back, with OS encryption on or off.
function memoryStorage() {
  let value = null, failSave = false;
  return { load: () => value, save: next => { if (failSave) throw new Error("OS credential encryption is unavailable."); value = JSON.parse(JSON.stringify(next)); }, get value() { return value; }, failSaves: () => { failSave = true; } };
}

function setup({ termsAccepted, encryption = true } = {}) {
  let user = "user-1";
  const api = fakeAgentId({ termsAccepted, user: () => user }), storage = memoryStorage(), opened = [];
  const local = { "agent-1": { id: "agent-1", name: "Orbit" }, "agent-2": { id: "agent-2", name: "Nova" } };
  const agents = { get: id => { if (!local[id]) throw Object.assign(new Error("This agent is unavailable for this account."), { status: 404 }); return local[id]; } };
  const ids = createAgentIds({ request: api.request, storage, encryption: { isEncryptionAvailable: () => encryption }, agents, userId: () => user, hostname: () => "desk", openPage: async url => { opened.push(url); return { opened: true }; } });
  return { api, storage, ids, opened, switchUser: id => { user = id; } };
}

test("an agent without an Agent ID gets one, linked to it, with its key kept encrypted and never shown", async () => {
  const { api, storage, ids } = setup();
  const before = await ids.get("agent-1");
  assert.equal(before.linked, false);
  assert.equal(before.owner.status, "unverified");
  const made = await ids.create("agent-1");
  assert.equal(made.linked, true);
  assert.equal(made.id, "agt_1");
  assert.equal(made.keyStored, true);
  assert.equal(made.url, "https://timewarpdev.com/agent-id/agents/agt_1");
  assert.ok(!JSON.stringify(made).includes("twa_"), "The key never leaves the main process");
  // The terms were accepted once, as the person agreed to them by asking.
  assert.deepEqual(api.calls.filter(call => call.method === "POST").map(call => call.route), ["/v1/account/terms", "/v1/agents"]);
  const sent = api.calls.find(call => call.route === "/v1/agents" && call.method === "POST").body;
  assert.deepEqual(sent, { name: "Orbit", desktopAgentId: "agent-1", origin: { app: "timewarp", detail: "desktop agent Orbit" }, keyName: "Timewarp on desk" });
  assert.equal(storage.value["user-1"]["agent-1"].key, "twa_secret_agt_1");
  const again = await ids.get("agent-1");
  assert.equal(again.id, "agt_1");
  assert.equal(again.keyStored, true);
  assert.equal(again.offline, false);
});

test("the agent page sees its owner's check, what it has (without settings or provider state) and what's offered", async () => {
  const { ids } = setup({ termsAccepted: true });
  await ids.create("agent-1");
  const shown = await ids.get("agent-1");
  assert.deepEqual(shown.owner, { status: "unverified", error: null, legalName: null, country: null, verifiedAt: null, check: "stripe_identity" });
  assert.deepEqual(shown.resources.mail, { status: "active", mode: "live", address: "orbit-1@agents.timewarpdev.com", label: null });
  assert.equal(shown.resources.wallet, null);
  assert.deepEqual(shown.available.wallet, { live: true, waitlist: false, verificationRequired: true, paidPlanRequired: false });
  assert.deepEqual(shown.available.card, { live: false, waitlist: true, verificationRequired: false, paidPlanRequired: false });
});

test("at a glance: unread mail, and whether a card or number was applied for", async () => {
  const { api, ids } = setup({ termsAccepted: true });
  await ids.create("agent-1");
  await ids.get("agent-1");
  const glance = await ids.glance("agent-1", ["mail"]);
  assert.deepEqual(glance, { mail: { unread: 1 }, card: { applied: false, status: null }, phone: { applied: false, status: null } });
  // The agent's own routes act as it; the owner's name it in the route.
  assert.equal(api.calls.find(call => call.route === "/v1/me/mail/counts").agent, "agt_1");
  assert.equal(api.calls.find(call => call.route === "/v1/agents/agt_1/card-application").agent, undefined);
});

test("only the page's named requests pass, for the agent's own Agent ID", async () => {
  const { api, ids } = setup({ termsAccepted: true });
  await assert.rejects(ids.call("agent-1", "mail.list"), /no Agent ID yet/);
  await ids.create("agent-1");
  await ids.call("agent-1", "mail.list", { folder: "sent", before: "2026-10-24T10:00:00.000Z", limit: 500 });
  assert.deepEqual(api.calls.at(-1), { method: "GET", route: "/v1/me/mail", body: undefined, query: { before: "2026-10-24T10:00:00.000Z", limit: "50", folder: "sent" }, agent: "agt_1" });
  await ids.call("agent-1", "mail.send", { to: "a@example.com", subject: "Hi", text: "Hello", replyTo: "m-1", from: "someone-else" });
  assert.deepEqual(api.calls.at(-1).body, { to: "a@example.com", subject: "Hi", text: "Hello", replyTo: "m-1" });
  await assert.rejects(ids.call("agent-1", "mail.read", { id: "../../v1/keys" }), /no longer exists/);
  await assert.rejects(ids.call("agent-1", "wallet.transfer", { to: "0x1", amount: 100 }), /can't do that/);
  await assert.rejects(ids.call("agent-1", "__proto__"), /can't do that/);
  await assert.rejects(ids.call("agent-1", "resource.add", { kind: "card" }), /Apply for a card/);
  await ids.call("agent-1", "resource.add", { kind: "vm" });
  assert.deepEqual(api.calls.at(-1), { method: "POST", route: "/v1/agents/agt_1/resources", body: { kind: "vm", mode: "live" }, query: undefined, agent: undefined });
});

test("verifying records consent and opens the provider's check in the Agent ID window", async () => {
  const { api, ids, opened } = setup();
  assert.deepEqual(await ids.verify(), { status: "pending", opened: true });
  assert.deepEqual(api.calls.at(-1).body, { kind: "person", consent: true });
  assert.deepEqual(opened, ["https://verify.stripe.com/start/test"]);
});

test("a check without a provider sends the owner's name and country, and opens nothing", async () => {
  const { api, ids, opened } = setup();
  assert.deepEqual(await ids.verify({ legalName: "Ada Lovelace", country: "gb" }), { status: "pending", opened: false });
  assert.deepEqual(api.calls.at(-1).body, { kind: "person", consent: true, legalName: "Ada Lovelace", country: "GB" });
  assert.deepEqual(opened, []);
});

test("the owner's pages on the website open in the Agent ID window: the agent's (at a tab), the check's and the terms", async () => {
  const { ids, opened } = setup({ termsAccepted: true });
  await assert.rejects(ids.openSite("agent-1"), /no Agent ID yet/);
  await ids.create("agent-1");
  await ids.openSite("agent-1");
  await ids.openSite("agent-1", { tab: "wallet" });
  await ids.openSite("agent-1", { tab: "../../keys" });
  await ids.openSite(null, { page: "verify" });
  await ids.openSite(null, { page: "terms" });
  await assert.rejects(ids.openSite("agent-1", { page: "https://example.com" }), /no such page/);
  assert.deepEqual(opened, [
    "https://timewarpdev.com/agent-id/agents/agt_1", "https://timewarpdev.com/agent-id/agents/agt_1?tab=wallet", "https://timewarpdev.com/agent-id/agents/agt_1",
    "https://timewarpdev.com/agent-id/verify", "https://timewarpdev.com/legal/agent-id-terms",
  ]);
});

test("accepted terms aren't accepted again, and an agent that has an Agent ID doesn't get a second one", async () => {
  const { api, ids } = setup({ termsAccepted: true });
  const [first, second] = await Promise.all([ids.create("agent-1"), ids.create("agent-1")]);
  assert.equal(first.id, second.id);
  await ids.create("agent-1");
  assert.deepEqual(api.calls.filter(call => call.method === "POST").map(call => call.route), ["/v1/agents"]);
});

test("an Agent ID linked to the agent elsewhere is shown, without a key on this computer", async () => {
  const { api, ids } = setup();
  api.identities.push({ id: "agt_cli", ownerId: "user-1", handle: "orbit-cli", name: "Orbit", status: "active", desktopAgentId: "agent-1", resources: {} });
  const shown = await ids.get("agent-1");
  assert.equal(shown.id, "agt_cli");
  assert.equal(shown.keyStored, false);
  assert.equal((await ids.get("agent-2")).linked, false);
});

test("without Agent ID, the one made here shows as saved; a lapsed sign-in isn't hidden", async () => {
  const { api, ids } = setup({ termsAccepted: true });
  await ids.create("agent-1");
  api.setDown(503);
  const shown = await ids.get("agent-1");
  assert.equal(shown.id, "agt_1");
  assert.equal(shown.offline, true);
  assert.equal(shown.keyStored, true);
  await assert.rejects(ids.get("agent-2"), /could not be reached/);
  api.setDown(401);
  await assert.rejects(ids.get("agent-1"), /could not be reached/);
});

test("an Agent ID revoked on the website takes its key off this computer", async () => {
  const { api, storage, ids } = setup({ termsAccepted: true });
  await ids.create("agent-1");
  api.identities[0].status = "revoked";
  assert.equal((await ids.get("agent-1")).linked, false);
  assert.equal(storage.value["user-1"]["agent-1"], undefined);
});

test("each account sees only its own Agent IDs", async () => {
  const { storage, ids, switchUser } = setup({ termsAccepted: true });
  await ids.create("agent-1");
  switchUser("user-2");
  assert.equal((await ids.get("agent-1")).linked, false);
  const theirs = await ids.create("agent-1");
  assert.equal(theirs.id, "agt_2");
  assert.equal(storage.value["user-1"]["agent-1"].id, "agt_1");
  assert.equal(storage.value["user-2"]["agent-1"].id, "agt_2");
  switchUser(null);
  assert.throws(() => ids.create("agent-1"), /Sign in/);
});

test("nothing is made when this computer can't encrypt the key, and a key that couldn't be kept is revoked", async () => {
  const off = setup({ termsAccepted: true, encryption: false });
  assert.throws(() => off.ids.create("agent-1"), /secure storage is unavailable/);
  assert.equal(off.api.calls.length, 0);

  const failing = setup({ termsAccepted: true });
  failing.storage.failSaves();
  await assert.rejects(failing.ids.create("agent-1"), /key wasn't kept/);
  assert.ok(failing.api.calls.some(call => call.method === "DELETE" && call.route === "/v1/agents/agt_1/keys/key-agt_1"));
});

test("the API is called as the signed-in account, as the agent when asked, and its errors keep their status and code", async () => {
  const seen = [];
  const fetch = async (url, options) => {
    seen.push({ url, options });
    return new Response(JSON.stringify({ error: { code: "terms_required", message: "Accept the Agent ID Terms first." } }), { status: 403 });
  };
  const request = agentIdApi({ config: { supabaseUrl: "https://example.supabase.co", publishableKey: "pk" }, auth: { accessToken: async () => "session" }, fetch });
  const error = await request("POST", "/v1/agents", { body: { name: "Orbit" } }).catch(value => value);
  assert.equal(error.status, 403);
  assert.equal(error.code, "terms_required");
  assert.equal(error.message, "Accept the Agent ID Terms first.");
  assert.equal(seen[0].url, "https://example.supabase.co/functions/v1/agent-id/v1/agents");
  assert.equal(seen[0].options.headers.Authorization, "Bearer session");
  assert.equal(seen[0].options.headers["Timewarp-Agent"], undefined);
  assert.equal(seen[0].options.body, JSON.stringify({ name: "Orbit" }));
  await request("GET", "/v1/me/mail", { query: { folder: "inbox" }, agent: "agt_1" }).catch(() => {});
  assert.equal(seen[1].url, "https://example.supabase.co/functions/v1/agent-id/v1/me/mail?folder=inbox");
  assert.equal(seen[1].options.headers["Timewarp-Agent"], "agt_1");
  assert.equal(seen[1].options.body, undefined);
});

// ---- The agent's own Agent ID in its chats (agent-id-tools.cjs) ----------------
const { createAgentIdTools } = require("../app/main/agent-id-tools.cjs");
const { createAutomationSync, scheduleText } = require("../app/main/agent-id.cjs");

test("an agent in its chat looks up its Agent ID's actions and does one, with its own key, never its owner's session", async () => {
  const { api, ids, storage } = setup({ termsAccepted: true });
  api.identities.push({ id: "agt_cli", ownerId: "user-1", handle: "nova-cli", name: "Nova", status: "active", desktopAgentId: "agent-2", resources: {} });
  const sent = [];
  const request = async (method, route, options = {}) => {
    sent.push({ method, route, ...options });
    if (route === "/v1/mcp/tools") return { tools: [
      { name: "mail_send", description: "Send an email from your own address.", inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] } },
      { name: "wallet_get", description: "Your wallet and its balance.", inputSchema: { type: "object", properties: {} } },
    ] };
    if (route === "/mcp" && options.body.method === "initialize") return { value: { result: {} }, headers: new Headers({ "mcp-session-id": "mcs_1" }) };
    if (route === "/mcp") return { value: { result: { content: [{ type: "text", text: JSON.stringify({ ok: options.body.params.name }) }] } }, headers: new Headers() };
    return api.request(method, route, options);
  };
  // Sending asks on a card in the chat first (approvals.cjs); here the user allows it.
  const cards = [];
  const tools = createAgentIdTools({ request, agentIds: ids, modelOf: () => "gpt-6.1-sol", confirm: async (conversationId, card) => { cards.push({ conversationId, ...card }); return { decision: "accept" }; } });
  await tools.refresh();
  // Two small tools, whatever Agent ID offers.
  assert.deepEqual(tools.specs()[0].tools.map(tool => tool.name), ["agent_id_tools", "agent_id"]);
  assert.ok(tools.readOnly.has("agent_id_tools") && !tools.readOnly.has("agent_id"));

  // Without an Agent ID: the user is told where to get one.
  const none = { id: "agent-1", name: "Orbit" };
  await assert.rejects(tools.call("chat-1", { tool: "agent_id", arguments: { action: "wallet_get" } }, none), /don't have an Agent ID yet.*\(<timewarp:\/\/agent>\)/);

  // An Agent ID linked elsewhere gets a key for this computer the first time, kept encrypted.
  const nova = { id: "agent-2", name: "Nova" };
  const found = await tools.call("chat-2", { tool: "agent_id_tools", arguments: { query: "send an email" } }, nova);
  assert.deepEqual(JSON.parse(found.contentItems[0].text).actions.map(action => action.name), ["mail_send"]);
  // Where the owner verifies, adds money and approves: a link the chat opens on the agent's page.
  assert.match(JSON.parse(found.contentItems[0].text).owner, /\(<timewarp:\/\/agent>\)/);
  const done = await tools.call("chat-2", { tool: "agent_id", arguments: { action: "mail_send", arguments: { to: "a@example.com" } } }, nova);
  assert.deepEqual(JSON.parse(done.contentItems[0].text), { ok: "mail_send" });
  assert.equal(done.success, true);
  assert.deepEqual(cards.map(card => [card.conversationId, card.kind, card.title, card.lines]), [["chat-2", "send", "Send this email?", [{ label: "To", value: "a@example.com" }]]]);
  const key = storage.value["user-1"]["agent-2"].key;
  assert.match(key, /^twa_secret_|^twa_/);
  const calls = sent.filter(item => item.route === "/mcp");
  assert.ok(calls.every(item => item.key === key && !item.agent), "every call carries the agent's key, never the owner acting as it");
  assert.equal(calls[0].body.params.clientInfo.name, "Timewarp");
  assert.equal(calls[1].headers["Mcp-Session-Id"], "mcs_1");
  assert.deepEqual(calls[1].body.params, { name: "mail_send", arguments: { to: "a@example.com", model: "gpt-6.1-sol" } });
  assert.ok(api.calls.some(item => item.method === "POST" && item.route === "/v1/agents/agt_cli/keys"));
  // One session per agent; a made-up action isn't sent.
  await tools.call("chat-2", { tool: "agent_id", arguments: { action: "wallet_get" } }, nova);
  assert.equal(sent.filter(item => item.route === "/mcp" && item.body.method === "initialize").length, 1);
  await assert.rejects(tools.call("chat-2", { tool: "agent_id", arguments: { action: "rm_rf" } }, nova), /no Agent ID action/);
});

test("automations go to the Agent ID without their instructions, and the website's requests are done here and answered", async () => {
  const sent = [];
  let list = [
    { id: "auto-1", agentId: "agent-1", name: "Morning inbox", instructions: "Read my private notes", schedule: { kind: "weekdays", time: "08:30" }, enabled: true, nextRunAt: "2026-10-27T07:30:00.000Z", lastRun: { status: "completed", startedAt: "2026-10-24T06:30:00.000Z", finishedAt: "2026-10-24T06:31:00.000Z" } },
    { id: "auto-2", agentId: "agent-9", name: "Not linked", schedule: { kind: "daily", time: "09:00" }, enabled: true },
  ];
  const ran = [];
  const automations = {
    list: () => list,
    update: (id, patch) => { list = list.map(item => item.id === id ? { ...item, ...patch } : item); },
    runNow: async id => { ran.push(id); return { status: "running" }; },
  };
  let requests = [
    { id: "r-1", automationId: "auto-1", desktopAgentId: "agent-1", action: "pause" },
    { id: "r-2", automationId: "auto-1", desktopAgentId: "agent-1", action: "run" },
    { id: "r-3", automationId: "gone", desktopAgentId: "agent-1", action: "resume" },
  ];
  const request = async (method, route, { body } = {}) => {
    sent.push({ method, route, body });
    if (route === "/v1/agents") return { agents: [{ id: "agt_1", status: "active", desktopAgentId: "agent-1" }, { id: "agt_cli", status: "active", desktopAgentId: null }] };
    if (route === "/v1/automation-requests") { const pending = requests; requests = []; return { requests: pending }; }
    return {};
  };
  const sync = createAutomationSync({ request, automations, userId: () => "user-1", hostname: () => "DESK-PC" });
  await sync.sync();
  const answers = sent.filter(item => item.route.startsWith("/v1/automation-requests/")).map(item => [item.route.split("/").pop(), item.body.status]);
  assert.deepEqual(answers, [["r-1", "done"], ["r-2", "done"], ["r-3", "failed"]]);
  assert.equal(list[0].enabled, false);
  assert.deepEqual(ran, ["auto-1"]);
  const put = sent.find(item => item.method === "PUT");
  assert.equal(put.route, "/v1/agents/agt_1/automations");
  assert.deepEqual(put.body, { device: "DESK-PC", automations: [{ id: "auto-1", name: "Morning inbox", schedule: { kind: "weekdays", time: "08:30" }, summary: "Weekdays at 08:30", enabled: false, nextRunAt: "2026-10-27T07:30:00.000Z", lastRun: { status: "completed", at: "2026-10-24T06:31:00.000Z" } }] });
  assert.ok(!JSON.stringify(sent).includes("private notes"), "instructions stay on this computer");
  // Nothing changed: nothing sent again.
  await sync.sync();
  assert.equal(sent.filter(item => item.method === "PUT").length, 1);
  assert.equal(scheduleText({ kind: "interval", minutes: 120 }), "Every 2 hours");
});
