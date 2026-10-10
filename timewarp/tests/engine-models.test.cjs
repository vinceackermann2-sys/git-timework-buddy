"use strict";
// The model catalog, saved model choices and the speed tier, from the picker
// to turn/start.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createModelCatalog, chooseModel } = require("../app/main/model-catalog.cjs");
const { createMethods } = require("../app/main/methods.cjs");
const { createLegacyRequests } = require("../app/main/legacy-requests.cjs");
const { createHarness } = require("../app/main/harness.cjs");
const { openStore } = require("../app/main/store.cjs");
const { bindCodexFunding } = require("../desktop/codex-funding.cjs");
const { codexModel } = require("../shared/model-capabilities.cjs");

// The Codex catalog as model/list reports it (GPT-6.1 Sol first, with Fast).
const codexChoices = require("../shared/codex-models.json").models.filter(model => model.visibility === "list").sort((a, b) => a.priority - b.priority)
  .map((model, at) => codexModel({ model: model.slug, displayName: model.display_name, isDefault: at === 0, defaultReasoningEffort: model.default_reasoning_level, supportedReasoningEfforts: model.supported_reasoning_levels.map(item => ({ reasoningEffort: item.effort, description: item.description })), serviceTiers: model.service_tiers, defaultServiceTier: model.default_service_tier }));
const settingsStore = (initial = {}) => { const values = new Map(Object.entries(initial)); return { get: key => values.get(key), set: (key, value) => values.set(key, value) }; };

function chatgptCatalog({ settings, failing = () => false }) {
  return createModelCatalog({
    funding: { current: async () => ({ source: "chatgpt", canFundUsage: true }) },
    chatgpt: { models: async () => { if (failing()) throw Object.assign(new Error("Codex is starting. Retry shortly."), { status: 503 }); return codexChoices; } },
    settings, userId: () => "user-1",
  });
}

test("a ChatGPT catalog that can't be read keeps the saved model instead of switching to Sol", async () => {
  const saved = { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: "priority" };
  const settings = settingsStore({ modelSettings: saved });
  let failing = true;
  const catalog = chatgptCatalog({ settings, failing: () => failing });
  await assert.rejects(catalog.modelChoices(), /Codex is starting/);
  await assert.rejects(catalog.selectModel(), /Codex is starting/);
  assert.equal(await catalog.selectModel([]), saved, "an empty catalog changes nothing");
  assert.deepEqual(settings.get("modelSettings"), saved);
  failing = false;
  assert.deepEqual(await catalog.selectModel(), saved, "the choice is still there once the catalog loads");
});

test("the default follows the catalog when the saved model is no longer offered", async () => {
  const settings = settingsStore({ modelSettings: { name: "gpt-6.1-sol", reasoningEffort: "ultra", serviceTier: "priority" } });
  const catalog = createModelCatalog({ funding: { current: async () => ({ source: "timewarp" }) }, chatgpt: {}, settings, userId: () => "user-1" });
  assert.deepEqual((await catalog.modelChoices()).map(model => model.id), ["openai/gpt-5.6-sol", "openai/gpt-5.6-luna"]);
  assert.deepEqual(await catalog.selectModel(), { name: "openai/gpt-5.6-sol", reasoningEffort: "low", serviceTier: null });
  assert.deepEqual(settings.get("modelSettings"), { name: "openai/gpt-5.6-sol", reasoningEffort: "low", serviceTier: null });
});

test("a picked effort and speed are kept when the model offers them, otherwise its defaults", () => {
  assert.deepEqual(chooseModel(codexChoices, { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: "priority" }), { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: "priority" });
  assert.deepEqual(chooseModel(codexChoices, { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: null }), { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: null }, "Standard stays Standard");
  assert.deepEqual(chooseModel(codexChoices, { name: "gpt-6-sol", reasoningEffort: "none", serviceTier: "turbo" }), { name: "gpt-6-sol", reasoningEffort: "medium", serviceTier: "priority" });
  assert.throws(() => chooseModel(codexChoices, { name: "gpt-4" }), error => error.status === 400);
});

function methodsWith({ settings, choices, harness = {} }) {
  const catalog = { modelChoices: async () => { if (choices() instanceof Error) throw choices(); return choices(); } };
  const selectModel = async list => createModelCatalog({ funding: { current: async () => ({ source: "chatgpt" }) }, chatgpt: { models: catalog.modelChoices }, settings, userId: () => "user-1" }).selectModel(list);
  return createMethods({ store: { settings }, services: { auth: { userId: () => "user-1" } }, agents: {}, harness, modelChoices: catalog.modelChoices, selectModel });
}

