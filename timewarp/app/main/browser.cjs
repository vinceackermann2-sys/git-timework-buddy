"use strict";
// The built-in browser: tabs per conversation, shown as native views in the
// right pane. Each browser profile has its own persistent session, so sign-ins
// stay on this device and separate between profiles.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { WebContentsView, BrowserWindow, Menu, clipboard, dialog, session: electronSession, shell } = require("electron");

const MAX_LIVE_TABS = 16;
// The previous app's storage for a profile: "browser-profile:v1:" and the SHA-256 of its id.
const LEGACY_PARTITION = /^browser-profile:v1:[0-9a-f]{64}$/;
// What pages may use. The camera and microphone are asked for per site
// (askMedia); everything else, such as notifications, reading the clipboard
// and location, is refused, for checks as well as requests.
const ALLOWED = new Set(["fullscreen", "clipboard-sanitized-write"]);
const CHECKS = new Set([...ALLOWED, "storage-access", "top-level-storage-access"]);
// The script that runs before each page and hands its dialogs and first edit to Timewarp.
const PAGE_SCRIPT = path.join(__dirname, "..", "preload", "browser-page.cjs");
const DIALOG = "timewarp-browser:dialog", EDITED = "timewarp-browser:edited";
// An agent's confirm or prompt nobody answers is dismissed after a minute.
const AGENT_DIALOG_MS = 60000;
// Google's sign-in refuses browsers it takes for embedded ones. It gets the
// browser's identity with Timewarp's name in it, as the previous app sent;
// other sites get Chrome's.
const GOOGLE_SIGN_IN = "https://accounts.google.com/*";
// Sites allowed the camera or microphone: { profile id: { origin: ["audio", "video"] } }.
const SITE_PERMISSIONS = "browserSitePermissions";
// Storage of removed profiles that was still in use, removed at the next start.
const REMOVE_LATER = "browserStorageToRemove";
// Hidden pages an agent works in are drawn this far outside the window, out of
// sight; Chromium delivers key presses only to pages it draws.
const PARKED = -30000;
// Page state (scroll position, form contents) kept with a sleeping tab's history.
const MAX_PAGE_STATE = 256 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const siteOf = url => { try { const value = new URL(url); return /^https?:$/.test(value.protocol) ? value.host : ""; } catch { return ""; } };
const originOf = url => { try { const value = new URL(url).origin; return value === "null" ? null : value; } catch { return null; } };

