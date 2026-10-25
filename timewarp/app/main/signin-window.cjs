"use strict";
// Sign-in windows: connecting ChatGPT, an app or an MCP server happens in a
// Timewarp window, never in another app. The window uses the default browser
// profile, as in the previous app, so a site signed in there is signed in for
// the agent's browser too. That profile never lets a page open another app
// (browser.cjs grants no openExternal), so a sign-in can't hand the user to
// the ChatGPT app.
//
// Codex finishes ChatGPT and MCP server sign-ins on a callback server of its
// own on this computer (the link's redirect_uri). For those, the window hands
// the callback to Codex itself and shows Timewarp's page instead of Codex's.
// Other sign-ins return to Timewarp's own callback page, and the window closes.
//
// A sign-in started in a chat opens in that chat instead: a tab of its own in
// the chat's pane (browser.cjs openSignin), followed the same way. When it
// comes back the tab closes, and the chat hears how it went (onResult).
const http = require("node:http");
const { authPage } = require("../../desktop/auth-page.cjs");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const isLoopback = address => { try { return LOOPBACK.has(new URL(address).hostname); } catch { return false; } };
const isWeb = address => { try { return ["https:", "http:"].includes(new URL(address).protocol); } catch { return false; } };

// The callback a sign-in link returns to, when it's a server on this computer.
function callbackOf(link) {
  try {
    const back = new URL(new URL(link).searchParams.get("redirect_uri") || "");
    return back.protocol === "http:" && isLoopback(back.href) && back.port ? back : null;
  } catch { return null; }
}
const sameServer = (address, back) => {
  try { const url = new URL(address); return url.protocol === "http:" && isLoopback(url.href) && url.port === back.port; } catch { return false; }
};

// Requests the callback as the window would have, following redirects on the
// same server: Codex sends a ChatGPT sign-in on to /success, which completes
// it. Resolves to the last answer's status and path.
function relayCallback(address, { timeout = 90000, hops = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(address);
    const request = http.get({ host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port, path: url.pathname + url.search, headers: { host: url.host }, timeout }, response => {
      response.resume();
      let next = null;
      try { next = response.statusCode >= 300 && response.statusCode < 400 && response.headers.location ? new URL(response.headers.location, url) : null; } catch {}
      if (next && hops > 0 && sameServer(next.href, url)) return void relayCallback(next.href, { timeout, hops: hops - 1 }).then(resolve, reject);
      resolve({ status: response.statusCode, path: url.pathname });
    });
    request.on("timeout", () => request.destroy(new Error("The sign-in callback didn't answer.")));
    request.on("error", reject);
  });
}

