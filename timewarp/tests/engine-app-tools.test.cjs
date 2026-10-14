"use strict";
// Timewarp itself for agents (app/main/app-tools.cjs): usage in credits, never
// money; settings to read; and changes only through the card the user answers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createAppTools, toolSpecs } = require("../app/main/app-tools.cjs");
const { chooseModel } = require("../app/main/model-catalog.cjs");

const MODELS = [
  { id: "anthropic/claude-opus-5-5", displayName: "Claude Opus 5.5", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }], defaultReasoningEffort: "medium", serviceTiers: [{ value: null }, { value: "priority" }], defaultServiceTier: null },
  { id: "openai/gpt-6-luna", displayName: "GPT-6 Luna", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }], defaultReasoningEffort: "low", serviceTiers: [{ value: null }], defaultServiceTier: null },
];

function setup(t, { funding = { plan: "pro", subscriptionAllowed: false, source: "timewarp", canFundUsage: true, timewarpCredits: 1234.567 }, planUsage = { name: "Pro", allowance: 2000, left: 500, resetsAt: "2026-11-01T00:00:00.000Z" }, chatgpt = null, answer = "accept" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-app-tools-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const chat = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "Trip", modelSettings: { name: "openai/gpt-6-luna", reasoningEffort: "low" } });
  const old = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "Old" });
  store.turnUsage.record(chat.id, "thread-1", "turn-1", { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100, reasoningOutputTokens: 0, totalTokens: 1100 });
  store.turnUsage.record(chat.id, "thread-1", "turn-2", { inputTokens: 2500, cachedInputTokens: 900, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 2800 });
  store.turnUsage.record(old.id, "thread-2", "turn-3", { inputTokens: 50, cachedInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0, totalTokens: 55 });
  store.settings.set("appearance", { scheme: "system", accent: "#123456" });
  store.settings.set("modelSettings", { name: "anthropic/claude-opus-5-5", reasoningEffort: "medium", serviceTier: null });
  const cards = [], written = [];
  const tools = createAppTools({
    store, userId: () => "user-1",
    usage: async () => ({ funding, planUsage, chatgpt }),
    settings: { read: () => store.settings.all(), write: async (key, value) => { written.push(key); store.settings.set(key, value); } },
    models: { choices: async () => MODELS, choose: chooseModel, select: async () => store.settings.get("modelSettings") },
    status: async () => ({ version: "1.2.6", agentRuntime: "ready" }),
    confirm: async (conversationId, card) => { cards.push({ conversationId, card }); return { decision: typeof answer === "function" ? answer(card) : answer }; },
  });
  const call = async (tool, args = {}) => tools.call(chat.id, { namespace: "timewarp_app", tool, arguments: args }, { id: "agent-1", name: "Orbit" });
  const run = async (tool, args) => { const result = await call(tool, args); const text = result.contentItems[0].text; try { return JSON.parse(text); } catch { return text; } };
  return { store, tools, call, run, chat, cards, written };
}

test("app tools have strict schemas; change_settings needs a reason", () => {
  const [namespace] = toolSpecs();
  assert.equal(namespace.name, "timewarp_app");
  assert.deepEqual(namespace.tools.map(tool => tool.name), ["get_usage", "get_settings", "get_status", "change_settings"]);
  for (const tool of namespace.tools) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(namespace.tools.find(tool => tool.name === "change_settings").inputSchema.required, ["reason"]);
  assert.ok(!namespace.tools.find(tool => tool.name === "change_settings").inputSchema.properties.approvals, "how extra access is approved isn't for agents to change");
});

test("usage is in credits, never money, with the plan's monthly credits and token use", async t => {
  const { call, run, chat } = setup(t);
  const raw = (await call("get_usage")).contentItems[0].text;
  assert.doesNotMatch(raw, /\$|USD|dollar|€|EUR/i, "credits are never shown as money");
  const usage = JSON.parse(raw);
  assert.equal(usage.plan, "pro");
  assert.equal(usage.aiPaidWith, "Timewarp credits");
  assert.deepEqual(usage.credits, { left: 1234.56, unit: "credits", monthly: { plan: "Pro", included: 2000, left: 500, percentLeft: 25, resetsAt: "2026-11-01T00:00:00.000Z" } });
  assert.deepEqual(usage.tokens.thisChat, { turns: 2, inputTokens: 2500, cachedInputTokens: 900, outputTokens: 300 });
  assert.equal(usage.tokens.last7Days.chats, 2);
  assert.equal(usage.tokens.busiestChats[0].conversationId, chat.id);
});

