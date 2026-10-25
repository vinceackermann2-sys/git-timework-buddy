"use strict";
// The Agent ID window (agent-id-window.cjs): the owner's own pages, apart from
// every agent's browser, with the website signed in from the app.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentIdWindows } = require("../app/main/agent-id-window.cjs");

const SITE = "https://timewarpdev.com";
const KEY = "sb-project-auth-token";

// Electron as the window uses it: windows, storage per partition and origin, and dialogs.
function electron({ answer = 0 } = {}) {
  const windows = [], partitions = new Map(), storage = new Map(), asked = [];
  const storageOf = (partition, origin) => {
    const key = partition + " " + origin;
    if (!storage.has(key)) storage.set(key, new Map());
    const map = storage.get(key);
    return { getItem: name => map.has(name) ? map.get(name) : null, setItem: (name, value) => { map.set(name, String(value)); }, map };
  };
  class BrowserWindow {
    constructor(options) {
      this.options = options; this.listeners = {}; this.shown = false; this.destroyed = false; this.url = ""; this.loads = [];
      const self = this, partition = options.webPreferences.session.partition;
      this.webContents = {
        listeners: {}, openHandler: null,
        on(name, fn) { (this.listeners[name] ||= []).push(fn); },
        setWindowOpenHandler(fn) { this.openHandler = fn; },
        getURL: () => self.url,
        isDestroyed: () => self.destroyed,
        executeJavaScript: async script => new Function("localStorage", "return " + script)(storageOf(partition, new URL(self.url).origin)),
        emit(name, ...args) { for (const fn of this.listeners[name] || []) fn(...args); },
      };
      windows.push(this);
    }
    static fromWebContents(contents) { return windows.find(window => window.webContents === contents) || null; }
    on(name, fn) { (this.listeners[name] ||= []).push(fn); }
    once(name, fn) { this.on(name, fn); }
    async loadURL(url) { this.url = url; this.loads.push(url); }
    show() { this.shown = true; }
    focus() {}
    isMinimized() { return false; }
    restore() {}
    setTitle(title) { this.title = title; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    close() { if (this.destroyed) return; this.destroyed = true; for (const fn of this.listeners.closed || []) fn(); }
  }
  const session = {
    fromPartition(partition) {
      if (!partitions.has(partition)) partitions.set(partition, { partition, cleared: 0, setPermissionRequestHandler(fn) { this.request = fn; }, setPermissionCheckHandler(fn) { this.check = fn; }, async clearStorageData() { this.cleared++; } });
      return partitions.get(partition);
    },
  };
  const dialog = { showMessageBox: async (_window, options) => { asked.push(options.message); return { response: answer }; } };
  return { BrowserWindow, session, dialog, windows, partitions, storageOf, asked };
}

function setup({ account = "user-1", answer, failSignIn = false, loopback = false } = {}) {
  const fake = electron({ answer });
  let user = account;
  const requests = [], logs = [];
  let closed = 0;
  const request = async (method, route, options) => {
    requests.push({ method, route, ...options });
    if (failSignIn) throw Object.assign(new Error("This endpoint does not exist."), { status: 404 });
    return { session: { access_token: "web-access", refresh_token: "web-refresh", expires_in: 3600, expires_at: 2000000000, user: { id: user, email: `${user}@example.com` } } };
  };
  const windows = createAgentIdWindows({
    BrowserWindow: fake.BrowserWindow, session: fake.session, dialog: fake.dialog, icon: null, userId: () => user, request, site: SITE,
    supabaseUrl: "https://project.supabase.co", loopback, onClosed: () => { closed++; }, log: (...args) => logs.push(args),
  });
  // The visible windows, not the hidden one that signs the website in.
  const shown = () => fake.windows.filter(window => window.options.show !== false || window.shown);
  return { fake, windows, requests, logs, shown, closed: () => closed, switchUser: id => { user = id; } };
}

test("the website opens signed in, with a session of its own for the account, made once", async () => {
  const { fake, windows, requests, shown } = setup();
  assert.deepEqual(await windows.open(`${SITE}/agent-id/agents/agt_1?tab=wallet`), { opened: true });
  assert.deepEqual(requests.map(item => [item.method, item.route]), [["POST", "/v1/account/web-session"]]);
  const [window] = shown();
  assert.equal(window.url, `${SITE}/agent-id/agents/agt_1?tab=wallet`);
  assert.ok(window.shown);
  // Kept where the website's Supabase client looks for it, for this account only.
  const partition = window.options.webPreferences.session.partition;
  assert.match(partition, /^persist:tw-agent-id-[0-9a-f]{24}$/);
  const kept = JSON.parse(fake.storageOf(partition, SITE).getItem(KEY));
  assert.deepEqual(kept, { access_token: "web-access", refresh_token: "web-refresh", token_type: "bearer", expires_in: 3600, expires_at: 2000000000, user: { id: "user-1", email: "user-1@example.com" } });
  // The hidden page that did it is gone; the next page reuses the window and the session.
  assert.ok(fake.windows.filter(item => item !== window).every(item => item.destroyed));
  await windows.open(`${SITE}/agent-id/verify`);
  assert.equal(requests.length, 1);
  assert.equal(shown().length, 1);
  assert.equal(window.url, `${SITE}/agent-id/verify`);
});

test("each account has its own window and storage; the last account's window closes", async () => {
  const { fake, windows, requests, shown, closed, switchUser } = setup();
  await windows.open(`${SITE}/agent-id/dashboard`);
  switchUser("user-2");
  await windows.open(`${SITE}/agent-id/dashboard`);
  const [first, second] = shown();
  assert.ok(first.destroyed && !second.destroyed);
  assert.equal(closed(), 1);
  assert.notEqual(first.options.webPreferences.session.partition, second.options.webPreferences.session.partition);
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(fake.storageOf(second.options.webPreferences.session.partition, SITE).getItem(KEY)).user.id, "user-2");
  windows.close();
  assert.ok(second.destroyed);
  assert.equal(windows.isOpen(), false);
});

