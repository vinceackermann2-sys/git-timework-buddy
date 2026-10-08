"use strict";
// The engine API used by Timewarp's interface through window.tw.call().
const fs = require("node:fs");
const path = require("node:path");

const SETTING_KEYS = new Set(["appearance", "privacy", "preferences", "notifications", "memory"]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max = 20000) => typeof value === "string" ? value.slice(0, max) : "";

function createMethods({ app, dialog, shell, store, services, agents, harness, client, version, profile, modelChoices, selectModel, registerTools, historyStatus, flushHistory, defaultAccent }) {
  const signedIn = () => { if (!services.auth.userId()) throw fail(401, "Sign in to Timewarp."); };
  return {
    "app.info": async () => ({ version, platform: process.platform, codex: client.status }),
    "account.get": () => services.account(),
    "account.signOut": () => services.auth.signOut(),
    "history.status": () => historyStatus(),
    "history.sync": async () => { await flushHistory(); return historyStatus(); },

    "settings.get": () => {
      const all = store.settings.all();
      return {
        appearance: all.appearance || { scheme: "system", accent: defaultAccent, radiance: 0.5, texture: { type: "dots", step: 0 } },
        privacy: all.privacy || { mode: "standard" },
        preferences: all.preferences || {},
        notifications: all.notifications || { replies: true },
        memory: all.memory || { mode: "standard" },
        modelSettings: all.modelSettings || null,
      };
    },
    "settings.set": ({ key, value }) => {
      if (!SETTING_KEYS.has(key)) throw fail(400, "Unknown setting.");
      if (value === undefined || JSON.stringify(value).length > 20000) throw fail(400, "Invalid setting.");
      store.settings.set(key, value);
      if (key === "privacy") void flushHistory();
      return value;
    },

    "models.list": async () => {
      signedIn();
      const choices = await modelChoices();
      return { choices, selected: await selectModel(choices) };
    },
    "models.select": async ({ name, reasoningEffort }) => {
      signedIn();
      const choices = await modelChoices();
      const choice = choices.find(item => item.id === name);
      if (!choice) throw fail(400, "This model is not available on your plan.");
      store.settings.set("modelSettings", { ...store.settings.get("modelSettings"), name, reasoningEffort: reasoningEffort || choice.defaultReasoningEffort || null });
      return selectModel(choices);
    },
    "funding.get": async () => { signedIn(); return services.funding.current(); },

    "agents.list": () => { signedIn(); return agents.list(); },
    "agents.create": input => { signedIn(); return agents.create({ name: input.name, instructions: text(input.instructions), avatar: input.avatar }); },
    "agents.update": ({ id, ...patch }) => { signedIn(); return agents.update(id, patch); },
    "agents.instructions": ({ id }) => { signedIn(); return { instructions: agents.instructions(id) }; },
    "agents.archive": ({ id }) => { signedIn(); return agents.archive(id); },
    "agents.reorder": ({ ids }) => { signedIn(); return agents.reorder(ids); },
    "agents.openWorkspace": async ({ id }) => {
      signedIn();
      const agent = agents.get(id);
      fs.mkdirSync(agent.workspace, { recursive: true });
      const error = await shell.openPath(agent.workspace);
      if (error) throw fail(500, error);
      return { opened: true };
    },

    "conversations.list": input => { signedIn(); return harness.conversations.list({ agentId: input.agentId, archivedOnly: !!input.archived, search: input.search ? text(input.search, 200) : undefined }); },
    "conversations.create": ({ agentId }) => { signedIn(); return harness.conversations.create({ agentId }); },
    "conversations.get": ({ id }) => { signedIn(); return harness.conversations.get(id); },
    "conversations.rename": ({ id, title }) => { signedIn(); return harness.conversations.rename(id, title); },
    "conversations.archive": ({ id, archived = true }) => { signedIn(); return harness.conversations.archive(id, archived); },
    "conversations.markRead": ({ id }) => { signedIn(); return harness.conversations.markRead(id); },
    "conversations.history": ({ id }) => { signedIn(); return harness.history(id); },
    "conversations.status": ({ id }) => { signedIn(); return harness.conversations.status(id); },
    "conversations.send": ({ id, text: message, images = [], clientId }) => {
      signedIn();
      const files = (Array.isArray(images) ? images : []).filter(file => typeof file === "string" && path.isAbsolute(file) && fs.existsSync(file));
      return harness.send(id, { text: text(message, 200000), images: files, clientId: typeof clientId === "string" ? clientId : undefined });
    },
    "conversations.interrupt": ({ id }) => { signedIn(); return harness.interrupt(id); },
    "approvals.respond": ({ id, response }) => { signedIn(); return harness.respond(id, response); },
    "approvals.pending": () => { signedIn(); return harness.pendingApprovals(); },

    "attachments.choose": async () => {
      signedIn();
      const result = await dialog.showOpenDialog({ title: "Attach images", properties: ["openFile", "multiSelections"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
      return result.canceled ? [] : result.filePaths;
    },

    "integrations.list": input => { signedIn(); return services.integrations.list(input); },
    "integrations.beginConnect": async input => {
      signedIn();
      await services.ensureCallback();
      const result = await services.integrations.beginConnect(input);
      if (result?.connectUrl) await services.openExternal(result.connectUrl);
      return result;
    },
    "integrations.disconnect": input => { signedIn(); return services.integrations.disconnect(input); },
    "integrations.getAccess": input => { signedIn(); return services.integrations.getAccess(input); },
    "integrations.setAccess": input => { signedIn(); return services.integrations.setAccess(input); },
    "integrations.refresh": async () => { signedIn(); services.integrations.invalidate(); await registerTools(true); return { ready: true }; },

    "organizations.members": () => { signedIn(); return services.accountRpc("product.organizations.members"); },
    "organizations.invitations": () => { signedIn(); return services.accountRpc("product.organizations.invitations.list"); },
    "organizations.pending": () => { signedIn(); return services.accountRpc("product.organizations.invitations.pending"); },
    "organizations.invite": ({ email, role }) => { signedIn(); return services.accountRpc("product.organizations.invitations.create", { email: text(email, 320), role: role === "admin" ? "admin" : "member" }); },
    "organizations.revokeInvite": ({ invitationId }) => { signedIn(); return services.accountRpc("product.organizations.invitations.revoke", { invitationId: text(invitationId, 100) }); },
    "organizations.acceptInvite": async ({ invitationId }) => { signedIn(); await services.accountRpc("product.organizations.invitations.accept", { invitationId: text(invitationId, 100) }); return services.account(); },
    "organizations.setActive": async ({ organizationId }) => { signedIn(); await services.accountRpc("product.organizations.setActive", { organizationId: text(organizationId, 100) }); return services.account(); },
    "organizations.update": ({ name, logo }) => { signedIn(); return services.accountRpc("product.organizations.update", { name: text(name, 120), ...(logo !== undefined ? { logo: logo ? text(logo, 200) : null } : {}) }); },
    "organizations.create": async ({ name, logo }) => { signedIn(); await services.accountRpc("product.organizations.create", { name: text(name, 120), ...(logo ? { logo: text(logo, 200) } : {}) }); return services.account(); },
    "images.beginUpload": () => { signedIn(); return services.accountRpc("product.images.beginUpload"); },
    "profile.update": async ({ name, imageId }) => {
      signedIn();
      await services.accountRpc("product.profile.update", { ...(name !== undefined ? { name: text(name, 100) } : {}), ...(imageId !== undefined ? { imageId: text(imageId, 200) } : {}) });
      await services.auth.refreshUser();
      return services.account();
    },

    "feedback.submit": input => services.submitFeedback(input),
    "links.open": ({ url }) => services.openExternal(url),
    "app.quit": () => { app.quit(); return { quitting: true }; },
    "profile.path": () => ({ profile }),
  };
}

module.exports = { createMethods, SETTING_KEYS };