test("a ChatGPT plan's usage shows its windows", async t => {
  const { run } = setup(t, { funding: { plan: "free", subscriptionAllowed: true, source: "chatgpt", canFundUsage: true, timewarpCredits: 0 }, planUsage: null, chatgpt: { status: "available", account: { planType: "plus" }, rateLimits: { primary: { usedPercent: 30, resetsAt: 1792000000 }, secondary: { usedPercent: 80 } } } });
  const usage = await run("get_usage");
  assert.equal(usage.aiPaidWith, "the user's ChatGPT plan");
  assert.equal(usage.credits, undefined);
  assert.deepEqual(usage.chatgpt.windows.map(window => [window.window, window.percentLeft]), [["current window", 70], ["weekly window", 20]]);
});

test("settings read as the user set them, with the plan's models", async t => {
  const { run } = setup(t);
  const settings = await run("get_settings");
  assert.equal(settings.theme, "system");
  assert.equal(settings.privacyMode, false);
  assert.equal(settings.memory, "enabled");
  assert.equal(settings.replyNotifications, true);
  assert.deepEqual(settings.defaultModel, { model: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5", reasoningEffort: "medium", speed: "Standard" });
  assert.deepEqual(settings.thisChatModel, { model: "openai/gpt-6-luna", name: "GPT-6 Luna", reasoningEffort: "low" });
  assert.deepEqual(settings.models.map(model => model.model), ["anthropic/claude-opus-5-5", "openai/gpt-6-luna"]);
  assert.deepEqual(await run("get_status"), { version: "1.2.6", agentRuntime: "ready" });
});

test("a change shows the user a card made from the checked values and applies only after Allow", async t => {
  const { store, run, cards, written, chat } = setup(t);
  const result = await run("change_settings", { theme: "dark", privacyMode: true, reason: "You asked for dark mode and private sync." });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].conversationId, chat.id);
  assert.deepEqual(cards[0].card, {
    kind: "settings", title: "Change these settings?", agent: "Orbit", reason: "You asked for dark mode and private sync.",
    changes: [{ key: "theme", label: "Theme", from: "System", to: "Dark" }, { key: "privacyMode", label: "Privacy Mode", from: "Off", to: "On" }],
  });
  assert.match(result, /The user allowed it/);
  assert.deepEqual(written, ["appearance", "privacy"]);
  assert.deepEqual(store.settings.get("appearance"), { scheme: "dark", accent: "#123456" }, "other appearance values stay");
  assert.equal(store.settings.get("privacy").mode, "private");
});

test("nothing changes when the user doesn't allow it, the card times out or the reply stops", async t => {
  for (const decision of ["decline", "timeout", "cancel"]) {
    const { store, call, written } = setup(t, { answer: decision });
    const result = await call("change_settings", { memory: "none", reason: "Turn memory off." });
    assert.equal(result.success, false);
    assert.match(result.contentItems[0].text, /nothing changed/);
    assert.deepEqual(written, []);
    assert.equal(store.settings.get("memory"), null);
  }
});

test("only known settings and values can change, and an unchanged one asks nothing", async t => {
  const { run, call, cards } = setup(t);
  await assert.rejects(call("change_settings", { theme: "neon", reason: "x" }), /theme is system, light or dark/);
  await assert.rejects(call("change_settings", { memory: "all", reason: "x" }), /memory is enabled/);
  await assert.rejects(call("change_settings", { defaultModel: "someone/else", reason: "x" }), /not available on your plan/);
  await assert.rejects(call("change_settings", { theme: "dark" }), /short reason/);
  assert.match(await run("change_settings", { theme: "system", reason: "x" }), /Nothing to change/);
  assert.equal(cards.length, 0);
});

test("the default model changes to one the plan offers, with a valid effort", async t => {
  const { store, run, cards } = setup(t);
  await run("change_settings", { defaultModel: "openai/gpt-6-luna", reasoningEffort: "medium", reason: "Luna is cheaper for this." });
  assert.deepEqual(cards[0].card.changes, [{ key: "defaultModel", label: "Model for new chats", from: "Claude Opus 5.5, medium", to: "GPT-6 Luna, medium" }]);
  assert.equal(store.settings.get("modelSettings").name, "openai/gpt-6-luna");
  assert.equal(store.settings.get("modelSettings").reasoningEffort, "medium");
});
