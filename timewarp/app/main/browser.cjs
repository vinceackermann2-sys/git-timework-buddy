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
  else address = "https://duckduckgo.com/?q=" + encodeURIComponent(text);
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

function createBrowser({ window: getWindow, store, notify = () => {}, userAgentSuffix = "Timewarp" }) {
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
      value.setUserAgent(value.getUserAgent().replace(/\s*Electron\/\S+/, "").replace(/\s*timewarp-desktop\/\S+/i, "") + " " + userAgentSuffix);
    }
    return value;
  }

  const stateOf = tab => ({
    id: tab.id, conversationId: tab.conversationId, profileId: tab.profileId, kind: tab.kind,
    url: tab.view ? tab.view.webContents.getURL() : tab.url, title: tab.title || "", favicon: tab.favicon || null,
    loading: !!tab.loading, canGoBack: !!tab.view?.webContents.navigationHistory.canGoBack(),
    canGoForward: !!tab.view?.webContents.navigationHistory.canGoForward(), agent: tab.agent || null,
  });
  function groupState(conversationId) {
    const group = groups.get(conversationId) || { active: null };
    return { conversationId, active: group.active, userControl: userControl.has(conversationId), tabs: [...tabs.values()].filter(tab => tab.conversationId === conversationId).sort((a, b) => a.order - b.order).map(stateOf) };
  }
  const changed = conversationId => notify("browser.state", groupState(conversationId));
  // Conversations where the user took the browser over from the agent.
  const userControl = new Set();

  function layout() {
    const window = getWindow();
    for (const tab of tabs.values()) {
      if (!tab.view) continue;
      const show = visible && bounds && tab.conversationId === shown && groups.get(shown)?.active === tab.id && tab.kind === "web";
      tab.view.setVisible(!!show);
      if (show) tab.view.setBounds(bounds);
    }
    void window;
  }

  function attach(tab) {
    const window = getWindow();
    if (!window || tab.view) return;
    const view = new WebContentsView({ webPreferences: { session: sessionFor(tab.profileId), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: true } });
    tab.view = view;
    window.contentView.addChildView(view);
    view.setVisible(false);
    const contents = view.webContents;
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
    show(conversationId) { shown = conversationId; layout(); return groupState(conversationId); },
    setBounds(rect) {
      if (!rect) { visible = false; layout(); return; }
      const round = value => Math.max(0, Math.round(Number(value) || 0));
      bounds = { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
      visible = bounds.width > 40 && bounds.height > 40 && rect.visible !== false;
      layout();
    },
    openTab, navigate, close,
    activate(conversationId, tabId) { const tab = tabFor(conversationId, tabId); groups.get(conversationId).active = tab.id; if (tab.kind === "web" && !tab.view) { attach(tab); evict(); } layout(); changed(conversationId); return groupState(conversationId); },
    back(conversationId, tabId) { const tab = tabFor(conversationId, tabId); if (tab.view?.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack(); return stateOf(tab); },
    forward(conversationId, tabId) { const tab = tabFor(conversationId, tabId); if (tab.view?.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward(); return stateOf(tab); },
    reload(conversationId, tabId) { const tab = tabFor(conversationId, tabId); tab.view?.webContents.reload(); return stateOf(tab); },
    stop(conversationId, tabId) { const tab = tabFor(conversationId, tabId); tab.view?.webContents.stop(); return stateOf(tab); },
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
      if (!tab.view) { attach(tab); evict(); layout(); }
      return { tab, contents: tab.view.webContents };
    },
    setUserControl(conversationId, value) {
      if (value) { userControl.add(conversationId); for (const tab of tabs.values()) if (tab.conversationId === conversationId) tab.agent = null; }
      else userControl.delete(conversationId);
      changed(conversationId);
      return groupState(conversationId);
    },
    userInControl: conversationId => userControl.has(conversationId),
    markAgent(conversationId, tabId, agent) { if (agent && userControl.has(conversationId)) return; const tab = tabs.get(tabId); if (tab && tab.conversationId === conversationId) { tab.agent = agent; changed(conversationId); } },
    closeConversation(conversationId) { for (const tab of [...tabs.values()]) if (tab.conversationId === conversationId) { if (tab.view) { getWindow()?.contentView.removeChildView(tab.view); tab.view.webContents.close(); } tabs.delete(tab.id); } groups.delete(conversationId); },
    // Preview builds only: where the active page view is and what it shows.
    async inspect(conversationId) {
      const tab = tabs.get(groups.get(conversationId)?.active);
      if (!tab?.view) return { bounds: null, visible: false };
      const image = await tab.view.webContents.capturePage();
      return { bounds: tab.view.getBounds(), visible: tab.view.getVisible(), image: image.resize({ width: 480 }).toDataURL() };
    },
    destroy() { for (const tab of tabs.values()) if (tab.view) tab.view.webContents.close(); tabs.clear(); groups.clear(); },
  };
}

module.exports = { createBrowser, safeUrl, recordable };
