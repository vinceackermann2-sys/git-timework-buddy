"use strict";
// Timewarp account and cloud services: sign-in, cloud calls, organizations,
// Codex/ChatGPT connection, AI funding, connected apps and feedback.
const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, safeStorage, shell } = require("electron");
const { createAuth } = require("../../desktop/auth.cjs");
const { sessionStorage } = require("../../desktop/session-storage.cjs");
const { callbackServer } = require("../../desktop/oauth.cjs");
const { protectedStore } = require("../../desktop/protected-store.cjs");
const { assertCloudSafe } = require("../../shared/privacy.cjs");

function createServices({ profile, config, onAccountChanged = async () => {}, onCodexConnected = async () => {}, mcpToken, agentsFor, fixture = null }) {
  let oauthServer = null, callbackOpening = null, providersPromise = null;
  const providersFile = path.join(profile, "auth-providers.json");
  const appWindows = () => BrowserWindow.getAllWindows().filter(window => !window.isDestroyed() && window.webContents.getURL().startsWith("app://app/"));
  // Screens that list connected apps reload on this.
  const integrationsChanged = () => { for (const window of appWindows()) window.webContents.send("tw:event", "integrations.changed", {}); };
  const focusApp = () => { for (const window of appWindows()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } };

  const accountChanged = async ({ changedUser }) => {
    if (changedUser) { chatgpt.stop(); integrations.invalidate(); }
    await onAccountChanged({ changedUser });
  };
  const auth = fixture ? fixture.auth : createAuth({ config, storage: sessionStorage(profile, safeStorage), onChange: accountChanged });
  if (fixture) fixture.auth.bind(accountChanged);

  // A content type marks payload as already-encoded bytes (dictation audio).
  async function cloud(route, payload, method = "POST", contentType) {
    await ready;
    if (fixture) return fixture.cloud(route, payload, method);
    const token = await auth.accessToken();
    return fetch(`${config.supabaseUrl}/functions/v1/timewarp-energy${route}`, {
      method,
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, "content-type": contentType || "application/json" },
      ...(payload === undefined ? {} : { body: contentType ? payload : JSON.stringify(assertCloudSafe(payload)) }),
      signal: AbortSignal.timeout(140000), redirect: "error",
    });
  }
  async function cloudJson(route, input, method = "POST") {
    const response = await cloud(route, input, method), value = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(typeof value.error === "string" ? value.error : value.error?.message || "Cloud request failed."), { status: response.status });
    return value;
  }
  const accountRpc = (rpc, input = {}) => cloudJson("/native/rpc", { rpc, input });

  async function ensureCallback() {
    if (oauthServer?.listening) return;
    if (callbackOpening) return callbackOpening;
    callbackOpening = (async () => {
      const server = callbackServer(code => auth.completeOAuth(code), async () => focusApp(), 17654, async () => {
        const result = await integrations.callback();
        integrationsChanged();
        focusApp();
        return result;
      });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(17654, "127.0.0.1", resolve); })
        .catch(() => { server.close(); throw new Error("Another app is using the Timewarp sign-in callback. Close it and retry."); });
      oauthServer = server;
    })();
    try { await callbackOpening; } finally { callbackOpening = null; }
  }

  const chatgpt = require("../../desktop/chatgpt.cjs").createChatgpt({
    storage: protectedStore(path.join(profile, "codex-connection.bin"), safeStorage),
    userId: () => auth.userId(),
    onConnected: async () => { await onCodexConnected(); focusApp(); },
    onLoginError: async () => { focusApp(); },
  });
  const funding = require("../../desktop/ai-funding.cjs").createAiFunding({ cloud, chatgpt, userId: () => auth.userId() });
  const integrations = require("../../desktop/composio.cjs").createComposio({
    cloud: cloudJson, userId: () => auth.userId(),
    storage: protectedStore(path.join(profile, "connector-access.bin"), safeStorage),
    getAgent: id => agentsFor().get(id), listAgents: owner => agentsFor().listActiveByOwner(owner),
    ensureCallback, onChanged: async () => { focusApp(); }, mcpToken,
  });
  // A removed account disappears everywhere, as a new one appears.
  const disconnect = integrations.disconnect;
  integrations.disconnect = async input => { const result = await disconnect(input); integrationsChanged(); return result; };
  const sendFeedback = require("../../desktop/reporting.cjs").createReporting({ config, auth });
  // Start after every service exists: sign-in changes notify them.
  const ready = auth.init().then(async () => { if (auth.hasPendingFlow()) await ensureCallback().catch(() => {}); });
  // Signed out: look up the sign-in methods while the window opens.
  ready.then(() => { if (!auth.user()) void service.providers().catch(() => {}); }).catch(() => {});
  ready.catch(() => console.error("[timewarp] Secure account storage is unavailable."));

  async function account() {
    await ready;
    const user = auth.user();
    if (!user) return { user: null };
    const value = await cloudJson("/account", {});
    return { user: { ...user, image: value.image || null }, activeOrganization: value.activeOrganization || null, organizations: value.organizations || [] };
  }

  async function openExternal(link) {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password || /^(?:localhost|127\.|10\.|192\.168\.|\[|.*\.local$)/i.test(url.hostname)) throw new Error("Only public HTTPS links can be opened.");
    await shell.openExternal(url.href);
    return { opened: true };
  }

  const service = {
    auth, ready, cloud, cloudJson, accountRpc, chatgpt, funding, integrations, account, openExternal, ensureCallback, focusApp,
    submitFeedback: async input => { await ready; return sendFeedback(input); },
    // Sign-in methods. The last known answer shows the sign-in screen at once
    // while a fresh one loads; it holds no account data.
    providers() {
      if (!providersPromise) {
        providersPromise = auth.providers().then(value => {
          try { fs.writeFileSync(providersFile, JSON.stringify(value)); } catch {}
          return value;
        }).catch(error => { providersPromise = null; throw error; });
        providersPromise.catch(() => {});
      }
      try { return Promise.resolve(JSON.parse(fs.readFileSync(providersFile, "utf8"))); } catch { return providersPromise; }
    },
    close() { chatgpt.stop(); oauthServer?.close(); },
  };
  return service;
}

module.exports = { createServices };