test("a provider's page opens without touching the website's sign-in; signed out, nothing opens", async () => {
  const { windows, requests, shown, switchUser } = setup();
  await windows.open("https://verify.stripe.com/start/test_123");
  assert.equal(requests.length, 0);
  assert.equal(shown()[0].url, "https://verify.stripe.com/start/test_123");
  switchUser(null);
  await assert.rejects(windows.open(`${SITE}/agent-id/dashboard`), /Sign in to Timewarp/);
});

test("the website still opens when it can't be signed in from here, and asks itself", async () => {
  const { windows, shown, logs } = setup({ failSignIn: true });
  assert.deepEqual(await windows.open(`${SITE}/agent-id/dashboard`), { opened: true });
  assert.equal(shown()[0].url, `${SITE}/agent-id/dashboard`);
  assert.match(logs[0][0], /couldn't be signed in/);
});

test("only web pages over https open, and only they can be navigated to or opened as pop-ups", async () => {
  const { windows, shown } = setup();
  await assert.rejects(windows.open("http://timewarpdev.com/agent-id"), /can't be opened here/);
  await assert.rejects(windows.open("https://user:pass@timewarpdev.com/"), /can't be opened here/);
  await assert.rejects(windows.open("http://127.0.0.1:54341/dev/bridge-kyc"), /can't be opened here/);
  await windows.open("https://bridge.example/kyc");
  const [window] = shown();
  let prevented = 0;
  window.webContents.emit("will-navigate", { url: "file:///C:/secrets.txt", preventDefault: () => { prevented++; } });
  window.webContents.emit("will-navigate", { url: "https://checkout.stripe.com/pay", preventDefault: () => { prevented++; } });
  window.webContents.emit("will-redirect", { url: "ms-settings:privacy", preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2);
  assert.equal(window.webContents.openHandler({ url: "https://privy.example/pay" }).action, "allow");
  assert.equal(window.webContents.openHandler({ url: "mailto:a@example.com" }).action, "deny");
  // A preview build against a local Agent ID opens its local pages.
  const local = setup({ loopback: true });
  assert.deepEqual(await local.windows.open("http://127.0.0.1:54341/dev/bridge-kyc?x=1"), { opened: true });
});

test("the camera is asked for each site while the window is open; nothing else is given", async () => {
  const { fake, windows, shown } = setup();
  await windows.open("https://verify.stripe.com/start/test_123");
  const [window] = shown();
  const profile = window.options.webPreferences.session;
  const ask = (permission, details) => new Promise(resolve => profile.request(window.webContents, permission, resolve, details));
  const camera = { securityOrigin: "https://verify.stripe.com", mediaTypes: ["video"] };
  assert.equal(await ask("media", camera), true);
  assert.equal(await ask("media", camera), true);
  assert.deepEqual(fake.asked, ["Allow verify.stripe.com to use your camera?"]);
  assert.equal(profile.check(window.webContents, "media", "https://verify.stripe.com", { mediaType: "video" }), true);
  assert.equal(profile.check(window.webContents, "media", "https://other.example", { mediaType: "video" }), false);
  assert.equal(await ask("notifications", {}), false);
  assert.equal(await ask("fullscreen", {}), true);
  // Closing the window takes it back: the next check asks again.
  windows.close();
  await windows.open("https://verify.stripe.com/start/test_456");
  const again = shown().at(-1);
  assert.equal(await new Promise(resolve => profile.request(again.webContents, "media", resolve, camera)), true);
  assert.equal(fake.asked.length, 2);
  const refused = setup({ answer: 1 });
  await refused.windows.open("https://verify.stripe.com/start/test_123");
  const other = refused.shown()[0];
  assert.equal(await new Promise(resolve => other.options.webPreferences.session.request(other.webContents, "media", resolve, camera)), false);
});

test("signing out of Timewarp clears every account's Agent ID storage, and nothing else", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { fake, windows, shown } = setup();
  await windows.open(`${SITE}/agent-id/dashboard`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tw-partitions-"));
  const ours = shown()[0].options.webPreferences.session.partition.replace(/^persist:/, "");
  for (const name of [ours, "tw-agent-id-" + "b".repeat(24), "tw-browser-default"]) fs.mkdirSync(path.join(directory, name));
  await windows.forget(directory);
  assert.ok(shown()[0].destroyed);
  assert.equal(fake.partitions.get("persist:" + ours).cleared, 1);
  assert.equal(fake.partitions.get("persist:tw-agent-id-" + "b".repeat(24)).cleared, 1);
  assert.equal(fake.partitions.has("persist:tw-browser-default"), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
