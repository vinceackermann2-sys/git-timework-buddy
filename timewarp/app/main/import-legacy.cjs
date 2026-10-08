"use strict";
// One-time import of a profile created by Timewarp 1.x. The previous local
// database is opened read-only and left unchanged. Agent workspaces (including
// their AGENTS.md instructions), memory files and the Codex home stay in place.
const fs = require("node:fs");
const path = require("node:path");

const MARKER = "legacyImport";
const SETTINGS = ["appearance", "memory", "onboarding", "privacy", "suggestions", "modelSettings"];

function textOf(parts) {
  let value;
  try { value = JSON.parse(parts || "[]"); } catch { return ""; }
  if (!Array.isArray(value)) return "";
  return value.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("\n\n");
}

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
          const text = textOf(row.parts);
          if (!text) continue;
          store.messages.append({ id: row.id, conversationId: row.conversationId, authorId: row.authorId, createdAt: row.createdAt, text, turnId: row.codexTurnId, status: row.deliveryStatus === "failed" ? "failed" : "sent" });
          result.messages++;
        }
      });
      // Automations come over paused with a daily schedule; their owners
      // confirm the schedule before turning them back on.
      if (tables.has("automations")) store.transaction(() => {
        for (const row of legacy.prepare("select * from automations where deletedAt is null").all()) {
          const conversation = store.conversations.get(row.conversationId);
          if (store.automations.get(row.id) || !conversation || !store.agents.get(row.agentId)) continue;
          store.automations.create({
            id: row.id, ownerId: conversation.ownerId, agentId: row.agentId, conversationId: row.conversationId,
            name: String(row.name || "Automation").slice(0, 80), instructions: row.instructions, schedule: { kind: "daily", time: "09:00" },
            enabled: false, createdAt: row.createdAt,
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
      for (const key of SETTINGS) if (value[key] !== undefined && store.settings.get(key) === null) { store.settings.set(key, value[key]); result.settings++; }
    } catch (error) { log("Previous settings could not be read.", error.message); }
  }
  store.settings.set(MARKER, { at: new Date().toISOString(), ...result });
  return result;
}

module.exports = { importLegacyProfile, textOf };
