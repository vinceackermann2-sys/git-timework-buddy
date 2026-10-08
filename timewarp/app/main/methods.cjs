"use strict";
// The engine API used by Timewarp's interface through window.tw.call().
const fs = require("node:fs");
const path = require("node:path");

const { createFiles } = require("./files.cjs");
const MAX_ATTACHMENT = 100 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const SETTING_KEYS = new Set(["appearance", "privacy", "preferences", "notifications", "memory"]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max = 20000) => typeof value === "string" ? value.slice(0, max) : "";

// Runs in the page (isolated world): fills the visible password field and the
// username field before it. Returns whether a password field was found.
function fillSignIn(username, password) {
  const visible = element => !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length) && !element.disabled && !element.readOnly;
  const set = (element, value) => {
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll("input")].filter(visible);
  const secret = inputs.find(element => element.type === "password");
  const named = inputs.find(element => element.autocomplete === "username" || element.type === "email");
  const before = secret ? inputs.slice(0, inputs.indexOf(secret)).reverse().find(element => ["text", "email", "tel", ""].includes(element.type)) : null;
  const user = named || before || (!secret ? inputs.find(element => ["text", "email"].includes(element.type)) : null);
  if (user && username) set(user, username);
  if (secret) set(secret, password);
  return !!(secret || (user && username));
}

