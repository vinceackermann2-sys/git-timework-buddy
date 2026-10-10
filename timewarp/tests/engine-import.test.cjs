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
    create table conversation_entries(internalId integer primary key, id text not null unique, searchText text not null default '', conversationId text not null, sequence integer not null, createdAt text not null, kind text not null, authorId text, parts text, suggestedReplies text, replyToMessageId text, forwardedFromMessageId text, codexTurnId text, deliveryStatus text);
    create table automations(id text primary key, agentId text not null, conversationId text not null, name text not null, instructions text not null, triggers text not null, enabled integer not null, version integer not null, createdAt text not null, updatedAt text not null, deletedAt text);`);
  db.prepare("insert into automations values (?,?,?,?,?,?,?,?,?,?,?)").run("auto-1", "agent-1", "chat-1", "Daily digest", "Summarize the news.", "[]", 1, 1, "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z", null);
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
  assert.deepEqual(importLegacyProfile({ store, runtimeDir: runtime }), { agents: 1, conversations: 1, messages: 2, automations: 1, settings: 2 });
  const automation = store.automations.get("auto-1");
  assert.deepEqual([automation.ownerId, automation.conversationId, automation.instructions, automation.enabled], ["user-1", "chat-1", "Summarize the news.", false], "Automations come over paused");
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

test("previous automations keep their schedules and on switch when the triggers map exactly", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-import-"));
  const runtime = legacyProfile(root);
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  const add = db.prepare("insert into automations values (?,?,?,?,?,?,?,?,?,?,?)");
  const rrule = text => JSON.stringify([{ type: "rrule", rrule: text }]);
  add.run("auto-weekly", "agent-1", "chat-1", "Plan", "Plan the week.", rrule("DTSTART;TZID=America/New_York:20260105T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"), 1, 1, "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z", null);
  add.run("auto-off", "agent-1", "chat-1", "Off", "Paused before.", rrule("RRULE:FREQ=HOURLY;BYMINUTE=0"), 0, 1, "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z", null);
  add.run("auto-slack", "agent-1", "chat-1", "Slack", "Answer Slack.", JSON.stringify([{ type: "event", integrationId: "slack", event: "message" }]), 1, 1, "2026-01-04T00:00:00.000Z", "2026-01-04T00:00:00.000Z", null);
  db.close();
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  importLegacyProfile({ store, runtimeDir: runtime });
  const weekly = store.automations.get("auto-weekly");
  assert.deepEqual([weekly.schedule.kind, weekly.schedule.days, weekly.schedule.time, weekly.schedule.tz, weekly.enabled], ["weekly", [1], "09:00", "America/New_York", true]);
  assert.ok(Date.parse(weekly.nextRunAt) > Date.now(), "The next run is the next one due, not one missed before the import");
  assert.equal(new Date(weekly.nextRunAt).getUTCDay(), 1);
  assert.deepEqual([store.automations.get("auto-off").schedule.kind, store.automations.get("auto-off").enabled], ["hourly", false], "An automation that was off stays off");
  assert.deepEqual([store.automations.get("auto-slack").enabled, store.automations.get("auto-slack").nextRunAt], [false, null], "Slack triggers have no match here");
});

test("the previous vault's sign-ins, cards and secrets come over once, with the agents allowed to use them", t => {
  const { importLegacyVault } = require("../app/main/import-legacy.cjs");
  const { createVault } = require("../app/main/vault.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-vault-import-"));
  const runtime = legacyProfile(root);
  // The operating system's key store, as Electron's safeStorage: base64 in and out.
  const encrypt = text => Buffer.from("os:" + text).toString("base64");
  const decrypt = value => { const text = Buffer.from(value, "base64").toString(); if (!text.startsWith("os:")) throw new Error("Not ours."); return text.slice(3); };
  const sealed = (id, metadata, secret) => "bound:v1:" + JSON.stringify({ ciphertext: encrypt(JSON.stringify({ id, metadata, secret })), version: 1 });
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  db.exec(`create table vault_entries(id text primary key not null, dedupeKey text not null, metadata text not null, encryptedSecret text not null, createdAt integer not null, updatedAt integer not null, createdByAgentId text);
    create table vault_agent_grants(agentId text primary key not null, allowed integer not null default 1);`);
  const add = db.prepare("insert into vault_entries values (?,?,?,?,?,?,?)");
  const signIn = { kind: "password", origin: "https://mail.example", username: "ada", label: "Mail", source: { type: "manual" } };
  const card = { kind: "credit-card", name: "Work card" };
  const odd = { kind: "credit-card", name: "Store card" };
  const secret = { kind: "secret", name: "OpenAI key", username: "ada" };
  add.run("v1", "k1", JSON.stringify(signIn), sealed("v1", signIn, "correct-horse"), 1, 10, "agent-1");
  add.run("v2", "k2", JSON.stringify(card), sealed("v2", card, JSON.stringify({ cardholder: "Ada Lovelace", number: "4242424242424242", expiryMonth: "04", expiryYear: "2031", cvc: "123" })), 2, 2, null);
  add.run("v3", "k3", JSON.stringify(secret), sealed("v3", secret, "sk-test-value"), 3, 3, null);
  // A sign-in the previous app hadn't sealed yet (from its older password list): read with its row's details.
  const older = { kind: "password", origin: "https://shop.example", username: "grace", label: null, source: { type: "browser", browserProfileId: "p", loginId: "l" } };
  add.run("v4", "k4", JSON.stringify(older), JSON.stringify({ ciphertext: encrypt("shop-password"), version: 1 }), 4, 4, null);
  // Sealed for another item, an older copy of v1 (the newer one wins), and a passkey.
  add.run("v5", "k5", JSON.stringify(signIn), sealed("v1", signIn, "swapped"), 5, 5, null);
  add.run("v7", "k7", JSON.stringify(signIn), sealed("v7", signIn, "older-password"), 0, 0, null);
  const passkey = { kind: "passkey", name: "Bank", rpId: "bank.example", credentialId: "c", userHandle: "u", username: "ada" };
  add.run("v6", "k6", JSON.stringify(passkey), sealed("v6", passkey, "key"), 6, 6, null);
  // A card number the previous app kept although it fails the checksum.
  add.run("v8", "k8", JSON.stringify(odd), sealed("v8", odd, JSON.stringify({ cardholder: "Ada", number: "4242424242424241", expiryMonth: "01", expiryYear: "2030" })), 8, 8, null);
  // Access was on by default: agent-2 has no grant row; agent-3's was turned off.
  const agent = db.prepare("insert into agents(id, displayName, ownerUserId, repositoryPath, createdAt, updatedAt) values (?,?,?,?,?,?)");
  agent.run("agent-2", "Nova", "user-1", path.join(runtime, "agents", "nova"), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  agent.run("agent-3", "Cosmo", "user-1", path.join(runtime, "agents", "cosmo"), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.prepare("insert into vault_agent_grants values (?, ?)").run("agent-1", 1);
  db.prepare("insert into vault_agent_grants values (?, ?)").run("agent-3", 0);
  db.close();
  const before = fs.readFileSync(path.join(runtime, "entities.sqlite"));

  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  importLegacyProfile({ store, runtimeDir: runtime });
  const vault = createVault({ store, cipher: { available: () => true, encrypt, decrypt }, userId: () => "user-1" });
  assert.deepEqual(importLegacyVault({ store, vault: { ...vault, available: () => false }, decrypt, runtimeDir: runtime }), { pending: true }, "Waits for the key store");
  assert.deepEqual(importLegacyVault({ store, vault, decrypt, runtimeDir: runtime }), { signIns: 2, cards: 2, secrets: 1, agents: 2, skipped: 2 });
  const items = vault.list();
  const mail = vault.secret(items.find(item => item.origin === "https://mail.example").id);
  assert.deepEqual([mail.origin, mail.username, mail.label, mail.password, mail.createdByAgent], ["https://mail.example", "ada", "Mail", "correct-horse", "agent-1"]);
  assert.equal(vault.secret(items.find(item => item.origin === "https://shop.example").id).password, "shop-password");
  const work = vault.secret(items.find(item => item.label === "Work card").id);
  assert.deepEqual([work.label, work.number, work.last4, work.expMonth, work.expYear, work.cardholder], ["Work card", "4242424242424242", "4242", 4, 2031, "Ada Lovelace"]);
  assert.equal(work.cvc, undefined, "Security codes aren't kept");
  assert.equal(vault.secret(items.find(item => item.label === "Store card").id).number, "4242424242424241");
  assert.equal(vault.secret(items.find(item => item.kind === "secret").id).value, "sk-test-value");
  assert.deepEqual(["agent-1", "agent-2", "agent-3"].map(id => store.agents.get(id).vaultAccess), [true, true, false]);
  assert.deepEqual(importLegacyVault({ store, vault, decrypt, runtimeDir: runtime }), { skipped: true });
  assert.equal(vault.list().length, 5);
  assert.ok(before.equals(fs.readFileSync(path.join(runtime, "entities.sqlite"))), "The previous database is left unchanged");
});

test("previous vault items the key store can't open yet are tried again at later starts, a few times", t => {
  const { importLegacyVault } = require("../app/main/import-legacy.cjs");
  const { createVault } = require("../app/main/vault.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-vault-retry-"));
  const runtime = legacyProfile(root);
  const encrypt = text => Buffer.from("os:" + text).toString("base64");
  let refuse = true;
  const decrypt = value => { if (refuse) throw new Error("The key store refused."); return Buffer.from(value, "base64").toString().slice(3); };
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  db.exec("create table vault_entries(id text primary key not null, dedupeKey text not null, metadata text not null, encryptedSecret text not null, createdAt integer not null, updatedAt integer not null, createdByAgentId text)");
  const signIn = { kind: "password", origin: "https://mail.example", username: "ada", label: null, source: { type: "manual" } };
  db.prepare("insert into vault_entries values (?,?,?,?,?,?,?)").run("v1", "k1", JSON.stringify(signIn), "bound:v1:" + JSON.stringify({ ciphertext: encrypt(JSON.stringify({ id: "v1", metadata: signIn, secret: "pw" })), version: 1 }), 1, 1, null);
  db.close();
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  importLegacyProfile({ store, runtimeDir: runtime });
  const vault = createVault({ store, cipher: { available: () => true, encrypt, decrypt: value => Buffer.from(value, "base64").toString().slice(3) }, userId: () => "user-1" });
  const first = importLegacyVault({ store, vault, decrypt, runtimeDir: runtime });
  assert.deepEqual([first.pending, first.unreadable, first.agents], [true, 1, 1]);
  store.agents.update("agent-1", { vaultAccess: false });
  refuse = false;
  assert.deepEqual(importLegacyVault({ store, vault, decrypt, runtimeDir: runtime }), { signIns: 1, cards: 0, secrets: 0, agents: 1, skipped: 0 });
  assert.equal(store.agents.get("agent-1").vaultAccess, false, "Access is given once, not again after the user turned it off");
  assert.equal(vault.list().length, 1);

  // A key store that never opens them: the import ends after a few starts.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-vault-retry-"));
  const store2 = openStore(path.join(other, "timewarp.sqlite"));
  t.after(() => { store2.close(); fs.rmSync(other, { recursive: true, force: true }); });
  const vault2 = createVault({ store: store2, cipher: { available: () => true, encrypt, decrypt: value => Buffer.from(value, "base64").toString().slice(3) }, userId: () => "user-1" });
  refuse = true;
  const results = Array.from({ length: 6 }, () => importLegacyVault({ store: store2, vault: vault2, decrypt, runtimeDir: runtime }));
  assert.deepEqual(results.map(result => !!result.pending), [true, true, true, true, false, false]);
  assert.equal(results[4].unreadable, 1);
  assert.deepEqual(results[5], { skipped: true });
});

test("files attached to messages, card answers and open browser tabs come over", t => {
  const { importLegacyChatExtras, importLegacyBrowserTabs } = require("../app/main/import-legacy.cjs");
  const { messageKey } = require("../app/renderer/src/cards.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-import-"));
  const runtime = legacyProfile(root);
  const report = path.join(root, "report.pdf");
  fs.writeFileSync(report, "pdf");
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  db.exec("create table widget_states(widgetKey text not null, messageId text not null, tagName text not null, payload text not null, summary text not null, createdAt text not null, updatedAt text not null, primary key(messageId, tagName, widgetKey))");
  const entry = db.prepare("insert into conversation_entries(id, conversationId, sequence, createdAt, kind, authorId, parts, codexTurnId, deliveryStatus) values (?,?,?,?,?,?,?,?,?)");
  const cards = [
    "Pick one:", '<select><option value="a">Alpha</option><option value="b">Beta</option></select>',
    '<conversation mode="email" title="Reply"><message-input to="bob@example.com">Hi Bob</message-input></conversation>',
    '<tabs><tab label="One"><button prompt="Go one">Go</button></tab><tab label="Two"><message-input>Second draft</message-input></tab></tabs>',
  ].join("\n\n");
  entry.run("e4", "chat-1", 4, "2026-01-02T00:01:00.000Z", "message", "agent-1", JSON.stringify([{ type: "text", text: cards }]), null, null);
  // The draft in the email was sent: only the user's message says so.
  const answer = '<widget-interaction source-message="e4" index="0" tag="message-input" summary="Send email to bob@example.com">{&quot;body&quot;:&quot;Hi Bob!&quot;,&quot;to&quot;:&quot;bob@example.com&quot;}</widget-interaction>';
  entry.run("e5", "chat-1", 5, "2026-01-02T00:02:00.000Z", "message", "user-1", JSON.stringify([{ type: "text", text: answer }]), null, null);
  entry.run("e6", "chat-1", 6, "2026-01-02T00:03:00.000Z", "message", "user-1", JSON.stringify([
    { type: "text", text: "See these" }, { type: "file", url: report, name: "report.pdf", mimeType: "application/pdf" },
    { type: "file", url: "cloud-file://0a1b/photo.png", name: "photo.png", mimeType: "image/png" }, { type: "file", url: path.join(root, "gone.txt"), name: "gone.txt", mimeType: "text/plain" },
  ]), null, null);
  entry.run("e7", "chat-1", 7, "2026-01-02T00:04:00.000Z", "message", "user-1", JSON.stringify([{ type: "file", url: report, name: "report.pdf", mimeType: "application/pdf" }]), null, null);
  // A draft sent from a message whose drafts can't be told apart any more.
  entry.run("e8", "chat-1", 8, "2026-01-02T00:05:00.000Z", "message", "agent-1", JSON.stringify([{ type: "text", text: "<message-input>One</message-input>\n\n<message-input>Two</message-input>" }]), null, null);
  const state = db.prepare("insert into widget_states values (?,?,?,?,?,?,?)");
  state.run("0", "e4", "select", JSON.stringify({ selections: ["b"] }), "Beta", "x", "x");
  state.run("1", "e4", "message-input", JSON.stringify({ body: "Second draft, edited" }), "Second", "x", "x");
  state.run("0", "e4", "button", JSON.stringify({ prompt: "Go one" }), "Go", "x", "x");
  state.run("9", "e8", "message-input", JSON.stringify({ body: "?" }), "?", "x", "x");
  db.close();
  fs.writeFileSync(path.join(runtime, "browser-tabs.json"), JSON.stringify({ version: 4, owners: {
    "chat-1": { p1: { profileId: "p1", visibleTabIndex: 1, tabs: [{ id: "a", url: "about:blank", title: "about:blank" }, { id: "b", url: "https://example.com/a", title: "A", pinned: true, history: { index: 1, entries: [{ url: "https://example.com/", title: "Home", pageState: "x" }, { url: "https://example.com/a", title: "A" }] } }, { id: "c", url: "https://user:pw@example.com/", title: "x" }] } },
    "chat-unknown": { p1: { profileId: "p1", visibleTabIndex: 0, tabs: [{ url: "https://example.com/" }] } },
  } }));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  importLegacyProfile({ store, runtimeDir: runtime });
  const message = id => store.messages.get(id);
  assert.deepEqual([message("e6").text, message("e6").images, message("e6").files], ["See these", ["photo.png"], [report, "gone.txt"]], "Files still here by path, others by name");
  assert.deepEqual([message("e7").text, message("e7").files], ["", [report]], "A message with only a file comes over");

  // A profile imported before files were: they're added to its messages.
  store.messages.update("e7", { images: [], files: [] });
  assert.equal(message("e7").files, undefined);
  assert.deepEqual(importLegacyChatExtras({ store, runtimeDir: runtime }), { attachments: 1, cards: 6 });
  assert.deepEqual(message("e7").files, [report]);
  const key = messageKey(cards), states = store.settings.get("chatCards:chat-1");
  assert.deepEqual(states[`${key}:select:0`], { selections: ["b"] });
  assert.deepEqual(states[`${key}:conversation:0:input0`], { sent: true, values: { body: "Hi Bob!", to: "bob@example.com" } });
  assert.deepEqual(states[`${key}/tabs0.1:message-input:0`], { sent: true, values: { body: "Second draft, edited" } });
  assert.deepEqual(states[`${key}/tabs0.0:button:0`], { sent: true });
  const other = messageKey("<message-input>One</message-input>\n\n<message-input>Two</message-input>");
  assert.deepEqual([states[`${other}:message-input:0`], states[`${other}:message-input:1`]], [{ sent: true }, { sent: true }], "No draft of that message can be sent again");
  assert.deepEqual(importLegacyChatExtras({ store, runtimeDir: runtime }), { skipped: true });

  assert.deepEqual(importLegacyBrowserTabs({ store, runtimeDir: runtime }), { chats: 1, tabs: 3 });
  const tabs = store.settings.get("browserTabs")["chat-1"].tabs;
  assert.deepEqual(tabs.map(tab => [tab.kind, tab.url, tab.title, tab.profileId, tab.active]), [
    ["home", null, "", "p1", false], ["web", "https://example.com/a", "A", "p1", true], ["home", null, "", "p1", false],
  ]);
  assert.equal(tabs[1].pinned, true, "A pinned tab stays pinned");
  assert.deepEqual(tabs[1].history, { index: 1, entries: [{ url: "https://example.com/", title: "Home" }, { url: "https://example.com/a", title: "A" }] }, "Back and forward pages come along, without page state");
  assert.deepEqual(importLegacyBrowserTabs({ store, runtimeDir: runtime }), { skipped: true });
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

test("the previous app's browser profiles come over once with their storage, so sites stay signed in", t => {
  const { importLegacyBrowserProfiles } = require("../app/main/import-legacy.cjs");
  const crypto = require("node:crypto");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-import-"));
  const runtime = legacyProfile(root);
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  db.exec(`create table browser_profiles(id text primary key, source text not null, name text null, label text not null, createdAt integer not null, "default" integer not null default 0, deletedAt integer null)`);
  const insert = db.prepare("insert into browser_profiles values (?,?,?,?,?,?,?)");
  // As in the previous app, the default isn't flagged: it is the oldest profile not imported from a browser.
  insert.run("energy:default", '{"type":"energy"}', null, "Timewarp", 0, 0, null);
  insert.run("work", '{"type":"chrome","browser":"Chrome"}', null, "Work", -5, 0, null);
  insert.run("gone", '{"type":"energy"}', null, "Old", 6, 0, 7);
  db.prepare("update conversation_members set browserProfileId = ? where entityId = ?").run("gone", "agent-1");
  db.close();
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  importLegacyProfile({ store, runtimeDir: runtime });
  assert.equal(store.conversations.get("chat-1").browserProfileId, "gone");
  assert.deepEqual(importLegacyBrowserProfiles({ store, runtimeDir: runtime }), { profiles: 2 });
  const partition = id => "browser-profile:v1:" + crypto.createHash("sha256").update(id).digest("hex");
  assert.deepEqual(store.browserProfiles.list().map(item => [item.id, item.label, item.isDefault, item.source.type, item.source.partition]), [
    ["energy:default", "Timewarp", true, "timewarp", partition("energy:default")],
    ["work", "Work", false, "chrome", partition("work")],
  ]);
  assert.equal(store.browserProfiles.ensureDefault().id, "energy:default", "the previous default stays the default");
  assert.equal(store.conversations.get("chat-1").browserProfileId, null, "a chat on a removed profile uses the default");
  assert.deepEqual(importLegacyBrowserProfiles({ store, runtimeDir: runtime }), { skipped: true });
});

test("a profile that already has a default keeps it and gets the previous default beside it", t => {
  const { importLegacyBrowserProfiles } = require("../app/main/import-legacy.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-import-"));
  const runtime = legacyProfile(root);
  const db = new DatabaseSync(path.join(runtime, "entities.sqlite"));
  db.exec(`create table browser_profiles(id text primary key, source text not null, name text null, label text not null, createdAt integer not null, "default" integer not null default 0, deletedAt integer null)`);
  db.prepare("insert into browser_profiles values (?,?,?,?,?,?,?)").run("energy:default", '{"type":"energy"}', null, "Timewarp", 0, 1, null);
  db.close();
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.browserProfiles.ensureDefault();
  importLegacyBrowserProfiles({ store, runtimeDir: runtime });
  assert.deepEqual(store.browserProfiles.list().map(item => [item.id, item.label, item.isDefault]), [["timewarp:default", "Timewarp", true], ["energy:default", "Timewarp (previous app)", false]]);
});

test("a chat's card answers drop the oldest past 500, never a sent draft", t => {
  const { createMethods } = require("../app/main/methods.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-cards-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const methods = createMethods({ store, services: { auth: { userId: () => "user-1" } }, harness: { conversations: { get: id => ({ id }) } } });
  const save = (key, value) => methods["cards.saveState"]({ conversationId: "chat-1", key, value });
  save("draft:message-input:0", { sent: true, values: { body: "Hi" } });
  for (let index = 0; index < 520; index++) save(`m${index}:select:0`, { selections: ["a"] });
  const states = methods["cards.state"]({ conversationId: "chat-1" });
  assert.deepEqual(states["draft:message-input:0"], { sent: true, values: { body: "Hi" } });
  assert.equal(states["m0:select:0"], undefined);
  assert.ok(states["m519:select:0"]);
  assert.equal(Object.keys(states).length, 500);
});
