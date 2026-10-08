"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createAutomations, normalizeSchedule, nextRun } = require("../app/main/automations.cjs");

const local = (...parts) => new Date(...parts);

test("schedules find the next local run time", () => {
  const monday9 = local(2026, 9, 5, 9, 0); // Monday 5 October 2026, 09:00
  assert.deepEqual(nextRun({ kind: "daily", time: "09:00" }, monday9), local(2026, 9, 6, 9, 0));
  assert.deepEqual(nextRun({ kind: "daily", time: "17:30" }, monday9), local(2026, 9, 5, 17, 30));
  assert.deepEqual(nextRun({ kind: "weekdays", time: "08:00" }, local(2026, 9, 9, 12, 0)), local(2026, 9, 12, 8, 0));
  assert.deepEqual(nextRun({ kind: "weekly", days: [3, 5], time: "10:00" }, monday9), local(2026, 9, 7, 10, 0));
  assert.deepEqual(nextRun({ kind: "monthly", day: 31, time: "09:00" }, local(2026, 10, 15)), local(2026, 10, 30, 9, 0));
  assert.deepEqual(nextRun({ kind: "hourly", minute: 15 }, local(2026, 9, 5, 9, 20)), local(2026, 9, 5, 10, 15));
  assert.deepEqual(nextRun({ kind: "interval", minutes: 30 }, monday9), local(2026, 9, 5, 9, 30));
  assert.equal(nextRun({ kind: "once", at: local(2026, 9, 5, 8, 0).toISOString() }, monday9), null);
});

test("schedules are validated", () => {
  const now = local(2026, 9, 5, 9, 0);
  assert.deepEqual(normalizeSchedule({ kind: "daily", time: "7:05" }, now), { kind: "daily", time: "07:05" });
  assert.deepEqual(normalizeSchedule({ kind: "weekly", days: [5, 1, 1, 9], time: "09:00" }, now), { kind: "weekly", days: [1, 5], time: "09:00" });
  assert.throws(() => normalizeSchedule({ kind: "daily", time: "25:00" }, now), /valid time/);
  assert.throws(() => normalizeSchedule({ kind: "interval", minutes: 5 }, now), /15 minutes/);
  assert.throws(() => normalizeSchedule({ kind: "once", at: local(2026, 9, 4).toISOString() }, now), /future/);
  assert.throws(() => normalizeSchedule({ kind: "weekly", days: [], time: "09:00" }, now), /at least one day/);
  assert.throws(() => normalizeSchedule({ kind: "yearly" }, now), /when the automation runs/);
});

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-automations-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const user = "user-1";
  store.agents.create({ id: "agent-1", ownerId: user, name: "Orbit", workspace: root });
  let clock = local(2026, 9, 5, 8, 59), turn = 0;
  const sent = [];
  const harness = {
    agents: { get: id => { const agent = store.agents.get(id); if (!agent || agent.ownerId !== user) throw Object.assign(new Error("missing"), { status: 404 }); return agent; } },
    conversations: { create: ({ agentId, title }) => store.conversations.create({ ownerId: user, agentId, title }) },
    send: async (id, message) => { sent.push({ id, text: message.text }); return { turnId: "turn-" + ++turn }; },
  };
  const automations = createAutomations({ store, harness, userId: () => user, clock: () => clock });
  return { store, automations, sent, setClock: value => { clock = value; } };
}

test("a due automation sends its instructions to its own chat and records the run", async t => {
  const { store, automations, sent, setClock } = setup(t);
  const created = automations.create({ name: "Morning brief", instructions: "Summarize my inbox.", agentId: "agent-1", schedule: { kind: "daily", time: "09:00" } });
  assert.equal(created.nextRunAt, local(2026, 9, 5, 9, 0).toISOString());
  assert.equal(store.conversations.get(created.conversationId).title, "Morning brief");

  await automations.tick();
  assert.equal(sent.length, 0);
  setClock(local(2026, 9, 5, 9, 0, 20));
  await automations.tick();
  assert.deepEqual(sent, [{ id: created.conversationId, text: "Summarize my inbox." }]);
  const after = automations.get(created.id);
  assert.equal(after.nextRunAt, local(2026, 9, 6, 9, 0).toISOString());
  assert.equal(after.lastRun.status, "running");

  automations.observe("conversation.event", { conversationId: created.conversationId, method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } });
  assert.equal(automations.get(created.id).lastRun.status, "completed");
  await automations.tick();
  assert.equal(sent.length, 1);
});

test("one-time automations switch off after running, and manual runs work", async t => {
  const { automations, sent, setClock } = setup(t);
  const once = automations.create({ name: "Reminder", instructions: "Remind me.", agentId: "agent-1", schedule: { kind: "once", at: local(2026, 9, 5, 9, 30).toISOString() } });
  setClock(local(2026, 9, 5, 10, 0));
  await automations.tick();
  assert.equal(sent.length, 1);
  assert.equal(automations.get(once.id).enabled, false);
  assert.equal(automations.get(once.id).nextRunAt, null);
  const run = await automations.runNow(once.id);
  assert.equal(run.trigger, "manual");
  assert.equal(sent.length, 2);
});

test("disabled automations don't run and other accounts can't see them", async t => {
  const { automations, sent, setClock } = setup(t);
  const paused = automations.create({ name: "Weekly", instructions: "Plan the week.", agentId: "agent-1", enabled: false, schedule: { kind: "weekly", days: [1], time: "09:00" } });
  assert.equal(paused.nextRunAt, null);
  setClock(local(2026, 9, 12, 9, 1));
  await automations.tick();
  assert.equal(sent.length, 0);
  assert.throws(() => automations.create({ name: "x", instructions: "y", agentId: "missing", schedule: { kind: "daily", time: "09:00" } }), /missing/);
  automations.remove(paused.id);
  assert.deepEqual(automations.list(), []);
});