test("models.list reports an unreadable catalog with the saved choice, and models.select keeps the speed", async () => {
  const saved = { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: "priority" };
  const settings = settingsStore({ modelSettings: saved });
  let current = new Error("Codex did not return available models. Retry in Billing.");
  const methods = methodsWith({ settings, choices: () => current });
  assert.deepEqual(await methods["models.list"](), { choices: [], selected: saved, error: "Codex did not return available models. Retry in Billing." });
  assert.deepEqual(settings.get("modelSettings"), saved);
  await assert.rejects(methods["models.select"]({ name: "gpt-6-sol", reasoningEffort: "high", serviceTier: null }));
  assert.deepEqual(settings.get("modelSettings"), saved);
  current = codexChoices;
  assert.deepEqual((await methods["models.list"]()).selected, saved);
  assert.deepEqual(await methods["models.select"]({ name: "gpt-6-sol", reasoningEffort: "high", serviceTier: null }), { name: "gpt-6-sol", reasoningEffort: "high", serviceTier: null });
  assert.deepEqual(await methods["models.select"]({ name: "gpt-6-luna", reasoningEffort: "ultra" }), { name: "gpt-6-luna", reasoningEffort: "medium", serviceTier: "priority" }, "an effort the model lacks becomes its default");
});

test("a chat's model change keeps the speed it was given", async () => {
  const calls = [];
  const methods = methodsWith({ settings: settingsStore(), choices: () => codexChoices, harness: { setModel: (id, settings) => { calls.push([id, settings]); return { id, modelSettings: settings }; } } });
  await methods["conversations.setModel"]({ id: "c1", name: "gpt-5.5", reasoningEffort: "xhigh", serviceTier: "priority" });
  assert.deepEqual(calls, [["c1", { name: "gpt-5.5", reasoningEffort: "xhigh", serviceTier: "priority" }]]);
  await assert.rejects(methods["conversations.setModel"]({ id: "c1", name: "gpt-unknown" }), error => error.status === 400);
});

// A stand-in for the Codex app server that records requests.
function fakeClient() {
  const client = new EventEmitter(), calls = [];
  let threads = 0, turns = 0;
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-" + ++threads, modelProvider: params.modelProvider } };
    if (method === "thread/resume") return { thread: { id: params.threadId, modelProvider: params.modelProvider } };
    if (method === "turn/start") return { turn: { id: "turn-" + ++turns } };
    return {};
  };
  return { client, calls };
}

function harnessSetup(t, { client, calls } = fakeClient()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-models-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  let global = { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: "priority" };
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "", modelSettings: () => global });
  return { store, harness, calls, setGlobal: value => { global = value; } };
}

test("a new chat keeps the model settings it started with", async t => {
  const { harness, calls, setGlobal } = harnessSetup(t);
  const conversation = harness.conversations.create({ agentId: "agent-1" });
  assert.deepEqual(conversation.modelSettings, { name: "gpt-6.1-sol", reasoningEffort: "xhigh", serviceTier: "priority" });
  setGlobal({ name: "gpt-5.5", reasoningEffort: "low", serviceTier: null });
  await harness.send(conversation.id, { text: "Hello" });
  const turn = calls.find(call => call.method === "turn/start").params;
  assert.deepEqual([turn.model, turn.effort, turn.serviceTier], ["gpt-6.1-sol", "xhigh", "priority"]);
  assert.deepEqual(harness.conversations.create({ agentId: "agent-1" }).modelSettings, { name: "gpt-5.5", reasoningEffort: "low", serviceTier: null });
});

test("the chosen speed reaches turn/start, and Standard is sent as no tier", async t => {
  const { store, harness, calls } = harnessSetup(t);
  const conversation = harness.conversations.create({ agentId: "agent-1" });
  harness.setModel(conversation.id, { name: "gpt-6-sol", reasoningEffort: "high", serviceTier: null });
  await harness.send(conversation.id, { text: "One" });
  const legacy = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", modelSettings: { name: "gpt-5.5", reasoningEffort: "low" } });
  await harness.send(legacy.id, { text: "Two" });
  const [standard, older] = calls.filter(call => call.method === "turn/start").map(call => call.params);
  assert.deepEqual([standard.model, standard.effort, standard.serviceTier], ["gpt-6-sol", "high", null]);
  assert.equal("serviceTier" in older, false, "chats saved without a speed use the model's default");
});

