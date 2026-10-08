"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openStore } = require("../app/main/store.cjs");
const { importLegacyProfile } = require("../app/main/import-legacy.cjs");
const { createHistoryAdapter } = require("../app/main/history-adapter.cjs");
const { createLocalHistory, snapshotOf } = require("../desktop/local-history.cjs");

// The subset of the Timewarp 1.x local database read by the import.
function legacyProfile(root) {
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  db.exec(`create table agents(id text primary key, displayName text not null, avatarUrl text, avatarType text, organizationId text, ownerUserId text not null, mainConversationId text, repositoryPath text not null, starredAt text, sidebarSortKey text, createdAt text not null, updatedAt text not null, deletedAt text);
    create table conversations(id text primary key, title text, sourceMessageId text, createdAt text not null, updatedAt text not null, createdByEntityId text, summary text, lastActivityAt text not null default '', modelSettings text, kind text not null default 'dm');
    create table conversation_members(conversationId text not null, entityId text not null, codexThreadId text, archivedAt text, read integer not null default 1, browserProfileId text, runtimeTargetId text, lastSyncedEntrySequence integer not null default 0, primary key(conversationId, entityId));
    create table conversation_entries(internalId integer primary key, id text not null unique, searchText text not null default '', conversationId text not null, sequence integer not null, createdAt text not null, kind text not null, authorId text, parts text, suggestedReplies text, replyToMessageId text, forwardedFromMessageId text, codexTurnId text, deliveryStatus text);`);
  db.prepare("insert into agents values (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("agent-1", "Orbit", "http://127.0.0.1:7788/mascots/orbit.png", "native", null, "user-1", null, path.join(runtime, "agents", "orbit-agent-1"), null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null);
  db.prepare("insert into conversations values (?,?,?,?,?,?,?,?,?,?)").run("chat-1", "Trip plan", null, "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "user-1", null, "2026-01-03T00:00:00.000Z", JSON.stringify({ name: "openai/gpt-5.6-sol" }), "dm");
  db.prepare("insert into conversation_members(conversationId, entityId, codexThreadId, archivedAt, read) values (?,?,?,?,?)").run("chat-1", "user-1", null, null, 0);
  db.prepare("insert into conversation_members(conversationId, entityId, codexThreadId, archivedAt, read) values (?,?,?,?,?)").run("chat-1", "agent-1", "thread-123", null, 1);
  const entry = db.prepare("insert into conversation_entries(id, conversationId, sequence, createdAt, kind, authorId, parts, codexTurnId, deliveryStatus) values (?,?,?,?,?,?,?,?,?)");
  entry.run("e1", "chat-1", 1, "2026-01-02T00:00:00.000Z", "message", "user-1", JSON.stringify([{ type: "text", text: "Plan a trip" }]), "turn-1", null);
  entry.run("e2", "chat-1", 2, "2026-01-02T00:00:05.000Z", "message", "agent-1", JSON.stringify([{ type: "text", text: "Here is a plan." }, { type: "image", url: "x" }]), "turn-1", null);
  entry.run("e3", "chat-1", 3, "2026-01-02T00:00:06.000Z", "toolActivity", "agent-1", JSON.stringify([{ type: "text", text: "internal" }]), "turn-1", null);
  db.close();
  fs.writeFileSync(path.join(runtime, "settings.json"), JSON.stringify({ appearance: { scheme: "dark" }, privacy: { mode: "standard" }, telemetry: { anonymousDistinctId: "x" } }));
  return runtime;
}

test("a 1.x profile imports agents, chats, messages and settings once, leaving the old database untouched", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-import-"));
  const runtime = legacyProfile(root);
  const before = fs.readFileSync(path.join(runtime, "entities.sqlite"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.deepEqual(importLegacyProfile({ store, runtimeDir: runtime }), { agents: 1, conversations: 1, messages: 2, settings: 2 });
  const agent = store.agents.get("agent-1");
  assert.equal(agent.name, "Orbit");
  assert.equal(agent.workspace, path.join(runtime, "agents", "orbit-agent-1"));
  const chat = store.conversations.get("chat-1");
  assert.equal(chat.codexThreadId, "thread-123", "The Codex transcript stays linked");
  assert.equal(chat.read, false);
  assert.deepEqual(store.messages.list("chat-1").map(m => [m.authorId, m.text]), [["user-1", "Plan a trip"], ["agent-1", "Here is a plan."]]);
  assert.deepEqual(store.settings.get("appearance"), { scheme: "dark" });
  assert.equal(store.settings.get("telemetry"), null, "Upstream telemetry identifiers are not imported");
  assert.deepEqual(importLegacyProfile({ store, runtimeDir: runtime }), { skipped: true });
  assert.ok(before.equals(fs.readFileSync(path.join(runtime, "entities.sqlite"))));
});

test("cloud history keeps the 1.x format, restores chats and creates the first agent", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-history-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const created = [];
  const adapter = createHistoryAdapter({ store, settings: store.settings, createAgent: input => { created.push(input); return store.agents.create({ ...input, workspace: path.join(root, input.id || "a") }); } });
  const saved = [];
  const remote = { conversation: { id: "remote-1", kind: "dm", createdByEntityId: "user-1", title: "From laptop", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", lastActivityAt: "2026-02-01T00:00:00.000Z", modelSettings: null, archived: false, read: true },
    agents: [{ id: "agent-r", displayName: "Nova" }],
    entries: [{ id: "r1", kind: "message", authorId: "user-1", createdAt: "2026-02-01T00:00:00.000Z", parts: [{ type: "text", text: "Hello from the laptop" }], suggestedReplies: [], replyToMessageId: null, forwardedFromMessageId: null }] };
  const cloud = async (_route, input) => {
    if (input.operation === "list") return { protocol: 2, manifest: [{ id: "remote-1", version: 1 }], nextOffset: null };
    if (input.operation === "get") return { chats: [{ ...remote, version: 1 }] };
    if (input.operation === "save") { saved.push(input.snapshot); return { saved: true }; }
    throw new Error("unexpected");
  };
  const history = createLocalHistory({ ...adapter, userId: () => "user-1", cloud, intervalMs: 3600000 });
  t.after(() => history.stop());
  await history.sync();
  assert.equal(store.conversations.get("remote-1").title, "From laptop");
  assert.equal(store.messages.list("remote-1")[0].text, "Hello from the laptop");
  assert.equal(store.agents.get("agent-r").name, "Nova", "The restored chat's agent is recreated");
  assert.equal(created.length, 1, "No extra default agent when one already exists after restore");

  const local = store.conversations.create({ ownerId: "user-1", agentId: "agent-r", title: "New here" });
  store.messages.append({ conversationId: local.id, authorId: "user-1", text: "Card 4242 4242 4242 4242" });
  await history.sync().catch(() => {});
  assert.ok(!saved.some(snapshot => JSON.stringify(snapshot).includes("4242 4242")), "Payment data never reaches the cloud");
  store.messages.update(store.messages.list(local.id)[0].id, { text: "Plain question" });
  await history.sync();
  const snapshot = saved.find(item => item.conversation.id === local.id);
  assert.deepEqual(Object.keys(snapshot), ["conversation", "agents", "entries"]);
  assert.deepEqual(snapshot.agents, [{ id: "agent-r", displayName: "Nova" }]);
  assert.equal(snapshot.entries[0].parts[0].text, "Plain question");
  assert.deepEqual(await snapshotOf(adapter.store, "someone-else", local.id), null, "Another account cannot read the chat");
});