function createMethods({ app, dialog, shell, store, services, agents, harness, client, browser, version, profile, modelChoices, selectModel, registerTools, historyStatus, flushHistory, defaultAppearance, knowledge, onboarding, automations, mcp, codexHome, vault, clipboard }) {
  const signedIn = () => { if (!services.auth.userId()) throw fail(401, "Sign in to Timewarp."); };
  // Agent ownership is checked on every call by agents.get().
  const files = createFiles({ workspaceOf: agentId => { signedIn(); return agents.get(agentId).workspace; } });
  return {
    "app.info": async () => ({ version, platform: process.platform, codex: client.status }),
    "account.get": () => services.account(),
    "account.signOut": () => services.auth.signOut(),
    "history.status": () => historyStatus(),
    "history.sync": async () => { await flushHistory(); return historyStatus(); },

    "settings.get": () => {
      const all = store.settings.all();
      return {
        appearance: all.appearance || defaultAppearance(),
        privacy: all.privacy || { mode: "standard" },
        preferences: all.preferences || {},
        notifications: all.notifications || { replies: true },
        memory: all.memory || { mode: "enabled" },
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
    "conversations.send": ({ id, text: message, images = [], files = [], clientId, retryOf }) => {
      signedIn();
      const existing = list => (Array.isArray(list) ? list : []).filter(file => typeof file === "string" && path.isAbsolute(file) && fs.existsSync(file) && fs.statSync(file).isFile()).slice(0, 10);
      const attached = existing(files);
      if (attached.some(file => fs.statSync(file).size > MAX_ATTACHMENT)) throw fail(413, "Attach files smaller than 100 MB.");
      return harness.send(id, { text: text(message, 200000), images: existing(images).filter(file => IMAGE.test(file)), files: attached, clientId: typeof clientId === "string" ? clientId : undefined, retryOf: typeof retryOf === "string" ? retryOf : undefined });
    },
    "conversations.warm": ({ id }) => { signedIn(); return harness.warm(id); },
    "conversations.setModel": async ({ id, name, reasoningEffort }) => {
      signedIn();
      const choice = (await modelChoices()).find(item => item.id === name);
      if (!choice) throw fail(400, "This model is not available on your plan.");
      return harness.setModel(id, { name, reasoningEffort: reasoningEffort || choice.defaultReasoningEffort || null });
    },
    "conversations.interrupt": ({ id }) => { signedIn(); return harness.interrupt(id); },
    "approvals.respond": ({ id, response }) => { signedIn(); return harness.respond(id, response); },
    "approvals.pending": () => { signedIn(); return harness.pendingApprovals(); },

    "attachments.choose": async () => {
      signedIn();
      const result = await dialog.showOpenDialog({ title: "Attach files", properties: ["openFile", "multiSelections"] });
      return result.canceled ? [] : result.filePaths.map(file => ({ path: file, image: IMAGE.test(file), size: fs.statSync(file).size }));
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

    // Built-in browser. Every call is scoped to a conversation of this account.
    "browser.show": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.show(conversationId); },
    "browser.bounds": ({ rect }) => { browser.setBounds(rect || null); return null; },
    "browser.state": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.state(conversationId); },
    "browser.newTab": ({ conversationId, url }) => { signedIn(); harness.conversations.get(conversationId); return browser.openTab(conversationId, { url: url || null }); },
    "browser.navigate": ({ conversationId, tabId, url }) => { signedIn(); harness.conversations.get(conversationId); return browser.navigate(conversationId, { tabId, url }); },
    "browser.activate": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.activate(conversationId, tabId); },
    "browser.close": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.close(conversationId, tabId); },
    "browser.back": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.back(conversationId, tabId); },
    "browser.forward": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.forward(conversationId, tabId); },
    "browser.reload": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.reload(conversationId, tabId); },
    "browser.stop": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.stop(conversationId, tabId); },
    "browser.profiles": () => { signedIn(); store.browserProfiles.ensureDefault(); return store.browserProfiles.list(); },
    "browser.setProfile": ({ conversationId, profileId }) => { signedIn(); harness.conversations.get(conversationId); return browser.setProfile(conversationId, profileId); },
    "browser.takeControl": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.setUserControl(conversationId, true); },
    "browser.handBack": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.setUserControl(conversationId, false); },
    "browser.recent": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.recent(conversationId); },

    // Files view: read-only access inside the agent's workspace.
    "files.list": ({ agentId, path: dir }) => files.list(agentId, dir),
    "files.read": ({ agentId, path: file }) => files.read(agentId, file),
    "files.search": ({ agentId, query }) => files.search(agentId, query),
    "files.open": async ({ agentId, path: file }) => { const error = await shell.openPath(files.absolute(agentId, file)); if (error) throw fail(500, error); return { opened: true }; },
    "files.reveal": ({ agentId, path: file }) => { shell.showItemInFolder(files.absolute(agentId, file)); return { shown: true }; },

    // Codex's Windows command sandbox. Setup runs only when the user asks for it.
    "sandbox.status": () => process.platform === "win32" ? client.request("windowsSandbox/readiness", {}) : { status: "ready" },
    "sandbox.setup": ({ mode }) => {
      signedIn();
      if (process.platform !== "win32") return { started: false };
      return client.request("windowsSandbox/setupStart", { mode: mode === "unelevated" ? "unelevated" : "elevated" });
    },

    // Memory, knowledge imported from other assistants, and skills.
    "memory.get": () => { signedIn(); return knowledge.read(); },
    "memory.save": ({ notes }) => { signedIn(); return knowledge.saveNotes(notes); },
    "memory.removeImport": ({ path: file }) => { signedIn(); return knowledge.removeImport(file); },
    "memory.openFolder": async () => { signedIn(); fs.mkdirSync(knowledge.memoriesRoot, { recursive: true }); const error = await shell.openPath(knowledge.memoriesRoot); if (error) throw fail(500, error); return { opened: true }; },
    "knowledge.detect": () => { signedIn(); return knowledge.detect(); },
    "knowledge.import": async ({ items }) => {
      signedIn();
      const result = knowledge.importItems(items);
      if (result.imported.skills) await client.request("skills/list", { forceReload: true }).catch(() => {});
      return result;
    },
    "skills.list": async ({ reload = false } = {}) => {
      signedIn();
      const result = await client.request("skills/list", { forceReload: !!reload });
      const seen = new Set(), skills = [], errors = [];
      for (const entry of result.data || []) {
        errors.push(...(entry.errors || []).map(error => error.message));
        for (const skill of entry.skills || []) {
          if (seen.has(skill.path)) continue;
          seen.add(skill.path);
          const local = path.resolve(skill.path).startsWith(path.resolve(knowledge.skillsRoot) + path.sep) && !/[\\/]\.system[\\/]/.test(skill.path);
          skills.push({ name: skill.name, title: skill.interface?.displayName || skill.name, description: skill.interface?.shortDescription || skill.shortDescription || skill.description || "", scope: skill.scope, enabled: skill.enabled !== false, path: skill.path, removable: local });
        }
      }
      skills.sort((a, b) => (a.scope === "system") - (b.scope === "system") || a.title.localeCompare(b.title));
      return { skills, errors: [...new Set(errors)] };
    },
    "skills.setEnabled": async ({ path: file, enabled }) => { signedIn(); await client.request("skills/config/write", { path: text(file, 4000), enabled: !!enabled }); return { enabled: !!enabled }; },
    "skills.remove": async ({ name }) => { signedIn(); const result = knowledge.removeSkill(name); await client.request("skills/list", { forceReload: true }).catch(() => {}); return result; },
    "skills.openFolder": async () => { signedIn(); fs.mkdirSync(knowledge.skillsRoot, { recursive: true }); const error = await shell.openPath(knowledge.skillsRoot); if (error) throw fail(500, error); return { opened: true }; },
    // MCP servers the user adds, and instructions every agent follows.
    "mcp.list": () => { signedIn(); return mcp.list(); },
    "mcp.add": input => { signedIn(); return mcp.add(input); },
    "mcp.setEnabled": ({ name, enabled }) => { signedIn(); return mcp.setEnabled(name, enabled); },
    "mcp.remove": ({ name }) => { signedIn(); return mcp.remove(name); },
    "mcp.signIn": ({ name }) => { signedIn(); return mcp.signIn(name); },
    "instructions.get": () => { signedIn(); try { return { text: fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf8") }; } catch { return { text: "" }; } },
    "instructions.save": ({ text: value }) => {
      signedIn();
      if (typeof value !== "string" || value.length > 20000) throw fail(400, "Instructions must be text under 20,000 characters.");
      const file = path.join(codexHome, "AGENTS.md"), temporary = file + "." + process.pid + ".tmp";
      fs.writeFileSync(temporary, value.trim() ? value.trim() + "\n" : "");
      fs.renameSync(temporary, file);
      return { text: fs.readFileSync(file, "utf8") };
    },
    // Vault. Values leave the main process only when the user copies or shows
    // one, or fills a sign-in into the page they are looking at.
    "vault.list": () => { signedIn(); return { available: vault.available(), items: vault.list() }; },
    "vault.create": input => { signedIn(); return vault.create(input); },
    "vault.update": ({ id, ...input }) => { signedIn(); return vault.update(id, input); },
    "vault.remove": ({ id }) => { signedIn(); return vault.remove(id); },
    "vault.reveal": ({ id, field }) => {
      signedIn();
      const item = vault.secret(id);
      if (!["password", "number", "cvc", "value"].includes(field) || item[field] === undefined) throw fail(400, "Nothing to show.");
      return { value: item[field] };
    },
    "vault.copy": ({ id, field }) => {
      signedIn();
      const item = vault.secret(id), value = item[field];
      if (!["password", "username", "number", "cvc", "value"].includes(field) || !value) throw fail(400, "Nothing to copy.");
      clipboard.writeText(value);
      // Clear the clipboard after a minute unless something else was copied.
      setTimeout(() => { if (clipboard.readText() === value) clipboard.clear(); }, 60000).unref?.();
      return { copied: true };
    },
    "vault.signInsForPage": ({ conversationId, tabId }) => {
      signedIn(); harness.conversations.get(conversationId);
      const url = browser.webContents(conversationId, tabId).contents.getURL();
      return vault.signInsFor(url);
    },
    "vault.fillPage": async ({ conversationId, tabId, id }) => {
      signedIn(); harness.conversations.get(conversationId);
      const { contents } = browser.webContents(conversationId, tabId);
      const item = vault.secret(id);
      if (item.kind !== "password" || !vault.signInsFor(contents.getURL()).some(entry => entry.id === id)) throw fail(403, "This sign-in isn't saved for this site.");
      const filled = await contents.executeJavaScriptInIsolatedWorld(1007, [{ code: `(${fillSignIn})(${JSON.stringify(item.username || "")}, ${JSON.stringify(item.password)})` }], true);
      if (!filled) throw fail(404, "Timewarp couldn't find a sign-in form on this page.");
      return { filled: true };
    },
    "automations.list": () => automations.list(),
    "automations.create": input => automations.create(input),
    "automations.update": ({ id, ...patch }) => automations.update(id, patch),
    "automations.remove": ({ id }) => automations.remove(id),
    "automations.run": ({ id }) => automations.runNow(id),
    "automations.runs": ({ id }) => automations.runs(id),
    // Voice input. Audio is sent once for transcription and not stored.
    "dictation.transcribe": async ({ audio, mimeType }) => {
      signedIn();
      const bytes = audio instanceof ArrayBuffer ? Buffer.from(audio) : ArrayBuffer.isView(audio) ? Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength) : null;
      if (!bytes?.length) throw fail(400, "Nothing was recorded.");
      if (bytes.length > 8 * 1024 * 1024) throw fail(413, "Recording is too long. Keep voice input under about 15 minutes.");
      const type = /^audio\/(?:webm|ogg|mp4|wav)/.test(String(mimeType)) ? String(mimeType).split(";")[0] : "audio/webm";
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), "dictation." + type.split("/")[1]);
      const encoded = new Response(form);
      const response = await services.cloud("/v1/transcriptions", Buffer.from(await encoded.arrayBuffer()), "POST", encoded.headers.get("content-type"));
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw fail(response.status, response.status === 402 ? "Voice input needs available credits. Add credits in Billing." : value.error?.message || (typeof value.error === "string" ? value.error : "Transcription failed. Try again."));
      return { text: String(value.text || "").trim() };
    },
    "onboarding.status": async () => ({ done: await onboarding.done() }),

    "feedback.submit": input => services.submitFeedback(input),
    "links.open": ({ url }) => services.openExternal(url),
    "app.quit": () => { app.quit(); return { quitting: true }; },
    "profile.path": () => ({ profile }),
  };
}

module.exports = { createMethods, SETTING_KEYS };
