"use strict";
// Local Timewarp data in the built-in SQLite database. Codex keeps detailed
// thread transcripts; this store keeps agents, chats, chat messages (for cloud
// history and search), settings and device-local records.
const { DatabaseSync } = require("node:sqlite");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA = [
  `create table agents(
    id text primary key, owner_id text not null, name text not null, instructions text not null default '',
    avatar_type text, avatar_url text, workspace text not null, model_settings text,
    vault_access integer not null default 0, starred_at text, sort_key text,
    created_at text not null, updated_at text not null, archived_at text)`,
  `create table conversations(
    id text primary key, owner_id text not null, agent_id text not null, title text,
    codex_thread_id text, model_settings text, archived_at text, read integer not null default 1,
    browser_profile_id text, created_at text not null, updated_at text not null, last_activity_at text not null)`,
  `create index conversations_owner on conversations(owner_id, last_activity_at)`,
  `create table messages(
    id text primary key, conversation_id text not null references conversations(id) on delete cascade,
    seq integer not null, author_id text not null, created_at text not null, text text not null,
    turn_id text, status text, unique(conversation_id, seq))`,
  `create table settings(key text primary key, value text not null)`,
  `create table automations(
    id text primary key, owner_id text not null, agent_id text not null, conversation_id text,
    name text not null, instructions text not null, schedule text not null, enabled integer not null default 1,
    last_run_at text, next_run_at text, created_at text not null, updated_at text not null, deleted_at text)`,
  `create table browser_profiles(
    id text primary key, label text not null, source text not null, is_default integer not null default 0,
    created_at text not null, deleted_at text)`,
  `create table recent_sites(
    profile_id text not null, conversation_id text not null, url text not null, title text,
    visited_at text not null, primary key(profile_id, conversation_id, url))`,
  `create table vault_entries(
    id text primary key, kind text not null, label text not null, origin text, username text,
    metadata text not null default '{}', secret text not null, created_by_agent text,
    created_at text not null, updated_at text not null)`,
  `create table vault_grants(agent_id text primary key, allowed integer not null)`,
];

const now = () => new Date().toISOString();
const json = value => value === undefined || value === null ? null : JSON.stringify(value);
const parse = value => { if (value === null || value === undefined) return null; try { return JSON.parse(value); } catch { return null; } };

function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
  db.exec("create table if not exists meta(key text primary key, value text not null)");
  const version = Number(db.prepare("select value from meta where key = 'schema'").get()?.value || 0);
  const migrate = (target, statements) => {
    if (version >= target) return;
    db.exec("begin");
    try {
      for (const statement of statements) db.exec(statement);
      db.prepare("insert or replace into meta(key, value) values ('schema', ?)").run(String(target));
      db.exec("commit");
    } catch (error) { db.exec("rollback"); throw error; }
  };
  migrate(1, SCHEMA);
  // Threads remember which tool set they were started with; older transcripts
  // stay readable after a chat continues in a new thread.
  migrate(2, [
    "alter table conversations add column tools_version integer not null default 0",
    "alter table conversations add column previous_thread_ids text",
  ]);
  return createStore(db);
}

