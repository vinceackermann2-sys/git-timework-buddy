"use strict";
// Agent ID for the app's agents: each agent's identity in Timewarp Agent ID,
// shown on its page with what it has there (mail, wallet, card, computer,
// phone) and whether its owner is verified. The identity belongs to the
// signed-in account (the agent-id cloud function, called with the account's
// own session) and is linked to the agent by its id; the agent's own routes
// are called as the website calls them, the owner acting as the agent.
// Its key stays on this computer, encrypted with the operating system's key
// store (Electron safeStorage): it is never shown, never synced and never
// given to the model. The owner's own pages (the identity check, and the
// website for money, limits and keys) open in the Agent ID window
// (agent-id-window.cjs), out of every agent's reach.
const os = require("node:os");

const fail = (status, message) => Object.assign(new Error(message), { status });
// The Agent ID website, where an agent's money, limits and keys are managed.
const SITE = "https://timewarpdev.com";
const KINDS = ["mail", "wallet", "card", "vm", "phone"];
// The website's tabs on an agent's page (src/components/agent-id/agent/tabs.ts).
const SITE_TABS = new Set(["mail", "phone", "wallet", "card", "machine", "vault", "connectors", "automations", "activity", "settings"]);

// Agent ID's API as the signed-in account: (method, route, { body, query,
// agent }) → its answer. With `agent`, the account acts as that agent; with
// `key`, the agent's own key is sent instead (its chats' tools). `headers`
// go along (an MCP session), and `withHeaders` returns the answer's too.
// base: another Agent ID than the cloud's (a local one, for preview builds).
function agentIdApi({ config, auth, fetch = globalThis.fetch, base = null }) {
  const root = base || `${config.supabaseUrl}/functions/v1/agent-id`;
  return async (method, route, { body, query, agent, key, headers = {}, withHeaders = false, timeout = 30000, open = false } = {}) => {
    // open: a route anyone may read, sent without a sign-in.
    const token = open ? null : key || await auth.accessToken();
    const search = query && Object.keys(query).length ? "?" + new URLSearchParams(query) : "";
    const response = await fetch(`${root}${route}${search}`, {
      method,
      headers: { apikey: config.publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(agent && !key ? { "Timewarp-Agent": agent } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout), redirect: "error",
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(value.error?.message || "Agent ID could not be reached."), { status: response.status, code: value.error?.code || null });
    return withHeaders ? { value, headers: response.headers } : value;
  };
}

// What the agent page may ask, by name: the route, and whether it acts as
// the agent ("me") or as its owner about it. Nothing else is passed on.
const text = (value, max) => value === undefined || value === null ? undefined : String(value).slice(0, max);
const segment = value => { const id = String(value ?? ""); if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw fail(400, "That item no longer exists."); return id; };
// A vault item as the page sealed it: never anything in the clear.
const envelopeOf = value => {
  if (!value || value.v !== 1 || ["key", "iv", "data"].some(part => typeof value[part] !== "string" || value[part].length > 40000)) throw fail(400, "The vault item wasn't sealed.");
  return { v: 1, key: value.key, iv: value.iv, data: value.data };
};
const page = input => Object.fromEntries([["before", text(input.before, 40)], ["limit", input.limit ? String(Math.min(50, Math.max(1, Number(input.limit) || 20))) : undefined]].filter(([, value]) => value));
const OPS = {
  "mail.counts": () => ({ method: "GET", route: "/v1/me/mail/counts", me: true }),
  "mail.list": input => ({ method: "GET", route: "/v1/me/mail", me: true, query: { ...page(input), folder: input.folder === "sent" ? "sent" : "inbox" } }),
  "mail.read": input => ({ method: "GET", route: `/v1/me/mail/${segment(input.id)}`, me: true }),
  "mail.send": input => ({ method: "POST", route: "/v1/me/mail", me: true, body: { to: text(input.to, 2000), subject: text(input.subject, 998), text: text(input.text, 100000), ...(input.replyTo ? { replyTo: segment(input.replyTo) } : {}) } }),
  "wallet.get": () => ({ method: "GET", route: "/v1/me/wallet", me: true }),
  "wallet.transactions": input => ({ method: "GET", route: "/v1/me/wallet/transactions", me: true, query: page(input) }),
  "card.get": () => ({ method: "GET", route: "/v1/me/card", me: true }),
  "card.transactions": input => ({ method: "GET", route: "/v1/me/card/transactions", me: true, query: page(input) }),
  "card.application": (input, id) => ({ method: "GET", route: `/v1/agents/${id}/card-application` }),
  "card.apply": (input, id) => ({ method: "POST", route: `/v1/agents/${id}/card-application`, body: { useCase: text(input.useCase, 500), monthlySpend: input.monthlySpend ?? null, country: text(input.country, 2) || null } }),
  "phone.application": (input, id) => ({ method: "GET", route: `/v1/agents/${id}/phone-application` }),
  "phone.apply": (input, id) => ({ method: "POST", route: `/v1/agents/${id}/phone-application`, body: { useCase: text(input.useCase, 1000), country: text(input.country, 2) || null, ...(Array.isArray(input.uses) ? { uses: input.uses.map(String) } : {}) } }),
  "phone.texts": input => ({ method: "GET", route: "/v1/me/sms", me: true, query: page(input) }),
  "phone.calls": input => ({ method: "GET", route: "/v1/me/calls", me: true, query: page(input) }),
  "computer.get": () => ({ method: "GET", route: "/v1/me/vm", me: true }),
  "computer.start": () => ({ method: "POST", route: "/v1/me/vm/start", me: true, body: {} }),
  "computer.stop": () => ({ method: "POST", route: "/v1/me/vm/stop", me: true, body: {} }),
  "computer.commands": input => ({ method: "GET", route: "/v1/me/vm/commands", me: true, query: page(input) }),
  // The vault on its computer: items go in sealed (the page seals them to the computer's key).
  "vault.get": (input, id) => ({ method: "GET", route: `/v1/agents/${id}/vault` }),
  "vault.setup": (input, id) => ({ method: "POST", route: `/v1/agents/${id}/vault/setup`, body: {} }),
  "vault.add": (input, id) => ({ method: "POST", route: `/v1/agents/${id}/vault/items`, body: { label: text(input.label, 100), envelope: envelopeOf(input.envelope) } }),
  "vault.remove": (input, id) => ({ method: "DELETE", route: `/v1/agents/${id}/vault/items/${segment(input.id)}` }),
  // What waits for the owner's yes (payments above the approval amount, actions that ask first).
  "approvals.list": (input, id) => ({ method: "GET", route: "/v1/approvals", query: { status: "pending" }, pick: value => ({ approvals: (value.approvals || []).filter(item => item.agentId === decodeURIComponent(id)) }) }),
  "approvals.decide": input => ({ method: "POST", route: `/v1/approvals/${segment(input.id)}`, body: { decision: input.decision === "approve" ? "approve" : "deny" } }),
  "activity": (input, id) => ({ method: "GET", route: `/v1/agents/${id}/events`, query: page(input) }),
  // Mail, a wallet and a computer are given at once; a card and a number are applied for.
  "resource.add": (input, id) => {
    if (!["mail", "wallet", "vm"].includes(input.kind)) throw fail(400, "Apply for a card or a number instead.");
    return { method: "POST", route: `/v1/agents/${id}/resources`, body: { kind: input.kind, mode: "live" } };
  },
};

// storage: a protectedStore holding { [account]: { [agent]: record } }, where a
// record is { id, handle, key, keyId, savedAt } for the Agent ID made here.
// openPage opens an address in the Agent ID window.
function createAgentIds({ request, storage, encryption, agents, userId, openPage = async () => ({ opened: false }), site = SITE, hostname = os.hostname, log = () => {} }) {
  const owner = () => { const id = userId(); if (!id) throw fail(401, "Sign in to Timewarp."); return id; };
  const load = () => {
    try { return storage.load() || {}; }
    catch (error) { log("Saved Agent IDs could not be read.", error.message); return {}; }
  };
  const recordOf = (account, agentId) => load()[account]?.[agentId] || null;
  const write = (account, agentId, record) => {
    const all = load(), mine = { ...all[account] };
    if (record) mine[agentId] = record; else delete mine[agentId];
    storage.save({ ...all, [account]: mine });
  };
  // The Agent ID each agent was last seen linked to, so its pages don't look it up again.
  const linked = new Map();
  // Only what the page shows of a resource: never its settings' secrets or provider state.
  const resourceSummary = resource => resource && resource.status !== "released" ? {
    status: resource.status, mode: resource.mode, address: resource.address || null, label: resource.label || null,
    ...(resource.kind === "card" ? { brand: resource.details?.brand || null, last4: resource.details?.last4 || null } : {}),
  } : null;
  // What the agent page shows. keyStored: its key is kept here, encrypted.
  // name, model and apps: as the website shows them ("Used in Timewarp · GPT-6.1").
  const view = (identity, record, extra = {}) => ({
    linked: true, id: identity.id, handle: identity.handle, status: identity.status || "active",
    name: identity.name || null, mascot: identity.mascot || null,
    model: identity.model && typeof identity.model === "object" ? { kind: identity.model.kind || "agent", label: identity.model.label || null, provider: identity.model.provider || null, name: identity.model.name || null } : null,
    apps: Array.isArray(identity.apps) ? identity.apps.filter(app => app?.app).map(app => ({ app: String(app.app), label: String(app.label || app.app), model: app.model ? String(app.model) : null })) : [],
    keyStored: !!record?.key && record.id === identity.id, savedAt: record?.id === identity.id ? record.savedAt : null,
    url: `${site}/agent-id/agents/${encodeURIComponent(identity.id)}`, offline: false,
    resources: identity.resources ? Object.fromEntries(KINDS.map(kind => [kind, resourceSummary(identity.resources[kind])])) : null,
    ...extra,
  });
  // The owner's identity check (who does it: "bridge" or "stripe_identity"
  // on their own page; "test" or "manual" from a name and a country), and
  // which resources this Agent ID offers and how.
  const ownerOf = account => account ? {
    owner: {
      status: account.person?.status || "unverified", error: account.person?.lastError || null,
      legalName: account.person?.legalName || null, country: account.person?.country || null, verifiedAt: account.person?.verifiedAt || null,
      check: account.config?.verification?.person || null,
    },
    connectorsAvailable: account.config?.connectors?.available !== false,
    available: Object.fromEntries(KINDS.map(kind => {
      const offer = account.config?.resources?.[kind] || {};
      return [kind, { live: !!offer.live, waitlist: !!offer.waitlist, verificationRequired: !!offer.verificationRequired, paidPlanRequired: !!offer.paidPlanRequired }];
    })),
  } : { owner: null, available: null };

  // The account's Agent ID for the agent: the one made here, else one linked
  // to it elsewhere (such as with `timewarp-id attach`). Without Agent ID, the
  // one made here is shown as it was saved.
  async function get(desktopAgentId) {
    const account = owner(), agent = agents.get(desktopAgentId);
    let record = recordOf(account, agent.id);
    const [list, about] = await Promise.allSettled([request("GET", "/v1/agents"), request("GET", "/v1/account")]);
    if (list.status === "rejected") {
      if (record && list.reason?.status !== 401) return view(record, record, { offline: true });
      throw list.reason;
    }
    const active = (list.value.agents || []).filter(item => item.status !== "revoked");
    // An Agent ID revoked on the website takes its key with it.
    if (record && !active.some(item => item.id === record.id)) { write(account, agent.id, null); record = null; }
    const found = (record && active.find(item => item.id === record.id)) || active.find(item => item.desktopAgentId === agent.id);
    const extra = ownerOf(about.status === "fulfilled" ? about.value : null);
    if (!found) { linked.delete(account + "\n" + agent.id); return { linked: false, ...extra }; }
    linked.set(account + "\n" + agent.id, found.id);
    return view(found, record, extra);
  }

  async function identityOf(account, agent) {
    const known = linked.get(account + "\n" + agent.id);
    if (known) return known;
    const current = await get(agent.id);
    if (!current.linked) throw fail(404, "This agent has no Agent ID yet.");
    return current.id;
  }

  // Each resource's latest state, for the agent page's rows: unread mail, the
  // wallet's balance, the computer's state, and card and number applications.
  // `kinds` are the resources it has (from get). What can't be read is left out.
  async function glance(desktopAgentId, kinds = []) {
    const account = owner(), agent = agents.get(desktopAgentId);
    if (!await identityOf(account, agent).catch(() => null)) return {};
    const has = kind => Array.isArray(kinds) && kinds.includes(kind);
    const ask = (op, kind) => call(desktopAgentId, op, {}).then(value => [kind, value], () => [kind, null]);
    const results = await Promise.all([
      has("mail") ? ask("mail.counts", "mail") : null,
      has("wallet") ? ask("wallet.get", "wallet") : null,
      has("vm") ? ask("computer.get", "vm") : null,
      has("vm") ? ask("vault.get", "vault") : null,
      has("card") ? null : ask("card.application", "card"),
      has("phone") ? null : ask("phone.application", "phone"),
    ].filter(Boolean));
    const value = Object.fromEntries(results.filter(([, result]) => result));
    return {
      ...(value.mail ? { mail: { unread: value.mail.inbox?.unread ?? 0 } } : {}),
      ...(value.wallet ? { wallet: { balance: value.wallet.wallet?.balance ?? null } } : {}),
      ...(value.vm ? { vm: { state: value.vm.machine?.state || null } } : {}),
      ...(value.vault ? { vault: { ready: !!value.vault.vault?.ready, count: (value.vault.items || []).length } } : {}),
      ...(value.card ? { card: { applied: !!value.card.application, status: value.card.application?.status || null } } : {}),
      ...(value.phone ? { phone: { applied: !!value.phone.application, status: value.phone.application?.status || null } } : {}),
    };
  }

  // One of the agent page's requests (OPS), for the agent's Agent ID.
  async function call(desktopAgentId, op, input = {}) {
    const account = owner(), agent = agents.get(desktopAgentId);
    const make = Object.hasOwn(OPS, op) ? OPS[op] : null;
    if (!make) throw fail(400, "Agent ID can't do that here.");
    const id = await identityOf(account, agent);
    const { method, route, me, body, query, pick } = make(input || {}, encodeURIComponent(id));
    const value = await request(method, route, { body, query, agent: me ? id : undefined });
    return pick ? pick(value) : value;
  }

  // The owner's identity check: they agreed to it (an ID document and a
  // selfie) on the agent page. It continues on the provider's page in the
  // Agent ID window; a check without a provider takes their legal name and
  // country instead.
  async function verify({ legalName, country } = {}) {
    owner();
    const named = legalName ? { legalName: String(legalName).slice(0, 200), country: String(country || "").slice(0, 2).toUpperCase() } : {};
    const result = await request("POST", "/v1/account/verification", { body: { kind: "person", consent: true, ...named } });
    const status = result.person?.status || "pending";
    const opened = result.url ? !!(await openPage(result.url))?.opened : false;
    return { status, opened };
  }

  // One of the owner's pages on the Agent ID website, in the Agent ID window:
  // the agent's own (at one of its tabs), the identity check's, or the terms.
  async function openSite(desktopAgentId, { page = "agent", tab = null } = {}) {
    const account = owner();
    if (page === "verify") return openPage(`${site}/agent-id/verify`);
    if (page === "terms") return openPage(`${site}/legal/agent-id-terms`);
    if (page !== "agent") throw fail(400, "Agent ID has no such page.");
    const id = await identityOf(account, agents.get(desktopAgentId));
    return openPage(`${site}/agent-id/agents/${encodeURIComponent(id)}${SITE_TABS.has(tab) ? `?tab=${tab}` : ""}`);
  }

  // A new Agent ID for the agent, with a key for this computer. The person
  // agreed to the Agent ID Terms by asking for it (the agent page says so).
  const creating = new Map();
  function create(desktopAgentId) {
    const account = owner(), agent = agents.get(desktopAgentId);
    if (!encryption.isEncryptionAvailable()) throw fail(503, "This computer's secure storage is unavailable, so an Agent ID can't be kept here.");
    const pending = account + "\n" + agent.id;
    if (creating.has(pending)) return creating.get(pending);
    const run = (async () => {
      const current = await get(agent.id);
      if (current.linked) return current;
      const { terms } = await request("GET", "/v1/account");
      if (terms && !terms.accepted) await request("POST", "/v1/account/terms", { body: { version: terms.current } });
      const made = await request("POST", "/v1/agents", { body: {
        name: agent.name, desktopAgentId: agent.id,
        origin: { app: "timewarp", detail: `desktop agent ${agent.name}`.slice(0, 200) },
        keyName: `Timewarp on ${hostname()}`.slice(0, 60),
      } });
      const record = { id: made.agent.id, handle: made.agent.handle, key: made.secret, keyId: made.key?.id || null, savedAt: new Date().toISOString() };
      try { write(account, agent.id, record); }
      catch (error) {
        // A key that can't be kept safely isn't left working.
        if (record.keyId) await request("DELETE", `/v1/agents/${encodeURIComponent(record.id)}/keys/${encodeURIComponent(record.keyId)}`).catch(() => {});
        log("An Agent ID key could not be saved.", error.message);
        throw fail(503, "This computer's secure storage is unavailable, so the Agent ID's key wasn't kept.");
      }
      linked.set(pending, made.agent.id);
      return view(made.agent, record, ownerOf(await request("GET", "/v1/account").catch(() => null)));
    })();
    creating.set(pending, run);
    return run.finally(() => creating.delete(pending));
  }

  // The Agent ID a Timewarp agent acts as in its chats, with its own key, so
  // its limits and asking first apply and Agent ID records the agent (never
  // its owner) as acting. An Agent ID linked elsewhere gets a key for this
  // computer the first time, kept like one made here. Null without an Agent ID.
  const keying = new Map();
  async function credentials(desktopAgentId) {
    const account = owner(), agent = agents.get(desktopAgentId);
    const id = await identityOf(account, agent).catch(error => { if (error.status === 404) return null; throw error; });
    if (!id) return null;
    const record = recordOf(account, agent.id);
    if (record?.id === id && record.key) return { id, key: record.key };
    if (!encryption.isEncryptionAvailable()) throw fail(503, "This computer's secure storage is unavailable, so the agent can't use its Agent ID here.");
    const pending = account + "\n" + agent.id;
    if (!keying.has(pending)) keying.set(pending, (async () => {
      const made = await request("POST", `/v1/agents/${encodeURIComponent(id)}/keys`, { body: { name: `Timewarp on ${hostname()}`.slice(0, 60) } });
      const next = { id, handle: record?.id === id ? record.handle : null, key: made.secret, keyId: made.key?.id || null, savedAt: new Date().toISOString() };
      try { write(account, agent.id, next); }
      catch (error) {
        if (next.keyId) await request("DELETE", `/v1/agents/${encodeURIComponent(id)}/keys/${encodeURIComponent(next.keyId)}`).catch(() => {});
        log("An Agent ID key could not be saved.", error.message);
        throw fail(503, "This computer's secure storage is unavailable, so the agent can't use its Agent ID here.");
      }
      return { id, key: next.key };
    })().finally(() => keying.delete(pending)));
    return keying.get(pending);
  }

  return { get, glance, call, verify, openSite, create, credentials };
}

// When an automation runs, in words, as the Automations page says it.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function scheduleText(schedule = {}) {
  if (schedule.kind === "daily") return `Every day at ${schedule.time}`;
  if (schedule.kind === "weekdays") return `Weekdays at ${schedule.time}`;
  if (schedule.kind === "weekly") return `Every ${(Array.isArray(schedule.days) ? schedule.days : []).map(day => DAYS[day]).filter(Boolean).join(", ")} at ${schedule.time}`;
  if (schedule.kind === "monthly") return `Monthly on day ${schedule.day} at ${schedule.time}`;
  if (schedule.kind === "hourly") return `Every hour at :${String(schedule.minute ?? 0).padStart(2, "0")}`;
  if (schedule.kind === "interval") return schedule.minutes % 60 === 0 ? `Every ${schedule.minutes / 60} hour${schedule.minutes === 60 ? "" : "s"}` : `Every ${schedule.minutes} minutes`;
  if (schedule.kind === "once") return "Once";
  return null;
}

// Each agent's automations on its Agent ID: what they are (never their
// instructions) goes there after every change, and pausing, resuming or
// running one from the website comes back as a request, done here and
// answered. Requests are looked for every minute while signed in.
function createAutomationSync({ request, automations, userId, hostname = os.hostname, log = () => {}, every = 60000, settle = 3000 }) {
  const sent = new Map();
  let timer = null, pass = null, again = false, ticker = null;
  const snapshot = automation => ({
    id: automation.id, name: automation.name, schedule: automation.schedule || {}, summary: scheduleText(automation.schedule), enabled: !!automation.enabled,
    nextRunAt: automation.nextRunAt || null, lastRun: automation.lastRun ? { status: automation.lastRun.status, at: automation.lastRun.finishedAt || automation.lastRun.startedAt || null } : null,
  });
  // The account's Agent IDs that belong to its Timewarp agents.
  const linkedAgents = async () => ((await request("GET", "/v1/agents")).agents || []).filter(item => item.status !== "revoked" && item.desktopAgentId);
  async function push() {
    const account = userId();
    if (!account) return;
    const mine = automations.list();
    for (const identity of await linkedAgents()) {
      const items = mine.filter(item => item.agentId === identity.desktopAgentId).map(snapshot);
      const body = { device: String(hostname() || "").slice(0, 100) || null, automations: items };
      const key = account + "\n" + identity.id, value = JSON.stringify(body);
      if (sent.get(key) === value) continue;
      await request("PUT", `/v1/agents/${encodeURIComponent(identity.id)}/automations`, { body });
      sent.set(key, value);
    }
  }
  async function take() {
    if (!userId()) return;
    const { requests = [] } = await request("GET", "/v1/automation-requests");
    for (const item of requests) {
      let error = null;
      try {
        const automation = item.desktopAgentId ? automations.list().find(entry => entry.id === item.automationId && entry.agentId === item.desktopAgentId) : null;
        if (!automation) throw new Error("This automation isn't on this computer.");
        if (item.action === "pause") automations.update(automation.id, { enabled: false });
        else if (item.action === "resume") automations.update(automation.id, { enabled: true });
        else if (item.action === "run") { const run = await automations.runNow(automation.id); if (run?.status === "failed") throw new Error(run.error || "The run didn't start."); }
        else throw new Error("Unknown request.");
      } catch (failure) { error = failure.message || "It could not be done."; }
      await request("POST", `/v1/automation-requests/${encodeURIComponent(item.id)}`, { body: error ? { status: "failed", error: error.slice(0, 500) } : { status: "done" } }).catch(failure => log("An automation request could not be answered.", failure.message));
    }
  }
  // One pass at a time; a change during a pass gets another.
  function run() {
    if (pass) { again = true; return pass; }
    pass = (async () => { try { await take(); await push(); } catch (error) { log("Automations could not be synced with Agent ID.", error.message); } })()
      .finally(() => { pass = null; if (again) { again = false; void run(); } });
    return pass;
  }
  return {
    // An automation changed or ran.
    changed() { clearTimeout(timer); timer = setTimeout(() => void run(), settle); timer.unref?.(); },
    start() { if (ticker) return; ticker = setInterval(() => void run(), every); ticker.unref?.(); setTimeout(() => void run(), 10000).unref?.(); },
    stop() { clearInterval(ticker); ticker = null; clearTimeout(timer); sent.clear(); },
    sync: run,
  };
}

module.exports = { createAgentIds, createAutomationSync, agentIdApi, scheduleText };
