"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createChatTools, toolSpecs } = require("../app/main/chat-tools.cjs");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-chat-tools-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  store.agents.create({ id: "agent-2", ownerId: "user-1", name: "Nova", workspace: path.join(root, "nova") });
  store.agents.create({ id: "agent-x", ownerId: "user-2", name: "Other", workspace: path.join(root, "other") });
  const trip = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "Trip to Lisbon" });
  const budget = store.conversations.create({ ownerId: "user-1", agentId: "agent-2", title: "Budget" });
  const archived = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "Old trip", archivedAt: new Date().toISOString() });
  const foreign = store.conversations.create({ ownerId: "user-2", agentId: "agent-x", title: "Their trip" });
  for (let index = 1; index <= 40; index++) store.messages.append({ conversationId: trip.id, authorId: index % 2 ? "user-1" : "agent-1", text: index === 7 ? "Book the hotel near Alfama" : "Message " + index });
  store.messages.append({ conversationId: budget.id, authorId: "user-1", text: "Hotel budget is 900 euros" });
  store.messages.append({ conversationId: archived.id, authorId: "user-1", text: "Hotel in Porto" });
  store.messages.append({ conversationId: foreign.id, authorId: "user-2", text: "Hotel secret" });
  store.messages.append({ conversationId: budget.id, authorId: "user-1", text: "Hotel draft that failed", status: "failed" });
  const tools = createChatTools({ store, userId: () => "user-1" });
  const run = async (tool, args = {}) => JSON.parse((await tools.call("chat", { namespace: "timewarp_chats", tool, arguments: args })).contentItems[0].text);
  return { store, tools, run, trip, budget, archived, foreign };
}

test("chat tools are read-only lookups with strict schemas", () => {
  const [namespace] = toolSpecs();
  assert.equal(namespace.name, "timewarp_chats");
  assert.deepEqual(namespace.tools.map(tool => tool.name), ["search_conversations", "search_messages", "read_conversation"]);
  for (const tool of namespace.tools) assert.equal(tool.inputSchema.additionalProperties, false);
});

test("agents find the user's chats by title or agent, without archived or other accounts' chats", async t => {
  const { run, trip, budget } = setup(t);
  const all = await run("search_conversations");
  assert.deepEqual(all.conversations.map(item => item.title).sort(), ["Budget", "Trip to Lisbon"]);
  assert.equal(all.conversations.find(item => item.conversationId === trip.id).recent.length, 3);
  assert.deepEqual((await run("search_conversations", { query: "nova" })).conversations.map(item => item.conversationId), [budget.id]);
  assert.deepEqual((await run("search_conversations", { agentIds: ["agent-1"] })).conversations.map(item => item.conversationId), [trip.id]);
});

test("message search covers the user's visible chats and needs three characters", async t => {
  const { run, trip, budget } = setup(t);
  const result = await run("search_messages", { query: "hotel" });
  assert.deepEqual(result.hits.map(hit => hit.conversationId).sort(), [budget.id, trip.id].sort());
  assert.ok(result.hits.every(hit => !/failed|Porto|secret/.test(hit.text)));
  assert.equal(result.hits.find(hit => hit.conversationId === trip.id).from, "user");
  await assert.rejects(run("search_messages", { query: "ho" }), /three characters/);
});

test("reading a chat pages through messages and around a message", async t => {
  const { store, run, trip, archived, foreign } = setup(t);
  const latest = await run("read_conversation", { conversationId: trip.id });
  assert.equal(latest.messages.length, 30);
  assert.equal(latest.messages.at(-1).text, "Message 40");
  assert.equal(latest.olderCursor, "older:10");
  const older = await run("read_conversation", { conversationId: trip.id, cursor: latest.olderCursor });
  assert.equal(older.messages[0].text, "Message 1");
  assert.equal(older.olderCursor, null);
  const hotel = store.messages.list(trip.id).find(message => /Alfama/.test(message.text));
  const around = await run("read_conversation", { conversationId: trip.id, messageId: hotel.id, before: 2, after: 1 });
  assert.deepEqual(around.messages.map(message => message.text), ["Message 5", "Message 6", "Book the hotel near Alfama", "Message 8"]);
  assert.equal(around.messages[3].from, "Orbit");
  await assert.rejects(run("read_conversation", { conversationId: archived.id }), /isn't available/);
  await assert.rejects(run("read_conversation", { conversationId: foreign.id }), /isn't available/);
});

test("reading a chat around a moment finds the messages sent then", async t => {
  const { store, run } = setup(t);
  const day = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "Day" });
  for (const [hour, text] of [[8, "Breakfast plan"], [9, "Call Avery"], [12, "Lunch with Sam"], [15, "Send the invoice"], [18, "Dinner"]]) {
    store.messages.append({ conversationId: day.id, authorId: "user-1", text, createdAt: `2026-10-09T${String(hour).padStart(2, "0")}:00:00.000Z` });
  }
  const noon = await run("read_conversation", { conversationId: day.id, at: "2026-10-09T13:30:00+02:00", before: 1, after: 2 });
  assert.deepEqual(noon.messages.map(message => message.text), ["Call Avery", "Lunch with Sam", "Send the invoice"]);
  const late = await run("read_conversation", { conversationId: day.id, at: "2026-10-10T00:00:00Z", before: 2 });
  assert.deepEqual(late.messages.map(message => message.text), ["Send the invoice", "Dinner"]);
  await assert.rejects(run("read_conversation", { conversationId: day.id, at: "yesterday" }), /date and time/);
});
