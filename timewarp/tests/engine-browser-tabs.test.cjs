"use strict";
// A chat's browser tabs come back after a restart, as in the previous app.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The browser module runs in Electron; here it gets small stand-ins.
let lastId = 0;
class FakeContents extends EventEmitter {
  id = ++lastId; url = ""; destroyed = false; ipc = new EventEmitter(); entries = []; index = -1;
  // Back and forward history, as Electron's navigationHistory keeps it.
  navigationHistory = {
    canGoBack: () => this.index > 0, canGoForward: () => this.index < this.entries.length - 1,
    goBack: () => { this.index--; this.url = this.entries[this.index].url; }, goForward: () => { this.index++; this.url = this.entries[this.index].url; },
    getAllEntries: () => this.entries.map(entry => ({ ...entry })), getActiveIndex: () => this.index,
    restore: ({ entries, index }) => { this.restored = { entries, index }; this.entries = entries.map(entry => ({ ...entry })); this.index = index; this.url = entries[index].url; return Promise.resolve(); },
  };
  setAudioMuted() {} setBackgroundThrottling() {}
  setWindowOpenHandler(handler) { this.openHandler = handler; }
  loadURL(url) { this.url = url; this.entries = [...this.entries.slice(0, this.index + 1), { url, title: "", pageState: "state of " + url }]; this.index = this.entries.length - 1; return Promise.resolve(); }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.emit("destroyed"); }
  reload() { this.reloaded = true; }
}
class FakeView {
  constructor(options = {}) { this.options = options; this.webContents = options.webContents || new FakeContents(); }
  setVisible(value) { this.visible = value; } getVisible() { return this.visible; }
  setBounds(value) { this.bounds = value; } getBounds() { return this.bounds; }
}
// Native dialogs and menus shown, what was copied and opened outside.
const sessions = new Map(), shownFiles = [], shown = [], menus = [], copied = [], opened = [];
let leaveAnswer = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === "electron") return {
    WebContentsView: FakeView, BrowserWindow: class {},
    shell: { showItemInFolder: file => shownFiles.push(file), openExternal: async url => { opened.push(url); } },
    dialog: {
      showMessageBox: (window, options) => new Promise(resolve => { shown.push({ window, options, resolve }); options.signal?.addEventListener("abort", () => resolve({ response: options.cancelId ?? 0 })); }),
      showMessageBoxSync: (window, options) => { shown.push({ window, options }); return leaveAnswer; },
    },
    Menu: { buildFromTemplate: items => ({ items, popup: options => menus.push({ items, options }) }) },
    clipboard: { writeText: value => copied.push(value) },
    session: { fromPartition: partition => {
      if (sessions.has(partition)) return sessions.get(partition);
      const value = {
        partition, handlers: {}, agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Timewarp/1.4.0 Chrome/150.0.0.0 Electron/43.7.7 Safari/537.36",
        setPermissionRequestHandler(handler) { value.request = handler; }, setPermissionCheckHandler(handler) { value.check = handler; }, on(event, handler) { value.handlers[event] = handler; },
        setUserAgent(agent) { value.agent = agent; }, getUserAgent: () => value.agent,
        webRequest: { onBeforeSendHeaders(filter, handler) { value.beforeSend = { filter, handler }; } },
        clearStorageData: async () => { value.cleared = true; }, clearCache: async () => {},
      };
      sessions.set(partition, value);
      return value;
    } },
  };
  return original.call(this, request, ...rest);
};
const { createBrowser } = require("../app/main/browser.cjs");
Module._load = original;