test("Codex receives the speed checked against the model's tiers", async () => {
  const { client, calls } = fakeClient();
  const chatgpt = { bindClient() {}, models: async () => codexChoices, trackTurn() {}, failTurn() {} };
  bindCodexFunding({ client, chatgpt, funding: { current: async () => ({ source: "chatgpt", canFundUsage: true }) }, userId: () => "user-1" });
  await client.request("turn/start", { threadId: "t1", input: [], model: "gpt-6.1-sol", effort: "xhigh", serviceTier: "priority" });
  await client.request("turn/start", { threadId: "t1", input: [], model: "gpt-6-sol", effort: "high", serviceTier: null });
  await client.request("turn/start", { threadId: "t1", input: [], model: "gpt-6-sol", effort: "high" });
  await client.request("turn/start", { threadId: "t1", input: [], model: "gpt-5.5", effort: "low", serviceTier: "ultrafast" });
  assert.deepEqual(calls.filter(call => call.method === "turn/start").map(call => call.params.serviceTier), ["priority", null, "priority", null]);
});

test("disconnecting ChatGPT or changing plan refreshes the interface's models, even when the catalog fails", async () => {
  const events = [];
  let selected = 0;
  const request = createLegacyRequests({
    services: { auth: {}, chatgpt: { disconnect: async () => ({ remoteRevoked: true }) }, funding: { current: async () => ({ source: "timewarp" }) }, integrations: {} },
    harness: {}, guard: {}, version: "test", registerTools: async () => {}, historyStatus: () => ({}),
    selectModel: async () => { selected++; throw new Error("Models unavailable."); },
    onFundingChanged: () => events.push("funding.changed"),
  });
  assert.deepEqual(await request("disconnectChatgpt"), { remoteRevoked: true });
  assert.deepEqual(await request("refreshAiFunding"), { source: "timewarp" });
  assert.equal(selected, 2);
  assert.deepEqual(events, ["funding.changed", "funding.changed"]);
});

test("a chat's execution status is only for its owner, and a missing chat has none", async () => {
  const chats = { mine: { id: "mine", codexThreadId: "thread-1" } };
  const asked = [];
  const request = createLegacyRequests({
    services: { auth: {}, chatgpt: {}, funding: {}, integrations: {} }, version: "test", registerTools: async () => {}, historyStatus: () => ({}), selectModel: async () => {},
    harness: { conversations: { get: id => { if (!chats[id]) throw Object.assign(new Error("This conversation is unavailable for this account."), { status: 404 }); return chats[id]; } } },
    guard: { snapshot: ids => { asked.push(ids); return [{ threadId: ids[0], running: true }]; } },
  });
  assert.deepEqual(await request("executionStatus", { conversationId: "mine" }), [{ threadId: "thread-1", running: true }]);
  assert.deepEqual(await request("executionStatus", { conversationId: "someone-elses" }), []);
  assert.deepEqual(await request("executionStatus", {}), []);
  assert.deepEqual(asked, [["thread-1"]]);
});

test("a chat loaded on the previous funding is unloaded and asked to resume, instead of failing until restart", async () => {
  const calls = [];
  const client = new EventEmitter();
  const loaded = new Map(); // thread id -> provider Codex keeps while it's loaded
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") { loaded.set("t1", params.modelProvider); return { thread: { id: "t1", modelProvider: params.modelProvider } }; }
    if (method === "thread/resume") { if (!loaded.has(params.threadId)) loaded.set(params.threadId, params.modelProvider); return { thread: { id: params.threadId, modelProvider: loaded.get(params.threadId) } }; }
    if (method === "thread/unsubscribe") { loaded.delete(params.threadId); return {}; }
    if (method === "turn/start") return { turn: { id: "turn-1" } };
    return {};
  };
  let source = "timewarp";
  const chatgpt = { bindClient() {}, models: async () => codexChoices, trackTurn() {}, failTurn() {} };
  bindCodexFunding({ client, chatgpt, funding: { current: async () => ({ source, canFundUsage: true }) }, userId: () => "user-1" });
  await client.request("thread/start", { model: "openai/gpt-5.6-sol" });
  await client.request("turn/start", { threadId: "t1", input: [] });
  source = "chatgpt"; // the user connected ChatGPT
  await assert.rejects(client.request("turn/start", { threadId: "t1", input: [] }), error => error.status === 409 && error.code === "provider-changed");
  assert.ok(calls.some(call => call.method === "thread/unsubscribe" && call.params.threadId === "t1"), "the thread is unloaded");
  const resumed = await client.request("thread/resume", { threadId: "t1" });
  assert.equal(resumed.thread.modelProvider, "openai");
  await client.request("turn/start", { threadId: "t1", input: [] });
  assert.equal(calls.filter(call => call.method === "turn/start").length, 2, "the retried turn starts on the new provider");
});
