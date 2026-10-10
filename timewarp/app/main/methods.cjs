"use strict";
// The engine API used by Timewarp's interface through window.tw.call().
const fs = require("node:fs");
const path = require("node:path");

const { createFiles } = require("./files.cjs");
const { importPasswords } = require("./vault-import.cjs");
const MAX_ATTACHMENT = 100 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const SETTING_KEYS = new Set(["appearance", "privacy", "preferences", "notifications", "memory"]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max = 20000) => typeof value === "string" ? value.slice(0, max) : "";
// Programs, scripts and shortcuts never open from Timewarp (a chat card or the
// Files view): an agent may have written them. Show in folder still works.
// Windows ignores trailing dots and spaces in a name, so they're ignored here too.
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|psd1|ps1xml|psc1|vbs|vbe|vb|js|jse|mjs|cjs|wsf|wsh|ws|wsc|sct|hta|chm|scf|msi|msp|msix|appx|appinstaller|scr|cpl|msc|lnk|url|pif|reg|inf|jar|jnlp|xll|py|pyw|sh|bash|zsh|command|terminal|app|pkg|dmg|scpt|applescript|workflow|desktop|dll|sys|gadget|application|appref-ms|settingcontent-ms|library-ms|search-ms|website|diagcab|xbap)$/i;
const runnable = file => RUNNABLE.test(path.basename(String(file)).replace(/[.\s]+$/, ""));
// "hyperframes-cli" → "Hyperframes Cli", as skills without a display name were shown before.
const skillTitle = name => String(name || "").split(":").pop().split(/[-_\s]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(" ") || String(name || "");
const IMAGE_TYPES = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
// A small local image (a plugin's icon) as a data address for the interface.
function imageData(file) {
  try {
    const type = file && IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type) return null;
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= 512 * 1024 ? `data:${type};base64,` + fs.readFileSync(file).toString("base64") : null;
  } catch { return null; }
}

// Runs in the page (isolated world): fills a sign-in form as the previous app
// did. The password goes only into a visible password field that isn't for a
// new password (a sign-up or change-password form); the username into the
// most username-like field before it in the same form, never a code, search
// or captcha field. Nothing is filled if the page has moved to another site
// since it was checked. Returns whether anything was filled.
function fillSignIn(username, password, origin) {
  if (location.origin !== origin) return false;
  const visible = element => !element.hidden && !element.disabled && !element.readOnly && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const auto = element => `${element.autocomplete || ""} ${element.getAttribute("autocomplete") || ""}`.toLowerCase();
  const hints = element => [element.name, element.id, element.placeholder, element.getAttribute("aria-label"), element.title].join(" ").toLowerCase();
  const set = (element, value) => {
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll("input")].filter(visible);
  const passwords = inputs.filter(element => element.type === "password");
  const secret = passwords.find(element => !auto(element).includes("new-password"));
  if (passwords.length && !secret) return false;
  const usable = element => ["", "text", "email", "tel", "number", "url"].includes(element.type)
    && !/one-time-code|new-password|otp|2fa|mfa|one[-_\s]?time|verification|captcha|security.?code|\bcode\b|search|query|filter/.test(auto(element) + " " + hints(element));
  const score = element => (/username|email/.test(auto(element)) ? 100 : 0) + (element.type === "email" ? 80 : 0) + (/email|user|login|account/.test(hints(element)) ? 60 : 0);
  const scope = secret?.form ? inputs.filter(element => element.form === secret.form) : inputs;
  // Before the password field; without one (a username-first page), only a field that looks like it's for the username.
  const candidates = (secret ? scope.slice(0, scope.indexOf(secret)) : scope).map((element, index) => ({ element, index, score: usable(element) ? score(element) : -1 }))
    .filter(item => item.score > (secret ? -1 : 0)).sort((a, b) => b.score - a.score || b.index - a.index);
  const user = candidates[0]?.element;
  if (user && username) set(user, username);
  if (secret) set(secret, password);
  return !!(secret || (user && username));
}

