"use strict";
// First-run setup: Timewarp's onboarding service (desktop/onboarding-service.cjs)
// running on the engine's agents, settings, knowledge import and browser
// profiles. Progress stays in the profile's onboarding.bin, per account.
const fs = require("node:fs/promises");
const path = require("node:path");
const { safeStorage } = require("electron");
const { protectedStore } = require("../../desktop/protected-store.cjs");
const { bindOnboardingSettings } = require("../../desktop/onboarding.cjs");
const { createOnboardingService } = require("../../desktop/onboarding-service.cjs");
const { rememberName } = require("../../desktop/setup-imports.cjs");

function createOnboarding({ profile, store, services, agents, knowledge, browserImport, dialog, shell, defaultAppearance }) {
  const storage = protectedStore(path.join(profile, "onboarding.bin"), safeStorage);
  const userId = () => services.auth.userId();
  const settings = {
    get: async () => ({ appearance: store.settings.get("appearance") || defaultAppearance() }),
    update: async input => { if (input.appearance) store.settings.set("appearance", input.appearance); return settings.get(); },
  };
  bindOnboardingSettings({ settings, storage, userId });

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

  const service = createOnboardingService({
    storage, userId, native: () => native, browsers: () => browserImport, cloud: services.cloudJson,
    updateProfile: async name => { await services.accountRpc("product.profile.update", { name }); await services.auth.refreshUser(); },
    rememberName: (name, agent) => rememberName(knowledge.memoriesRoot, name, agent),
    openPayment: url => shell.openExternal(url), chooseCursorRoot,
  });
  return {
    service,
    async done() { return userId() ? (await settings.get()).onboarding.done : true; },
    // Marks setup finished for an account that doesn't need it (preview builds).
    async skip() { if (userId()) await settings.update({ onboarding: { done: true, conversationId: null } }); },
  };
}

module.exports = { createOnboarding };
