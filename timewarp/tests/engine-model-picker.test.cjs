"use strict";
// The model picker's bolt is the Fast switch: it turns a model's Fast tier on
// and off, the trigger shows Fast, and models without it leave the bolt inert.
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
  codexModel({ model: "gpt-6-luna", displayName: "gpt-6-luna", defaultReasoningEffort: "low", supportedReasoningEfforts: efforts, serviceTiers: tiers }),
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
  await ui.click(".tw-mp-bolt");
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-6.1-sol", reasoningEffort: "high", serviceTier: "priority" }, "Fast keeps the effort");
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-pressed"), "true");
  assert.match(ui.trigger(), /Fast/);
  assert.equal(ui.$(".tw-model-speed").dataset.fast, "true");
  assert.equal(ui.$('.tw-mp-speed-options button[aria-pressed="true"]').textContent, "Fast", "the Speed row follows the bolt");
  await ui.click(".tw-mp-bolt");
  assert.deepEqual(ui.selections.at(-1), { name: "gpt-6.1-sol", reasoningEffort: "high", serviceTier: null });
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

test("Timewarp credits have no Fast: the bolt is inert and no speed shows", async t => {
  const ui = mount(t, credits, { name: credits[0].id, reasoningEffort: "low", serviceTier: null });
  await ui.click(".tw-pill.model");
  assert.equal(ui.$(".tw-mp-bolt").getAttribute("aria-disabled"), "true");
  assert.equal(ui.$(".tw-mp-bolt").title, "Fast isn't available for this model");
  assert.equal(ui.$(".tw-mp-speed"), null);
  await ui.click(".tw-mp-bolt");
  assert.equal(ui.selections.length, 0);
  assert.doesNotMatch(ui.trigger(), /Fast|Standard/);
});
