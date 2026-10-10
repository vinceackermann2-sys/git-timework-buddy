"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createReplyNotifications, plainReply } = require("../app/main/notifications.cjs");

function setup({ focused = false, enabled = true } = {}) {
  const shown = [], opened = [], badges = [];
  class FakeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; this.closed = false; }
    show() { shown.push(this); }
    close() { this.closed = true; }
  }
  const conversation = { id: "c1", ownerId: "u1", agentId: "a1", read: false };
  const messages = [
    { id: "m1", conversationId: "c1", authorId: "u1", text: "Find me a flight", turnId: "t1" },
    { id: "m2", conversationId: "c1", authorId: "a1", text: "I found **two** flights: [SAS](https://sas.example) and <widget-select>x</widget-select> more.", turnId: "t1" },
  ];
  const store = {
    conversations: { get: id => id === "c1" ? conversation : null, list: () => [conversation, { id: "c2", read: true }] },
    messages: { list: () => messages },
    agents: { get: () => ({ name: "Tao" }) },
  };
  const notifications = createReplyNotifications({ Notification: FakeNotification, store, userId: () => "u1", enabled: () => enabled, focused: () => focused, open: id => opened.push(id), setBadge: count => badges.push(count) });
  const completed = (extra = {}) => notifications.observe("conversation.event", { conversationId: "c1", method: "turn/completed", params: { turn: { id: "t1", status: "completed" }, ...extra } });
  return { shown, opened, badges, conversation, notifications, completed };
}

test("a finished reply notifies with the agent's name and its text, opens the chat on click and clears when read", () => {
  const { shown, opened, badges, notifications, completed } = setup();
  completed();
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].options, { title: "Tao", body: "I found two flights: SAS and more." });
  assert.deepEqual(badges, [1], "The unread count is updated");
  shown[0].emit("click");
  assert.deepEqual(opened, ["c1"]);
  completed();
  notifications.read("c1");
  assert.equal(shown[1].closed, true, "Reading the chat clears its notification");
});

test("no notification while the window is focused, when turned off, for workers or for a chat still marked read", () => {
  for (const options of [{ focused: true }, { enabled: false }]) {
    const { shown, completed } = setup(options);
    completed();
    assert.equal(shown.length, 0);
  }
  const worker = setup();
  worker.completed({ subAgent: true });
  assert.equal(worker.shown.length, 0);
  const quiet = setup();
  quiet.conversation.read = true;
  quiet.completed();
  assert.equal(quiet.shown.length, 0, "A scheduled run with nothing to report stays quiet");
});

test("replies become one plain line", () => {
  assert.equal(plainReply("# Done\n\n- one\n- `two`\n\n```js\ncode()\n```\n> quoted"), "Done one two quoted");
  assert.equal(plainReply(""), "");
});

test("a scheduled run the agent marked as nothing to report doesn't notify, even in an unread chat", () => {
  const { EventEmitter } = require("node:events");
  const shown = [];
  class FakeNotification extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; } show() { shown.push(this); } close() {} }
  const conversation = { id: "c1", ownerId: "u1", agentId: "a1", read: false };
  const store = {
    conversations: { get: () => conversation, list: () => [conversation] },
    messages: { list: () => [{ authorId: "a1", text: "No new listings today.", turnId: "t9" }] },
    agents: { get: () => ({ name: "Tao" }) },
  };
  const notifications = createReplyNotifications({ Notification: FakeNotification, store, userId: () => "u1", quiet: turnId => turnId === "t9" });
  notifications.observe("conversation.event", { conversationId: "c1", method: "turn/completed", params: { turn: { id: "t9", status: "completed" } } });
  assert.equal(shown.length, 0);
});
