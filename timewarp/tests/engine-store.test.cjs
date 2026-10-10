"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createAgents, workspaceInstructions } = require("../app/main/agents.cjs");

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

test("search finds chat names and messages from three characters, with the match highlighted", t => {
  const { store } = tempStore(t);
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  const trip = store.conversations.create({ ownerId: "u1", agentId: agent.id, title: "Trip to Zürich" });
  const notes = store.conversations.create({ ownerId: "u1", agentId: agent.id, title: "Notes" });
  const old = store.conversations.create({ ownerId: "u1", agentId: agent.id, title: "Old zurich plans", archivedAt: new Date().toISOString() });
  store.messages.append({ id: "m1", conversationId: notes.id, authorId: "u1", text: "When you have a moment, please book the hotel near the main station in Zurich before Friday, and check the  trains to the airport." });
  store.messages.append({ id: "m2", conversationId: notes.id, authorId: "u1", text: "zurich again", status: "failed" });
  store.messages.append({ id: "m3", conversationId: old.id, authorId: "u1", text: "zurich archived" });
  assert.deepEqual(store.conversations.search("u1", "zu"), { conversations: [], messages: [] }, "Two characters aren't enough");
  const found = store.conversations.search("u1", "zurich");
  assert.deepEqual(found.conversations.map(item => item.conversation.id), [trip.id], "Accents and case are ignored; archived chats are left out");
  assert.equal(found.conversations[0].snippet, "Trip to Zürich");
  assert.deepEqual(found.conversations[0].highlight, { start: 8, end: 14 });
  assert.deepEqual(found.messages.map(item => item.messageId), ["m1"], "Undelivered messages are left out");
  const [message] = found.messages;
  assert.equal(message.conversation.id, notes.id);
  assert.equal(message.snippet.slice(message.highlight.start, message.highlight.end), "Zurich");
  assert.match(message.snippet, /^\.\.\..+\.\.\.$/, "Cut text is marked");
  assert.doesNotMatch(message.snippet, / {2}/);
  assert.equal(store.conversations.search("u2", "zurich").messages.length, 0);
  assert.equal(store.conversations.search("u1", "100%").messages.length, 0, "% is literal");
  store.messages.append({ id: "m4", conversationId: trip.id, authorId: agent.id, text: "**Packing list** for [the trip](https://example.com): `passport`" });
  const [packing] = store.conversations.search("u1", "packing list").messages;
  assert.equal(packing.snippet, "Packing list for the trip: passport", "Snippets read as text, without Markdown");
  assert.equal(packing.snippet.slice(packing.highlight.start, packing.highlight.end), "Packing list");
});