function memoryStore({ agents = {} } = {}) {
  const values = new Map();
  return {
    settings: { get: (key, fallback = null) => values.has(key) ? JSON.parse(values.get(key)) : fallback, set: (key, value) => { values.set(key, JSON.stringify(value)); return value; } },
    browserProfiles: { list: () => [{ id: "default" }, { id: "work" }], ensureDefault: () => ({ id: "default" }) },
    conversations: { get: () => ({ browserProfileId: null, agentId: "agent-1" }), update() {} },
    agents: { get: id => agents[id] || null },
    recentSites: { record() {}, list: () => [] },
  };
}
// A window's content view, as Electron's BrowserWindow has.
function fakeWindow() {
  const children = new Set();
  return { closed: false, minimized: false, isDestroyed() { return this.closed; }, isMinimized() { return this.minimized; }, isVisible: () => true, contentView: { children, addChildView: view => children.add(view), removeChildView: view => children.delete(view) } };
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

test("profiles from the previous app open in their own storage; pages can't show notifications or read the clipboard", () => {
  const store = memoryStore();
  const legacy = "browser-profile:v1:" + "a".repeat(64);
  store.browserProfiles.list = () => [{ id: "energy:default", source: { type: "timewarp", partition: legacy } }, { id: "work", source: { type: "chrome", partition: "../elsewhere" } }];
  const browser = createBrowser({ window: () => null, store });
  const session = browser.sessionFor("energy:default");
  assert.equal(session.partition, "persist:" + legacy);
  assert.equal(browser.sessionFor("work").partition, "persist:tw-browser-work", "only the previous app's partition names are used");
  for (const permission of ["notifications", "clipboard-read", "geolocation"]) {
    assert.equal(session.check(null, permission), false, permission + " check");
    let granted; session.request(null, permission, value => { granted = value; }); assert.equal(granted, false, permission + " request");
  }
  assert.equal(session.check(null, "clipboard-sanitized-write"), true);
  browser.destroy();
});

test("a site asks for the camera and microphone in the user's own tab; an allow is remembered for the profile", async () => {
  const store = memoryStore(), current = fakeWindow();
  const browser = createBrowser({ window: () => current, store });
  const page = browser.openTab("chat-1", { url: "https://meet.example/room" });
  const contents = browser.webContents("chat-1", page.id).contents;
  const session = browser.sessionFor("default");
  const ask = (origin = "https://meet.example", mediaTypes = ["video", "audio"]) => new Promise(resolve => session.request(contents, "media", resolve, { mediaTypes, securityOrigin: origin + "/" }));
  // Nobody is looking at the page: refused without asking.
  shown.length = 0;
  assert.equal(await ask(), false);
  assert.equal(shown.length, 0);
  browser.show("chat-1");
  browser.setBounds({ x: 400, y: 50, width: 800, height: 700 });
  const first = ask();
  await tick();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].window, current);
  assert.equal(shown[0].options.message, "Allow meet.example to use your camera and microphone?");
  shown[0].resolve({ response: 0 });
  assert.equal(await first, true);
  assert.equal(session.check(contents, "media", "https://meet.example", { mediaType: "video" }), true);
  assert.equal(await ask(), true, "Remembered");
  assert.equal(shown.length, 1);
  assert.deepEqual(store.settings.get("browserSitePermissions"), { default: { "https://meet.example": ["audio", "video"] } });
  // A refusal holds until the page changes.
  const other = ask("https://chat.example", ["audio"]);
  await tick();
  assert.equal(shown[1].options.message, "Allow chat.example to use your microphone?");
  shown[1].resolve({ response: 1 });
  assert.equal(await other, false);
  assert.equal(await ask("https://chat.example", ["audio"]), false);
  assert.equal(shown.length, 2);
  // A page an agent works in never gets them.
  browser.markAgent("chat-1", page.id, { name: "Orbit", action: "Clicking" });
  assert.equal(await ask(), false);
  assert.equal(session.check(contents, "media", "https://meet.example", { mediaType: "video" }), false);
  for (const permission of ["notifications", "clipboard-read", "geolocation"]) { let granted; session.request(contents, permission, value => { granted = value; }); assert.equal(granted, false); }
  browser.destroy();
});

