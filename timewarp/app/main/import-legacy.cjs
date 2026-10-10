"use strict";
// One-time import of a profile created by Timewarp 1.x. The previous local
// database is opened read-only and left unchanged. Agent workspaces (including
// their AGENTS.md instructions), memory files and the Codex home stay in place.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { memoryMode } = require("./knowledge.cjs");

const MARKER = "legacyImport";
const SETTINGS = ["appearance", "memory", "onboarding", "privacy", "suggestions", "modelSettings"];
// The previous app's memory modes "read-only" and "write-only" are "read" and "write" here.
const memorySetting = value => ({ ...(value && typeof value === "object" ? value : {}), mode: memoryMode(value?.mode) });

// A file reference naming a file still on this computer: a plain path, or a
// reference whose path part is one (as files on a device were named). Network
// paths are never looked up.
function localFile(reference) {
  const candidates = [reference];
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/]*\/([^?#]*)/i.exec(reference);
  if (match) { try { const decoded = decodeURIComponent(match[1]); candidates.push(decoded, "/" + decoded); } catch {} }
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || /^[\\/]{2}/.test(candidate)) continue;
    try { if (fs.statSync(candidate).isFile()) return path.resolve(candidate); } catch {}
  }
  return null;
}
// A message's text, and the images and files it carried as the chat view
// shows them (store.cjs messages): a file still on this computer by its path,
// one that isn't (an upload to the previous app's cloud, a file since moved)
// by its name, so the chat still says what was attached.
function partsOf(parts) {
  let value;
  try { value = JSON.parse(parts || "[]"); } catch { value = []; }
  if (!Array.isArray(value)) value = [];
  const text = value.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("\n\n");
  const images = [], files = [];
  for (const part of value) {
    if ((part?.type !== "file" && part?.type !== "image") || typeof part.url !== "string" || !part.url) continue;
    const local = localFile(part.url);
    const last = /^data:/i.test(part.url) ? "" : part.url.split(/[?#]/)[0].split(/[\\/]/).pop() || "";
    let name = part.name || (local ? path.basename(local) : last);
    if (!part.name && !local) try { name = decodeURIComponent(last); } catch {}
    name = String(name || "Attachment").slice(0, 255);
    (part.type === "image" || /^image\//i.test(String(part.mimeType || "")) ? images : files).push(local || name);
  }
  return { text, images: images.slice(0, 20), files: files.slice(0, 20) };
}
const textOf = parts => partsOf(parts).text;

function importLegacyProfile({ store, runtimeDir, log = () => {} }) {
  if (store.settings.get(MARKER)) return { skipped: true };
  const file = path.join(runtimeDir, "entities.sqlite");
  const result = { agents: 0, conversations: 0, messages: 0, settings: 0 };
  if (fs.existsSync(file)) {
    const { DatabaseSync } = require("node:sqlite");
    const legacy = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = new Set(legacy.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name));
      if (tables.has("agents")) store.transaction(() => {
        for (const row of legacy.prepare("select * from agents").all()) {
          if (store.agents.get(row.id)) continue;
          store.agents.create({
            id: row.id, ownerId: row.ownerUserId, name: row.displayName, workspace: row.repositoryPath,
            avatarType: row.avatarType, avatarUrl: row.avatarUrl, starredAt: row.starredAt, sortKey: row.sidebarSortKey,
            createdAt: row.createdAt, updatedAt: row.updatedAt, archivedAt: row.deletedAt,
          });
          result.agents++;
        }
      });
      if (tables.has("conversations") && tables.has("conversation_members")) store.transaction(() => {
        const members = legacy.prepare("select * from conversation_members where conversationId = ?");
        for (const row of legacy.prepare("select * from conversations").all()) {
          if (store.conversations.get(row.id)) continue;
          const rows = members.all(row.id), owner = rows.find(member => member.entityId === row.createdByEntityId);
          const agent = rows.find(member => member.entityId !== row.createdByEntityId && store.agents.get(member.entityId));
          if (!owner || !agent) continue;
          let modelSettings = null;
          try { modelSettings = JSON.parse(row.modelSettings || "null"); } catch {}
          store.conversations.create({
            id: row.id, ownerId: row.createdByEntityId, agentId: agent.entityId, title: row.title,
            codexThreadId: agent.codexThreadId || owner.codexThreadId || null, modelSettings,
            archivedAt: owner.archivedAt, read: owner.read !== 0, browserProfileId: agent.browserProfileId || owner.browserProfileId,
            createdAt: row.createdAt, updatedAt: row.updatedAt, lastActivityAt: row.lastActivityAt || row.updatedAt,
          });
          result.conversations++;
        }
      });
      if (tables.has("conversation_entries")) store.transaction(() => {
        for (const row of legacy.prepare("select * from conversation_entries where kind = 'message' order by conversationId, sequence").all()) {
          if (!store.conversations.get(row.conversationId)) continue;
          const { text, images, files } = partsOf(row.parts);
          if (!text && !images.length && !files.length) continue;
          store.messages.append({ id: row.id, conversationId: row.conversationId, authorId: row.authorId, createdAt: row.createdAt, text, images, files, turnId: row.codexTurnId, status: row.deliveryStatus === "failed" ? "failed" : "sent" });
          result.messages++;
        }
      });
      // Automations keep their schedules (date and RRULE triggers) and whether
      // they were on. Ones whose triggers have no exact match here, such as
      // Slack events, come over paused with the closest schedule (or daily at
      // 09:00) for their owners to check. The next run is the next one due
      // from now; runs missed before the import don't happen.
      if (tables.has("automations")) store.transaction(() => {
        const { legacySchedule, nextRun } = require("./automations.cjs");
        const now = new Date();
        for (const row of legacy.prepare("select * from automations where deletedAt is null").all()) {
          const conversation = store.conversations.get(row.conversationId);
          if (store.automations.get(row.id) || !conversation || !store.agents.get(row.agentId)) continue;
          const { schedule, exact } = legacySchedule(row.triggers);
          const next = nextRun(schedule, now);
          const enabled = Number(row.enabled) === 1 && exact && !!next;
          store.automations.create({
            id: row.id, ownerId: conversation.ownerId, agentId: row.agentId, conversationId: row.conversationId,
            name: String(row.name || "Automation").slice(0, 80), instructions: row.instructions, schedule,
            enabled, nextRunAt: enabled ? next.toISOString() : null, createdAt: row.createdAt,
          });
          result.automations = (result.automations || 0) + 1;
        }
      });
    } finally { legacy.close(); }
  }
  const settingsFile = path.join(runtimeDir, "settings.json");
  if (fs.existsSync(settingsFile)) {
    try {
      const value = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      for (const key of SETTINGS) if (value[key] !== undefined && store.settings.get(key) === null) { store.settings.set(key, key === "memory" ? memorySetting(value.memory) : value[key]); result.settings++; }
    } catch (error) { log("Previous settings could not be read.", error.message); }
  }
  store.settings.set(MARKER, { at: new Date().toISOString(), ...result });
  return result;
}

// The previous app's browser profiles, once. Each keeps its storage (its
// "browser-profile:v1:<sha256 of id>" partition), so sites stay signed in; the
// previous default becomes the default unless this profile already has one.
// The previous app marked its default only implicitly: it is the oldest
// profile that wasn't imported from another browser.
// Chats pointing at a profile that no longer exists use the default again.
const BROWSER_MARKER = "legacyBrowserProfiles";
const BROWSERS = ["chrome", "edge", "brave", "vivaldi"];
function importLegacyBrowserProfiles({ store, runtimeDir }) {
  if (store.settings.get(BROWSER_MARKER)) return { skipped: true };
  const file = path.join(runtimeDir, "entities.sqlite");
  const result = { profiles: 0 };
  if (fs.existsSync(file)) {
    const { DatabaseSync } = require("node:sqlite");
    const legacy = new DatabaseSync(file, { readOnly: true });
    try {
      const table = legacy.prepare("select name from sqlite_master where type = 'table' and name = 'browser_profiles'").get();
      if (table) store.transaction(() => {
        const rows = legacy.prepare("select * from browser_profiles where deletedAt is null order by \"default\" desc, createdAt").all();
        const sourceOf = row => { try { return JSON.parse(row.source || "{}") || {}; } catch { return {}; } };
        const fallback = rows.find(row => row.default === 1) || rows.find(row => !BROWSERS.includes(sourceOf(row).type));
        for (const row of rows) {
          // Profiles already here, including ones removed since, stay as they are.
          if (typeof row.id !== "string" || !row.id || store.db.prepare("select 1 from browser_profiles where id = ?").get(row.id)) continue;
          const existing = store.browserProfiles.list();
          const source = sourceOf(row);
          const type = BROWSERS.includes(source.type) ? source.type : "timewarp";
          const wantsDefault = row === fallback;
          let label = String(row.label || row.name || "Timewarp").slice(0, 80);
          if (existing.some(item => item.label === label)) label = `${label} (previous app)`;
          store.browserProfiles.create({
            id: row.id, label, isDefault: wantsDefault && !existing.some(item => item.isDefault),
            source: { ...source, type, partition: "browser-profile:v1:" + crypto.createHash("sha256").update(row.id).digest("hex") },
          });
          result.profiles++;
        }
      });
    } finally { legacy.close(); }
  }
  const profiles = new Set(store.browserProfiles.list().map(item => item.id));
  store.db.prepare("select id, browser_profile_id from conversations where browser_profile_id is not null").all()
    .filter(row => !profiles.has(row.browser_profile_id))
    .forEach(row => store.conversations.update(row.id, { browserProfileId: null }, { touch: false }));
  store.settings.set(BROWSER_MARKER, { at: new Date().toISOString(), ...result });
  return result;
}

// The previous app's open browser tabs, once per profile: each chat's tabs
// (addresses, titles and the one showing; no page content) become the tabs
// the browser restores for it (browser.cjs, "browserTabs"). Chats that
// already have tabs here keep theirs.
const TABS_MARKER = "legacyBrowserTabs", TABS_KEY = "browserTabs", SAVED_TABS = 12;
const webAddress = value => { try { const url = new URL(String(value)); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
// A previous tab's back and forward pages (web addresses only, ten each way),
// when its history is consistent with the page it showed.
function legacyHistory(tab, url) {
  const entries = Array.isArray(tab.history?.entries) ? tab.history.entries : [];
  const index = Math.trunc(Number(tab.history?.index)) || 0;
  if (!entries.length || index < 0 || index >= entries.length || webAddress(entries[index]?.url) !== url) return {};
  const kept = entries.slice(Math.max(0, index - 10), index + 11).map(entry => ({ url: webAddress(entry?.url), title: String(entry?.title || "").slice(0, 300) }));
  if (kept.length < 2 || kept.some(entry => !entry.url)) return {};
  return { history: { index: index - Math.max(0, index - 10), entries: kept } };
}

function importLegacyBrowserTabs({ store, runtimeDir }) {
  if (store.settings.get(TABS_MARKER)) return { skipped: true };
  const result = { chats: 0, tabs: 0 };
  let saved = null, savedAt = Date.now();
  const file = path.join(runtimeDir, "browser-tabs.json");
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); savedAt = Math.floor(fs.statSync(file).mtimeMs); } catch {}
  const owners = saved?.owners && typeof saved.owners === "object" ? saved.owners : {};
  const current = { ...(store.settings.get(TABS_KEY, {}) || {}) };
  const fallback = store.browserProfiles.list().find(profile => profile.isDefault)?.id;
  for (const [conversationId, profiles] of Object.entries(owners)) {
    const conversation = store.conversations.get(conversationId);
    if (!conversation || current[conversationId] || !profiles || typeof profiles !== "object") continue;
    // The tabs the chat had in its own browser profile, else in the first one listed.
    const groups = Object.values(profiles).filter(group => Array.isArray(group?.tabs) && group.tabs.some(tab => tab && typeof tab === "object"));
    const group = groups.find(item => item.profileId === (conversation.browserProfileId || fallback)) || groups[0];
    if (!group) continue;
    const tabs = group.tabs.filter(tab => tab && typeof tab === "object");
    const showing = Math.min(Math.max(0, Math.trunc(Number(group.visibleTabIndex)) || 0), tabs.length - 1);
    // Up to as many as the browser restores, keeping the one that was showing.
    const start = Math.max(0, Math.min(tabs.length - SAVED_TABS, showing));
    current[conversationId] = {
      savedAt, tabs: tabs.slice(start, start + SAVED_TABS).map((tab, index) => {
        const url = webAddress(tab.url);
        return {
          kind: url ? "web" : "home", url, title: url ? String(tab.title || "").slice(0, 300) : "", profileId: typeof group.profileId === "string" ? group.profileId : null, active: start + index === showing,
          ...(tab.pinned === true ? { pinned: true } : {}), ...(url ? legacyHistory(tab, url) : {}),
        };
      }),
    };
    result.chats++;
    result.tabs += current[conversationId].tabs.length;
  }
  if (result.chats) store.settings.set(TABS_KEY, current);
  store.settings.set(TABS_MARKER, { at: new Date().toISOString(), ...result });
  return result;
}

// What the first import of chats left out, once per profile: files attached
// to messages, and what the user did with chat cards (choices made, drafts
// and buttons sent, secure inputs saved, connections made). Card answers are
// kept under the keys the chat view gives its cards (cards.mjs, widgets.jsx).
const EXTRAS_MARKER = "legacyChatExtras";
// The previous app's longer card names.
const CARD_NAMES = { "widget-connector": "connect-plugin", "widget-suggested-tasks": "suggested-tasks", "widget-browser-connection": "browser-connection" };
function cardAnswer(tag, payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  if (tag === "select") {
    if (value.skipped) return { skipped: true };
    return { selections: Array.isArray(value.selections) ? value.selections.filter(item => typeof item === "string") : [], ...(typeof value.customAnswer === "string" && value.customAnswer.trim() ? { customAnswer: value.customAnswer } : {}) };
  }
  if (tag === "message-input") return { sent: true, values: Object.fromEntries(["body", "from", "to", "cc", "bcc"].filter(key => typeof value[key] === "string").map(key => [key, value[key].slice(0, 20000)])) };
  if (tag === "widget-secret") return { status: value.status === "cancelled" ? "cancelled" : "submitted", notified: true };
  if (tag === "button") return { sent: true };
  return { connected: true };
}
function importLegacyChatExtras({ store, runtimeDir }) {
  if (store.settings.get(EXTRAS_MARKER)) return { skipped: true };
  const file = path.join(runtimeDir, "entities.sqlite");
  const result = { attachments: 0, cards: 0 };
  if (fs.existsSync(file)) {
    const { DatabaseSync } = require("node:sqlite");
    const { parseCards, messageKey, readTag, decode } = require("../renderer/src/cards.mjs");
    const legacy = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = new Set(legacy.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name));
      if (tables.has("conversation_entries")) store.transaction(() => {
        // Messages imported before their files were.
        for (const row of legacy.prepare(`select id, parts from conversation_entries where kind = 'message' and parts like '%"url"%'`).all()) {
          const message = store.messages.get(row.id);
          if (!message || message.images?.length || message.files?.length) continue;
          const { images, files } = partsOf(row.parts);
          if (!images.length && !files.length) continue;
          store.messages.update(row.id, { images, files });
          result.attachments++;
        }
        // Answers by message: the saved card states, and the answers the
        // user's messages sent (<widget-interaction source-message index tag>).
        const answers = new Map();
        const note = (messageId, tag, index, payload) => {
          if (typeof messageId !== "string" || typeof tag !== "string" || index === undefined || index === null) return;
          if (!answers.has(messageId)) answers.set(messageId, new Map());
          const key = (CARD_NAMES[tag] || tag) + "\n" + index;
          if (!answers.get(messageId).has(key) || payload) answers.get(messageId).set(key, { tag: CARD_NAMES[tag] || tag, index: String(index), payload });
        };
        if (tables.has("widget_states")) for (const row of legacy.prepare("select messageId, tagName, widgetKey, payload from widget_states").all()) {
          let payload = null;
          try { payload = JSON.parse(row.payload); } catch {}
          note(row.messageId, row.tagName, row.widgetKey, payload);
        }
        for (const row of legacy.prepare("select parts from conversation_entries where kind = 'message' and parts like '%widget-interaction%'").all()) {
          const text = partsOf(row.parts).text;
          for (const match of text.matchAll(/<widget-interaction\b[^>]*>([\s\S]*?)<\/widget-interaction>/g)) {
            const tag = readTag(match[0], 0);
            if (!tag?.attrs) continue;
            let payload = null;
            try { payload = JSON.parse(decode(match[1]).trim()); } catch {}
            note(tag.attrs["source-message"], tag.attrs.tag, tag.attrs.index, payload);
          }
        }
        const chats = new Map();
        for (const [messageId, list] of answers) {
          const message = store.messages.get(messageId);
          if (!message) continue;
          if (!chats.has(message.conversationId)) chats.set(message.conversationId, { ...(store.settings.get("chatCards:" + message.conversationId, {}) || {}) });
          const states = chats.get(message.conversationId);
          // The keys of the message's cards by kind, in the order the previous
          // app numbered them: through the whole message, tabs included.
          const slots = new Map(), add = (tag, key) => { if (!slots.has(tag)) slots.set(tag, []); slots.get(tag).push(key); };
          const walk = (source, prefix) => {
            for (const card of parseCards(source).cards) {
              const key = `${prefix}:${card.tag}:${card.ordinal}`;
              if (card.tag === "tabs") (card.tabs || []).forEach((tab, index) => walk(tab.body, `${prefix}/tabs${card.ordinal}.${index}`));
              else if (card.tag === "conversation") { let inputs = 0; for (const item of card.items || []) if (item.tag === "message-input") add("message-input", `${key}:input${inputs++}`); }
              else add(card.tag, key);
            }
          };
          walk(message.text, messageKey(message.text));
          for (const { tag, index, payload } of list.values()) {
            const keys = slots.get(tag) || [];
            if (tag === "suggested-tasks") {
              const [ordinal, task] = index.split(":").map(Number), key = keys[ordinal];
              if (!key || !Number.isInteger(task)) continue;
              states[key] = { ...states[key], started: [...new Set([...(states[key]?.started || []), task])] };
              result.cards++;
              continue;
            }
            const key = /^\d+$/.test(index) ? keys[Number(index)] : undefined;
            if (key) { if (states[key] === undefined) { states[key] = cardAnswer(tag, payload); result.cards++; } continue; }
            // A sent draft whose place can't be told: none of the message's
            // drafts can be sent again.
            if (tag === "message-input") for (const other of keys) if (states[other] === undefined) { states[other] = { sent: true }; result.cards++; }
          }
        }
        for (const [conversationId, states] of chats) store.settings.set("chatCards:" + conversationId, states);
      });
    } finally { legacy.close(); }
  }
  store.settings.set(EXTRAS_MARKER, { at: new Date().toISOString(), ...result });
  return result;
}

