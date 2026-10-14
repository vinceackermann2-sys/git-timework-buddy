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

// Timewarp's own commits run outside the command sandbox, so whatever an
// agent writes into its repository must not run there.
test("workspace commits run no hooks, monitor, signing or filter commands the agent planted", { skip: require("node:child_process").spawnSync("git", ["--version"]).status !== 0 && "Git isn't installed" }, async t => {
  const { execFileSync } = require("node:child_process");
  const { root, store } = tempStore(t);
  const agents = createAgents({ store, root: path.join(root, "agents"), userId: () => "u1" });
  const agent = agents.create({ name: "Orbit", instructions: "Be brief." });
  await agents.settled();
  const dotGit = path.join(agent.workspace, ".git"), ran = path.join(root, "ran").replace(/\\/g, "/");
  const script = (file, name, tail = "") => { fs.writeFileSync(file, `#!/bin/sh\necho ${name} >> "${ran}"\n${tail}`); fs.chmodSync(file, 0o755); return file.replace(/\\/g, "/"); };
  for (const hook of ["pre-commit", "commit-msg", "post-commit"]) script(path.join(dotGit, "hooks", hook), hook);
  const config = (...args) => execFileSync("git", ["config", ...args], { cwd: agent.workspace });
  config("core.fsmonitor", script(path.join(root, "monitor.sh"), "fsmonitor", "exit 1\n"));
  config("commit.gpgSign", "true");
  config("gpg.program", script(path.join(root, "gpg.sh"), "gpg", "exit 1\n"));
  const log = () => execFileSync("git", ["log", "--format=%s"], { cwd: agent.workspace, encoding: "utf8" }).trim().split("\n");
  agents.update(agent.id, { instructions: "Be thorough." });
  await agents.settled();
  assert.equal(fs.existsSync(ran), false, "no hook, monitor or signing program ran");
  assert.equal(log()[0], "Update agent workspace", "the change is still committed");
  // A filter command in the repository's own config (here through an include) stops the commit.
  fs.writeFileSync(path.join(root, "filters.cfg"), `[filter "x"]\n\tclean = ${script(path.join(root, "clean.sh"), "clean", "cat\n")}\n`);
  config("include.path", path.join(root, "filters.cfg").replace(/\\/g, "/"));
  fs.writeFileSync(path.join(agent.workspace, ".gitattributes"), "* filter=x\n");
  agents.update(agent.id, { instructions: "Be quick." });
  await agents.settled();
  assert.equal(fs.existsSync(ran), false, "the filter didn't run");
  assert.equal(log().length, 2, "nothing was committed");
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

test("an existing database upgrades: thread lookups use an index, and its messages are found by search", t => {
  const { DatabaseSync } = require("node:sqlite");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-store-"));
  const file = path.join(root, "timewarp.sqlite");
  let store = openStore(file);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  const chat = store.conversations.create({ ownerId: "u1", agentId: agent.id, title: "Trip", codexThreadId: "thread-1" });
  store.messages.append({ id: "m1", conversationId: chat.id, authorId: "u1", text: "Book the hotel in Zürich" });
  store.close();
  // The database as version 5 left it.
  const raw = new DatabaseSync(file);
  raw.exec(`drop index conversations_thread; drop table history_sync; drop table history_entries; drop table history_changed; drop table message_search; drop table search_pending;
    drop trigger messages_search_insert; drop trigger messages_search_text; drop trigger messages_search_delete;
    drop trigger history_message_insert; drop trigger history_message_update; drop trigger history_message_delete; drop trigger history_conversation_update; drop trigger history_agent_update;
    drop table account_sync; drop table account_sync_cursor; alter table browser_profiles drop column owner_id; update meta set value = '5' where key = 'schema'`);
  raw.close();
  store = openStore(file);
  assert.equal(store.db.prepare("select value from meta where key = 'schema'").get().value, "8");
  assert.equal(store.db.prepare("pragma synchronous").get().synchronous, 1, "synchronous = normal");
  assert.match(store.db.prepare("explain query plan select * from conversations where codex_thread_id = ?").all("x").map(row => row.detail).join(), /conversations_thread/);
  assert.equal(store.conversations.byThread("thread-1").id, chat.id);
  assert.deepEqual(store.conversations.search("u1", "zurich").messages.map(item => item.messageId), ["m1"]);
  assert.equal(store.db.prepare("select count(*) n from search_pending").get().n, 0, "Search indexed the waiting messages");
  // A message written without this store (an older version) is found too.
  store.db.prepare("insert into messages(id, conversation_id, seq, author_id, created_at, text) values ('m2', ?, 2, 'u1', ?, 'Train to Zurich at nine')").run(chat.id, new Date().toISOString());
  assert.deepEqual(store.conversations.search("u1", "zurich").messages.map(item => item.messageId).sort(), ["m1", "m2"]);
  store.db.prepare("update messages set text = 'Train to Basel' where id = 'm2'").run();
  assert.deepEqual(store.conversations.search("u1", "zurich").messages.map(item => item.messageId), ["m1"]);
  assert.deepEqual(store.conversations.search("u1", "basel").messages.map(item => item.messageId), ["m2"]);
});

test("queued messages are indexed in the background in small commits, and closing the store stops it", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-store-"));
  const file = path.join(root, "timewarp.sqlite");
  let store = openStore(file);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  const chat = store.conversations.create({ ownerId: "u1", agentId: agent.id });
  store.transaction(() => { for (let index = 0; index < 1000; index++) store.messages.append({ conversationId: chat.id, authorId: "u1", text: "Message " + index }); });
  store.messages.append({ id: "last", conversationId: chat.id, authorId: "u1", text: "Meet in Zürich" });
  const pending = () => store.db.prepare("select count(*) n from search_pending").get().n;
  // Closed before its backlog starts: nothing runs later.
  store.close();
  store = openStore(file);
  store.close();
  t.mock.timers.tick(10000);
  store = openStore(file);
  assert.equal(pending(), 1001);
  t.mock.timers.tick(4999);
  assert.equal(pending(), 1001, "Not during start-up");
  // At most 400 a commit (fewer when a commit takes over 10 ms).
  t.mock.timers.tick(1);
  const first = pending();
  assert.ok(first >= 601 && first < 1001, String(first));
  t.mock.timers.tick(20);
  assert.ok(pending() >= first - 400 && pending() < first);
  assert.deepEqual(store.conversations.search("u1", "zurich").messages.map(item => item.messageId), ["last"], "A search indexes what is left first");
  assert.equal(pending(), 0);
  t.mock.timers.tick(1000);
});

test("statements are prepared once", t => {
  const { store } = tempStore(t);
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  store.conversations.create({ ownerId: "u1", agentId: agent.id, codexThreadId: "thread-1" });
  store.conversations.byThread("thread-1");
  const prepare = store.db.prepare;
  let prepared = 0;
  store.db.prepare = sql => { prepared++; return prepare.call(store.db, sql); };
  for (let index = 0; index < 5; index++) { store.conversations.byThread("thread-1"); store.settings.set("key", index); store.settings.get("key"); }
  assert.equal(prepared, 2, "Only settings.set's and settings.get's statements are new");
});

test("the unread count is that of the chats the sidebar lists", t => {
  const { store } = tempStore(t);
  const agent = store.agents.create({ ownerId: "u1", name: "Orbit", workspace: "/w/orbit" });
  const at = index => new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString();
  store.transaction(() => {
    for (let index = 0; index < 530; index++) store.conversations.create({ ownerId: "u1", agentId: agent.id, read: index % 3 !== 0, lastActivityAt: at(index), archivedAt: index % 50 === 1 ? at(index) : null });
    store.conversations.create({ ownerId: "u2", agentId: agent.id, read: false });
  });
  assert.equal(store.conversations.unreadCount("u1"), store.conversations.list("u1").filter(item => !item.read).length);
  assert.ok(store.conversations.unreadCount("u1") < store.conversations.list("u1", { limit: 1000 }).filter(item => !item.read).length, "Older chats past the list aren't counted, as before");
  assert.equal(store.conversations.unreadCount("u2"), 1);
  assert.equal(store.conversations.unreadCount("nobody"), 0);
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
