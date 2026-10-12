"use strict";
// First-run setup: Timewarp's onboarding service (desktop/onboarding-service.cjs)
// running on the engine's agents, settings, knowledge import and browser
// profiles. Progress stays in the profile's onboarding.bin, per account.
// Setup runs once per account: the cloud keeps that it was finished, so signing
// in again or on another computer skips it.
const fs = require("node:fs/promises");
const path = require("node:path");
const { safeStorage } = require("electron");
const { protectedStore } = require("../../desktop/protected-store.cjs");
const { bindOnboardingSettings, readOwners } = require("../../desktop/onboarding.cjs");
const { createOnboardingService } = require("../../desktop/onboarding-service.cjs");
const { rememberName } = require("../../desktop/setup-imports.cjs");

function createOnboarding({ profile, store, services, agents, knowledge, browserImport, importPasswords = null, dialog, shell, defaultAppearance, encryption = safeStorage, retryMs = 1000 }) {
  const storage = protectedStore(path.join(profile, "onboarding.bin"), encryption);
  const userId = () => services.auth.userId();
  const settings = {
    get: async () => ({ appearance: store.settings.get("appearance") || defaultAppearance() }),
    update: async input => { if (input.appearance) store.settings.set("appearance", input.appearance); return settings.get(); },
  };
  bindOnboardingSettings({ settings, storage, userId });
  const record = id => readOwners(storage)[id] || {};

  const product = {
    agents: {
      list: async () => agents.list().map(agent => ({ id: agent.id, displayName: agent.name })),
      create: async ({ agentId, displayName, instructions }) => agents.create({ id: agentId, name: displayName, instructions, avatar: { mascot: "Orbit" } }),
      update: async ({ agentId, displayName }) => agents.update(agentId, { name: displayName, avatar: { mascot: "Orbit" } }),
    },
  };
  const setupImport = { detect: async () => knowledge.detect(), import: async ({ items }) => knowledge.importItems(items) };
  const native = { settings, caller: () => ({ product, codex: { setupImport } }) };

  async function chooseCursorRoot() {
    const result = await dialog.showOpenDialog({ title: "Choose your Cursor project or .cursor folder", properties: ["openDirectory"] });
    if (result.canceled) return null;
    const selected = result.filePaths[0], root = path.basename(selected) === ".cursor" ? selected : path.join(selected, ".cursor");
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) throw new Error("This folder has no .cursor directory. Choose a Cursor project with rules or skills.");
    return fs.realpath(root);
  }

  // Tells the cloud this account finished setup, once per computer.
  async function share(id) {
    if (!id || id !== userId()) return;
    await services.accountRpc("product.onboarding.complete", {});
    if (id === userId()) await settings.update({ onboarding: { cloud: true } });
  }
  // Whether the account finished setup elsewhere. A cloud that doesn't answer
  // this (an older one) or can't be reached leaves setup to run, as before.
  async function finishedElsewhere() {
    for (let attempt = 0; ; attempt++) {
      try { return !!(await services.accountRpc("product.onboarding.status", {}))?.done; }
      catch (error) {
        if (attempt || (error.status >= 400 && error.status < 500)) return false;
        await new Promise(resolve => setTimeout(resolve, retryMs));
      }
    }
  }
  // The window and the sandbox ask at the same moment after sign-in.
  let asking = null;
  function askCloud(id) {
    if (asking?.id !== id) {
      const result = finishedElsewhere();
      asking = { id, result };
      void result.finally(() => { if (asking?.result === result) asking = null; });
    }
    return asking.result;
  }

  const service = createOnboardingService({
    storage, userId, native: () => native, browsers: () => browserImport, cloud: services.cloudJson,
    updateProfile: async name => { await services.accountRpc("product.profile.update", { name }); await services.auth.refreshUser(); },
    rememberName: (name, agent) => rememberName(knowledge.memoriesRoot, name, agent),
    openPayment: url => shell.openExternal(url), chooseCursorRoot, importPasswords,
  });
  return {
    service: {
      ...service,
      async run(action, input) {
        const id = userId(), result = await service.run(action, input);
        // Setup stays finished here if the cloud can't be told now; the next launch tells it.
        if (action === "complete") await share(id).catch(() => {});
        return result;
      },
    },
    async done() {
      const id = userId();
      if (!id) return true;
      const saved = record(id);
      if (saved.done) { if (!saved.cloud) void share(id).catch(() => {}); return true; }
      // "Run setup again" runs it on this computer whatever the cloud says,
      // also when it's chosen while the cloud is answering.
      if (saved.restarted || !await askCloud(id) || id !== userId()) return false;
      const latest = record(id);
      if (latest.done) return true;
      if (latest.restarted) return false;
      await settings.update({ onboarding: { done: true, conversationId: null, cloud: true } });
      return true;
    },
    // Marks setup finished for an account that doesn't need it (preview builds).
    async skip() { if (userId()) await settings.update({ onboarding: { done: true, conversationId: null } }); },
    // Starts setup over for this account (its saved answers are cleared).
    async restart() { if (!userId()) throw new Error("Sign in to Timewarp."); await settings.update({ onboarding: { done: false, conversationId: null, restarted: true } }); return { restarted: true }; },
  };
}

module.exports = { createOnboarding };