// The previous app's vault, once the user is signed in. Its items are
// encrypted with the same operating-system key (Electron safeStorage). Most
// are sealed with their id and details; sign-ins it carried over from its
// older password list aren't (it sealed those when it next started), and are
// read with the details on their row. They're saved again in Timewarp's vault
// for the signed-in account, the newest of two copies of a sign-in winning.
// Agents keep the access they had: the previous app let every agent use the
// vault unless the user turned that off. Passkeys aren't carried over, and
// card security codes are left out, as Timewarp never keeps them. Items the
// key store can't open yet are tried again at the next starts, a few times.
const VAULT_MARKER = "legacyVaultImport", VAULT_PROGRESS = "legacyVaultImportProgress", VAULT_ATTEMPTS = 5;
const SEALED = "bound:v1:";

// { item } to import, { unreadable } when the key store can't open it (yet), or {} to skip.
function legacyVaultItem(row, decrypt) {
  const raw = typeof row.encryptedSecret === "string" ? row.encryptedSecret : "";
  const sealed = raw.startsWith(SEALED);
  let ciphertext;
  try { ciphertext = JSON.parse(sealed ? raw.slice(SEALED.length) : raw).ciphertext; } catch { return {}; }
  if (typeof ciphertext !== "string" || !ciphertext) return {};
  let text;
  try { text = decrypt(ciphertext); } catch { return { unreadable: true }; }
  let metadata, secret;
  if (sealed) {
    let value;
    try { value = JSON.parse(text); } catch { return {}; }
    // The sealed copy of the details is used: it can't have been changed.
    if (value?.id !== row.id) return {};
    ({ metadata, secret } = value);
  } else {
    secret = text;
    try { metadata = JSON.parse(row.metadata); } catch { return {}; }
  }
  if (!metadata || typeof secret !== "string" || !secret) return {};
  if (metadata.kind === "password") return { item: { kind: "password", site: metadata.origin, username: metadata.username || "", password: secret, label: metadata.label || undefined } };
  if (metadata.kind === "secret") return { item: { kind: "secret", label: metadata.name, value: secret, notes: metadata.username ? "Username: " + metadata.username : undefined } };
  if (metadata.kind === "credit-card") {
    let card;
    try { card = JSON.parse(secret); } catch { return {}; }
    return { item: { kind: "card", label: metadata.name, number: card?.number, expMonth: Number(card?.expiryMonth), expYear: Number(card?.expiryYear), cardholder: card?.cardholder } };
  }
  return {};
}