test("search snippets keep whole characters", () => {
  const { snippetOf } = require("../app/main/store.cjs");
  const text = "😀".repeat(30) + " needle " + "😀".repeat(30);
  const { snippet, highlight } = snippetOf(text, "NEEDLE", 10);
  assert.equal(snippet.slice(highlight.start, highlight.end), "needle");
  assert.doesNotMatch(snippet, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  assert.deepEqual(snippetOf("short text", "absent"), { snippet: "short text", highlight: null });
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

test("agents get a workspace with AGENTS.md instructions and a mascot", async t => {
  const { root, store } = tempStore(t);
  const agents = createAgents({ store, root: path.join(root, "agents"), userId: () => "u1" });
  const agent = agents.create({ name: "  Research   Bot ", instructions: "Cite sources." });
  assert.equal(agent.name, "Research Bot");
  assert.match(path.basename(agent.workspace), /^research-bot-/);
  const file = path.join(agent.workspace, "AGENTS.md");
  // As in the previous app: the agent's name, the workspace conventions and its responsibilities.
  assert.equal(fs.readFileSync(file, "utf8"), workspaceInstructions("Research Bot", "Cite sources."));
  assert.match(fs.readFileSync(file, "utf8"), /^# Research Bot\n\nThis repository is your persistent workspace\./);
  assert.equal(fs.readFileSync(path.join(agent.workspace, "Overview.md"), "utf8"), "# Overview\n");
  assert.match(agent.avatarUrl, /\/mascots\/(orbit|nova|cosmo)\.png$/);
  // The agent's own notes in AGENTS.md stay when its responsibilities or name change.
  fs.appendFileSync(file, "\n## Conventions\n\nUse ISO dates.\n");
  agents.update(agent.id, { instructions: "Be brief.", avatar: { mascot: "Nova" }, starred: true });
  agents.update(agent.id, { name: "Scout" });
  assert.equal(agents.instructions(agent.id), "Be brief.");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^# Scout\n/);
  assert.match(text, /\nBe brief\.\n/);
  assert.doesNotMatch(text, /Cite sources/);
  assert.match(text, /Use ISO dates\./);
  assert.match(agents.workspaceInstructions(agent.id), /^This repository is your persistent workspace\./);
  assert.match(store.agents.get(agent.id).avatarUrl, /nova\.png$/);
  assert.ok(store.agents.get(agent.id).starredAt);
  assert.throws(() => agents.update(agent.id, { avatar: { imageUrl: "javascript:alert(1)" } }), /PNG, JPEG or WebP/);
  const other = createAgents({ store, root: path.join(root, "agents"), userId: () => "u2" });
  assert.throws(() => other.get(agent.id), /unavailable/);
  // With Git on the computer, the workspace is a repository the agent can commit to.
  await agents.settled();
  if (require("node:child_process").spawnSync("git", ["--version"]).status === 0) assert.ok(fs.existsSync(path.join(agent.workspace, ".git")), "the workspace is a Git repository");
});

test("browser profiles can be renamed and removed; their chats return to the default", t => {
  const { store } = tempStore(t);
  const fallback = store.browserProfiles.ensureDefault();
  const work = store.browserProfiles.create({ label: "Work" });
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  const chat = store.conversations.create({ ownerId: "u1", agentId: agent.id, browserProfileId: work.id });
  assert.equal(store.browserProfiles.rename(work.id, "Clients").label, "Clients");
  store.browserProfiles.remove(fallback.id);
  assert.ok(store.browserProfiles.list().some(profile => profile.id === fallback.id), "The default profile stays");
  store.browserProfiles.remove(work.id);
  assert.deepEqual(store.browserProfiles.list().map(profile => profile.label), ["Timewarp"]);
  assert.equal(store.conversations.get(chat.id).browserProfileId, null);
});

test("chat lists carry the latest message for the activity feed, as before", t => {
  const { store } = tempStore(t);
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  const chat = store.conversations.create({ ownerId: "u1", agentId: agent.id });
  assert.equal(store.conversations.list("u1")[0].lastText, null);
  store.messages.append({ id: "m1", conversationId: chat.id, authorId: "u1", text: "First" });
  store.messages.append({ id: "m2", conversationId: chat.id, authorId: agent.id, text: "Reply" });
  store.messages.append({ id: "m3", conversationId: chat.id, authorId: "u1", text: "Next question" });
  store.messages.append({ id: "m4", conversationId: chat.id, authorId: agent.id, text: "Lost", status: "failed" });
  assert.equal(store.conversations.list("u1")[0].lastText, "Next question");
});

test("turn usage is the growth of the thread's totals", t => {
  const { store } = tempStore(t);
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  const chat = store.conversations.create({ ownerId: "u1", agentId: agent.id });
  const total = (input, output) => ({ inputTokens: input, cachedInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0, totalTokens: input + output });
  store.turnUsage.record(chat.id, "thread", "t1", total(100, 10));
  store.turnUsage.record(chat.id, "thread", "t1", total(150, 20));
  store.turnUsage.record(chat.id, "thread", "t2", total(400, 50));
  assert.deepEqual(store.turnUsage.list(chat.id).map(row => [row.turnId, row.input, row.output]), [["t1", 150, 20], ["t2", 250, 30]]);
});