test("Google's sign-in gets the browser identity with Timewarp's name; other sites get Chrome's", () => {
  const browser = createBrowser({ window: () => null, store: memoryStore() });
  const session = browser.sessionFor("identity");
  assert.equal(session.agent, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36");
  assert.deepEqual(session.beforeSend.filter, { urls: ["https://accounts.google.com/*"] });
  let sent;
  session.beforeSend.handler({ url: "https://accounts.google.com/v3/signin", requestHeaders: { "User-Agent": session.agent, Accept: "*/*" } }, value => { sent = value; });
  assert.deepEqual(sent.requestHeaders, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Timewarp/1.4.0 Chrome/150.0.0.0 Safari/537.36", Accept: "*/*" });
  browser.destroy();
});

test("browser home shows the chat's new tab page and leaves the web tab with its page", () => {
  const browser = createBrowser({ window: () => null, store: memoryStore() });
  const page = browser.openTab("chat-1", { url: "https://example.com/a" });
  const contents = browser.webContents("chat-1", page.id).contents;
  let state = browser.home("chat-1", page.id);
  const home = state.tabs.find(tab => tab.kind === "home");
  assert.equal(state.active, home.id);
  assert.deepEqual([state.tabs.find(tab => tab.id === page.id).url, contents.isDestroyed()], ["https://example.com/a", false]);
  browser.activate("chat-1", page.id);
  state = browser.home("chat-1", page.id);
  assert.deepEqual([state.active, state.tabs.length], [home.id, 2], "The new tab page is reused");
  browser.destroy();
});

test("pinned tabs come first; busy pages aren't put to sleep, and sleeping tabs keep their history, also after a restart", () => {
  const store = memoryStore();
  const browser = createBrowser({ window: () => null, store });
  const first = browser.openTab("chat-1", { url: "https://example.com/1" });
  const firstPage = browser.webContents("chat-1", first.id).contents;
  void firstPage.loadURL("https://example.com/2");
  firstPage.emit("did-navigate", {}, "https://example.com/2");
  const pinned = browser.openTab("chat-1", { url: "https://example.com/pinned" });
  let state = browser.pin("chat-1", pinned.id, true);
  assert.deepEqual(state.tabs.map(tab => [tab.id, tab.pinned]), [[pinned.id, true], [first.id, false]]);
  // Pages with typed input, sound, a page still loading or an agent at work.
  const busy = ["form", "music", "slow", "agent"].map(name => browser.openTab("chat-1", { url: "https://example.com/" + name }));
  const pages = busy.map(tab => browser.webContents("chat-1", tab.id).contents);
  pages[0].ipc.emit("timewarp-browser:edited");
  pages[1].emit("media-started-playing");
  pages[2].emit("did-start-loading");
  browser.markAgent("chat-1", busy[3].id, { name: "Orbit", action: "Reading" });
  const pinnedPage = browser.webContents("chat-1", pinned.id).contents;
  for (let index = 0; index < 16; index++) browser.openTab("chat-2", { url: "https://example.org/" + index });
  assert.equal(firstPage.isDestroyed(), true, "The page used longest ago sleeps");
  assert.deepEqual([pinnedPage, ...pages].map(page => page.isDestroyed()), [false, false, false, false, false]);
  // It comes back with its history.
  const back = browser.webContents("chat-1", first.id).contents;
  assert.deepEqual(back.restored, { index: 1, entries: [{ url: "https://example.com/1", title: "", pageState: "state of https://example.com/1" }, { url: "https://example.com/2", title: "", pageState: "state of https://example.com/2" }] });
  assert.equal(browser.state("chat-1").tabs.find(tab => tab.id === first.id).canGoBack, true);
  browser.destroy();
  // After a restart: pins and history (addresses and titles) are kept.
  const again = createBrowser({ window: () => null, store });
  state = again.state("chat-1");
  assert.equal(state.tabs[0].id, pinned.id);
  assert.equal(state.tabs[0].pinned, true);
  assert.deepEqual(again.webContents("chat-1", first.id).contents.restored, { index: 1, entries: [{ url: "https://example.com/1", title: "" }, { url: "https://example.com/2", title: "" }] });
  again.destroy();
});

test("hidden pages an agent works in are parked out of sight, where key presses reach them", () => {
  const current = fakeWindow();
  const browser = createBrowser({ window: () => current, store: memoryStore() });
  const page = browser.openTab("chat-1", { url: "https://example.com/" });
  const view = [...current.contentView.children][0];
  assert.deepEqual([view.visible, browser.keyInput("chat-1", page.id)], [false, -1], "A hidden page nobody works in isn't drawn");
  browser.markAgent("chat-1", page.id, { name: "Orbit", action: "Typing" });
  assert.equal(view.visible, true);
  assert.ok(view.bounds.x < -10000 && view.bounds.y < -10000, "Outside the window");
  const wait = browser.keyInput("chat-1", page.id);
  assert.ok(wait > 0 && wait <= 250, String(wait));
  current.minimized = true;
  assert.equal(browser.keyInput("chat-1", page.id), -1, "A minimized window isn't drawn");
  current.minimized = false;
  browser.show("chat-1");
  browser.setBounds({ x: 400, y: 50, width: 800, height: 700 });
  assert.deepEqual([view.bounds.x, browser.keyInput("chat-1", page.id)], [400, 0], "On screen");
  browser.setBounds(null);
  browser.markAgent("chat-1", page.id, null);
  assert.deepEqual([view.visible, view.bounds.x], [false, 0]);
  browser.destroy();
});

test("a page's dialogs: the agent answers in its tabs, the user in theirs, and a hidden tab's closes", async () => {
  const current = fakeWindow();
  const browser = createBrowser({ window: () => current, store: memoryStore() });
  const page = browser.openTab("chat-1", { url: "https://shop.example/" });
  const contents = browser.webContents("chat-1", page.id).contents;
  const open = (type, message, value = "") => { const event = { senderFrame: { url: "https://shop.example/cart" } }; contents.ipc.emit("timewarp-browser:dialog", event, { type, message, value }); return event; };
  // Nobody is looking at the user's hidden tab: dismissed at once, as in Chrome.
  shown.length = 0;
  assert.equal(open("confirm", "Leave?").returnValue, false);
  // The agent's tab: an alert closes at once and is reported; a confirm or prompt waits for the agent.
  browser.markAgent("chat-1", page.id, { name: "Orbit", action: "Clicking" });
  const heard = [], stop = browser.onDialog((conversationId, tabId) => heard.push([conversationId, tabId]));
  let event = open("alert", "Saved!");
  assert.ok("returnValue" in event);
  assert.deepEqual(browser.notes("chat-1"), ['The page showed an alert: "Saved!"']);
  event = open("prompt", "Your name?", "Ada");
  assert.equal("returnValue" in event, false, "The page waits");
  assert.deepEqual(heard, [["chat-1", page.id]]);
  assert.deepEqual(browser.dialogs("chat-1"), [{ tabId: page.id, type: "prompt", message: "Your name?", site: "shop.example", forAgent: true, value: "Ada" }]);
  assert.equal(browser.state("chat-1").tabs[0].dialog.type, "prompt");
  browser.answerDialog("chat-1", page.id, { accept: true, text: "Grace" });
  assert.equal(event.returnValue, "Grace");
  assert.deepEqual(browser.dialogs("chat-1"), []);
  // Unanswered when the agent's turn ends: dismissed, and it hears so.
  event = open("confirm", "Delete it?");
  browser.endAgentDialogs("chat-1");
  assert.equal(event.returnValue, false);
  assert.match(browser.notes("chat-1")[0], /confirm "Delete it\?" was dismissed when your turn ended/);
  stop();
  assert.equal(shown.length, 0, "The user wasn't asked");
  // Leaving a page that warns about unsaved changes: the agent leaves it.
  let left = false;
  contents.emit("will-prevent-unload", { preventDefault: () => { left = true; } });
  assert.equal(left, true);
  assert.match(browser.notes("chat-1")[0], /left anyway/);
  // The user's own tab on screen: they're asked, in a dialog on the window.
  browser.markAgent("chat-1", page.id, null);
  browser.show("chat-1");
  browser.setBounds({ x: 400, y: 50, width: 800, height: 700 });
  event = open("confirm", "Empty the cart?");
  assert.equal(shown.length, 1);
  assert.deepEqual([shown[0].window, shown[0].options.message, shown[0].options.detail, shown[0].options.buttons], [current, "shop.example says", "Empty the cart?", ["OK", "Cancel"]]);
  assert.throws(() => browser.answerDialog("chat-1", page.id, { accept: true }), /user is answering/);
  shown[0].resolve({ response: 0 });
  await tick();
  assert.equal(event.returnValue, true);
  // Closing the tab answers a dialog still open, so the page isn't left waiting.
  event = open("alert", "Bye");
  browser.close("chat-1", page.id);
  await tick();
  assert.ok("returnValue" in event);
  for (const answer of [0, 1]) {
    leaveAnswer = answer;
    const other = browser.webContents("chat-1", browser.openTab("chat-1", { url: "https://docs.example/" }).id).contents;
    browser.setBounds({ x: 400, y: 50, width: 800, height: 700 });
    left = false;
    other.emit("will-prevent-unload", { preventDefault: () => { left = true; } });
    assert.equal(left, answer === 0, "Leave or stay, as the user chose");
    assert.equal(shown.at(-1).options.message, "Leave site?");
  }
  browser.destroy();
});

test("a page's right-click menu has the previous app's items", () => {
  const current = fakeWindow();
  const browser = createBrowser({ window: () => current, store: memoryStore() });
  const page = browser.openTab("chat-1", { url: "https://example.com/" });
  const later = browser.openTab("chat-1", { url: "https://example.org/" });
  const contents = browser.webContents("chat-1", page.id).contents;
  const menu = params => { contents.emit("context-menu", {}, { pageURL: "https://example.com/", selectionText: "", isEditable: false, mediaType: "none", editFlags: {}, ...params }); return menus.at(-1); };
  const labels = shown => shown.items.filter(item => item.label).map(item => item.label);
  let shownMenu = menu({ linkURL: "https://example.com/next" });
  assert.equal(shownMenu.options.window, current);
  assert.deepEqual(labels(shownMenu), ["Open link in new tab", "Copy link address", "Open page in default browser"]);
  shownMenu.items[0].click();
  let state = browser.state("chat-1");
  assert.deepEqual(state.tabs.map(tab => tab.url), ["https://example.com/", "https://example.com/next", "https://example.org/"], "Next to its page");
  assert.equal(state.active, later.id, "In the background");
  shownMenu.items[1].click();
  assert.equal(copied.at(-1), "https://example.com/next");
  shownMenu.items.at(-1).click();
  assert.equal(opened.at(-1), "https://example.com/");
  assert.deepEqual(labels(menu({ isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: true } })), ["Cut", "Copy", "Paste", "Select all", "Open page in default browser"]);
  assert.deepEqual(labels(menu({ mediaType: "image", srcURL: "https://example.com/cat.png", hasImageContents: true })), ["Copy image", "Copy image address", "Open page in default browser"]);
  shownMenu = menu({});
  assert.deepEqual(labels(shownMenu), ["Back", "Forward", "Reload", "Open page in default browser"]);
  shownMenu.items[2].click();
  assert.equal(contents.reloaded, true);
  browser.destroy();
});

test("removing a profile clears its storage and removes its folder, or does so at the next start if it's in use", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-partitions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folderOf = name => { const folder = path.join(root, "Partitions", name); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, "Cookies"), "x"); return folder; };
  const store = memoryStore();
  const browser = createBrowser({ window: () => null, store });
  const session = browser.sessionFor("work");
  session.storagePath = folderOf("tw-browser-work");
  await browser.removeProfile("work");
  assert.deepEqual([session.cleared, fs.existsSync(session.storagePath)], [true, false]);
  // Files still in use: left for the next start.
  const locked = browser.sessionFor("locked");
  locked.storagePath = folderOf("tw-browser-locked");
  const rm = fs.promises.rm;
  fs.promises.rm = async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); };
  try { await browser.removeProfile("locked"); } finally { fs.promises.rm = rm; }
  assert.deepEqual(store.settings.get("browserStorageToRemove"), [locked.storagePath]);
  browser.destroy();
  createBrowser({ window: () => null, store }).destroy();
  assert.equal(fs.existsSync(locked.storagePath), false);
  assert.deepEqual(store.settings.get("browserStorageToRemove"), []);
});

test("the agent reads another address in the background, without a tab; its downloads are cancelled", async () => {
  const browser = createBrowser({ window: () => null, store: memoryStore() });
  let page, cancelled = false;
  const text = await browser.readAway("chat-1", "example.com/news", async contents => {
    page = contents;
    sessions.get("persist:tw-browser-default").handlers["will-download"]({}, { cancel: () => { cancelled = true; } }, contents);
    return "read " + contents.getURL();
  });
  assert.equal(text, "read https://example.com/news");
  assert.deepEqual([page.isDestroyed(), cancelled, browser.state("chat-1").tabs.length], [true, true, 0]);
  await assert.rejects(browser.readAway("chat-1", "file:///C:/Windows/win.ini", async () => ""), /web pages/);
  browser.destroy();
});

test("a page's pop-up opens as a tab beside it, keeps its opener and closes itself", () => {
  const browser = createBrowser({ window: () => null, store: memoryStore() });
  const shop = browser.openTab("chat-1", { url: "https://shop.example/" });
  const later = browser.openTab("chat-1", { url: "https://example.org/" });
  browser.activate("chat-1", shop.id);
  const opener = browser.webContents("chat-1", shop.id).contents;
  for (const url of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "chrome://settings", "https://u:p@example.com/"]) assert.deepEqual(opener.openHandler({ url }), { action: "deny" }, url);
  // "Sign in with Google" in pop-up mode: the page opens a blank window and keeps a handle on it.
  const answer = opener.openHandler({ url: "about:blank", frameName: "signin", features: "popup,width=500" });
  assert.deepEqual([answer.action, answer.outlivesOpener], ["allow", true]);
  const preferences = answer.overrideBrowserWindowOptions.webPreferences;
  assert.equal(preferences.session, browser.sessionFor("default"), "The pop-up shares the page's profile and sign-ins");
  assert.deepEqual([preferences.sandbox, preferences.contextIsolation, preferences.nodeIntegration], [true, true, false]);
  const guest = new FakeContents();
  assert.equal(answer.createWindow({ webContents: guest, webPreferences: preferences }), guest, "Electron's new page is adopted, so window.opener works");
  let state = browser.state("chat-1");
  const popup = state.tabs.find(tab => ![shop.id, later.id].includes(tab.id));
  assert.deepEqual(state.tabs.map(tab => tab.id), [shop.id, popup.id, later.id], "It opens next to its page");
  assert.equal(state.active, popup.id, "It comes to the front, as its page was in front");
  // It's set up like any tab: addresses are checked, titles show, its own pop-ups open as tabs too.
  let prevented = false;
  guest.emit("will-navigate", { preventDefault: () => { prevented = true; } }, "javascript:alert(1)");
  assert.ok(prevented);
  guest.url = "https://accounts.google.com/signin";
  guest.emit("did-navigate", {}, guest.url);
  guest.emit("page-title-updated", {}, "Sign in - Google Accounts");
  state = browser.state("chat-1");
  assert.deepEqual([state.tabs[1].url, state.tabs[1].title], ["https://accounts.google.com/signin", "Sign in - Google Accounts"]);
  assert.equal(typeof guest.openHandler, "function");
  // Done, the pop-up closes itself: its tab goes and the page that opened it is shown again.
  guest.close();
  state = browser.state("chat-1");
  assert.deepEqual(state.tabs.map(tab => tab.id), [shop.id, later.id]);
  assert.equal(state.active, shop.id);
  // A pop-up Electron gives no page for (noopener) loads its address itself.
  const paypal = opener.openHandler({ url: "https://www.paypal.com/checkoutnow?token=1" }).createWindow({ webPreferences: preferences });
  assert.equal(paypal.getURL(), "https://www.paypal.com/checkoutnow?token=1");
  browser.destroy();
});

test("pages outlive a closed window, keep working for the agent and go into the next window", () => {
  let current = null;
  const browser = createBrowser({ window: () => current, store: memoryStore() });
  // No window (macOS keeps running after it closes): the agent still browses.
  const page = browser.openTab("chat-1", { url: "https://example.com/" });
  let target = browser.webContents("chat-1", page.id);
  const contents = target.contents;
  assert.equal(contents.getURL(), "https://example.com/");
  assert.deepEqual([target.onScreen, target.inWindow], [false, false]);
  // A window opens: the page goes into it, hidden until the pane says where it is.
  const first = fakeWindow();
  current = first;
  browser.show("chat-1");
  const view = [...first.contentView.children][0];
  assert.equal(view?.webContents, contents);
  assert.equal(view.visible, false);
  browser.setBounds({ x: 400, y: 50, width: 800, height: 700 });
  assert.deepEqual([view.visible, browser.webContents("chat-1", page.id).onScreen], [true, true]);
  // The window closes: the page stays open and is no longer on screen.
  first.closed = true;
  current = null;
  target = browser.webContents("chat-1", page.id);
  assert.deepEqual([target.contents, target.onScreen, target.inWindow], [contents, false, false]);
  assert.equal(contents.isDestroyed(), false);
  // The next window gets the chat's pages back.
  const second = fakeWindow();
  current = second;
  browser.show("chat-1");
  assert.ok(second.contentView.children.has(view));
  assert.equal(view.visible, false, "Hidden until the new pane reports its place");
  browser.setBounds({ x: 400, y: 50, width: 800, height: 700 });
  assert.deepEqual([view.visible, browser.webContents("chat-1", page.id).inWindow], [true, true]);
  browser.close("chat-1", page.id);
  assert.equal(second.contentView.children.size, 0);
  assert.equal(contents.isDestroyed(), true);
  browser.destroy();
});

test("an agent's downloads go to its workspace without a dialog; the user's own ask where to save", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-downloads-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "agent");
  const browser = createBrowser({ window: () => null, store: memoryStore({ agents: { "agent-1": { id: "agent-1", workspace } } }) });
  const page = browser.openTab("chat-1", { url: "https://example.com/" });
  const contents = browser.webContents("chat-1", page.id).contents;
  const started = sessions.get("persist:tw-browser-default").handlers["will-download"];
  const item = name => Object.assign(new EventEmitter(), { getFilename: () => name, setSavePath(file) { this.path = file; }, getSavePath() { return this.path || path.join(root, "Downloads", name); } });
  shownFiles.length = 0;
  // The user's own download: Electron asks where to save, then the file is shown.
  const own = item("invoice.pdf");
  started({}, own, contents);
  assert.equal(own.path, undefined);
  own.emit("done", {}, "completed");
  assert.deepEqual(shownFiles, [path.join(root, "Downloads", "invoice.pdf")]);
  assert.deepEqual(browser.downloads("chat-1"), []);
  // While the agent works in the tab, files go to "downloads" in its workspace, under free names.
  browser.markAgent("chat-1", page.id, { name: "Orbit", action: "Clicking" });
  const first = item("invoice.pdf"), second = item("invoice.pdf"), odd = item("CON.txt");
  for (const download of [first, second, odd]) started({}, download, contents);
  const folder = path.join(workspace, "downloads");
  assert.deepEqual([first.path, second.path, odd.path], [path.join(folder, "invoice.pdf"), path.join(folder, "invoice (1).pdf"), path.join(folder, "_CON.txt")]);
  assert.ok(fs.statSync(folder).isDirectory());
  assert.deepEqual(browser.downloads("chat-1").map(entry => entry.state), ["progressing", "progressing", "progressing"]);
  assert.deepEqual(browser.downloads("chat-1"), [], "Each change is reported once");
  first.emit("done", {}, "completed");
  second.emit("done", {}, "cancelled");
  assert.deepEqual(browser.downloads("chat-1"), [{ file: first.path, state: "completed" }, { file: second.path, state: "cancelled" }]);
  assert.equal(shownFiles.length, 1, "No folder window opens for the agent's downloads");
  // A worker's background tab saves to the workspace too.
  const worker = browser.openTab("chat-1", { url: "https://example.net/", activate: false, worker: true });
  const report = item("report.csv");
  started({}, report, browser.webContents("chat-1", worker.id).contents);
  assert.equal(report.path, path.join(folder, "report.csv"));
  browser.destroy();
});
