"use strict";
// The model picker's bolt is the Fast switch, and the only speed control: the
// speed is Standard unless the bolt turns a model's Fast tier on, the trigger
// shows Fast, and models without it leave the bolt inert.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const { codexModel } = require("../shared/model-capabilities.cjs");

const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { flushSync } from "react-dom"; import { ModelPicker } from "./app/renderer/src/components/ModelPicker.jsx"; globalThis.picker = { React, createRoot, flushSync, ModelPicker };', resolveDir: root, loader: "jsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
}).outputFiles[0].text;

const tiers = [{ id: "priority", name: "Fast", description: "1.5x speed, increased usage" }];
const efforts = ["low", "medium", "high"].map(effort => ({ reasoningEffort: effort, description: effort }));
const codex = [
  codexModel({ model: "gpt-6.1-sol", displayName: "gpt-6.1-sol", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: efforts, serviceTiers: tiers }),
  // Codex lists Fast as some models' default speed; the picker still starts at Standard.
  codexModel({ model: "gpt-6-luna", displayName: "gpt-6-luna", defaultReasoningEffort: "low", supportedReasoningEfforts: efforts, serviceTiers: tiers, defaultServiceTier: "priority" }),
  codexModel({ model: "gpt-review", displayName: "gpt-review", defaultReasoningEffort: "low", supportedReasoningEfforts: efforts, serviceTiers: [] }),
];
const credits = require("../shared/models.cjs").models();
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };

