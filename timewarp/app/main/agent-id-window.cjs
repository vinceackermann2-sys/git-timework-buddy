"use strict";
// The Agent ID window: the owner's own pages, in a Timewarp window of their
// own. The identity check (an ID document and a selfie, on the provider's
// page) and the Agent ID website (adding and withdrawing money, an agent's
// limits and keys) open here, never in an agent's browser: agents can't see
// or click in this window, and its storage is apart from every browser
// profile, one for each account.
//
// The website opens signed in. The window gets a session of its own for the
// account from Agent ID (POST /v1/account/web-session), kept where the
// website keeps it, so the app's own session never leaves the app.
const crypto = require("node:crypto");
const fs = require("node:fs");

const fail = (status, message) => Object.assign(new Error(message), { status });
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
// What its pages may use besides the camera and microphone, which are asked for.
const ALLOWED = new Set(["fullscreen", "clipboard-sanitized-write"]);
const originOf = address => { try { const value = new URL(address).origin; return value === "null" ? null : value; } catch { return null; } };
const hostOf = address => { try { return new URL(address).host; } catch { return ""; } };

// site: the Agent ID website; supabaseUrl: the Supabase project it signs in
// with. loopback: also local pages (preview builds, against a local API).
function createAgentIdWindows({ BrowserWindow, session, dialog, icon, userId, request, site, supabaseUrl, loopback = false, onClosed = () => {}, log = () => {} }) {
  const siteOrigin = new URL(site).origin;
  // Where the website's Supabase client keeps its session (supabase-js's default key).
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  const allowed = address => {
    try {
      const url = new URL(address);
      return !url.username && !url.password && (url.protocol === "https:" || (loopback && url.protocol === "http:" && LOOPBACK.has(url.hostname)));
    } catch { return false; }
  };
  let current = null; // { window, account }

  // What each account's storage was allowed to use while its window is open.
  const grants = new Map();
  function profileFor(account) {
    const partition = "persist:tw-agent-id-" + crypto.createHash("sha256").update(String(account)).digest("hex").slice(0, 24);
    const profile = session.fromPartition(partition);
    if (grants.has(profile)) return profile;
    // The camera and microphone: asked for each site while the window is open
    // (the identity check's photos and selfie); nothing else.
    const granted = new Set();
    grants.set(profile, granted);
    profile.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission !== "media") return callback(ALLOWED.has(permission));
      const origin = originOf(details?.securityOrigin || details?.requestingUrl);
      const types = [...new Set((details?.mediaTypes || []).filter(type => type === "audio" || type === "video"))];
      if (!origin || !types.length) return callback(false);
      if (types.every(type => granted.has(`${origin} ${type}`))) return callback(true);
      const owner = BrowserWindow.fromWebContents(contents);
      const what = types.length === 2 ? "camera and microphone" : types[0] === "video" ? "camera" : "microphone";
      dialog.showMessageBox(owner || undefined, { type: "question", title: "Agent ID", message: `Allow ${hostOf(origin) || origin} to use your ${what}?`, buttons: ["Allow", "Don't allow"], defaultId: 0, cancelId: 1, noLink: true })
        .then(({ response }) => { if (response === 0) for (const type of types) granted.add(`${origin} ${type}`); callback(response === 0 && !contents.isDestroyed()); }, () => callback(false));
    });
    profile.setPermissionCheckHandler((_contents, permission, origin, details) => permission === "media"
      ? [...granted].some(entry => entry.startsWith(`${originOf(origin)} `) && (!details?.mediaType || entry.endsWith(` ${details.mediaType}`)))
      : ALLOWED.has(permission));
    return profile;
  }

  // The website signed in as the account: the session it keeps already, or a
  // new one from Agent ID, written where the website looks for it. A page
  // of the site's that never runs its scripts (robots.txt) does the work.
  async function signIn(profile, account) {
    const helper = new BrowserWindow({ show: false, webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    try {
      await helper.loadURL(siteOrigin + "/robots.txt");
      const read = await helper.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(storageKey)})`);
      try { const kept = JSON.parse(read); if (kept?.refresh_token && kept.user?.id === account) return true; } catch {}
      const { session: made } = await request("POST", "/v1/account/web-session", { body: {} });
      if (!made?.access_token || !made.refresh_token) return false;
      const expiresIn = Number(made.expires_in) || 3600;
      const value = {
        access_token: made.access_token, refresh_token: made.refresh_token, token_type: "bearer", expires_in: expiresIn,
        expires_at: Number(made.expires_at) || Math.floor(Date.now() / 1000) + expiresIn, user: made.user && typeof made.user === "object" ? made.user : { id: account },
      };
      await helper.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(value))})`);
      return true;
    } catch (error) {
      // The website asks for its own sign-in instead.
      log("The Agent ID website couldn't be signed in from the app.", error.message);
      return false;
    } finally { if (!helper.isDestroyed()) helper.destroy(); }
  }

  function windowFor(account, profile) {
    if (current && !current.window.isDestroyed() && current.account === account) return current.window;
    close();
    const window = new BrowserWindow({
      width: 1180, height: 860, minWidth: 420, minHeight: 560, title: "Agent ID", icon, autoHideMenuBar: true, backgroundColor: "#ffffff", show: false,
      webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: true },
    });
    // The title bar always names the site that's open; pages can't change it.
    const showAddress = () => { if (!window.isDestroyed()) { const host = hostOf(window.webContents.getURL()); window.setTitle(host ? `Agent ID — ${host}` : "Agent ID"); } };
    window.on("page-title-updated", event => event.preventDefault());
    window.webContents.on("did-navigate", showAddress);
    window.webContents.on("did-navigate-in-page", showAddress);
    window.webContents.on("will-navigate", (event, next) => { if (!allowed(event.url || next)) event.preventDefault(); });
    window.webContents.on("will-redirect", (event, next) => { if (!allowed(event.url || next)) event.preventDefault(); });
    // A payment or identity provider's own pop-up opens beside it, in the same storage.
    window.webContents.setWindowOpenHandler(({ url }) => allowed(url)
      ? { action: "allow", overrideBrowserWindowOptions: { parent: window, autoHideMenuBar: true, icon, webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } } }
      : { action: "deny" });
    window.webContents.on("did-fail-load", (_event, code, description, address, isMainFrame) => { if (isMainFrame && code !== -3) log("An Agent ID page didn't load.", `${code} ${description} ${originOf(address) || ""}`); });
    window.on("closed", () => { grants.get(profile)?.clear(); if (current?.window === window) current = null; onClosed(); });
    current = { window, account };
    return window;
  }

  // Opens an Agent ID page or a provider's page in the window, the one already open if there is one.
  async function open(address) {
    const account = userId();
    if (!account) throw fail(401, "Sign in to Timewarp.");
    if (!allowed(address)) throw fail(400, "That page can't be opened here.");
    const profile = profileFor(account);
    if (originOf(address) === siteOrigin) await signIn(profile, account);
    const window = windowFor(account, profile);
    void window.loadURL(address).catch(error => { if (error.code !== "ERR_ABORTED") log("An Agent ID page didn't load.", error.message); });
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return { opened: true };
  }

  function close() { if (current && !current.window.isDestroyed()) current.window.close(); current = null; }

  // Signed out of Timewarp: no account's website session or provider sign-ins
  // stay behind. directory: where Electron keeps its storage partitions.
  async function forget(directory) {
    close();
    let names = [];
    try { names = fs.readdirSync(directory).filter(name => /^tw-agent-id-[0-9a-f]{24}$/.test(name)); } catch {}
    await Promise.all(names.map(name => session.fromPartition("persist:" + name).clearStorageData().catch(error => log("Agent ID's storage couldn't be cleared.", error.message))));
  }

  return { open, close, forget, isOpen: () => !!current && !current.window.isDestroyed() };
}

module.exports = { createAgentIdWindows };