function safeUrl(input) {
  const text = String(input || "").trim();
  if (!text) throw fail(400, "Enter an address.");
  if (/^about:blank$/i.test(text)) return "about:blank";
  let address;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(text)) address = "http://" + text; // local development servers
  else if (/^[^\s/:]+\.[^\s/:]{2,}(:\d+)?([/?#]|$)/.test(text)) address = "https://" + text;
  else if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/\s/.test(text)) address = text;
  else address = "https://www.google.com/search?q=" + encodeURIComponent(text); // searches go to Google, as in Chrome
  let url;
  try { url = new URL(address); }
  catch { throw fail(400, "That address isn't valid."); }
  if (!["http:", "https:"].includes(url.protocol)) throw fail(400, "Only web pages (http and https) can be opened in the browser.");
  if (url.username || url.password) throw fail(400, "Addresses with embedded credentials can't be opened.");
  return url.href;
}

function recordable(url) {
  try { const value = new URL(url); return ["http:", "https:"].includes(value.protocol) && !value.username && !value.password; } catch { return false; }
}
// What a page may open in a new tab: web pages, and the blank page sign-in pop-ups start from.
const opensAsTab = url => url === "about:blank" || recordable(url);

// A page's back and forward history, to bring a sleeping tab back as it was.
// Page state is kept only while Timewarp runs; saved tabs keep addresses and titles.
function historyOf(contents, { pageState = true, around = Infinity } = {}) {
  try {
    if (!contents || contents.isDestroyed()) return null;
    const entries = contents.navigationHistory.getAllEntries(), index = contents.navigationHistory.getActiveIndex();
    return validHistory({ index, entries: entries.map(entry => ({ url: entry.url, title: entry.title, ...(pageState && entry.pageState && entry.pageState.length <= MAX_PAGE_STATE ? { pageState: entry.pageState } : {}) })) }, around);
  } catch { return null; }
}
// Only web pages, and at most `around` entries on each side of the current one.
function validHistory(history, around = Infinity) {
  const entries = Array.isArray(history?.entries) ? history.entries : [];
  const index = Number(history?.index);
  if (!entries.length || !Number.isInteger(index) || index < 0 || index >= entries.length) return null;
  if (!entries.every(entry => typeof entry?.url === "string" && opensAsTab(entry.url))) return null;
  const start = Math.max(0, index - around), kept = entries.slice(start, index + around + 1);
  return { index: index - start, entries: kept.map(entry => ({ url: entry.url, title: String(entry.title || "").slice(0, 300), ...(typeof entry.pageState === "string" ? { pageState: entry.pageState } : {}) })) };
}

// A name for a download that's free in its folder and safe on every system.
function freeFile(folder, name, taken = new Set()) {
  let base = path.basename(String(name || "").replace(/\\/g, "/")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 150) || "download";
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = "_" + base;
  const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
  for (let index = 0; ; index++) {
    const file = path.join(folder, index ? `${stem} (${index})${ext}` : base);
    if (!taken.has(file) && !fs.existsSync(file)) return file;
  }
}

// Removes a folder, retrying while files in it are still being let go.
async function removeFolder(folder, attempts = 8) {
  for (let attempt = 1; ; attempt++) {
    try { await fs.promises.rm(folder, { recursive: true, force: true }); return true; }
    catch (error) { if (attempt >= attempts || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) return false; }
    await pause(100 * attempt);
  }
}

function createBrowser({ window: getWindow, store, notify = () => {}, log = null }) {
  const tabs = new Map(); // tab id -> tab
  const groups = new Map(); // conversation id -> { active: tab id | null }
  const partitions = new Set();
  let shown = null; // conversation id whose tabs are on screen
  let bounds = null;
  let visible = false;
  let host = null; // the window the pages are in
  // Tabs are ordered by when they opened; two can open in the same millisecond.
  let lastOrder = 0;
  const nextOrder = () => (lastOrder = Math.max(Date.now(), lastOrder + 1));
  const downloads = new Map(); // conversation id -> [{ file, state, reported }]
  const saving = new Set(); // files being downloaded
  const away = new WeakSet(); // pages read in the background (readAway), which have no tab
  const tabOf = contents => contents ? [...tabs.values()].find(entry => entry.view?.webContents === contents) || null : null;
  // Storage of profiles removed while it was in use goes now, before any page opens it.
  try {
    const later = store.settings.get(REMOVE_LATER, []) || [];
    const left = later.filter(folder => {
      if (typeof folder !== "string" || path.basename(path.dirname(folder)) !== "Partitions") return false;
      try { fs.rmSync(folder, { recursive: true, force: true }); return false; } catch { return true; }
    });
    if (later.length) store.settings.set(REMOVE_LATER, left);
  } catch {}

  function sessionFor(profileId) {
    // Profiles from the previous app keep their storage, and with it their sign-ins.
    const legacy = store.browserProfiles.list().find(item => item.id === profileId)?.source?.partition;
    const partition = LEGACY_PARTITION.test(legacy || "") ? "persist:" + legacy : "persist:tw-browser-" + profileId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const value = electronSession.fromPartition(partition);
    if (!partitions.has(partition)) {
      partitions.add(partition);
      value.setPermissionRequestHandler((contents, permission, callback, details) => {
        if (permission === "media") { askMedia(profileId, contents, details).then(callback, () => callback(false)); return; }
        callback(ALLOWED.has(permission));
      });
      value.setPermissionCheckHandler((contents, permission, origin, details) => permission === "media" ? mediaAllowed(profileId, contents, origin, details?.mediaType) : CHECKS.has(permission));
      value.on("will-download", (_event, item, contents) => download(item, contents));
      // Pages see the same Chrome identity as in Chrome itself, except Google's
      // sign-in page (GOOGLE_SIGN_IN), which gets it with Timewarp's name.
      const own = value.getUserAgent().replace(/\s*Electron\/\S+/, "").trim();
      value.setUserAgent(own.replace(/(\(KHTML, like Gecko\)\s+)(?:[^\s/]+\/\S+\s+)+(?=Chrome\/)/, "$1").replace(/\s*timewarp(?:-desktop)?\/\S+/gi, "").trim());
      value.webRequest?.onBeforeSendHeaders({ urls: [GOOGLE_SIGN_IN] }, (details, callback) => {
        const name = Object.keys(details.requestHeaders || {}).find(key => key.toLowerCase() === "user-agent");
        callback(name ? { requestHeaders: { ...details.requestHeaders, [name]: own } } : {});
      });
    }
    return value;
  }
  // disableDialogs: dialogs from frames of other sites, which the page script
  // doesn't reach, close at once rather than freeze the page.
  const preferences = profileId => ({ session: sessionFor(profileId), preload: PAGE_SCRIPT, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: true, disableDialogs: true });

  // The camera and microphone: the user is asked per site, for a page on
  // screen in their own tab, and an allow is remembered for the profile. A
  // refusal holds until the page goes elsewhere. Pages an agent works in, or
  // that nobody is looking at, never get them.
  const sitePermissions = () => { try { return store.settings.get(SITE_PERMISSIONS, {}) || {}; } catch { return {}; } };
  const mediaAsks = new Map(); // "<page id> <origin> <types>" -> Promise<boolean>
  function mediaAllowed(profileId, contents, origin, type) {
    const tab = tabOf(contents);
    if (!tab || agentDriven(tab)) return false;
    const allowed = sitePermissions()[profileId]?.[originOf(origin)] || [];
    return type === "audio" || type === "video" ? allowed.includes(type) : allowed.length > 0;
  }
  async function askMedia(profileId, contents, details) {
    const origin = originOf(details?.securityOrigin || details?.requestingUrl), tab = tabOf(contents);
    const types = [...new Set((details?.mediaTypes || []).filter(type => type === "audio" || type === "video"))].sort();
    if (!origin || !types.length || !tab || agentDriven(tab)) return false;
    if (types.every(type => (sitePermissions()[profileId]?.[origin] || []).includes(type))) return true;
    const window = hostWindow();
    if (tab.mediaRefused?.has(origin) || !window || !seen(tab)) return false;
    const key = `${contents.id} ${origin} ${types}`;
    if (!mediaAsks.has(key)) mediaAsks.set(key, (async () => {
      const what = types.length === 2 ? "camera and microphone" : types[0] === "video" ? "camera" : "microphone";
      const { response } = await dialog.showMessageBox(window, {
        type: "question", title: "Timewarp", message: `Allow ${siteOf(origin) || origin} to use your ${what}?`,
        detail: "Timewarp remembers this for the site in this browser profile.", buttons: ["Allow", "Don't allow"], defaultId: 1, cancelId: 1, noLink: true,
      });
      if (response !== 0 || contents.isDestroyed()) { (tab.mediaRefused ||= new Set()).add(origin); return false; }
      const saved = sitePermissions();
      saved[profileId] = { ...saved[profileId], [origin]: [...new Set([...(saved[profileId]?.[origin] || []), ...types])] };
      try { store.settings.set(SITE_PERMISSIONS, saved); } catch {}
      return true;
    })().finally(() => mediaAsks.delete(key)));
    return mediaAsks.get(key);
  }

  // Downloads in a tab an agent is working in go to "downloads" in the chat
  // agent's workspace, without a dialog; the agent's next browser result says
  // where. The user's own downloads ask where to save and then show the file.
  function download(item, contents) {
    // A page read in the background has no one to download for.
    if (contents && away.has(contents)) { item.cancel(); return; }
    const tab = tabOf(contents);
    // A tab with a download in progress keeps its page.
    if (tab) { tab.downloads = (tab.downloads || 0) + 1; item.once("done", () => { tab.downloads--; }); }
    let workspace = null;
    try { if (tab && (tab.agent || tab.worker)) workspace = store.agents.get(store.conversations.get(tab.conversationId)?.agentId)?.workspace || null; } catch {}
    if (!workspace) { item.once("done", (_event, state) => { if (state === "completed") shell.showItemInFolder(item.getSavePath()); }); return; }
    const folder = path.join(workspace, "downloads");
    try { fs.mkdirSync(folder, { recursive: true }); } catch {}
    const entry = { file: freeFile(folder, item.getFilename(), saving), state: "progressing", reported: null };
    saving.add(entry.file);
    item.setSavePath(entry.file);
    if (!downloads.has(tab.conversationId)) downloads.set(tab.conversationId, []);
    downloads.get(tab.conversationId).push(entry);
    item.once("done", (_event, state) => { entry.state = state; saving.delete(entry.file); });
  }

  const stateOf = tab => ({
    id: tab.id, conversationId: tab.conversationId, profileId: tab.profileId, kind: tab.kind,
    url: tab.view ? tab.view.webContents.getURL() : tab.url, title: tab.title || "", favicon: tab.favicon || null,
    loading: !!tab.loading, canGoBack: !!tab.view?.webContents.navigationHistory.canGoBack(),
    canGoForward: !!tab.view?.webContents.navigationHistory.canGoForward(), agent: tab.agent || null, muted: tab.muted !== false,
    pinned: !!tab.pinned,
    // A dialog the page is showing: forAgent when the agent answers it, else the user is being asked.
    dialog: tab.dialog ? { type: tab.dialog.type, message: tab.dialog.message, site: tab.dialog.site, forAgent: tab.dialog.forAgent } : null,
  });
  // Pinned tabs first, then in the order they opened.
  const inOrder = conversationId => [...tabs.values()].filter(tab => tab.conversationId === conversationId).sort((a, b) => a.order - b.order);
  const chatTabs = conversationId => inOrder(conversationId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  function groupState(conversationId) {
    restore(conversationId);
    const group = groups.get(conversationId) || { active: null };
    return { conversationId, active: group.active, userControl: userControl.has(conversationId), tabs: chatTabs(conversationId).map(stateOf) };
  }
  const changed = conversationId => { remember(conversationId); notify("browser.state", groupState(conversationId)); };

  // A chat's tabs come back after a restart, as in the previous app: addresses,
  // titles, back and forward history, pins and the active tab are kept (no page
  // content); a page loads when shown.
  const SAVED_KEY = "browserTabs", SAVED_CHATS = 50, SAVED_TABS = 12, SAVED_HISTORY = 10;
  const restored = new Set(), dirty = new Set();
  let saveTimer = null;
  function restore(conversationId) {
    if (!conversationId || restored.has(conversationId)) return;
    restored.add(conversationId);
    let saved;
    try { saved = store.settings.get(SAVED_KEY, {})?.[conversationId]; } catch { return; }
    if (!Array.isArray(saved?.tabs) || !saved.tabs.length) return;
    const profiles = new Set(store.browserProfiles.list().map(profile => profile.id));
    const fallback = () => store.conversations.get(conversationId)?.browserProfileId || store.browserProfiles.ensureDefault().id;
    let active = null;
    saved.tabs.slice(-SAVED_TABS).forEach((item, index) => {
      const url = item.kind === "web" && recordable(item.url) ? item.url : null;
      const id = typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id) && !tabs.has(item.id) ? item.id : crypto.randomUUID();
      let history = url ? validHistory(item.history, SAVED_HISTORY) : null;
      if (history?.entries[history.index].url !== url) history = null;
      tabs.set(id, {
        id, conversationId, profileId: profiles.has(item.profileId) ? item.profileId : fallback(), kind: url ? "web" : "home", url, title: String(item.title || "").slice(0, 300),
        order: Date.now() - SAVED_TABS + index, usedAt: 0, pinned: item.pinned === true, history: history && { ...history, entries: history.entries.map(({ url: address, title }) => ({ url: address, title })) },
      });
      if (item.active || !active) active = id;
    });
    groups.set(conversationId, { active });
  }
  function save() {
    saveTimer = null;
    let saved;
    try { saved = { ...(store.settings.get(SAVED_KEY, {}) || {}) }; } catch { return; }
    for (const conversationId of dirty) {
      const list = chatTabs(conversationId).slice(-SAVED_TABS);
      if (!list.length) { delete saved[conversationId]; continue; }
      const active = groups.get(conversationId)?.active;
      saved[conversationId] = { savedAt: Date.now(), tabs: list.map(tab => {
        const url = tab.kind === "web" ? (tab.view ? tab.view.webContents.getURL() : tab.url) : null;
        const web = !!url && recordable(url);
        const history = web ? (tab.view ? historyOf(tab.view.webContents, { pageState: false, around: SAVED_HISTORY }) : validHistory(tab.history, SAVED_HISTORY)) : null;
        return {
          id: tab.id, kind: web ? "web" : "home", url: web ? url : null, title: tab.title || "", profileId: tab.profileId, active: tab.id === active,
          ...(tab.pinned ? { pinned: true } : {}),
          ...(history && history.entries.length > 1 ? { history: { index: history.index, entries: history.entries.map(entry => ({ url: entry.url, title: entry.title })) } } : {}),
        };
      }) };
    }
    dirty.clear();
    const kept = Object.entries(saved).sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0)).slice(0, SAVED_CHATS);
    try { store.settings.set(SAVED_KEY, Object.fromEntries(kept)); } catch {}
  }
  function remember(conversationId) {
    if (!restored.has(conversationId)) return;
    dirty.add(conversationId);
    if (!saveTimer) saveTimer = setTimeout(save, 1000);
  }
  // The tab on screen gets its page when the pane shows it.
  function wake() {
    const tab = tabs.get(groups.get(shown)?.active);
    if (visible && tab?.kind === "web" && !tab.view) { attach(tab); evict(tab); }
  }
  // Conversations where the user took the browser over from the agent.
  const userControl = new Set();

  // Hidden pages keep a real size, so the agent can still read and work in
  // them while the pane is closed or another tab or chat is shown.
  const HIDDEN_SIZE = { width: 1280, height: 860 };
  // Pages outlive the window: on macOS Timewarp keeps running when it's
  // closed, and agents keep browsing. They go into the next window, hidden
  // until its pane says where it is.
  function hostWindow() {
    const window = getWindow();
    const current = window && !window.isDestroyed?.() ? window : null;
    if (current !== host) {
      host = current;
      visible = false;
      if (host) for (const tab of tabs.values()) if (tab.view) host.contentView.addChildView(tab.view);
    }
    return host;
  }
  const onScreen = tab => !!(hostWindow() && visible && bounds && tab.conversationId === shown && groups.get(shown)?.active === tab.id && tab.kind === "web");
  // On screen in a window that is shown, not minimized: the user can see it,
  // and Chromium takes mouse input for it.
  const windowShown = () => !!host && !host.isMinimized?.() && host.isVisible?.() !== false;
  const seen = tab => onScreen(tab) && windowShown();
  // A hidden page an agent works in is parked: drawn outside the window, out
  // of sight, so key presses still reach it. Other hidden pages aren't drawn.
  function layout() {
    const size = bounds && bounds.width > 200 && bounds.height > 200 ? { width: bounds.width, height: bounds.height } : HIDDEN_SIZE;
    const window = hostWindow();
    for (const tab of tabs.values()) {
      if (!tab.view) continue;
      const show = onScreen(tab), park = !show && !!window && !!(tab.agent || tab.worker);
      if (!park) tab.parkedAt = 0;
      else if (!tab.parkedAt) tab.parkedAt = Date.now();
      tab.view.setVisible(show || park);
      tab.view.setBounds(show ? bounds : { x: park ? PARKED : 0, y: park ? PARKED : 0, ...size });
    }
  }

  // A tab's page, new or adopted from the page that opened it.
  function attach(tab, view = null) {
    if (tab.view) return;
    const adopted = !!view;
    view ||= new WebContentsView({ webPreferences: preferences(tab.profileId) });
    tab.view = view;
    hostWindow()?.contentView.addChildView(view);
    view.setVisible(false);
    view.setBounds(bounds && bounds.width > 200 ? { x: 0, y: 0, width: bounds.width, height: bounds.height } : { x: 0, y: 0, ...HIDDEN_SIZE });
    const contents = view.webContents;
    // Pages start muted, as in the previous app; the toolbar turns sound on.
    contents.setAudioMuted(tab.muted !== false);
    contents.setWindowOpenHandler(details => popup(tab, details));
    contents.on("will-navigate", (event, url) => { try { safeUrl(url); } catch { event.preventDefault(); } });
    contents.on("will-redirect", (event, url) => { try { safeUrl(url); } catch { event.preventDefault(); } });
    contents.on("did-start-loading", () => { tab.loading = true; changed(tab.conversationId); });
    contents.on("did-stop-loading", () => { tab.loading = false; changed(tab.conversationId); });
    contents.on("page-title-updated", (_event, title) => {
      tab.title = title;
      // Recommended sites show the page's title, as before.
      const url = contents.getURL();
      if (title && recordable(url)) store.recentSites.record(tab.profileId, tab.conversationId, url, title);
      changed(tab.conversationId);
    });
    contents.on("page-favicon-updated", (_event, favicons) => { tab.favicon = favicons.find(icon => /^https:/.test(icon)) || null; changed(tab.conversationId); });
    contents.on("did-navigate", (_event, url) => {
      tab.url = url;
      // A new page: nothing typed in it yet, no sound, and it may ask again for what was refused.
      Object.assign(tab, { edited: false, playing: false, mediaRefused: null, dialogs: 0, quiet: false });
      // The title arrives later (page-title-updated); until then the page has none.
      if (recordable(url)) store.recentSites.record(tab.profileId, tab.conversationId, url, null);
      changed(tab.conversationId);
    });
    contents.on("media-started-playing", () => { tab.playing = true; });
    contents.on("media-paused", () => { tab.playing = false; });
    contents.ipc?.on(EDITED, () => { tab.edited = true; });
    contents.ipc?.on(DIALOG, (event, payload) => openDialog(tab, event, payload));
    contents.on("will-prevent-unload", event => leaving(tab, event));
    contents.on("context-menu", (_event, params) => contextMenu(tab, contents, params));
    contents.on("did-navigate-in-page", (_event, url) => { tab.url = url; changed(tab.conversationId); });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) log?.warn("browser-view", "A page didn't load", { code, description, origin: (() => { try { return new URL(url).origin; } catch { return null; } })() });
    });
    contents.on("render-process-gone", (_event, details) => log?.warn("browser-view", "A page's renderer stopped", { reason: details?.reason }));
    contents.on("render-process-gone", () => { tab.loading = false; tab.title = "This page stopped responding"; changed(tab.conversationId); });
    // A page that closes itself, such as a sign-in pop-up once it's done.
    contents.once("destroyed", () => { if (tab.view === view && tabs.get(tab.id) === tab) remove(tab); });
    // A tab that slept comes back with its back and forward history.
    const history = tab.history;
    tab.history = null;
    if (adopted) return;
    if (history && contents.navigationHistory.restore) void contents.navigationHistory.restore(history).catch(() => {});
    else if (tab.url && tab.url !== "about:blank") void contents.loadURL(tab.url).catch(() => {});
  }
  // Closes a tab's page; the tab itself stays, with its address and history.
  function discard(tab) {
    const view = tab.view;
    if (!view) return;
    if (tab.dialog) finishDialog(tab, false);
    const contents = view.webContents;
    if (contents && !contents.isDestroyed()) {
      tab.history = historyOf(contents);
      tab.url = contents.getURL() || tab.url;
    }
    Object.assign(tab, { view: null, loading: false, playing: false, edited: false, parkedAt: 0 });
    hostWindow()?.contentView.removeChildView(view);
    if (contents && !contents.isDestroyed()) contents.close();
  }

  // Pages' alert, confirm and prompt (sent by the page script) and warnings
  // about leaving a page. In a tab an agent works in, the agent answers: an
  // alert closes at once and is reported, a confirm or prompt waits for the
  // agent's dialog tool and is dismissed if nobody answers. In the user's own
  // tab on screen, the user is asked; a hidden tab's dialog is dismissed, as
  // Chrome does for background tabs. The page waits meanwhile.
  const notes = new Map(); // conversation id -> lines for the agent's next browser result
  const dialogListeners = new Set();
  const tell = (conversationId, line) => notes.set(conversationId, [...(notes.get(conversationId) || []), line].slice(-10));
  const agentDriven = tab => !userControl.has(tab.conversationId) && !!(tab.worker || tab.agent);
  const quote = value => JSON.stringify(String(value).replace(/\s+/g, " ").trim().slice(0, 300));
  function openDialog(tab, event, payload) {
    const type = ["alert", "confirm", "prompt"].includes(payload?.type) ? payload.type : null;
    const reply = value => { try { event.returnValue = value; } catch {} };
    if (!type || !tab.view) return reply(null);
    if (tab.dialog) finishDialog(tab, false);
    const message = String(payload.message ?? "").slice(0, 2000), value = String(payload.value ?? "").slice(0, 2000);
    const site = siteOf(event.senderFrame?.url || tab.view.webContents.getURL());
    const answer = (accept, text) => reply(type === "alert" ? undefined : type === "confirm" ? !!accept : accept ? String(text ?? value) : null);
    if (agentDriven(tab)) {
      if (type === "alert") { answer(true); tell(tab.conversationId, `The page showed an alert: ${quote(message)}`); return; }
      const entry = tab.dialog = { type, message, value, site, forAgent: true, answer };
      entry.timer = setTimeout(() => {
        if (tab.dialog !== entry) return;
        tell(tab.conversationId, `Nobody answered the page's ${type} ${quote(message)}, so it was dismissed.`);
        finishDialog(tab, false);
      }, AGENT_DIALOG_MS);
      entry.timer.unref?.();
      changed(tab.conversationId);
      for (const listener of dialogListeners) listener(tab.conversationId, tab.id);
      return;
    }
    const window = hostWindow();
    if (!window || !seen(tab) || tab.quiet) return answer(false);
    tab.dialogs = (tab.dialogs || 0) + 1;
    const entry = tab.dialog = { type, message, value, site, forAgent: false, answer, abort: new AbortController() };
    changed(tab.conversationId);
    const asked = type === "prompt" ? askText(window, entry) : dialog.showMessageBox(window, {
      type: "none", title: "Timewarp", message: `${site || "This page"} says`, detail: message, buttons: type === "confirm" ? ["OK", "Cancel"] : ["OK"],
      defaultId: 0, cancelId: type === "confirm" ? 1 : 0, noLink: true, signal: entry.abort.signal,
      // A page that keeps opening dialogs can be stopped, as in Chrome.
      ...(tab.dialogs > 2 ? { checkboxLabel: "Don't let this page show more dialogs" } : {}),
    }).then(result => { if (result.checkboxChecked) tab.quiet = true; return { accept: result.response === 0 }; });
    asked.then(result => { if (tab.dialog === entry) finishDialog(tab, result.accept, result.text); }, () => { if (tab.dialog === entry) finishDialog(tab, false); });
  }
  function finishDialog(tab, accept, text) {
    const entry = tab.dialog;
    if (!entry) return;
    tab.dialog = null;
    clearTimeout(entry.timer);
    entry.abort?.abort();
    entry.answer(accept, text);
    changed(tab.conversationId);
  }
  // A prompt in the user's tab: a small window with the page's question and a field.
  function askText(parent, entry) {
    return new Promise(resolve => {
      const window = new BrowserWindow({
        parent, modal: true, width: 440, height: 200, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, show: false,
        title: `${entry.site || "This page"} says`, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
      });
      let done = false;
      const finish = result => { if (done) return; done = true; resolve(result); if (!window.isDestroyed()) window.close(); };
      entry.abort.signal.addEventListener("abort", () => finish({ accept: false }));
      window.on("closed", () => finish({ accept: false }));
      // The page answers through its title: "ok:" and the text, or "cancel".
      window.on("page-title-updated", event => event.preventDefault());
      window.webContents.on("page-title-updated", (_event, title) => {
        if (title === "cancel") finish({ accept: false });
        else if (title.startsWith("ok:")) { let text = ""; try { text = decodeURIComponent(title.slice(3)); } catch {} finish({ accept: true, text }); }
      });
      window.webContents.on("will-navigate", event => event.preventDefault());
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.once("ready-to-show", () => window.show());
      const page = `<!doctype html><meta charset="utf-8"><title>prompt</title><style>
:root { color-scheme: light dark; font: 13px system-ui, sans-serif; } body { margin: 16px; }
p { margin: 0 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 64px; overflow: auto; }
input { width: 100%; box-sizing: border-box; padding: 6px 8px; font: inherit; } div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
button { min-width: 76px; padding: 5px 12px; font: inherit; }</style>
<form><p id="message"></p><input id="answer" autofocus><div><button type="button" id="cancel">Cancel</button><button>OK</button></div></form>
<script>const [message, value] = JSON.parse(decodeURIComponent(location.hash.slice(1)));
document.getElementById("message").textContent = message; const field = document.getElementById("answer"); field.value = value; field.select();
document.querySelector("form").onsubmit = event => { event.preventDefault(); document.title = "ok:" + encodeURIComponent(field.value); };
document.getElementById("cancel").onclick = () => { document.title = "cancel"; };
addEventListener("keydown", event => { if (event.key === "Escape") document.title = "cancel"; });</script>`;
      void window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page) + "#" + encodeURIComponent(JSON.stringify([entry.message, entry.value]))).catch(() => finish({ accept: false }));
    });
  }
  // Leaving a page that warns about unsaved changes: an agent leaves it (and
  // hears about it); the user is asked, as in Chrome.
  function leaving(tab, event) {
    if (agentDriven(tab)) { event.preventDefault(); tell(tab.conversationId, "The page warned that changes may not be saved; it was left anyway."); return; }
    const window = hostWindow();
    if (!window) return;
    const choice = dialog.showMessageBoxSync(window, { type: "question", title: "Timewarp", message: "Leave site?", detail: "Changes you made may not be saved.", buttons: ["Leave", "Cancel"], defaultId: 0, cancelId: 1, noLink: true });
    if (choice === 0) event.preventDefault();
  }

  // The page's right-click menu, as in the previous app.
  function contextMenu(tab, contents, params = {}) {
    const window = hostWindow();
    if (!window || contents.isDestroyed()) return;
    const items = [];
    const group = list => { if (!list.length) return; if (items.length) items.push({ type: "separator" }); items.push(...list); };
    if (params.misspelledWord) group((params.dictionarySuggestions || []).slice(0, 4).map(word => ({ label: word, click: () => contents.replaceMisspelling(word) })));
    if (params.linkURL && recordable(params.linkURL)) group([
      { label: "Open link in new tab", click: () => { try { openTab(tab.conversationId, { url: params.linkURL, profileId: tab.profileId, activate: false, after: tab }); } catch {} } },
      { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) },
    ]);
    if (params.mediaType === "image" && params.srcURL) group([
      ...(params.hasImageContents !== false ? [{ label: "Copy image", click: () => contents.copyImageAt(params.x, params.y) }] : []),
      ...(recordable(params.srcURL) ? [{ label: "Copy image address", click: () => clipboard.writeText(params.srcURL) }] : []),
    ]);
    const flags = params.editFlags || {};
    if (params.isEditable) group([
      { label: "Cut", enabled: flags.canCut !== false, click: () => contents.cut() },
      { label: "Copy", enabled: flags.canCopy !== false, click: () => contents.copy() },
      { label: "Paste", enabled: flags.canPaste !== false, click: () => contents.paste() },
      { label: "Select all", click: () => contents.selectAll() },
    ]);
    else if (params.selectionText) group([{ label: "Copy", click: () => contents.copy() }, { label: "Select all", click: () => contents.selectAll() }]);
    if (!items.length) {
      const history = contents.navigationHistory;
      group([
        { label: "Back", enabled: history.canGoBack(), click: () => history.goBack() },
        { label: "Forward", enabled: history.canGoForward(), click: () => history.goForward() },
        { label: "Reload", click: () => contents.reload() },
      ]);
    }
    if (recordable(params.pageURL)) group([{ label: "Open page in default browser", click: () => { void shell.openExternal(params.pageURL).catch(() => {}); } }]);
    Menu.buildFromTemplate(items).popup({ window });
  }

  // Links and pop-ups that open a window open as a tab next to their page, in
  // the same chat and profile. The page keeps its opener, so a sign-in pop-up
  // (Google, Apple, Microsoft, PayPal) can hand its result back.
  function popup(opener, { url }) {
    if (!opensAsTab(url)) return { action: "deny" };
    return { action: "allow", outlivesOpener: true, overrideBrowserWindowOptions: { webPreferences: preferences(opener.profileId) }, createWindow: options => adopt(opener, url, options) };
  }
  function adopt(opener, url, options) {
    const view = new WebContentsView({ ...(options?.webContents ? { webContents: options.webContents } : {}), webPreferences: options?.webPreferences || preferences(opener.profileId) });
    const tab = {
      id: crypto.randomUUID(), conversationId: opener.conversationId, profileId: opener.profileId, kind: "web", url: url === "about:blank" ? null : url, title: "",
      order: orderAfter(opener), usedAt: Date.now(), openerId: opener.id, worker: opener.worker, agent: opener.agent || null,
    };
    tabs.set(tab.id, tab);
    opener.usedAt = Date.now(); // kept open while the pop-up may answer it
    attach(tab, view);
    if (!options?.webContents && tab.url) void view.webContents.loadURL(tab.url).catch(() => {});
    // It comes to the front when the page that opened it is in front.
    const group = groups.get(tab.conversationId);
    if (group?.active === opener.id) group.active = tab.id;
    evict();
    layout();
    changed(tab.conversationId);
    return view.webContents;
  }

  // The place right after a tab, for the tabs it opens.
  function orderAfter(tab) {
    const later = inOrder(tab.conversationId).find(item => item.order > tab.order);
    return later ? (tab.order + later.order) / 2 : nextOrder();
  }

  // Past the limit, the pages used longest ago are closed to save memory; the
  // tab stays, with its history, and its page comes back when used. A page is
  // kept open when it's on screen or pinned, loading, playing sound or video,
  // has input not yet sent, a dialog or a download, is a pop-up or has pop-ups
  // open, or an agent is working in it.
  const keepsPage = tab => (tab.conversationId === shown && groups.get(shown)?.active === tab.id) || tab.pinned || tab.loading || tab.playing || tab.edited || tab.dialog || tab.downloads > 0 || tab.agent
    || !!(tab.openerId && tabs.get(tab.openerId)?.view) || [...tabs.values()].some(other => other.openerId === tab.id && other.view);
  function evict(spare = null) {
    const live = [...tabs.values()].filter(tab => tab.view);
    if (live.length <= MAX_LIVE_TABS) return;
    for (const tab of live.filter(item => item !== spare && !keepsPage(item)).sort((a, b) => a.usedAt - b.usedAt).slice(0, live.length - MAX_LIVE_TABS)) discard(tab);
  }

  // worker: a worker's own background tab (its downloads go to the workspace).
  // after: the tab it opens from, to place it right after that one.
  function openTab(conversationId, { url = null, profileId, activate = true, worker = false, after = null } = {}) {
    restore(conversationId);
    const profile = profileId || store.conversations.get(conversationId)?.browserProfileId || store.browserProfiles.ensureDefault().id;
    const tab = { id: crypto.randomUUID(), conversationId, profileId: profile, kind: url ? "web" : "home", url: url ? safeUrl(url) : null, title: "", order: after ? orderAfter(after) : nextOrder(), usedAt: Date.now(), worker: !!worker };
    tabs.set(tab.id, tab);
    if (!groups.has(conversationId)) groups.set(conversationId, { active: null });
    if (tab.kind === "web") { attach(tab); evict(tab); }
    if (activate) groups.get(conversationId).active = tab.id;
    layout();
    changed(conversationId);
    return stateOf(tab);
  }

  // Closing a tab shows the page that opened it, or the one used last.
  function remove(tab) {
    discard(tab);
    tabs.delete(tab.id);
    const group = groups.get(tab.conversationId);
    if (group?.active === tab.id) group.active = (tabs.get(tab.openerId)?.conversationId === tab.conversationId ? tab.openerId : null) || chatTabs(tab.conversationId).sort((a, b) => b.usedAt - a.usedAt)[0]?.id || null;
    layout();
    changed(tab.conversationId);
  }

  function tabFor(conversationId, tabId) {
    restore(conversationId);
    const id = tabId || groups.get(conversationId)?.active;
    const tab = id && tabs.get(id);
    if (!tab || tab.conversationId !== conversationId) throw fail(404, "This browser tab is closed.");
    tab.usedAt = Date.now();
    return tab;
  }

  function navigate(conversationId, { tabId, url }) {
    const target = safeUrl(url);
    let tab;
    try { tab = tabFor(conversationId, tabId); } catch { return openTab(conversationId, { url: target }); }
    tab.kind = "web";
    tab.url = target;
    tab.history = null;
    if (!tab.view) attach(tab); else void tab.view.webContents.loadURL(target).catch(() => {});
    evict(tab);
    layout();
    changed(conversationId);
    return stateOf(tab);
  }

  function close(conversationId, tabId) {
    remove(tabFor(conversationId, tabId));
    return groupState(conversationId);
  }

  return {
    safeUrl,
    state: conversationId => groupState(conversationId),
    show(conversationId) { hostWindow(); shown = conversationId; restore(conversationId); wake(); layout(); return groupState(conversationId); },
    setBounds(rect) {
      hostWindow();
      if (!rect) { visible = false; layout(); return; }
      const round = value => Math.max(0, Math.round(Number(value) || 0));
      bounds = { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
      visible = bounds.width > 40 && bounds.height > 40 && rect.visible !== false;
      wake();
      layout();
    },
    openTab, navigate, close, sessionFor,
    activate(conversationId, tabId) { const tab = tabFor(conversationId, tabId); groups.get(conversationId).active = tab.id; if (tab.kind === "web" && !tab.view) { attach(tab); evict(tab); } layout(); changed(conversationId); return groupState(conversationId); },
    // Shows the chat's new tab page: the one used last, else a new one. The
    // web tab stays as it was, with its page and history.
    home(conversationId, tabId) {
      const tab = tabFor(conversationId, tabId);
      if (tab.kind === "home") return groupState(conversationId);
      const home = chatTabs(conversationId).filter(item => item.kind === "home").sort((a, b) => b.usedAt - a.usedAt)[0];
      if (!home) { openTab(conversationId); return groupState(conversationId); }
      home.usedAt = Date.now();
      groups.get(conversationId).active = home.id;
      layout();
      changed(conversationId);
      return groupState(conversationId);
    },
    // Pinned tabs come first and keep their pages open.
    pin(conversationId, tabId, pinned) { const tab = tabFor(conversationId, tabId); tab.pinned = !!pinned; changed(conversationId); return groupState(conversationId); },
    back(conversationId, tabId) { const tab = tabFor(conversationId, tabId); if (tab.view?.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack(); return stateOf(tab); },
    forward(conversationId, tabId) { const tab = tabFor(conversationId, tabId); if (tab.view?.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward(); return stateOf(tab); },
    reload(conversationId, tabId) { const tab = tabFor(conversationId, tabId); tab.view?.webContents.reload(); return stateOf(tab); },
    stop(conversationId, tabId) { const tab = tabFor(conversationId, tabId); tab.view?.webContents.stop(); return stateOf(tab); },
    setMuted(conversationId, tabId, muted) { const tab = tabFor(conversationId, tabId); tab.muted = !!muted; tab.view?.webContents.setAudioMuted(tab.muted); changed(conversationId); return stateOf(tab); },
    // The chat's tabs reopen in the chosen profile, with its own sign-ins.
    setProfile(conversationId, profileId) {
      if (!store.browserProfiles.list().some(profile => profile.id === profileId)) throw fail(404, "This browser profile is unavailable.");
      store.conversations.update(conversationId, { browserProfileId: profileId }, { touch: false });
      const open = [...tabs.values()].filter(tab => tab.conversationId === conversationId && tab.profileId !== profileId).sort((a, b) => a.order - b.order);
      const active = groups.get(conversationId)?.active;
      for (const tab of open) {
        const url = tab.kind === "web" ? (tab.view ? tab.view.webContents.getURL() : tab.url) : null;
        discard(tab);
        tabs.delete(tab.id);
        let reopened = null;
        try { reopened = openTab(conversationId, { url: url && recordable(url) ? url : null, profileId, activate: tab.id === active }); } catch {}
        if (reopened) Object.assign(tabs.get(reopened.id), { order: tab.order, pinned: tab.pinned });
      }
      layout();
      changed(conversationId);
      return groupState(conversationId);
    },
    // Signs a removed profile out everywhere: its stored data is cleared and
    // its folder removed, as in the previous app. A folder still in use is
    // removed at the next start.
    async removeProfile(profileId) {
      for (const [conversationId] of groups) if ([...tabs.values()].some(tab => tab.conversationId === conversationId && tab.profileId === profileId)) {
        const fallback = store.browserProfiles.ensureDefault().id;
        this.setProfile(conversationId, fallback);
      }
      const value = sessionFor(profileId);
      await value.clearStorageData().catch(() => {});
      await value.clearCache?.().catch(() => {});
      const permissions = sitePermissions();
      if (permissions[profileId]) { delete permissions[profileId]; try { store.settings.set(SITE_PERMISSIONS, permissions); } catch {} }
      const folder = value.storagePath;
      if (!folder || await removeFolder(folder)) return;
      log?.warn("browser-profile", "A removed profile's storage is in use; it's removed at the next start");
      try { store.settings.set(REMOVE_LATER, [...new Set([...(store.settings.get(REMOVE_LATER, []) || []), folder])]); } catch {}
    },
    recent: (conversationId, profileId) => store.recentSites.list(profileId || store.conversations.get(conversationId)?.browserProfileId || store.browserProfiles.ensureDefault().id, conversationId).slice(0, 4),
    // Agent tools act on the conversation's active web tab.
    webContents(conversationId, tabId) {
      const tab = tabFor(conversationId, tabId);
      if (tab.kind !== "web") throw fail(409, "Open a web page first.");
      if (!tab.view) { attach(tab); evict(tab); }
      // Pages the agent works in run at full speed even while hidden.
      tab.view.webContents.setBackgroundThrottling(false);
      // onScreen: the user sees the page and Chromium takes mouse input for it.
      // inWindow: pages can be read without a window, but not captured.
      return { tab, contents: tab.view.webContents, onScreen: seen(tab), inWindow: !!hostWindow() };
    },
    // How long until key presses reach a tab's page (a hidden page an agent
    // works in was just parked), or -1 when Chromium won't deliver them: no
    // window, or it's minimized. browser-tools then sends them as page events.
    keyInput(conversationId, tabId) {
      const tab = tabFor(conversationId, tabId);
      if (!tab.view || !hostWindow() || !windowShown()) return -1;
      if (onScreen(tab)) return 0;
      if (!tab.parkedAt) layout();
      return tab.parkedAt ? Math.max(0, tab.parkedAt + 250 - Date.now()) : -1;
    },
    // Dialogs the chat's pages are showing, for the agent's tools.
    dialogs: conversationId => chatTabs(conversationId).filter(tab => tab.dialog).map(tab => ({ tabId: tab.id, ...stateOf(tab).dialog, value: tab.dialog.value })),
    answerDialog(conversationId, tabId, { accept = true, text } = {}) {
      const tab = tabFor(conversationId, tabId);
      if (!tab.dialog) throw fail(409, "No dialog is open on this page.");
      if (!tab.dialog.forAgent) throw fail(409, "The user is answering this dialog.");
      finishDialog(tab, !!accept, text === undefined || text === null ? undefined : String(text));
      return stateOf(tab);
    },
    // Called with (conversation id, tab id) when a page opens a dialog for the agent.
    onDialog(listener) { dialogListeners.add(listener); return () => dialogListeners.delete(listener); },
    // What the agent should hear about since it last asked: alerts, dismissed dialogs, pages left.
    notes(conversationId) { const list = notes.get(conversationId) || []; notes.delete(conversationId); return list; },
    // The agent's turn ended: what it didn't answer is dismissed.
    endAgentDialogs(conversationId) {
      for (const tab of chatTabs(conversationId)) if (tab.dialog?.forAgent) {
        tell(conversationId, `The page's ${tab.dialog.type} ${quote(tab.dialog.message)} was dismissed when your turn ended.`);
        finishDialog(tab, false);
      }
    },
    // A page read for the agent in the background, in the chat's profile,
    // without a tab or changing the visible page; it closes once read.
    async readAway(conversationId, url, read) {
      const address = safeUrl(url);
      const chosen = store.conversations.get(conversationId)?.browserProfileId;
      const profileId = chosen && store.browserProfiles.list().some(profile => profile.id === chosen) ? chosen : store.browserProfiles.ensureDefault().id;
      const view = new WebContentsView({ webPreferences: preferences(profileId) });
      const contents = view.webContents;
      away.add(contents);
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", (event, next) => { try { safeUrl(next); } catch { event.preventDefault(); } });
      contents.on("will-redirect", (event, next) => { try { safeUrl(next); } catch { event.preventDefault(); } });
      contents.on("will-prevent-unload", event => event.preventDefault());
      // Nobody is there to answer its dialogs.
      contents.ipc?.on(DIALOG, event => { event.returnValue = null; });
      try {
        let timer;
        await Promise.race([contents.loadURL(address).catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 20000); })]).finally(() => clearTimeout(timer));
        return await read(contents);
      } finally { if (!contents.isDestroyed()) contents.close(); }
    },
    // Downloads in the chat's agent tabs that started or ended since last asked.
    downloads(conversationId) {
      const list = downloads.get(conversationId) || [];
      const fresh = list.filter(entry => entry.reported !== entry.state);
      for (const entry of fresh) entry.reported = entry.state;
      downloads.set(conversationId, list.filter(entry => entry.state === "progressing"));
      return fresh.map(({ file, state }) => ({ file, state }));
    },
    setUserControl(conversationId, value) {
      if (value) { userControl.add(conversationId); for (const tab of tabs.values()) if (tab.conversationId === conversationId) tab.agent = null; }
      else userControl.delete(conversationId);
      layout();
      changed(conversationId);
      return groupState(conversationId);
    },
    userInControl: conversationId => userControl.has(conversationId),
    // A tab an agent starts or stops working in is parked or put away (layout).
    markAgent(conversationId, tabId, agent) {
      if (agent && userControl.has(conversationId)) return;
      const tab = tabs.get(tabId);
      if (!tab || tab.conversationId !== conversationId) return;
      const moved = !tab.agent !== !agent;
      tab.agent = agent;
      if (moved) layout();
      changed(conversationId);
    },
    closeConversation(conversationId) { restored.add(conversationId); for (const tab of [...tabs.values()]) if (tab.conversationId === conversationId) { discard(tab); tabs.delete(tab.id); } groups.delete(conversationId); downloads.delete(conversationId); remember(conversationId); },
    // Preview builds only: where the active page view is and what it shows.
    async inspect(conversationId) {
      const tab = tabs.get(groups.get(conversationId)?.active);
      if (!tab?.view) return { bounds: null, visible: false };
      const image = await tab.view.webContents.capturePage();
      return { bounds: tab.view.getBounds(), visible: tab.view.getVisible(), image: image.resize({ width: 480 }).toDataURL() };
    },
    destroy() { if (saveTimer) { clearTimeout(saveTimer); save(); } for (const tab of tabs.values()) discard(tab); tabs.clear(); groups.clear(); },
  };
}

module.exports = { createBrowser, safeUrl, recordable };