function mount(t, choices, initial) {
  const dom = new JSDOM('<main id="host"></main>', { url: "https://fixture.invalid", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const selections = [];
  let selected = initial;
  window.tw = { call: async method => method === "models.list" ? { choices, selected } : method === "settings.get" ? { modelSettings: selected } : null, on: () => () => {} };
  window.eval(bundle);
  const { React, createRoot, flushSync, ModelPicker } = window.picker;
  const host = window.document.getElementById("host");
  const reactRoot = createRoot(host);
  const render = () => flushSync(() => reactRoot.render(React.createElement(ModelPicker, { models: { choices, selected }, onSelect: async choice => { selections.push(JSON.parse(JSON.stringify(choice))); selected = choice; render(); } })));
  render();
  t.after(() => { reactRoot.unmount(); dom.window.close(); });
  const $ = selector => host.querySelector(selector);
  const click = async (selector, at = 0) => { host.querySelectorAll(selector)[at].dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await flush(); };
  return { $, click, selections, trigger: () => $(".tw-pill.model").textContent };
}

test("the bolt turns Fast on and off and the trigger shows Fast", async t => {
  const ui = mount(t, codex, { name: "gpt-6.1-sol", reasoningEffort: "high", serviceTier: null });
  assert.doesNotMatch(ui.trigger(), /Fast|Standard/, "Standard isn't named on the trigger");
  await ui.click(".tw-pill.model");
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-pressed"), "false");
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-disabled"), "false");
  assert.equal(ui.$(".tw-mp-slider").dataset.fast, undefined);
  assert.ok(ui.$(".tw-mp-fill .tw-mp-sparks"), "the fill carries the sparkles Fast shows");
  assert.equal(ui.$(".tw-mp-speed"), null, "there's no Speed row: the bolt is the only speed control");
  await ui.click(".tw-mp-bolt");
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-6.1-sol", reasoningEffort: "high", serviceTier: "priority" }, "Fast keeps the effort");
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-pressed"), "true");
  assert.equal(ui.$(".tw-mp-slider").dataset.fast, "true", "the slider turns speedy");
  assert.match(ui.trigger(), /Fast/);
  assert.equal(ui.$(".tw-model-speed").dataset.fast, "true");
  assert.equal(ui.$(".tw-mp-speed"), null);
  await ui.click(".tw-mp-bolt");
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-6.1-sol", reasoningEffort: "high", serviceTier: null });
  assert.equal(ui.$(".tw-mp-slider").dataset.fast, undefined);
  assert.doesNotMatch(ui.trigger(), /Fast/);
});

test("Fast stays on when the next model offers it and turns off when it doesn't", async t => {
  const ui = mount(t, codex, { name: "gpt-6.1-sol", reasoningEffort: "medium", serviceTier: "priority" });
  await ui.click(".tw-pill.model");
  await ui.click(".tw-mp-choose");
  await ui.click(".tw-mp-option", 1);
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-6-luna", reasoningEffort: "low", serviceTier: "priority" });
  await ui.click(".tw-mp-choose");
  await ui.click(".tw-mp-option", 2);
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-review", reasoningEffort: "low", serviceTier: null });
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-disabled"), "true");
  const before = ui.selections.length;
  await ui.click(".tw-mp-bolt");
  assert.equal(ui.selections.length, before, "the bolt does nothing for a model without Fast");
});

test("picking a model is Standard unless the bolt is on, even where Codex lists Fast as its default", async t => {
  const ui = mount(t, codex, { name: "gpt-6.1-sol", reasoningEffort: "medium", serviceTier: null });
  await ui.click(".tw-pill.model");
  await ui.click(".tw-mp-choose");
  await ui.click(".tw-mp-option", 1);
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-6-luna", reasoningEffort: "low", serviceTier: null });
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-pressed"), "false");
  assert.doesNotMatch(ui.trigger(), /Fast|Standard/);
  await ui.click(".tw-mp-bolt");
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-6-luna", reasoningEffort: "low", serviceTier: "priority" });
});

test("Timewarp's models: the bolt turns Fast on for Opus 5.5 and GPT-6, and is inert for the other Claude models", async t => {
  const sonnet = credits.find(model => model.id === "anthropic/claude-sonnet-5-5");
  const ui = mount(t, credits, { name: sonnet.id, reasoningEffort: "high", serviceTier: null });
  await ui.click(".tw-pill.model");
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-disabled"), "true");
  assert.equal(ui.$(".tw-mp-bolt").title, "Fast isn't available for this model");
  await ui.click(".tw-mp-bolt");
  assert.equal(ui.selections.length, 0);
  assert.doesNotMatch(ui.trigger(), /Fast|Standard/);
  await ui.click(".tw-mp-choose");
  await ui.click(".tw-mp-option", credits.findIndex(model => model.id === "anthropic/claude-opus-5-5"));
  assert.deepEqual(ui.selections.at(-1), { name: "anthropic/claude-opus-5-5", reasoningEffort: "medium", serviceTier: null });
  await ui.click(".tw-mp-bolt");
  assert.deepEqual(ui.selections.at(-1), { name: "anthropic/claude-opus-5-5", reasoningEffort: "medium", serviceTier: "priority" });
  assert.match(ui.$(".tw-mp-bolt").title, /^Fast is on: Up to 2.5x faster replies, uses twice the credits$/);
  assert.match(ui.trigger(), /Fast/);
  await ui.click(".tw-mp-choose");
  await ui.click(".tw-mp-option", credits.findIndex(model => model.id === "openai/gpt-6-astra"));
  assert.deepEqual(ui.selections.at(-1), { name: "openai/gpt-6-astra", reasoningEffort: "low", serviceTier: "priority" }, "Fast stays on for GPT-6");
});

test("Timewarp's models show intelligence, speed and low cost as a percentage of the best; Codex's don't", async t => {
  const ui = mount(t, credits, { name: "openai/gpt-6.1-sol", reasoningEffort: "low", serviceTier: null });
  await ui.click(".tw-pill.model");
  await ui.click(".tw-mp-choose");
  const rows = [...ui.$(".tw-mp-options").querySelectorAll(".tw-mp-option")];
  assert.deepEqual(rows.map(row => row.querySelector(".tw-mp-option-name").textContent), ["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Fable 5.1", "GPT-6 Astra", "GPT-6.1 Sol", "Claude Haiku 5.5", "GPT-6 Luna"]);
  const stats = row => [...row.querySelectorAll(".tw-mp-stat")].map(stat => stat.textContent);
  assert.deepEqual(stats(rows[0]), ["Intelligence100%", "Speed37%", "Low cost22%"]);
  assert.deepEqual(stats(rows[5]), ["Intelligence59%", "Speed74%", "Low cost89%"]);
  assert.equal(rows[6].querySelector('.tw-mp-stat[data-stat="speed"]').style.getPropertyValue("--tw-stat"), "100%", "the bar fills to the percentage");
  assert.match(rows[0].querySelector(".tw-mp-stats").title, /Artificial Analysis/);
  assert.ok(rows[4].querySelector(".tw-mp-option-check svg"), "the chosen model keeps its check");
  const codexUi = mount(t, codex, { name: "gpt-6.1-sol", reasoningEffort: "medium", serviceTier: null });
  await codexUi.click(".tw-pill.model");
  await codexUi.click(".tw-mp-choose");
  assert.equal(codexUi.$(".tw-mp-stats"), null, "Codex's catalog has no scores");
});