function createStore(db) {
  const events = new EventEmitter();
  events.setMaxListeners(100);
  const changed = (kind, id, extra = {}) => events.emit("change", { kind, id, ...extra });
  const one = (sql, ...args) => db.prepare(sql).get(...args) || null;
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  // Nested transactions become savepoints, so store operations compose.
  let depth = 0;
  const transaction = fn => {
    const savepoint = "nested_" + depth;
    db.exec(depth ? `savepoint ${savepoint}` : "begin");
    depth++;
    try {
      const value = fn();
      depth--;
      db.exec(depth ? `release ${savepoint}` : "commit");
      return value;
    } catch (error) {
      depth--;
      db.exec(depth ? `rollback to ${savepoint}; release ${savepoint}` : "rollback");
      throw error;
    }
  };

  const agentOf = row => row && {
    id: row.id, ownerId: row.owner_id, name: row.name, instructions: row.instructions,
    avatarType: row.avatar_type, avatarUrl: row.avatar_url, workspace: row.workspace,
    modelSettings: parse(row.model_settings), vaultAccess: !!row.vault_access,
    starredAt: row.starred_at, sortKey: row.sort_key, createdAt: row.created_at,
    updatedAt: row.updated_at, archivedAt: row.archived_at,
  };
  const conversationOf = row => row && {
    id: row.id, ownerId: row.owner_id, agentId: row.agent_id, title: row.title,
    codexThreadId: row.codex_thread_id, toolsVersion: row.tools_version || 0, previousThreadIds: parse(row.previous_thread_ids) || [],
    modelSettings: parse(row.model_settings),
    archivedAt: row.archived_at, read: !!row.read, browserProfileId: row.browser_profile_id,
    createdAt: row.created_at, updatedAt: row.updated_at, lastActivityAt: row.last_activity_at,
  };
  const messageOf = row => row && {
    id: row.id, conversationId: row.conversation_id, seq: row.seq, authorId: row.author_id,
    createdAt: row.created_at, text: row.text, turnId: row.turn_id, status: row.status,
  };

  const agents = {
    get: id => agentOf(one("select * from agents where id = ?", id)),
    list: (ownerId, { includeArchived = false } = {}) => all(
      `select * from agents where owner_id = ? ${includeArchived ? "" : "and archived_at is null"}
       order by starred_at is null, coalesce(sort_key, created_at), created_at`, ownerId).map(agentOf),
    create(input) {
      const at = now(), id = input.id || crypto.randomUUID();
      run(`insert into agents(id, owner_id, name, instructions, avatar_type, avatar_url, workspace, model_settings,
        vault_access, starred_at, sort_key, created_at, updated_at, archived_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.ownerId, input.name, input.instructions || "", input.avatarType || null, input.avatarUrl || null,
      input.workspace, json(input.modelSettings), input.vaultAccess ? 1 : 0, input.starredAt || null,
      input.sortKey || null, input.createdAt || at, input.updatedAt || at, input.archivedAt || null);
      changed("agent", id);
      return agents.get(id);
    },
    update(id, patch) {
      const current = agents.get(id);
      if (!current) throw Object.assign(new Error("Agent not found."), { status: 404 });
      const next = { ...current, ...patch };
      run(`update agents set name = ?, instructions = ?, avatar_type = ?, avatar_url = ?, workspace = ?, model_settings = ?,
        vault_access = ?, starred_at = ?, sort_key = ?, archived_at = ?, updated_at = ? where id = ?`,
      next.name, next.instructions, next.avatarType, next.avatarUrl, next.workspace, json(next.modelSettings),
      next.vaultAccess ? 1 : 0, next.starredAt, next.sortKey, next.archivedAt, now(), id);
      changed("agent", id);
      return agents.get(id);
    },
  };

  const conversations = {
    get: id => conversationOf(one("select * from conversations where id = ?", id)),
    byThread: threadId => conversationOf(one("select * from conversations where codex_thread_id = ?", threadId)),
    list(ownerId, { agentId, includeArchived = false, archivedOnly = false, search, limit = 500 } = {}) {
      const where = ["c.owner_id = ?"], args = [ownerId];
      if (agentId) { where.push("c.agent_id = ?"); args.push(agentId); }
      if (archivedOnly) where.push("c.archived_at is not null");
      else if (!includeArchived) where.push("c.archived_at is null");
      if (search) {
        where.push(`(c.title like ? escape '\\' or exists (select 1 from messages m where m.conversation_id = c.id and m.text like ? escape '\\'))`);
        const pattern = "%" + String(search).replace(/[\\%_]/g, "\\$&") + "%";
        args.push(pattern, pattern);
      }
      args.push(limit);
      return all(`select c.* from conversations c where ${where.join(" and ")} order by c.last_activity_at desc limit ?`, ...args).map(conversationOf);
    },
    create(input) {
      const at = input.createdAt || now(), id = input.id || crypto.randomUUID();
      run(`insert into conversations(id, owner_id, agent_id, title, codex_thread_id, model_settings, archived_at, read,
        browser_profile_id, created_at, updated_at, last_activity_at) values (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.ownerId, input.agentId, input.title || null, input.codexThreadId || null, json(input.modelSettings),
      input.archivedAt || null, input.read === false ? 0 : 1, input.browserProfileId || null, at,
      input.updatedAt || at, input.lastActivityAt || at);
      changed("conversation", id);
      return conversations.get(id);
    },
    update(id, patch, { touch = true } = {}) {
      const current = conversations.get(id);
      if (!current) throw Object.assign(new Error("Conversation not found."), { status: 404 });
      const next = { ...current, ...patch };
      run(`update conversations set agent_id = ?, title = ?, codex_thread_id = ?, tools_version = ?, previous_thread_ids = ?, model_settings = ?,
        archived_at = ?, read = ?, browser_profile_id = ?, updated_at = ?, last_activity_at = ? where id = ?`,
      next.agentId, next.title, next.codexThreadId, next.toolsVersion || 0, next.previousThreadIds?.length ? JSON.stringify(next.previousThreadIds) : null,
      json(next.modelSettings), next.archivedAt, next.read ? 1 : 0,
      next.browserProfileId, touch ? now() : (patch.updatedAt || current.updatedAt), next.lastActivityAt, id);
      changed("conversation", id);
      return conversations.get(id);
    },
    remove(id) { run("delete from conversations where id = ?", id); changed("conversation", id, { removed: true }); },
  };

  const messages = {
    list: conversationId => all("select * from messages where conversation_id = ? order by seq", conversationId).map(messageOf),
    get: id => messageOf(one("select * from messages where id = ?", id)),
    append(input) {
      return transaction(() => {
        const id = input.id || crypto.randomUUID();
        if (one("select 1 from messages where id = ?", id)) return messages.get(id);
        const seq = (one("select max(seq) seq from messages where conversation_id = ?", input.conversationId)?.seq || 0) + 1;
        const at = input.createdAt || now();
        run(`insert into messages(id, conversation_id, seq, author_id, created_at, text, turn_id, status) values (?,?,?,?,?,?,?,?)`,
          id, input.conversationId, seq, input.authorId, at, input.text, input.turnId || null, input.status || null);
        run("update conversations set last_activity_at = max(last_activity_at, ?), updated_at = ? where id = ?", at, now(), input.conversationId);
        changed("conversation", input.conversationId, { message: id });
        return messages.get(id);
      });
    },
    update(id, patch) {
      const current = messages.get(id);
      if (!current) return null;
      run("update messages set text = ?, status = ?, turn_id = ? where id = ?", patch.text ?? current.text, patch.status ?? current.status, patch.turnId ?? current.turnId, id);
      changed("conversation", current.conversationId, { message: id });
      return messages.get(id);
    },
  };

  const settings = {
    get(key, fallback = null) { const row = one("select value from settings where key = ?", key); return row ? parse(row.value) : fallback; },
    set(key, value) { run("insert or replace into settings(key, value) values (?, ?)", key, JSON.stringify(value)); changed("settings", key); return value; },
    all() { return Object.fromEntries(all("select key, value from settings").map(row => [row.key, parse(row.value)])); },
  };

  const browserProfiles = {
    list: () => all("select * from browser_profiles where deleted_at is null order by is_default desc, created_at").map(row => ({ id: row.id, label: row.label, source: parse(row.source) || { type: "timewarp" }, isDefault: !!row.is_default, createdAt: row.created_at })),
    create({ id = crypto.randomUUID(), label, source = { type: "timewarp" }, isDefault = false }) {
      run("insert into browser_profiles(id, label, source, is_default, created_at) values (?,?,?,?,?)", id, label, JSON.stringify(source), isDefault ? 1 : 0, now());
      changed("browserProfiles", id);
      return browserProfiles.list().find(item => item.id === id);
    },
    remove(id) { run("update browser_profiles set deleted_at = ? where id = ? and is_default = 0", now(), id); changed("browserProfiles", id); },
    ensureDefault() {
      const existing = browserProfiles.list().find(item => item.isDefault);
      return existing || browserProfiles.create({ id: "timewarp:default", label: "Timewarp", isDefault: true });
    },
  };

  const recentSites = {
    list: (profileId, conversationId) => all("select url, title, visited_at from recent_sites where profile_id = ? and conversation_id = ? order by visited_at desc limit 12", profileId, conversationId).map(row => ({ url: row.url, title: row.title, visitedAt: row.visited_at })),
    record(profileId, conversationId, url, title) {
      run(`insert into recent_sites(profile_id, conversation_id, url, title, visited_at) values (?,?,?,?,?)
        on conflict(profile_id, conversation_id, url) do update set title = coalesce(excluded.title, recent_sites.title), visited_at = excluded.visited_at`,
      profileId, conversationId, url, title || null, now());
      run(`delete from recent_sites where profile_id = ? and conversation_id = ? and url not in
        (select url from recent_sites where profile_id = ? and conversation_id = ? order by visited_at desc limit 12)`, profileId, conversationId, profileId, conversationId);
    },
  };

  return {
    db, events, transaction, agents, conversations, messages, settings, browserProfiles, recentSites,
    on: (name, fn) => events.on(name, fn), off: (name, fn) => events.off(name, fn),
    close: () => db.close(),
  };
}

module.exports = { openStore, createStore };
