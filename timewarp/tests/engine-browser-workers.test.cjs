"use strict";
// Workers browse in their own tabs: two workers at once don't navigate each
// other's pages or the chat agent's.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrowserTools } = require("../app/main/browser-tools.cjs");

// A chat's tabs with the browser API the tools use; each page is its address.
function fakeBrowser() {
  const tabs = new Map();
  let active = null, next = 0;
  const contentsOf = tab => ({
    getURL: () => tab.url, getTitle: () => "Page " + tab.url, isLoading: () => false,
    executeJavaScript: async () => ({ title: "Page " + tab.url, url: tab.url, text: "Heading of " + tab.url }),
  });
  const tabFor = id => { const tab = tabs.get(id || active); if (!tab) throw new Error("This browser tab is closed."); return tab; };
  return {
    tabs, active: () => active,
    openTab(conversationId, { url, activate = true, worker = false }) { const tab = { id: "tab-" + (++next), url, worker }; tabs.set(tab.id, tab); if (activate) active = tab.id; return { id: tab.id, url }; },
    navigate(conversationId, { tabId, url }) { let tab; try { tab = tabFor(tabId); } catch { return this.openTab(conversationId, { url }); } tab.url = url; return { id: tab.id, url }; },
    webContents(conversationId, tabId) { const tab = tabFor(tabId); return { tab, contents: contentsOf(tab), onScreen: false }; },
    state: () => ({ active, tabs: [...tabs.values()].map(tab => ({ id: tab.id, url: tab.url, title: "" })) }),
    close(conversationId, tabId) { const tab = tabFor(tabId); tabs.delete(tab.id); if (active === tab.id) active = [...tabs.keys()][0] || null; return this.state(); },
    markAgent() {}, userInControl: () => false,
  };
}

test("workers browse in their own tabs and leave the chat agent's tab alone", async () => {
  const browser = fakeBrowser();
  const tools = createBrowserTools({ browser });
  const call = async (tool, args, caller) => (await tools.call("chat-1", { tool, arguments: args, ...caller }, { name: "Orbit" })).contentItems[0].text;
  const agent = { threadId: "root" }, workerA = { threadId: "worker-a", worker: true }, workerB = { threadId: "worker-b", worker: true };

  await call("open", { url: "https://example.com/start" }, agent);
  const chatTab = browser.active();
  // Two workers open their pages one after the other, as when they run at once.
  await call("open", { url: "https://example.com/a" }, workerA);
  await call("open", { url: "https://example.com/b" }, workerB);
  assert.match(await call("read", {}, workerA), /Heading of https:\/\/example\.com\/a/, "Worker A still reads its own page");
  assert.match(await call("read", {}, workerB), /Heading of https:\/\/example\.com\/b/);
  // Their tabs open in the background: the chat agent's active tab is unchanged.
  assert.equal(browser.active(), chatTab);
  // Marked as workers' tabs, so their downloads go to the workspace without a dialog.
  assert.deepEqual([...browser.tabs.values()].map(tab => tab.worker), [false, true, true]);
  assert.match(await call("read", {}, agent), /example\.com\/start/);
  // A worker's next open reuses its tab rather than starting another.
  await call("open", { url: "https://example.com/a2" }, workerA);
  assert.equal(browser.tabs.size, 3);
  assert.match(await call("tabs", {}, workerA), /^\* \S+ https:\/\/example\.com\/a2/m, "The worker's own tab is marked as its current one");
  // A tab named explicitly is still used, and closing without a tab closes the worker's own.
  assert.match(await call("read", { tab: chatTab }, workerB), /example\.com\/start/);
  await call("close_tab", {}, workerB);
  assert.ok(browser.tabs.has(chatTab) && ![...browser.tabs.values()].some(tab => tab.url === "https://example.com/b"));
  assert.equal(tools.defaultTab("chat-1", workerA), [...browser.tabs.values()].find(tab => tab.url === "https://example.com/a2").id);
  assert.equal(tools.defaultTab("chat-1", agent), undefined, "The chat agent uses the active tab");
});
