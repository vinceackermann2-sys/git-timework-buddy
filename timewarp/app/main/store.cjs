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
// Search ignores case and accents, as before ("cafe" finds "Café").
const fold = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// What SQLite's LIKE ignores: the case of A-Z only.
const lowerAscii = value => value.replace(/[A-Z]+/g, letters => letters.toLowerCase());
const SEARCH_MIN = 3, SNIPPET_ROOM = 40;
// The search index's query for text containing `needle`: each of its
// three-character pieces, quoted. Null when the index can't narrow it down.
function trigramQuery(needle) {
  const characters = [...needle];
  if (characters.length < 3 || needle.includes("\0")) return null;
  const pieces = new Set();
  for (let index = 0; index + 3 <= characters.length; index++) pieces.add(characters.slice(index, index + 3).join(""));
  return [...pieces].map(piece => '"' + piece.replace(/"/g, '""') + '"').join(" AND ");
}
const plainText = value => String(value || "").replace(/```[\w+-]*/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>~|]+/g, "");
// One line around the first match, with "..." where text was cut, and where
// the match is within it ({ start, end }, or null when it isn't in the text).
function snippetOf(text, query, room = SNIPPET_ROOM) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  let folded = "";
  const at = [];
  for (let index = 0; index < source.length;) {
    const character = String.fromCodePoint(source.codePointAt(index));
    const piece = fold(character);
    folded += piece;
    for (let count = 0; count < piece.length; count++) at.push(index);
    index += character.length;
  }
  at.push(source.length);
  const needle = fold(String(query || "").trim());
  const found = needle ? folded.indexOf(needle) : -1;
  // Cuts never split a character made of two UTF-16 units.
  const whole = index => index > 0 && index < source.length && /[\udc00-\udfff]/.test(source[index]) ? index - 1 : index;
  if (found < 0) {
    const end = whole(Math.min(source.length, room * 2));
    return { snippet: source.slice(0, end) + (end < source.length ? "..." : ""), highlight: null };
  }
  const start = at[found], end = at[found + needle.length];
  const from = whole(Math.max(0, start - room)), to = whole(Math.min(source.length, end + room));
  const lead = from > 0 ? "..." : "";
  const offset = lead.length + start - from;
  return { snippet: lead + source.slice(from, to) + (to < source.length ? "..." : ""), highlight: { start: offset, end: offset + end - start } };
}
const parse = value => { if (value === null || value === undefined) return null; try { return JSON.parse(value); } catch { return null; } };
// The search index needs FTS5 with contentless_delete (SQLite 3.43 and later).
function fts5(db) {
  try { db.exec("create virtual table temp.fts5_probe using fts5(x, content='', contentless_delete=1, tokenize='trigram case_sensitive 1', detail='none'); drop table temp.fts5_probe"); return true; }
  catch { return false; }
}

function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // With WAL, synchronous = normal syncs at checkpoints instead of at every
  // commit: a power cut can lose the last commits but never damages the file.
  db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
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
  // Each automation run is recorded with the chat turn it started.
  migrate(3, [
    `create table automation_runs(
      id text primary key, automation_id text not null references automations(id) on delete cascade,
      conversation_id text, turn_id text, trigger text not null, status text not null, error text,
      started_at text not null, finished_at text)`,
    "create index automation_runs_automation on automation_runs(automation_id, started_at)",
  ]);
  // Token usage per turn, shown in a chat's activity trace.
  migrate(4, [
    `create table turn_usage(
      turn_id text primary key, conversation_id text not null references conversations(id) on delete cascade,
      thread_id text, input integer not null, cached integer not null, output integer not null, reasoning integer not null,
      thread_total integer not null, updated_at text not null)`,
    "create index turn_usage_conversation on turn_usage(conversation_id)",
  ]);
  // Files and images a message carried, for messages that have no Codex
  // transcript to show them (chats from the previous app).
  migrate(5, ["alter table messages add column attachments text"]);
  // Every Codex notification finds its chat by thread. History sync keeps what
  // it knew of each chat, so a launch downloads and uploads only chats that
  // changed (desktop/local-history.cjs). Triggers count the writes to each chat,
  // whoever makes them; sync notes the count it has seen through (`settled`).
  const counted = chats => `insert into history_changed(conversation_id, count) ${chats} on conflict(conversation_id) do update set count = count + 1`;
  migrate(6, [
    "create index conversations_thread on conversations(codex_thread_id)",
    `create table history_sync(
      conversation_id text primary key references conversations(id) on delete cascade, owner_id text not null,
      version text, remote_hash text, local_hash text, settled integer)`,
    `create table history_entries(
      conversation_id text not null references conversations(id) on delete cascade, entry_id text not null, hash text not null,
      primary key(conversation_id, entry_id)) without rowid`,
    "create table history_changed(conversation_id text primary key references conversations(id) on delete cascade, count integer not null) without rowid",
    `create trigger history_message_insert after insert on messages begin ${counted("values (new.conversation_id, 1)")}; end`,
    `create trigger history_message_update after update on messages begin ${counted("values (new.conversation_id, 1)")}; end`,
    // Not for the messages of a chat being deleted.
    `create trigger history_message_delete after delete on messages when exists (select 1 from conversations where id = old.conversation_id)
      begin ${counted("values (old.conversation_id, 1)")}; end`,
    `create trigger history_conversation_update after update on conversations begin ${counted("values (new.id, 1)")}; end`,
    `create trigger history_agent_update after update of name, owner_id on agents when new.name is not old.name or new.owner_id is not old.owner_id
      begin ${counted("select id, 1 from conversations where agent_id = new.id")}; end`,
  ]);
  // Message search reads a trigram index instead of every message. Triggers
  // queue each change to a message's text, whoever makes it (an older version
  // too), and search indexes the queue first. Without FTS5, search scans.
  if (version < 7 && fts5(db)) migrate(7, [
    `create virtual table message_search using fts5(folded, lowered, content='', contentless_delete=1,
      tokenize='trigram case_sensitive 1', detail='none')`,
    "create table search_pending(id integer primary key)",
    "create trigger messages_search_insert after insert on messages begin insert or ignore into search_pending(id) values (new.rowid); end",
    "create trigger messages_search_text after update of text on messages when new.text is not old.text begin insert or ignore into search_pending(id) values (new.rowid); end",
    "create trigger messages_search_delete after delete on messages begin insert or ignore into search_pending(id) values (old.rowid); end",
    "insert into search_pending(id) select rowid from messages",
  ]);
  return createStore(db);
}

function createStore(db) {
  const events = new EventEmitter();
  events.setMaxListeners(100);
  const changed = (kind, id, extra = {}) => events.emit("change", { kind, id, ...extra });
  // Accent-insensitive search needs SQLite user functions (Node 22.13 and later).
  const folding = typeof db.function === "function";
  if (folding) db.function("tw_fold", { deterministic: true }, value => typeof value === "string" ? fold(value) : value);
  // Statements are prepared once and kept, by their SQL.
  const statements = new Map();
  const prepare = sql => { let statement = statements.get(sql); if (!statement) statements.set(sql, statement = db.prepare(sql)); return statement; };
  const one = (sql, ...args) => prepare(sql).get(...args) || null;
  const all = (sql, ...args) => prepare(sql).all(...args);
  const run = (sql, ...args) => prepare(sql).run(...args);
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
  // Messages queued for the search index (see openStore) are indexed before a
  // search. The index holds each text folded and, where that differs, with only
  // A-Z lowered: a message search's LIKE matches contains the folded query in
  // one of the two, so the index finds every message the LIKE would.
  const indexed = !!one("select 1 from sqlite_master where type = 'table' and name = 'message_search'");
  // Indexes up to `limit` queued messages in one commit, stopping early once
  // `ms` have passed; true when more wait.
  const indexSome = (limit, ms = Infinity) => {
    const rows = all("select p.id, m.text from search_pending p left join messages m on m.rowid = p.id order by p.id limit ?", limit);
    if (!rows.length) return false;
    const until = performance.now() + ms;
    let done = 0;
    transaction(() => {
      for (const { id, text } of rows) {
        run("delete from message_search where rowid = ?", id);
        if (typeof text === "string") {
          const folded = fold(text), lowered = lowerAscii(text);
          run("insert into message_search(rowid, folded, lowered) values (?, ?, ?)", id, folded, lowered === folded ? null : lowered);
        }
        if (++done < rows.length && performance.now() > until) break;
      }
      run("delete from search_pending where id <= ?", rows[done - 1].id);
    });
    return done < rows.length || rows.length === limit;
  };
  const indexPending = () => { while (indexSome(1000)); };
  // A backlog (an upgrade queues every message) is indexed in the background
  // from a few seconds after start-up, in commits of a few hundred messages or
  // about 10 ms, so a search only has what is left; closing the store stops it.
  let closed = false, backlog = null;
  const indexLater = delay => { backlog = setTimeout(() => { backlog = null; try { if (!closed && indexSome(400, 10)) indexLater(20); } catch {} }, delay); backlog.unref?.(); };
  if (indexed && one("select 1 from search_pending limit 1")) indexLater(5000);

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
    ...(row.last_text !== undefined ? { lastText: row.last_text ? String(row.last_text).slice(0, 200) : null } : {}),
  };
  // images: paths (or names, when the file is gone); files: paths or names.
  const attachmentsOf = value => {
    const parsed = parse(value);
    const list = key => Array.isArray(parsed?.[key]) ? parsed[key].filter(item => typeof item === "string" && item) : [];
    return parsed ? { images: list("images"), files: list("files") } : {};
  };
  const messageOf = row => row && {
    id: row.id, conversationId: row.conversation_id, seq: row.seq, authorId: row.author_id,
    createdAt: row.created_at, text: row.text, turnId: row.turn_id, status: row.status,
    ...(row.attachments ? attachmentsOf(row.attachments) : {}),
  };
  const attachmentsJson = ({ images, files } = {}) => (images?.length || files?.length) ? JSON.stringify({ images: images || [], files: files || [] }) : null;

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
    // Unread chats among those the sidebar lists (the latest 500 not archived), for the badge.
    unreadCount: ownerId => one("select count(*) count from (select read from conversations where owner_id = ? and archived_at is null order by last_activity_at desc limit 500) where read = 0", ownerId).count,
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
      // The chat's latest message (from either side; not ones that failed), shown in the sidebar's activity list.
      const last = "(select substr(m.text, 1, 400) from messages m where m.conversation_id = c.id and coalesce(m.status, '') not in ('failed', 'replaced') and m.text not like '<agent-introduction>%' order by m.seq desc limit 1)";
      return all(`select c.*, ${last} last_text from conversations c where ${where.join(" and ")} order by c.last_activity_at desc limit ?`, ...args).map(conversationOf);
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
    // Search (Ctrl/⌘+K), from three characters as before: chats whose name
    // matches, then messages that match, newest first, each with a snippet.
    // Archived chats and messages that weren't delivered are left out.
    search(ownerId, query, { limit = 50 } = {}) {
      const text = String(query || "").trim();
      if ([...text].length < SEARCH_MIN) return { conversations: [], messages: [] };
      const needle = fold(text), pattern = "%" + needle.replace(/[\\%_]/g, "\\$&") + "%";
      // Text with accents or other non-ASCII letters is folded before matching;
      // plain text is matched by SQLite directly, which is much faster.
      const matches = column => folding
        ? `(${column} like :pattern escape '\\' or (${column} glob :wide and tw_fold(${column}) like :pattern escape '\\'))`
        : `${column} like :pattern escape '\\'`;
      const args = { owner: ownerId, pattern, limit, ...(folding ? { wide: "*[^" + String.fromCharCode(1) + "-~]*" } : {}) };
      const titles = all(`select c.* from conversations c where c.owner_id = :owner and c.archived_at is null and c.title is not null and ${matches("c.title")}
        order by c.last_activity_at desc limit :limit`, args);
      // The index narrows messages down to those holding every piece of the
      // query; the same match as before then decides.
      const terms = indexed ? trigramQuery(needle) : null;
      if (terms) indexPending();
      const found = all(`select c.*, m.id message_id, m.created_at message_at, m.text message_text from
        ${terms ? "message_search cross join messages m on m.rowid = message_search.rowid" : "messages m"} join conversations c on c.id = m.conversation_id
        where ${terms ? "message_search match :terms and " : ""}c.owner_id = :owner and c.archived_at is null and coalesce(m.status, '') not in ('failed', 'replaced') and ${matches("m.text")}
        order by m.created_at desc, m.seq desc limit :limit`, terms ? { ...args, terms } : args);
      return {
        conversations: titles.map(row => ({ conversation: conversationOf(row), ...snippetOf(row.title, text) })),
        // Snippets read as text: no Markdown marks, links as their words.
        messages: found.map(row => ({ conversation: conversationOf(row), messageId: row.message_id, createdAt: row.message_at, ...snippetOf(plainText(row.message_text), text) })),
      };
    },
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
        run(`insert into messages(id, conversation_id, seq, author_id, created_at, text, turn_id, status, attachments) values (?,?,?,?,?,?,?,?,?)`,
          id, input.conversationId, seq, input.authorId, at, input.text, input.turnId || null, input.status || null, attachmentsJson(input));
        run("update conversations set last_activity_at = max(last_activity_at, ?), updated_at = ? where id = ?", at, now(), input.conversationId);
        changed("conversation", input.conversationId, { message: id });
        return messages.get(id);
      });
    },
    update(id, patch) {
      const current = messages.get(id);
      if (!current) return null;
      run("update messages set text = ?, status = ?, turn_id = ?, attachments = ? where id = ?", patch.text ?? current.text, patch.status ?? current.status, patch.turnId ?? current.turnId,
        attachmentsJson(patch.images || patch.files ? { images: patch.images ?? current.images, files: patch.files ?? current.files } : current), id);
      changed("conversation", current.conversationId, { message: id });
      return messages.get(id);
    },
  };

  const settings = {
    get(key, fallback = null) { const row = one("select value from settings where key = ?", key); return row ? parse(row.value) : fallback; },
    set(key, value) { run("insert or replace into settings(key, value) values (?, ?)", key, JSON.stringify(value)); changed("settings", key); return value; },
    all() { return Object.fromEntries(all("select key, value from settings").map(row => [row.key, parse(row.value)])); },
  };

  const automationOf = row => row && {
    id: row.id, ownerId: row.owner_id, agentId: row.agent_id, conversationId: row.conversation_id,
    name: row.name, instructions: row.instructions, schedule: parse(row.schedule) || {}, enabled: !!row.enabled,
    lastRunAt: row.last_run_at, nextRunAt: row.next_run_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
  const runOf = row => row && {
    id: row.id, automationId: row.automation_id, conversationId: row.conversation_id, turnId: row.turn_id,
    trigger: row.trigger, status: row.status, error: row.error, startedAt: row.started_at, finishedAt: row.finished_at,
  };
  const automations = {
    get: id => automationOf(one("select * from automations where id = ? and deleted_at is null", id)),
    list: ownerId => all("select * from automations where owner_id = ? and deleted_at is null order by created_at", ownerId).map(automationOf),
    due: (ownerId, at) => all("select * from automations where owner_id = ? and deleted_at is null and enabled = 1 and next_run_at is not null and next_run_at <= ? order by next_run_at", ownerId, at).map(automationOf),
    create(input) {
      const at = now(), id = input.id || crypto.randomUUID();
      run(`insert into automations(id, owner_id, agent_id, conversation_id, name, instructions, schedule, enabled, last_run_at, next_run_at, created_at, updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?)`, id, input.ownerId, input.agentId, input.conversationId || null, input.name, input.instructions,
      JSON.stringify(input.schedule || {}), input.enabled === false ? 0 : 1, input.lastRunAt || null, input.nextRunAt || null, input.createdAt || at, at);
      changed("automation", id);
      return automations.get(id);
    },
    update(id, patch) {
      const current = automations.get(id);
      if (!current) throw Object.assign(new Error("Automation not found."), { status: 404 });
      const next = { ...current, ...patch };
      run(`update automations set agent_id = ?, conversation_id = ?, name = ?, instructions = ?, schedule = ?, enabled = ?, last_run_at = ?, next_run_at = ?, updated_at = ? where id = ?`,
        next.agentId, next.conversationId, next.name, next.instructions, JSON.stringify(next.schedule || {}), next.enabled ? 1 : 0, next.lastRunAt, next.nextRunAt, now(), id);
      changed("automation", id);
      return automations.get(id);
    },
    remove(id) { run("update automations set deleted_at = ?, enabled = 0 where id = ?", now(), id); changed("automation", id, { removed: true }); },
    runs: {
      list: (automationId, limit = 30) => all("select * from automation_runs where automation_id = ? order by started_at desc limit ?", automationId, limit).map(runOf),
      byTurn: turnId => runOf(one("select * from automation_runs where turn_id = ? order by started_at desc limit 1", turnId)),
      get: id => runOf(one("select * from automation_runs where id = ?", id)),
      // A run that didn't start leaves no record; it is tried again (automations.cjs).
      remove(id) {
        const current = runOf(one("select * from automation_runs where id = ?", id));
        if (!current) return;
        run("delete from automation_runs where id = ?", id);
        changed("automation", current.automationId, { run: id, removed: true });
      },
      create(input) {
        const id = input.id || crypto.randomUUID();
        run(`insert into automation_runs(id, automation_id, conversation_id, turn_id, trigger, status, error, started_at, finished_at) values (?,?,?,?,?,?,?,?,?)`,
          id, input.automationId, input.conversationId || null, input.turnId || null, input.trigger, input.status, input.error || null, input.startedAt || now(), input.finishedAt || null);
        run(`delete from automation_runs where automation_id = ? and id not in (select id from automation_runs where automation_id = ? order by started_at desc limit 100)`, input.automationId, input.automationId);
        changed("automation", input.automationId, { run: id });
        return runOf(one("select * from automation_runs where id = ?", id));
      },
      update(id, patch) {
        const current = runOf(one("select * from automation_runs where id = ?", id));
        if (!current) return null;
        const next = { ...current, ...patch };
        run("update automation_runs set turn_id = ?, status = ?, error = ?, finished_at = ? where id = ?", next.turnId, next.status, next.error, next.finishedAt, id);
        changed("automation", current.automationId, { run: id });
        return runOf(one("select * from automation_runs where id = ?", id));
      },
    },
  };

  const browserProfiles = {
    list: () => all("select * from browser_profiles where deleted_at is null order by is_default desc, created_at").map(row => ({ id: row.id, label: row.label, source: parse(row.source) || { type: "timewarp" }, isDefault: !!row.is_default, createdAt: row.created_at })),
    create({ id = crypto.randomUUID(), label, source = { type: "timewarp" }, isDefault = false }) {
      run("insert into browser_profiles(id, label, source, is_default, created_at) values (?,?,?,?,?)", id, label, JSON.stringify(source), isDefault ? 1 : 0, now());
      changed("browserProfiles", id);
      return browserProfiles.list().find(item => item.id === id);
    },
    rename(id, label) { run("update browser_profiles set label = ? where id = ? and deleted_at is null", label, id); changed("browserProfiles", id); return browserProfiles.list().find(item => item.id === id); },
    // Chats that used a removed profile go back to the default one.
    remove(id) {
      transaction(() => {
        run("update browser_profiles set deleted_at = ? where id = ? and is_default = 0", now(), id);
        run("update conversations set browser_profile_id = null where browser_profile_id = ?", id);
      });
      changed("browserProfiles", id);
    },
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

  // Codex reports cumulative thread usage. Each turn keeps the thread's totals
  // at its last update; a turn's own usage is the growth since the previous
  // turn of the same thread (or its totals, when the count restarted).
  const turnUsage = {
    list(conversationId) {
      const rows = all("select * from turn_usage where conversation_id = ? order by thread_id, rowid", conversationId);
      const previous = new Map(), result = [];
      for (const row of rows) {
        const before = previous.get(row.thread_id);
        const restarted = !before || row.thread_total < before.thread_total;
        const delta = key => restarted ? row[key] : Math.max(0, row[key] - before[key]);
        result.push({ turnId: row.turn_id, threadId: row.thread_id, input: delta("input"), cached: delta("cached"), output: delta("output"), reasoning: delta("reasoning") });
        previous.set(row.thread_id, row);
      }
      return result;
    },
    record(conversationId, threadId, turnId, total) {
      const value = key => Math.max(0, Number(total?.[key]) || 0);
      run(`insert into turn_usage(turn_id, conversation_id, thread_id, input, cached, output, reasoning, thread_total, updated_at) values (?,?,?,?,?,?,?,?,?)
        on conflict(turn_id) do update set input = excluded.input, cached = excluded.cached, output = excluded.output, reasoning = excluded.reasoning,
        thread_total = excluded.thread_total, updated_at = excluded.updated_at`,
      turnId, conversationId, threadId, value("inputTokens"), value("cachedInputTokens"), value("outputTokens"), value("reasoningOutputTokens"), value("totalTokens"), now());
    },
  };

  // What chat history sync knew of each chat at its last pass, kept between
  // launches (desktop/local-history.cjs): the cloud's revision and contents,
  // the local snapshot the cloud has and each message sent. It goes with the chat.
  const historySync = {
    load: ownerId => all("select * from history_sync where owner_id = ?", ownerId)
      .map(row => ({ id: row.conversation_id, version: row.version, remoteHash: row.remote_hash, localHash: row.local_hash })),
    // Chats with no write since sync last saw them through (see openStore).
    settled: ownerId => all(`select s.conversation_id from history_sync s left join history_changed c on c.conversation_id = s.conversation_id
      where s.owner_id = ? and s.local_hash is not null and s.settled = coalesce(c.count, 0)`, ownerId).map(row => row.conversation_id),
    // A chat's write count, read before its snapshot: settling notes it as seen.
    mark: conversationId => one("select count from history_changed where conversation_id = ?", conversationId)?.count ?? 0,
    settle(conversationId, mark) { run("update history_sync set settled = ? where conversation_id = ?", mark, conversationId); },
    save(ownerId, conversationId, { version = null, remoteHash = null, localHash = null }) {
      run(`insert into history_sync(conversation_id, owner_id, version, remote_hash, local_hash) select ?, ?, ?, ?, ? where exists (select 1 from conversations where id = ?)
        on conflict(conversation_id) do update set owner_id = excluded.owner_id, version = excluded.version, remote_hash = excluded.remote_hash, local_hash = excluded.local_hash`,
      conversationId, ownerId, version, remoteHash, localHash, conversationId);
    },
    entries: conversationId => all("select entry_id, hash from history_entries where conversation_id = ?", conversationId).map(row => [row.entry_id, row.hash]),
    remember(conversationId, pairs) {
      if (!pairs.length || !one("select 1 from conversations where id = ?", conversationId)) return;
      transaction(() => { for (const [entryId, hash] of pairs) run("insert into history_entries(conversation_id, entry_id, hash) values (?, ?, ?) on conflict(conversation_id, entry_id) do update set hash = excluded.hash", conversationId, entryId, hash); });
    },
    forget(conversationId) {
      transaction(() => { run("delete from history_sync where conversation_id = ?", conversationId); run("delete from history_entries where conversation_id = ?", conversationId); });
    },
  };

  return {
    db, events, transaction, agents, conversations, messages, settings, automations, browserProfiles, recentSites, turnUsage, historySync,
    on: (name, fn) => events.on(name, fn), off: (name, fn) => events.off(name, fn),
    close: () => { closed = true; clearTimeout(backlog); db.close(); },
  };
}

module.exports = { openStore, createStore, snippetOf };