function importLegacyVault({ store, vault, decrypt, runtimeDir, log = () => {} }) {
  if (store.settings.get(VAULT_MARKER)) return { skipped: true };
  // Without the key store nothing can be read yet; the next start tries again.
  if (!vault.available()) return { pending: true };
  const file = path.join(runtimeDir, "entities.sqlite");
  // Earlier tries: the rows already handled, the counts, and whether access was given.
  const progress = store.settings.get(VAULT_PROGRESS) || {};
  const result = { signIns: 0, cards: 0, secrets: 0, agents: 0, skipped: 0, ...progress.result };
  const done = () => { store.settings.set(VAULT_MARKER, { at: new Date().toISOString(), ...result }); return result; };
  if (!fs.existsSync(file)) return done();
  const { DatabaseSync } = require("node:sqlite");
  const legacy = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = new Set(legacy.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name));
    // All or nothing, so a failed start leaves no half import to repeat.
    return store.transaction(() => {
      const handled = new Set(Array.isArray(progress.handled) ? progress.handled : []);
      let unreadable = 0;
      if (tables.has("vault_entries")) {
        const signIns = new Set(vault.list().filter(item => item.kind === "password").map(item => item.origin + "\n" + (item.username || "")));
        // Newest first, so of two copies of a sign-in the latest is kept.
        for (const row of legacy.prepare("select * from vault_entries order by updatedAt desc, createdAt desc").all()) {
          if (handled.has(row.id)) continue;
          const { item, unreadable: later } = legacyVaultItem(row, decrypt);
          if (later) { unreadable++; continue; }
          handled.add(row.id);
          if (!item) { result.skipped++; continue; }
          let saved;
          try { saved = vault.create(item, { agentId: row.createdByAgentId && store.agents.get(row.createdByAgentId) ? row.createdByAgentId : null, dedupe: signIns, imported: true }); }
          catch (error) { result.skipped++; log("A previous vault item could not be imported.", error.message); continue; }
          if (!saved) continue;
          if (item.kind === "password") result.signIns++;
          else if (item.kind === "card") result.cards++;
          else result.secrets++;
        }
        // Once: each agent from the previous app, unless its access was turned off there.
        if (!progress.granted && tables.has("agents")) {
          const denied = new Set(tables.has("vault_agent_grants") ? legacy.prepare("select * from vault_agent_grants").all().filter(row => row.allowed === 0).map(row => row.agentId) : []);
          for (const { id } of legacy.prepare("select id from agents").all()) {
            const agent = store.agents.get(id);
            if (!agent || agent.vaultAccess || denied.has(id)) continue;
            store.agents.update(agent.id, { vaultAccess: true });
            result.agents++;
          }
        }
      }
      const attempts = (Number(progress.attempts) || 0) + 1;
      if (unreadable && attempts < VAULT_ATTEMPTS) {
        store.settings.set(VAULT_PROGRESS, { attempts, handled: [...handled], granted: true, result });
        return { ...result, pending: true, unreadable };
      }
      if (unreadable) { result.unreadable = unreadable; log(`${unreadable} previous vault item(s) couldn't be read and weren't imported.`); }
      return done();
    });
  } finally { legacy.close(); }
}

module.exports = { importLegacyProfile, importLegacyBrowserProfiles, importLegacyBrowserTabs, importLegacyChatExtras, importLegacyVault, textOf, partsOf };
