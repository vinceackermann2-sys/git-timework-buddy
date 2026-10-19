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

function createOnboarding({ profile, store, services, agents, knowledge, browserImport, assistantImport = null, importPasswords = null, dialog, shell, defaultAppearance, encryption = safeStorage, retryMs = 1000, askMs = 15000 }) {
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
    const result = await dialog.showOpenDialog({ title: "Choose your Cursor project folder", properties: ["openDirectory"] });
    if (result.canceled) return null;
    // Use the project root so .cursor/rules, .cursorrules and AGENTS.md resolve.
    let root = result.filePaths[0];
    if (path.basename(root) === ".cursor") root = path.dirname(root);
    const hasCursor = await fs.stat(path.join(root, ".cursor")).then(stat => stat.isDirectory()).catch(() => false);
    const hasRules = await fs.stat(path.join(root, ".cursorrules")).then(stat => stat.isFile()).catch(() => false);
    if (!hasCursor && !hasRules) throw new Error("This isn't a Cursor project. Choose a folder with a .cursor directory or a .cursorrules file.");
    return fs.realpath(root);
  }

  // Tells the cloud this account finished setup, once per computer.
  async function share(id) {
    if (!id || id !== userId()) return;
    await services.accountRpc("product.onboarding.complete", {});
    if (id === userId()) await settings.update({ onboarding: { cloud: true } });
  }
  // A computer signing in soon after shouldn't run setup again because the
  // cloud couldn't be told: it's told again a few times, and at the next launch.
  function shareSoon(id, attempt = 0) {
    return share(id).catch(() => {
      if (attempt < 3) setTimeout(() => void shareSoon(id, attempt + 1), retryMs * 10 ** attempt).unref?.();
    });
  }
  // Whether the account finished setup elsewhere: true or false as the cloud
  // says, or null when it can't say now. A cloud without these calls (an older
  // one) leaves setup to run, as before. The window waits on this, so each try
  // waits askMs at most.
  async function finishedElsewhere() {
    for (let attempt = 0; ; attempt++) {
      let timer;
      const late = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error("The cloud didn't answer.")), askMs); });
      try { return !!(await Promise.race([services.accountRpc("product.onboarding.status", {}), late]))?.done; }
      catch (error) {
        if (error.status === 404 || error.status === 410) return false;
        if (attempt === 2) return null;
      } finally { clearTimeout(timer); }
      await new Promise(resolve => setTimeout(resolve, retryMs * 2 ** attempt));
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
    openPayment: url => shell.openExternal(url), chooseCursorRoot, importPasswords, assistantImport,
  });
  return {
    service: {
      ...service,
      async run(action, input) {
        const id = userId(), result = await service.run(action, input);
        if (action === "complete") {
          // The workspace then shows First steps (FirstSteps.jsx), once.
          if (id === userId()) await settings.update({ onboarding: { firstSteps: true } });
          // Setup stays finished here if the cloud can't be told now.
          await shareSoon(id);
        }
        return result;
      },
    },
    // Setup runs once per account: only when this computer has no finished
    // setup for it and the cloud says it never finished one.
    async done() {
      const id = userId();
      if (!id) return true;
      const saved = record(id);
      if (saved.done) { if (!saved.cloud) void share(id).catch(() => {}); return true; }
      // "Run setup again" runs it on this computer whatever the cloud says,
      // also when it's chosen while the cloud is answering.
      if (saved.restarted) return false;
      const finished = await askCloud(id);
      if (id !== userId()) return false;
      const latest = record(id);
      if (latest.done) return true;
      if (latest.restarted) return false;
      // A cloud that can't say now doesn't bring setup back for an account that
      // may have finished it; it's asked again at the next sign-in or launch.
      if (finished === null) return true;
      if (!finished) return false;
      await settings.update({ onboarding: { done: true, conversationId: null, cloud: true } });
      return true;
    },
    // Marks setup finished for an account that doesn't need it (preview builds).
    async skip() { if (userId()) await settings.update({ onboarding: { done: true, conversationId: null } }); },
    // Whether the workspace still owes this account First steps: the short
    // guide after setup finished on this computer, until it's done or skipped.
    firstSteps: () => { const id = userId(); return !!(id && record(id).firstSteps); },
    async firstStepsDone() { const id = userId(); if (id && record(id).firstSteps) await settings.update({ onboarding: { firstSteps: false } }); return { done: true }; },
    // Starts setup over for this account (its saved answers are cleared).
    async restart() { if (!userId()) throw new Error("Sign in to Timewarp."); await settings.update({ onboarding: { done: false, conversationId: null, restarted: true } }); return { restarted: true }; },
  };
}

module.exports = { createOnboarding };