// session: the browser profile's session. logo (a data URL) and css make
// Timewarp's pages, which have no server behind them. chat(conversationId,
// link, { onClosed }), when given, opens a sign-in in that chat's pane and
// returns { contents, close }, or null when the chat can't show it.
// onResult({ conversationId, ok, title, message }) tells a chat how a sign-in
// Codex completes went.
function createSigninWindows({ BrowserWindow, session, parent = () => null, icon, logo, css, log = { info() {}, warn() {} }, relay = relayCallback, closeDelay = 1500, chat = null, onResult = () => {} }) {
  const page = ({ title, message, hint }, state) => "data:text/html;charset=utf-8;base64," + Buffer.from(authPage({ title, message, hint, success: state === "done", pending: state === "pending", logo, css })).toString("base64");

  // Follows a sign-in's page, in a window or a chat's tab. With back, the
  // provider's return to Codex's callback is handed to Codex from here, and
  // answer gets "pending", then "done" or "failed". Without it, a return to
  // Timewarp's own callback page calls home. progress.returned: whether the
  // sign-in came back to this computer.
  function follow(contents, { back, finish, answer, home, progress }) {
    const handOver = (event, next, mainFrame) => {
      if (!back || !mainFrame || !sameServer(next, back)) return;
      event.preventDefault();
      if (progress.returned) return;
      progress.returned = true;
      log.info("connector", "Sign-in returned to Timewarp");
      answer("pending");
      relay(next).then(result => !!finish.done(result), error => { log.warn("connector", "Codex didn't take the sign-in", { message: error.message }); return false; })
        .then(ok => answer(ok ? "done" : "failed"));
    };
    contents.on("will-navigate", (event, next) => {
      const address = event.url || next;
      if (!isWeb(address)) return event.preventDefault();
      handOver(event, address, true);
    });
    contents.on("will-redirect", (event, next, _inPlace, isMainFrame) => handOver(event, event.url || next, event.isMainFrame ?? isMainFrame));
    // Timewarp's own callback page (127.0.0.1:17654) says the sign-in is done.
    contents.on("did-navigate", (_event, next) => {
      if (back || !isLoopback(next)) return;
      progress.returned = true;
      log.info("connector", "Sign-in returned to Timewarp");
      home();
    });
    contents.on("did-fail-load", (_event, code, description, next, isMainFrame) => { if (isMainFrame && code !== -3) log.warn("connector", "The sign-in page didn't load", { code, description, origin: (() => { try { return new URL(next).origin; } catch { return null; } })() }); });
  }

  // In the chat: its tab closes once the sign-in is back, and a sign-in Codex
  // completes tells the chat how it went.
  function openInChat(conversationId, url, { back, finish, onClose }) {
    const progress = { returned: false };
    const tab = chat(conversationId, url.href, { onClosed: () => { void Promise.resolve().then(() => onClose({ returned: progress.returned })).catch(() => {}); } });
    if (!tab) return null;
    follow(tab.contents, {
      back, finish, progress,
      answer: state => {
        if (state === "pending") return;
        const ok = state === "done", shown = ok ? finish.success : finish.failure;
        onResult({ conversationId, ok, title: shown.title, message: ok ? "" : shown.message });
        tab.close();
      },
      // Timewarp's page shows a moment first.
      home: () => setTimeout(tab.close, closeDelay),
    });
    log.info("connector", "Sign-in opened in the chat", { origin: url.origin });
    return { opened: true, inChat: true, close: tab.close };
  }

  // finish, for a sign-in Codex completes: done(answer) tells whether its
  // callback's answer means success, and pending, success and failure are the
  // pages shown meanwhile and after. onClose({ returned }) runs when the window
  // or the chat's tab closes; returned is whether the sign-in came back to this
  // computer. conversationId: the chat it was started in, where it opens when
  // that chat can show it.
  function open(link, { title = "Connect an app", finish = null, onClose = () => {}, conversationId = null } = {}) {
    let url;
    try { url = new URL(link); } catch { throw new Error("The sign-in link isn't valid."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("The sign-in link isn't valid.");
    // A server set up with a callback elsewhere ends on its own page there.
    const back = finish ? callbackOf(url.href) : null;
    if (conversationId && chat) {
      let opened = null;
      try { opened = openInChat(conversationId, url, { back, finish, onClose }); }
      catch (error) { log.warn("connector", "The sign-in couldn't open in the chat", { message: error.message }); }
      if (opened) return opened;
    }
    const profile = session();
    const window = new BrowserWindow({
      parent: parent() || undefined, width: 560, height: 780, minWidth: 420, minHeight: 560, title, icon, autoHideMenuBar: true, backgroundColor: "#ffffff", show: false,
      webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
    });
    const progress = { returned: false };
    const show = (content, state) => { if (!window.isDestroyed()) void window.loadURL(page(content, state)).catch(() => {}); };
    const closeSoon = () => setTimeout(() => { if (!window.isDestroyed()) window.close(); }, closeDelay);
    window.once("ready-to-show", () => window.show());
    // The title bar always names the site being signed in to, as the previous
    // app's sign-in panel showed its address; pages can't change it.
    const showAddress = () => {
      if (window.isDestroyed()) return;
      const address = window.webContents.getURL();
      window.setTitle(isWeb(address) ? `${title} — ${new URL(address).host}` : title);
    };
    window.on("page-title-updated", event => event.preventDefault());
    window.webContents.on("did-navigate", showAddress);
    window.webContents.on("did-navigate-in-page", showAddress);
    window.webContents.setWindowOpenHandler(({ url: next }) => isWeb(next) && new URL(next).protocol === "https:"
      ? { action: "allow", overrideBrowserWindowOptions: { parent: window, autoHideMenuBar: true, webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false } } }
      : { action: "deny" });

    // The provider sends the window to Codex's callback, by a link or a
    // redirect. Codex gets the request from here; the window never shows its
    // page but Timewarp's. After Timewarp's own callback page the window
    // closes, as in the previous app.
    follow(window.webContents, {
      back, finish, progress, home: closeSoon,
      answer: state => { show(state === "pending" ? finish.pending : state === "done" ? finish.success : finish.failure, state); if (state === "done") closeSoon(); },
    });
    window.on("closed", () => { void Promise.resolve().then(() => onClose({ returned: progress.returned })).catch(() => {}); });
    log.info("connector", "Sign-in window opened", { origin: url.origin });
    void window.loadURL(url.href).catch(() => {});
    return { opened: true, close: () => { if (!window.isDestroyed()) window.close(); } };
  }
  return { open };
}

module.exports = { createSigninWindows, callbackOf, relayCallback };
