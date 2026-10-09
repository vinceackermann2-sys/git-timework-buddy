"use strict";
// The built-in browser: tabs per conversation, shown as native views in the
// right pane. Each browser profile has its own persistent session, so sign-ins
// stay on this device and separate between profiles.
const crypto = require("node:crypto");
const { WebContentsView, session: electronSession, shell } = require("electron");

const MAX_LIVE_TABS = 16;
const fail = (status, message) => Object.assign(new Error(message), { status });

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

function createBrowser({ window: getWindow, store, notify = () => {}, log = null }) {
  const tabs = new Map(); // tab id -> tab
  const groups = new Map(); // conversation id -> { active: tab id | null }
  const partitions = new Set();
  let shown = null; // conversation id whose tabs are on screen
  let bounds = null;
  let visible = false;

  function sessionFor(profileId) {
    const partition = "persist:tw-browser-" + profileId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const value = electronSession.fromPartition(partition);
    if (!partitions.has(partition)) {
      partitions.add(partition);
      value.setPermissionRequestHandler((_contents, permission, callback) => callback(["fullscreen", "clipboard-sanitized-write"].includes(permission)));
      value.on("will-download", (_event, item) => { item.once("done", (_e, state) => { if (state === "completed") shell.showItemInFolder(item.getSavePath()); }); });
      // Pages see the same Chrome identity as in Chrome itself.
      value.setUserAgent(value.getUserAgent().replace(/\s*Electron\/\S+/, "").replace(/\s*timewarp(?:-desktop)?\/\S+/gi, "").trim());
    }
    return value;
  }

  const stateOf = tab => ({
    id: tab.id, conversationId: tab.conversationId, profileId: tab.profileId, kind: tab.kind,
    url: tab.view ? tab.view.webContents.getURL() : tab.url, title: tab.title || "", favicon: tab.favicon || null,
    loading: !!tab.loading, canGoBack: !!tab.view?.webContents.navigationHistory.canGoBack(),
    canGoForward: !!tab.view?.webContents.navigationHistory.canGoForward(), agent: tab.agent || null, muted: tab.muted !== false,
  });
  const chatTabs = conversationId => [...tabs.values()].filter(tab => tab.conversationId === conversationId).sort((a, b) => a.order - b.order);
  function groupState(conversationId) {
    restore(conversationId);
    const group = groups.get(conversationId) || { active: null };
    return { conversationId, active: group.active, userControl: userControl.has(conversationId), tabs: chatTabs(conversationId).map(stateOf) };
  }
  const changed = conversationId => { remember(conversationId); notify("browser.state", groupState(conversationId)); };

  // A chat's tabs come back after a restart, as in the previous app: addresses,
  // titles and the active tab are kept (no page content); a page loads when shown.
  const SAVED_KEY = "browserTabs", SAVED_CHATS = 50, SAVED_TABS = 12;
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
      tabs.set(id, { id, conversationId, profileId: profiles.has(item.profileId) ? item.profileId : fallback(), kind: url ? "web" : "home", url, title: String(item.title || "").slice(0, 300), order: Date.now() - SAVED_TABS + index, usedAt: 0 });
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
        return { id: tab.id, kind: url && recordable(url) ? "web" : "home", url: url && recordable(url) ? url : null, title: tab.title || "", profileId: tab.profileId, active: tab.id === active };
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
    if (visible && tab?.kind === "web" && !tab.view) { attach(tab); evict(); }
  }
  // Conversations where the user took the browser over from the agent.
  const userControl = new Set();

  // Hidden pages keep a real size, so the agent can still read and work in
  // them while the pane is closed or another tab or chat is shown.
  const HIDDEN_SIZE = { width: 1280, height: 860 };
  const onScreen = tab => !!(visible && bounds && tab.conversationId === shown && groups.get(shown)?.active === tab.id && tab.kind === "web");
  function layout() {
    const size = bounds && bounds.width > 200 && bounds.height > 200 ? { width: bounds.width, height: bounds.height } : HIDDEN_SIZE;
    for (const tab of tabs.values()) {
      if (!tab.view) continue;
      const show = onScreen(tab);
      tab.view.setVisible(show);
      tab.view.setBounds(show ? bounds : { x: 0, y: 0, ...size });
    }
  }

  function attach(tab) {
    const window = getWindow();
    if (!window || tab.view) return;
    const view = new WebContentsView({ webPreferences: { session: sessionFor(tab.profileId), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: true } });
    tab.view = view;
    window.contentView.addChildView(view);
    view.setVisible(false);
    view.setBounds(bounds && bounds.width > 200 ? { x: 0, y: 0, width: bounds.width, height: bounds.height } : { x: 0, y: 0, ...HIDDEN_SIZE });
    const contents = view.webContents;
    // Pages start muted, as in the previous app; the toolbar turns sound on.
    contents.setAudioMuted(tab.muted !== false);
    contents.setWindowOpenHandler(({ url }) => {
      try { void openTab(tab.conversationId, { url: safeUrl(url), profileId: tab.profileId }); } catch {}
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => { try { safeUrl(url); } catch { event.preventDefault(); } });
    contents.on("will-redirect", (event, url) => { try { safeUrl(url); } catch { event.preventDefault(); } });
    contents.on("did-start-loading", () => { tab.loading = true; changed(tab.conversationId); });
    contents.on("did-stop-loading", () => { tab.loading = false; changed(tab.conversationId); });
    contents.on("page-title-updated", (_event, title) => { tab.title = title; changed(tab.conversationId); });
    contents.on("page-favicon-updated", (_event, favicons) => { tab.favicon = favicons.find(icon => /^https:/.test(icon)) || null; changed(tab.conversationId); });
    contents.on("did-navigate", (_event, url) => {
      tab.url = url;
      if (recordable(url)) store.recentSites.record(tab.profileId, tab.conversationId, url, contents.getTitle());
      changed(tab.conversationId);
    });
    contents.on("did-navigate-in-page", (_event, url) => { tab.url = url; changed(tab.conversationId); });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) log?.warn("browser-view", "A page didn't load", { code, description, origin: (() => { try { return new URL(url).origin; } catch { return null; } })() });
    });
    contents.on("render-process-gone", (_event, details) => log?.warn("browser-view", "A page's renderer stopped", { reason: details?.reason }));
    contents.on("render-process-gone", () => { tab.loading = false; tab.title = "This page stopped responding"; changed(tab.conversationId); });
    if (tab.url && tab.url !== "about:blank") void contents.loadURL(tab.url).catch(() => {});
  }

  function evict() {
    const live = [...tabs.values()].filter(tab => tab.view).sort((a, b) => a.usedAt - b.usedAt);
    while (live.length > MAX_LIVE_TABS) {
      const tab = live.shift();
      if (tab.conversationId === shown && groups.get(shown)?.active === tab.id) continue;
      tab.url = tab.view.webContents.getURL() || tab.url;
      getWindow()?.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
      tab.view = null;
    }
  }

  function openTab(conversationId, { url = null, profileId, activate = true } = {}) {
    restore(conversationId);
    const profile = profileId || store.conversations.get(conversationId)?.browserProfileId || store.browserProfiles.ensureDefault().id;
    const tab = { id: crypto.randomUUID(), conversationId, profileId: profile, kind: url ? "web" : "home", url: url ? safeUrl(url) : null, title: "", order: Date.now(), usedAt: Date.now() };
    tabs.set(tab.id, tab);
    if (!groups.has(conversationId)) groups.set(conversationId, { active: null });
    if (tab.kind === "web") { attach(tab); evict(); }
    if (activate) groups.get(conversationId).active = tab.id;
    layout();
    changed(conversationId);
    return stateOf(tab);
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
    if (!tab.view) attach(tab); else void tab.view.webContents.loadURL(target).catch(() => {});
    evict();
    layout();
    changed(conversationId);
    return stateOf(tab);
  }

  function close(conversationId, tabId) {
    const tab = tabFor(conversationId, tabId);
    if (tab.view) { getWindow()?.contentView.removeChildView(tab.view); tab.view.webContents.close(); }
    tabs.delete(tab.id);
    const group = groups.get(conversationId);
    if (group?.active === tab.id) group.active = [...tabs.values()].filter(item => item.conversationId === conversationId).sort((a, b) => b.usedAt - a.usedAt)[0]?.id || null;
    layout();
    changed(conversationId);
    return groupState(conversationId);
  }

  return {
    safeUrl,
    state: conversationId => groupState(conversationId),
    show(conversationId) { shown = conversationId; restore(conversationId); wake(); layout(); return groupState(conversationId); },
    setBounds(rect) {
      if (!rect) { visible = false; layout(); return; }
      const round = value => Math.max(0, Math.round(Number(value) || 0));
      bounds = { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
      visible = bounds.width > 40 && bounds.height > 40 && rect.visible !== false;
      wake();
      layout();
    },
    openTab, navigate, close, sessionFor,
    activate(conversationId, tabId) { const tab = tabFor(conversationId, tabId); groups.get(conversationId).active = tab.id; if (tab.kind === "web" && !tab.view) { attach(tab); evict(); } layout(); changed(conversationId); return groupState(conversationId); },
    // Back to the new tab page in the same tab.
    home(conversationId, tabId) {
      const tab = tabFor(conversationId, tabId);
      if (tab.view) { getWindow()?.contentView.removeChildView(tab.view); tab.view.webContents.close(); tab.view = null; }
      Object.assign(tab, { kind: "home", url: null, title: "", favicon: null, loading: false, agent: null });
      layout();
      changed(conversationId);
      return groupState(conversationId);
    },
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
        if (tab.view) { getWindow()?.contentView.removeChildView(tab.view); tab.view.webContents.close(); }
        tabs.delete(tab.id);
        let reopened = null;
        try { reopened = openTab(conversationId, { url: url && recordable(url) ? url : null, profileId, activate: tab.id === active }); } catch {}
        if (reopened) tabs.get(reopened.id).order = tab.order;
      }
      layout();
      changed(conversationId);
      return groupState(conversationId);
    },
    // Signs a removed profile out everywhere by clearing its stored data.
    async removeProfile(profileId) {
      for (const [conversationId] of groups) if ([...tabs.values()].some(tab => tab.conversationId === conversationId && tab.profileId === profileId)) {
        const fallback = store.browserProfiles.ensureDefault().id;
        this.setProfile(conversationId, fallback);
      }
      await sessionFor(profileId).clearStorageData().catch(() => {});
    },
    recent: (conversationId, profileId) => store.recentSites.list(profileId || store.conversations.get(conversationId)?.browserProfileId || store.browserProfiles.ensureDefault().id, conversationId).slice(0, 4),
    // Agent tools act on the conversation's active web tab.
    webContents(conversationId, tabId) {
      const tab = tabFor(conversationId, tabId);
      if (tab.kind !== "web") throw fail(409, "Open a web page first.");
      if (!tab.view) { attach(tab); evict(); }
      // Pages the agent works in run at full speed even while hidden.
      tab.view.webContents.setBackgroundThrottling(false);
      return { tab, contents: tab.view.webContents, onScreen: onScreen(tab) };
    },
    setUserControl(conversationId, value) {
      if (value) { userControl.add(conversationId); for (const tab of tabs.values()) if (tab.conversationId === conversationId) tab.agent = null; }
      else userControl.delete(conversationId);
      changed(conversationId);
      return groupState(conversationId);
    },
    userInControl: conversationId => userControl.has(conversationId),
    markAgent(conversationId, tabId, agent) { if (agent && userControl.has(conversationId)) return; const tab = tabs.get(tabId); if (tab && tab.conversationId === conversationId) { tab.agent = agent; changed(conversationId); } },
    closeConversation(conversationId) { restored.add(conversationId); for (const tab of [...tabs.values()]) if (tab.conversationId === conversationId) { if (tab.view) { getWindow()?.contentView.removeChildView(tab.view); tab.view.webContents.close(); } tabs.delete(tab.id); } groups.delete(conversationId); remember(conversationId); },
    // Preview builds only: where the active page view is and what it shows.
    async inspect(conversationId) {
      const tab = tabs.get(groups.get(conversationId)?.active);
      if (!tab?.view) return { bounds: null, visible: false };
      const image = await tab.view.webContents.capturePage();
      return { bounds: tab.view.getBounds(), visible: tab.view.getVisible(), image: image.resize({ width: 480 }).toDataURL() };
    },
    destroy() { if (saveTimer) { clearTimeout(saveTimer); save(); } for (const tab of tabs.values()) if (tab.view) tab.view.webContents.close(); tabs.clear(); groups.clear(); },
  };
}

module.exports = { createBrowser, safeUrl, recordable };
