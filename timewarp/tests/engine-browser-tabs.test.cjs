"use strict";
// A chat's browser tabs come back after a restart, as in the previous app.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// The browser module runs in Electron; here it gets small stand-ins.
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === "electron") return { WebContentsView: class {}, session: { fromPartition: () => ({ setPermissionRequestHandler() {}, on() {}, setUserAgent() {}, getUserAgent: () => "Chrome" }) }, shell: {} };
  return original.call(this, request, ...rest);
};
const { createBrowser } = require("../app/main/browser.cjs");
Module._load = original;

function memoryStore() {
  const values = new Map();
  return {
    settings: { get: (key, fallback = null) => values.has(key) ? JSON.parse(values.get(key)) : fallback, set: (key, value) => { values.set(key, JSON.stringify(value)); return value; } },
    browserProfiles: { list: () => [{ id: "default" }, { id: "work" }], ensureDefault: () => ({ id: "default" }) },
    conversations: { get: () => ({ browserProfileId: null }), update() {} },
    recentSites: { record() {}, list: () => [] },
  };
}

test("a chat's tabs, their profile and the active tab are restored after a restart", () => {
  const store = memoryStore();
  const first = createBrowser({ window: () => null, store });
  const home = first.openTab("chat-1");
  const page = first.openTab("chat-1", { url: "https://example.com/a", profileId: "work" });
  first.openTab("chat-2", { url: "https://example.org/" });
  first.activate("chat-1", home.id);
  first.destroy(); // quitting saves at once

  const second = createBrowser({ window: () => null, store });
  const state = second.state("chat-1");
  assert.deepEqual(state.tabs.map(tab => [tab.id, tab.kind, tab.url, tab.profileId]), [[home.id, "home", null, "default"], [page.id, "web", "https://example.com/a", "work"]]);
  assert.equal(state.active, home.id, "the tab that was active is active again");
  assert.equal(second.state("chat-2").tabs[0].url, "https://example.org/");
  // A tab link from an earlier reply still finds its tab.
  assert.equal(second.activate("chat-1", page.id).active, page.id);
  second.destroy();
});

test("closing a chat's tabs forgets them, and only web addresses are kept", () => {
  const store = memoryStore();
  const first = createBrowser({ window: () => null, store });
  const page = first.openTab("chat-1", { url: "https://example.com/" });
  first.closeConversation("chat-1");
  first.openTab("chat-2", { url: "https://example.com/private" });
  first.destroy();
  const saved = store.settings.get("browserTabs", {});
  assert.equal(saved["chat-1"], undefined);
  assert.ok(saved["chat-2"]);
  const second = createBrowser({ window: () => null, store });
  assert.equal(second.state("chat-1").tabs.length, 0);
  assert.notEqual(second.state("chat-2").tabs[0].id, undefined);
  assert.equal(second.state("chat-2").tabs.some(tab => tab.id === page.id), false);
  second.destroy();
});
