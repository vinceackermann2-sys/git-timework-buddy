"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createAgents } = require("../app/main/agents.cjs");

function tempStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-store-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

test("agents, conversations and messages are scoped, ordered and searchable", t => {
  const { store } = tempStore(t);
  const a = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  store.agents.create({ ownerId: "u2", name: "Other", workspace: "/w/other" });
  assert.deepEqual(store.agents.list("u1").map(agent => agent.name), ["Orbit"]);
  const first = store.conversations.create({ ownerId: "u1", agentId: a.id, title: "Groceries", lastActivityAt: "2026-01-01T00:00:00.000Z" });
  const second = store.conversations.create({ ownerId: "u1", agentId: a.id, title: "Taxes", lastActivityAt: "2026-01-02T00:00:00.000Z" });
  assert.deepEqual(store.conversations.list("u1").map(c => c.title), ["Taxes", "Groceries"]);
  store.messages.append({ id: "m1", conversationId: first.id, authorId: "u1", text: "Buy oat milk 100%" });
  assert.equal(store.messages.append({ id: "m1", conversationId: first.id, authorId: "u1", text: "duplicate" }).text, "Buy oat milk 100%", "Appending is idempotent by id");
  assert.deepEqual(store.conversations.list("u1").map(c => c.title), ["Groceries", "Taxes"], "A new message moves the chat to the top");
  assert.deepEqual(store.conversations.list("u1", { search: "oat" }).map(c => c.title), ["Groceries"]);
  assert.deepEqual(store.conversations.list("u1", { search: "100%" }).map(c => c.title), ["Groceries"], "Search treats % literally");
  assert.equal(store.conversations.list("u2").length, 0);
  store.conversations.update(second.id, { archivedAt: new Date().toISOString() });
  assert.deepEqual(store.conversations.list("u1").map(c => c.title), ["Groceries"]);
  assert.deepEqual(store.conversations.list("u1", { archivedOnly: true }).map(c => c.title), ["Taxes"]);
});

test("nested transactions roll back only their own work", t => {
  const { store } = tempStore(t);
  store.transaction(() => {
    store.settings.set("kept", 1);
    assert.throws(() => store.transaction(() => { store.settings.set("dropped", 2); throw new Error("inner"); }), /inner/);
  });
  assert.equal(store.settings.get("kept"), 1);
  assert.equal(store.settings.get("dropped"), null);
  assert.throws(() => store.transaction(() => { store.settings.set("outer", 3); throw new Error("outer"); }));
  assert.equal(store.settings.get("outer"), null);
});

test("agents get a workspace with AGENTS.md instructions and a mascot", t => {
  const { root, store } = tempStore(t);
  const agents = createAgents({ store, root: path.join(root, "agents"), userId: () => "u1" });
  const agent = agents.create({ name: "  Research   Bot ", instructions: "Cite sources." });
  assert.equal(agent.name, "Research Bot");
  assert.match(path.basename(agent.workspace), /^research-bot-/);
  assert.equal(fs.readFileSync(path.join(agent.workspace, "AGENTS.md"), "utf8"), "Cite sources.\n");
  assert.match(agent.avatarUrl, /\/mascots\/(orbit|nova|cosmo)\.png$/);
  agents.update(agent.id, { instructions: "Be brief.", avatar: { mascot: "Nova" }, starred: true });
  assert.equal(agents.instructions(agent.id), "Be brief.\n");
  assert.match(store.agents.get(agent.id).avatarUrl, /nova\.png$/);
  assert.ok(store.agents.get(agent.id).starredAt);
  assert.throws(() => agents.update(agent.id, { avatar: { imageUrl: "javascript:alert(1)" } }), /PNG, JPEG or WebP/);
  const other = createAgents({ store, root: path.join(root, "agents"), userId: () => "u2" });
  assert.throws(() => other.get(agent.id), /unavailable/);
});