function createMethods({ app, dialog, shell, store, services, agents, harness, client, browser, version, profile, modelChoices, selectModel, registerTools, historyStatus, flushHistory, defaultAppearance, knowledge, onboarding, automations, mcp, codexHome, vault, clipboard, diagnostics, logs = null, openConnector = null, previousSessionUnclean = false, browserImport = null, browserTools = null, sandbox = null }) {
  const signedIn = () => { if (!services.auth.userId()) throw fail(401, "Sign in to Timewarp."); };
  // Each agent's workspace, so the skills kept there (Settings → Skills → Workspace) are listed, as before.
  const skillFolders = () => store.agents.list(services.auth.userId()).filter(agent => !agent.archivedAt && fs.existsSync(agent.workspace)).map(agent => agent.workspace);
  // Agent ownership is checked on every call by agents.get().
  const files = createFiles({ workspaceOf: agentId => { signedIn(); return agents.get(agentId).workspace; } });
  return {
    "app.info": async () => ({ version, platform: process.platform, codex: client.status, previousSessionUnclean, hardwareAcceleration: !fs.existsSync(path.join(profile, "software-rendering")) }),
    // Turns graphics hardware acceleration on or off; Timewarp restarts.
    "app.setHardwareAcceleration": ({ enabled }) => {
      const file = path.join(profile, "software-rendering");
      if (enabled) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, JSON.stringify({ reason: "settings", at: new Date().toISOString() }));
      setTimeout(() => { app.relaunch(); app.quit(); }, 100);
      return { restarting: true };
    },
    // A support file with versions, states and recent app log lines; no chats,
    // files, account details or secrets.
    "diagnostics.export": async () => {
      const target = await dialog.showSaveDialog({ title: "Save diagnostics", defaultPath: `timewarp-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (target.canceled || !target.filePath) return { saved: false };
      fs.writeFileSync(target.filePath, JSON.stringify(await diagnostics(), null, 2));
      return { saved: true, path: target.filePath };
    },
    "onboarding.restart": () => onboarding.restart(),
    // The app log folder (runtime/logs), for support.
    "app.openLogs": async () => {
      if (!logs) throw fail(404, "Logs are unavailable.");
      fs.mkdirSync(logs.directory, { recursive: true });
      const error = await shell.openPath(logs.directory);
      if (error) throw fail(500, error);
      return { opened: true };
    },
    "vault.importPasswords": async () => {
      signedIn();
      const chosen = await dialog.showOpenDialog({ title: "Import passwords", properties: ["openFile"], filters: [{ name: "Passwords export (CSV)", extensions: ["csv"] }] });
      if (chosen.canceled || !chosen.filePaths[0]) return { cancelled: true };
      if (fs.statSync(chosen.filePaths[0]).size > 5 * 1024 * 1024) throw fail(413, "That file is too large to import.");
      return importPasswords({ vault, text: fs.readFileSync(chosen.filePaths[0], "utf8") });
    },
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

    // The picker reads this each time it opens. A catalog that can't be read
    // keeps the saved choice and reports the error, so the picker offers Retry.
    "models.list": async () => {
      signedIn();
      let choices;
      try { choices = await modelChoices(); }
      catch (error) { return { choices: [], selected: store.settings.get("modelSettings") || null, error: error.message || "Models unavailable." }; }
      return { choices, selected: await selectModel(choices) };
    },
    // { name, reasoningEffort, serviceTier }: an effort or speed the model
    // doesn't offer becomes its default.
    "models.select": async ({ name, reasoningEffort, serviceTier }) => {
      signedIn();
      const choices = await modelChoices();
      store.settings.set("modelSettings", require("./model-catalog.cjs").chooseModel(choices, { name, reasoningEffort, serviceTier }));
      return selectModel(choices);
    },
    // Paid plans also report their monthly included credits, which the sidebar
    // meters as the previous app did (null when the billing service can't say).
    "funding.get": async () => {
      signedIn();
      const state = await services.funding.current();
      if (state.subscriptionAllowed) return state;
      const status = await require("../../desktop/account-compat.cjs").billingStatus(services.cloud).catch(() => null);
      const allowance = Number(status?.includedCredits?.allowance), left = Number(status?.includedCredits?.balance);
      const planUsage = status?.plan === state.plan && allowance > 0 && Number.isFinite(left)
        ? { name: status.plans?.find(item => item.id === state.plan)?.name || state.plan.replace(/^./, c => c.toUpperCase()), allowance, left, resetsAt: typeof status.currentPeriodEnd === "string" ? status.currentPeriodEnd : null }
        : null;
      return { ...state, planUsage };
    },

    "agents.list": () => { signedIn(); return agents.list(); },
    "agents.create": input => { signedIn(); return agents.create({ name: input.name, instructions: text(input.instructions), avatar: input.avatar }); },
    "agents.update": ({ id, ...patch }) => { signedIn(); return agents.update(id, patch); },
    "agents.instructions": ({ id }) => { signedIn(); return { instructions: agents.instructions(id) }; },
    "agents.workspaceInstructions": ({ id }) => { signedIn(); return { instructions: agents.workspaceInstructions(id) }; },
    // The agent page's Instructions editor: AGENTS.md below its title line.
    "agents.saveWorkspaceInstructions": ({ id, instructions }) => {
      signedIn();
      const agent = agents.get(id);
      if (typeof instructions !== "string" || instructions.length > 50000) throw fail(400, "Instructions must be text under 50,000 characters.");
      fs.mkdirSync(agent.workspace, { recursive: true });
      fs.writeFileSync(path.join(agent.workspace, "AGENTS.md"), `# ${agent.name}\n\n${instructions.replace(/\r\n/g, "\n").trim()}\n`);
      return { instructions: agents.workspaceInstructions(id) };
    },
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
    "conversations.markUnread": ({ id }) => { signedIn(); return harness.conversations.markUnread(id); },
    "conversations.history": ({ id }) => { signedIn(); return harness.history(id); },
    "conversations.status": ({ id }) => { signedIn(); return harness.conversations.status(id); },
    // Chats with a reply in progress, for the sidebar's "Agent is working".
    "conversations.running": () => { signedIn(); return harness.conversations.list({}).filter(item => harness.conversations.status(item.id).running).map(item => item.id); },
    // Ctrl/⌘+K search: { conversations: [{ conversation, snippet, highlight }], messages: [{ conversation, messageId, createdAt, snippet, highlight }] }.
    "conversations.search": ({ query }) => { signedIn(); return store.conversations.search(services.auth.userId(), text(query, 200)); },
    "conversations.usage": ({ id }) => { signedIn(); return harness.conversations.usage(id); },
    "conversations.worker": ({ id, threadId }) => { signedIn(); return harness.conversations.worker(id, threadId); },
    "conversations.send": ({ id, text: message, images = [], files = [], skills = [], clientId, retryOf }) => {
      signedIn();
      const existing = list => (Array.isArray(list) ? list : []).filter(file => typeof file === "string" && path.isAbsolute(file) && fs.existsSync(file) && fs.statSync(file).isFile()).slice(0, 10);
      const attached = existing(files);
      if (attached.some(file => fs.statSync(file).size > MAX_ATTACHMENT)) throw fail(413, "Attach files smaller than 100 MB.");
      // Skills chosen with @ or $ in the composer: { name, path } of an installed SKILL.md.
      const chosen = (Array.isArray(skills) ? skills : []).filter(skill => typeof skill?.name === "string" && skill.name.trim() && typeof skill.path === "string" && path.isAbsolute(skill.path) && /^SKILL\.md$/i.test(path.basename(skill.path)) && fs.existsSync(skill.path))
        .slice(0, 10).map(skill => ({ name: text(skill.name, 200), path: skill.path }));
      // Sent while the agent works, the message joins its turn (steer).
      return harness.send(id, { text: text(message, 200000), images: existing(images).filter(file => IMAGE.test(file)), files: attached, ...(chosen.length ? { skills: chosen } : {}), clientId: typeof clientId === "string" ? clientId : undefined, retryOf: typeof retryOf === "string" ? retryOf : undefined }, { steer: true });
    },
    "conversations.warm": ({ id }) => { signedIn(); return harness.warm(id); },
    "conversations.setModel": async ({ id, name, reasoningEffort, serviceTier }) => {
      signedIn();
      return harness.setModel(id, require("./model-catalog.cjs").chooseModel(await modelChoices(), { name, reasoningEffort, serviceTier }));
    },
    "conversations.interrupt": ({ id }) => { signedIn(); return harness.interrupt(id); },
    "approvals.respond": ({ id, response }) => { signedIn(); return harness.respond(id, response); },
    "approvals.pending": () => { signedIn(); return harness.pendingApprovals(); },

    "attachments.choose": async () => {
      signedIn();
      const result = await dialog.showOpenDialog({ title: "Attach files", properties: ["openFile", "multiSelections"] });
      return result.canceled ? [] : result.filePaths.map(file => ({ path: file, image: IMAGE.test(file), size: fs.statSync(file).size }));
    },
    // Files dropped or pasted into a chat, described as attachments.choose
    // describes them. Folders and missing files are left out.
    "attachments.describe": ({ paths } = {}) => {
      signedIn();
      return (Array.isArray(paths) ? paths : []).slice(0, 100).filter(file => typeof file === "string" && path.isAbsolute(file)).flatMap(file => {
        try { const stat = fs.statSync(file); return stat.isFile() ? [{ path: file, image: IMAGE.test(file), size: stat.size }] : []; } catch { return []; }
      });
    },
    // An image the user sent from elsewhere on this computer, for its
    // thumbnail in the chat (images in the workspace use files.read).
    "attachments.preview": ({ conversationId, path: file } = {}) => {
      signedIn();
      harness.conversations.get(conversationId);
      if (typeof file !== "string" || !path.isAbsolute(file) || /^[\\/]{2}/.test(file) || !IMAGE.test(file)) throw fail(400, "Choose an image.");
      let stat;
      try { stat = fs.statSync(file); } catch { throw fail(404, "That image no longer exists."); }
      if (!stat.isFile()) throw fail(404, "That image no longer exists.");
      if (stat.size > 12 * 1024 * 1024) throw fail(413, "This image is too large to preview.");
      const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[path.extname(file).toLowerCase()];
      return { dataUrl: `data:${type};base64,${fs.readFileSync(file).toString("base64")}` };
    },
    // A pasted file that isn't on disk (a copied image) is saved in the
    // profile, so it attaches like any other file.
    "attachments.savePasted": ({ data, type, name } = {}) => {
      signedIn();
      const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
      if (!bytes?.length) throw fail(400, "Nothing was pasted.");
      if (bytes.length > MAX_ATTACHMENT) throw fail(413, "Attach files smaller than 100 MB.");
      const raw = text(name, 200), given = path.extname(raw).toLowerCase();
      const extension = /^\.[a-z0-9]{1,15}$/.test(given) ? given : { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[text(type, 100).toLowerCase()] || "";
      const stem = path.basename(raw, path.extname(raw)).replace(/[^\w.-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 80) || "pasted";
      const folder = path.join(profile, "attachments", new Date().toISOString().slice(0, 10), require("node:crypto").randomUUID());
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      const file = path.join(folder, stem + extension);
      fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
      return { path: file, image: IMAGE.test(file), size: bytes.length };
    },

    "integrations.list": input => { signedIn(); return services.integrations.list(input); },
    "integrations.beginConnect": async input => {
      signedIn();
      await services.ensureCallback();
      const result = await services.integrations.beginConnect(input);
      if (result?.connectUrl) await (openConnector ? openConnector(result.connectUrl) : services.openExternal(result.connectUrl));
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
    "browser.setMuted": ({ conversationId, tabId, muted }) => { signedIn(); harness.conversations.get(conversationId); return browser.setMuted(conversationId, tabId, !!muted); },
    "browser.newTab": ({ conversationId, url }) => { signedIn(); harness.conversations.get(conversationId); return browser.openTab(conversationId, { url: url || null }); },
    "browser.navigate": ({ conversationId, tabId, url }) => { signedIn(); harness.conversations.get(conversationId); return browser.navigate(conversationId, { tabId, url }); },
    "browser.activate": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.activate(conversationId, tabId); },
    "browser.close": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.close(conversationId, tabId); },
    "browser.back": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.back(conversationId, tabId); },
    "browser.forward": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.forward(conversationId, tabId); },
    "browser.home": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.home(conversationId, tabId); },
    // Pinned tabs come first and keep their pages open (tab menu: Pin tab / Unpin tab).
    "browser.pin": ({ conversationId, tabId, pinned }) => { signedIn(); harness.conversations.get(conversationId); return browser.pin(conversationId, tabId, !!pinned); },
    "browser.reload": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.reload(conversationId, tabId); },
    "browser.stop": ({ conversationId, tabId }) => { signedIn(); harness.conversations.get(conversationId); return browser.stop(conversationId, tabId); },
    "browser.profiles": () => { signedIn(); store.browserProfiles.ensureDefault(); return store.browserProfiles.list(); },
    // Separate sets of sign-ins for the built-in browser.
    "browser.createProfile": ({ label }) => {
      signedIn();
      const name = text(label, 60).trim();
      if (!name) throw fail(400, "Give the profile a name.");
      if (store.browserProfiles.list().length >= 20) throw fail(409, "You can have up to 20 browser profiles.");
      return store.browserProfiles.create({ label: name });
    },
    "browser.renameProfile": ({ id, label }) => {
      signedIn();
      const name = text(label, 60).trim();
      if (!name) throw fail(400, "Give the profile a name.");
      if (!store.browserProfiles.list().some(profile => profile.id === id)) throw fail(404, "This browser profile is unavailable.");
      return store.browserProfiles.rename(id, name);
    },
    "browser.removeProfile": async ({ id }) => {
      signedIn();
      const profile = store.browserProfiles.list().find(item => item.id === id);
      if (!profile) throw fail(404, "This browser profile is unavailable.");
      if (profile.isDefault) throw fail(400, "The default profile can't be removed.");
      await browser.removeProfile(id);
      store.browserProfiles.remove(id);
      return store.browserProfiles.list();
    },
    // Profiles found in Chrome, Edge and other browsers on this computer.
    "browser.importable": () => { signedIn(); store.browserProfiles.ensureDefault(); return browserImport ? browserImport.importable() : []; },
    "browser.importProfile": async ({ browserId, profilePath }) => {
      signedIn();
      if (!browserImport) throw fail(404, "Browser profiles can't be imported here.");
      if (store.browserProfiles.list().length >= 20) throw fail(409, "You can have up to 20 browser profiles.");
      const result = await browserImport.importProfiles({ selections: [{ browserId: text(browserId, 40), profilePath: text(profilePath, 120) }] });
      return result.profiles[0];
    },
    "browser.setProfile": ({ conversationId, profileId }) => { signedIn(); harness.conversations.get(conversationId); return browser.setProfile(conversationId, profileId); },
    "browser.takeControl": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.setUserControl(conversationId, true); },
    "browser.handBack": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.setUserControl(conversationId, false); },
    "browser.recent": ({ conversationId }) => { signedIn(); harness.conversations.get(conversationId); return browser.recent(conversationId); },

    // Files view: read-only access inside the agent's workspace.
    "files.list": ({ agentId, path: dir }) => files.list(agentId, dir),
    "files.read": ({ agentId, path: file }) => files.read(agentId, file),
    "files.search": ({ agentId, query }) => files.search(agentId, query),
    "files.open": async ({ agentId, path: file }) => {
      const target = files.absolute(agentId, file);
      if (runnable(target)) throw fail(400, "Programs and scripts don't open from Timewarp. Use Show in folder.");
      const error = await shell.openPath(target);
      if (error) throw fail(500, error);
      return { opened: true };
    },
    "files.reveal": ({ agentId, path: file }) => { shell.showItemInFolder(files.absolute(agentId, file)); return { shown: true }; },

    // Codex's command sandbox (sandbox.cjs): setup in onboarding, as before,
    // and again from there after it was turned off on this PC.
    "sandbox.status": () => sandbox.status(),
    "sandbox.setup": () => { signedIn(); return sandbox.ensure({ setup: true, retry: true }); },

    // Memory, knowledge imported from other assistants, and skills.
    "memory.get": () => { signedIn(); return knowledge.read(); },
    "memory.save": ({ notes }) => { signedIn(); return knowledge.saveNotes(notes); },
    "memory.removeImport": ({ path: file }) => { signedIn(); return knowledge.removeImport(file); },
    "memory.openFolder": async () => { signedIn(); fs.mkdirSync(knowledge.memoriesRoot, { recursive: true }); const error = await shell.openPath(knowledge.memoriesRoot); if (error) throw fail(500, error); return { opened: true }; },
    "knowledge.detect": () => { signedIn(); return knowledge.detect(); },
    // Memory files and skills are copied; MCP servers are added to the
    // agents' Codex settings.
    "knowledge.import": async ({ items }) => {
      signedIn();
      const list = Array.isArray(items) ? items : [];
      const servers = list.filter(item => typeof item?.id === "string" && item.id.endsWith(":mcp"));
      const files = list.filter(item => !servers.includes(item));
      if (!files.length && !servers.length) throw fail(400, "Select at least one memory, skill or server.");
      const configs = servers.flatMap(item => (Array.isArray(item.names) ? item.names : []).map(name => ({ name, config: knowledge.mcpServer(item.id.slice(0, -4), name) })));
      const result = files.length ? knowledge.importItems(files) : { imported: { memoryFiles: 0, skills: 0 } };
      if (result.imported.skills) await client.request("skills/list", { forceReload: true }).catch(() => {});
      const added = configs.length ? await mcp.importServers(configs) : { imported: [], skipped: [] };
      return { imported: { ...result.imported, mcpServers: added.imported.length }, skipped: added.skipped };
    },
    // A folder with Cursor rules, such as a project, when none were found.
    "knowledge.chooseCursorFolder": async () => {
      signedIn();
      const chosen = await dialog.showOpenDialog({ title: "Choose a Cursor folder", properties: ["openDirectory"] });
      if (chosen.canceled || !chosen.filePaths[0]) return { cancelled: true };
      store.settings.set("cursorRoot", chosen.filePaths[0]);
      return knowledge.detect();
    },
    "skills.list": async ({ reload = false } = {}) => {
      signedIn();
      const result = await client.request("skills/list", { forceReload: !!reload, cwds: skillFolders() });
      const seen = new Set(), skills = [], errors = [];
      for (const entry of result.data || []) {
        errors.push(...(entry.errors || []).map(error => error.message));
        for (const skill of entry.skills || []) {
          if (seen.has(skill.path)) continue;
          seen.add(skill.path);
          // In Timewarp's own skills folder (which a Windows package can report under another path).
          const folder = path.basename(path.dirname(skill.path));
          const local = !/[\\/]\.system[\\/]/.test(skill.path) && (path.resolve(skill.path).startsWith(path.resolve(knowledge.skillsRoot) + path.sep)
            || (path.basename(path.dirname(path.dirname(skill.path))) === "skills" && folder === skill.name && fs.existsSync(path.join(knowledge.skillsRoot, folder, "SKILL.md"))));
          skills.push({ name: skill.name, title: skill.interface?.displayName || skillTitle(skill.name), fromApp: /[\\/]plugins[\\/]cache[\\/]/.test(skill.path), description: skill.description || skill.interface?.shortDescription || skill.shortDescription || "", details: skill.description || "", scope: skill.scope, enabled: skill.enabled !== false, path: skill.path, removable: local });
        }
      }
      // One entry per skill name and scope: a copy in Timewarp's own folder wins over the same
      // skill in a folder Codex also reads (such as ~/.agents/skills).
      const unique = new Map();
      for (const skill of skills) {
        const key = skill.scope + ":" + skill.name, kept = unique.get(key);
        if (!kept || (skill.removable && !kept.removable)) unique.set(key, skill);
      }
      // Ordered by folder, as the previous app listed them ("hyperframes-audio" before "hyperframes").
      const sortKey = skill => { const file = skill.path.replace(/\\/g, "/"); const cut = skill.fromApp ? file.search(/\/plugins\/cache\//) : file.lastIndexOf("/skills/"); return cut >= 0 ? file.slice(cut) : file; };
      const list = [...unique.values()].sort((a, b) => (a.scope === "system") - (b.scope === "system") || (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
      return { skills: list, errors: [...new Set(errors)] };
    },
    "skills.setEnabled": async ({ path: file, enabled }) => { signedIn(); await client.request("skills/config/write", { path: text(file, 4000), enabled: !!enabled }); return { enabled: !!enabled }; },
    "skills.create": async input => { signedIn(); const result = knowledge.createSkill({ name: text(input?.name, 200), description: text(input?.description, 1000), instructions: text(input?.instructions, 100000) }); await client.request("skills/list", { forceReload: true }).catch(() => {}); return result; },
    "skills.remove": async ({ name }) => { signedIn(); const result = knowledge.removeSkill(name); await client.request("skills/list", { forceReload: true }).catch(() => {}); return result; },
    "skills.read": async ({ path: file }) => {
      signedIn();
      const listed = await client.request("skills/list", { cwds: skillFolders() });
      const known = (listed.data || []).flatMap(entry => entry.skills || []).some(skill => skill.path === file);
      if (!known || path.basename(String(file)) !== "SKILL.md") throw fail(404, "That skill isn't available.");
      return { text: fs.readFileSync(file, "utf8").slice(0, 200000) };
    },
    "skills.openFolder": async () => { signedIn(); fs.mkdirSync(knowledge.skillsRoot, { recursive: true }); const error = await shell.openPath(knowledge.skillsRoot); if (error) throw fail(500, error); return { opened: true }; },
    // MCP servers the user adds, and instructions every agent follows.
    "mcp.list": input => { signedIn(); return mcp.list({ builtIn: input?.builtIn === true, status: input?.status !== false }); },
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
      const url = contents.getURL(), item = vault.secret(id);
      if (item.kind !== "password" || !vault.signInsFor(url).some(entry => entry.id === id)) throw fail(403, "This sign-in isn't saved for this site.");
      // Hidden from the chat's browser tools, as a password an agent fills is,
      // so an agent can't read it back from the page.
      browserTools?.rememberFilled(conversationId, item.password, "password");
      const filled = await contents.executeJavaScriptInIsolatedWorld(1007, [{ code: `(${fillSignIn})(${JSON.stringify(item.username || "")}, ${JSON.stringify(item.password)}, ${JSON.stringify(new URL(url).origin)})` }], true);
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
    // { installed, configured } for the home screen's "Set up 1Password".
    "setup.onePassword": () => { signedIn(); return require("./one-password.cjs").onePasswordSetup(); },

    // A report carries the app's version and platform, and the chat it was sent from.
    "feedback.submit": input => {
      let conversationId = null;
      try { if (typeof input?.conversationId === "string") conversationId = harness.conversations.get(input.conversationId).id; } catch {}
      return services.submitFeedback({ description: input?.description, route: text(input?.route, 2000) || null, conversationId, environment: { app: "desktop", appVersion: version, platform: process.platform } });
    },
    "links.open": ({ url }) => services.openExternal(url),
    "app.quit": () => { app.quit(); return { quitting: true }; },
    "profile.path": () => ({ profile }),

    // Chat cards: files and images an agent shows in a chat, and what the
    // user did with its cards. Paths are resolved against the chat agent's
    // workspace; only files inside it are read or opened from a chat.
    ...(() => {
      const NETWORK_PATH = /^[\\/]{2}/;
      const within = (root, target) => {
        const [base, value] = process.platform === "win32" ? [root.toLowerCase(), target.toLowerCase()] : [root, target];
        return value === base || value.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
      };
      function cardFile(conversationId, file) {
        signedIn();
        const agent = agents.get(harness.conversations.get(conversationId).agentId);
        const raw = text(file, 4000).trim();
        if (!raw || raw.includes("\0")) throw fail(400, "Choose a file.");
        fs.mkdirSync(agent.workspace, { recursive: true });
        const root = fs.realpathSync(agent.workspace);
        let target = path.resolve(root, raw);
        // Network and device paths (\\server\share, \\?\…) outside the
        // workspace are refused before any lookup: reaching one would send the
        // user's Windows sign-in to whatever computer an agent's message names.
        if (NETWORK_PATH.test(target) && !within(root, target)) throw fail(400, "Files on other computers don't open from a chat.");
        try { target = fs.realpathSync(target); } catch {}
        const inside = within(root, target);
        return { agent, root, target, inside, relative: inside ? path.relative(root, target).split(path.sep).join("/") : null };
      }
      const stateKey = conversationId => { signedIn(); harness.conversations.get(conversationId); return "chatCards:" + conversationId; };
      return {
        // Whether a file exists, and its workspace path for files.read.
        "cards.resolve": ({ conversationId, path: file }) => {
          const { agent, target, inside, relative } = cardFile(conversationId, file);
          let stat = null;
          try { stat = fs.statSync(target); } catch {}
          return { agentId: agent.id, inside, relative, exists: !!stat, isFile: !!stat?.isFile(), name: path.basename(target), size: stat?.isFile() ? stat.size : null, modifiedAt: stat ? stat.mtime.toISOString() : null };
        },
        "cards.openFile": async ({ conversationId, path: file }) => {
          const { target, inside } = cardFile(conversationId, file);
          if (!inside) throw fail(403, "Only files in the agent's workspace open from a chat. Use Show in folder.");
          if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw fail(404, "That file no longer exists.");
          if (runnable(target)) throw fail(400, "Programs and scripts don't open from a chat. Use Show in folder.");
          const error = await shell.openPath(target);
          if (error) throw fail(500, error);
          return { opened: true };
        },
        // Shows the file in its folder, also outside the workspace; nothing is opened.
        "cards.revealFile": ({ conversationId, path: file }) => {
          const { target } = cardFile(conversationId, file);
          if (!fs.existsSync(target)) throw fail(404, "That file no longer exists.");
          shell.showItemInFolder(target);
          return { shown: true };
        },
        // Answers, sent drafts and connections, kept on this device per chat.
        "cards.state": ({ conversationId }) => store.settings.get(stateKey(conversationId), {}) || {},
        "cards.saveState": ({ conversationId, key, value }) => {
          const name = stateKey(conversationId);
          if (typeof key !== "string" || !/^[\w.:/-]{1,200}$/.test(key)) throw fail(400, "Unknown card.");
          const json = JSON.stringify(value ?? null);
          if (json.length > 20000) throw fail(413, "This card's answer is too long.");
          const states = { ...(store.settings.get(name, {}) || {}) };
          delete states[key];
          states[key] = JSON.parse(json);
          // Past 500 the oldest go, but never a sent draft or button: it could be sent again.
          const extra = Object.keys(states).length - 500;
          if (extra > 0) for (const old of Object.keys(states).filter(other => other !== key && !states[other]?.sent).slice(0, extra)) delete states[old];
          store.settings.set(name, states);
          return states[key];
        },
      };
    })(),
  };
}

module.exports = { createMethods, SETTING_KEYS, fillSignIn };
