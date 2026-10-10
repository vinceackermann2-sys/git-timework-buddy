"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createAutomations, normalizeSchedule, nextRun, legacySchedule, systemZone } = require("../app/main/automations.cjs");

const local = (...parts) => new Date(...parts);
const zone = systemZone() ? { tz: systemZone() } : {};

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
  assert.deepEqual(normalizeSchedule({ kind: "daily", time: "7:05" }, now), { kind: "daily", time: "07:05", ...zone }, "Wall-clock schedules keep the zone they were made in");
  assert.deepEqual(normalizeSchedule({ kind: "weekly", days: [5, 1, 1, 9], time: "09:00" }, now), { kind: "weekly", days: [1, 5], time: "09:00", ...zone });
  assert.deepEqual(normalizeSchedule({ kind: "interval", minutes: 30 }, now), { kind: "interval", minutes: 30 });
  assert.throws(() => normalizeSchedule({ kind: "daily", time: "09:00", tz: "Mars/Olympus" }, now), /time zone/);
  assert.throws(() => normalizeSchedule({ kind: "daily", time: "09:00", count: 0.5 }, now), /number of runs/);
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
  let clock = local(2026, 9, 5, 8, 59), turn = 0, failure = null, hold = null;
  const sent = [], inputs = [];
  const harness = {
    agents: { get: id => { const agent = store.agents.get(id); if (!agent || agent.ownerId !== user || agent.archivedAt) throw Object.assign(new Error("missing"), { status: 404 }); return agent; } },
    conversations: { create: ({ agentId, title }) => store.conversations.create({ ownerId: user, agentId, title }) },
    send: async (id, message, options = {}) => {
      if (hold) await hold;
      if (failure) throw failure;
      sent.push({ id, text: message.text });
      inputs.push(options.run?.text || null);
      return { turnId: "turn-" + ++turn };
    },
    quietRun: id => id === "quiet-chat",
  };
  const automations = createAutomations({ store, harness, userId: () => user, clock: () => clock });
  return {
    store, automations, sent, inputs, setClock: value => { clock = value; },
    failWith: error => { failure = error; }, holdUntil: promise => { hold = promise; },
  };
}
const busy = () => Object.assign(new Error("Wait for the current reply or stop it first."), { status: 409 });

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

test("agents create, list, change and remove only their own automations", async t => {
  const { store, automations } = setup(t);
  const { createAutomationTools, toolSpecs } = require("../app/main/automation-tools.cjs");
  store.agents.create({ id: "agent-2", ownerId: "user-1", name: "Nova", workspace: "/w/nova" });
  const tools = createAutomationTools({ automations });
  const orbit = store.agents.get("agent-1"), nova = store.agents.get("agent-2");
  const run = (agent, tool, args = {}) => tools.call("chat-1", { namespace: "timewarp_automations", tool, arguments: args }, agent);
  assert.deepEqual(toolSpecs()[0].tools.map(tool => tool.name), ["list", "create", "update", "delete", "run_now", "nothing_to_report"]);
  assert.doesNotMatch(JSON.stringify(toolSpecs()), /Confirm the details|Ask the user first/, "The agent rules say to do what the user asked");
  assert.match((await run(orbit, "list")).contentItems[0].text, /no automations/);
  const created = await run(orbit, "create", { name: "Inbox check", instructions: "Look for new invoices.", schedule: { kind: "interval", minutes: 30 } });
  assert.match(created.contentItems[0].text, /Inbox check \| on/);
  const [item] = automations.list();
  assert.equal(item.agentId, "agent-1");
  assert.match((await run(orbit, "list")).contentItems[0].text, /Inbox check/);
  assert.match((await run(nova, "list")).contentItems[0].text, /no automations/);
  await assert.rejects(run(nova, "delete", { id: item.id }), /another agent/);
  await run(orbit, "update", { id: item.id, enabled: false });
  assert.equal(automations.get(item.id).enabled, false);
  await assert.rejects(run(orbit, "create", { name: "Bad", instructions: "x", schedule: { kind: "interval", minutes: 5 } }), /15 minutes/);
  await run(orbit, "delete", { id: item.id });
  assert.equal(automations.list().length, 0);
});

test("a run that finds its chat busy tries again every minute, or when the reply ends, until the next run is due", async t => {
  const { automations, sent, setClock, failWith } = setup(t);
  const created = automations.create({ name: "Inbox", instructions: "Check the inbox.", agentId: "agent-1", schedule: { kind: "daily", time: "09:00" } });
  failWith(busy());
  setClock(local(2026, 9, 5, 9, 0, 10));
  await automations.tick();
  let item = automations.get(created.id);
  assert.equal(item.nextRunAt, local(2026, 9, 5, 9, 0).toISOString(), "The run isn't passed over while it waits");
  assert.equal(item.lastRun, null, "A run that didn't start leaves no record");
  failWith(null);
  setClock(local(2026, 9, 5, 9, 0, 40));
  await automations.tick();
  assert.equal(sent.length, 0, "It waits a minute");
  // The chat's reply ended: the run starts without waiting for the minute.
  automations.observe("conversation.event", { conversationId: created.conversationId, method: "turn/completed", params: { turn: { id: "user-turn", status: "completed" } } });
  await automations.tick();
  assert.equal(sent.length, 1);
  item = automations.get(created.id);
  assert.equal(item.nextRunAt, local(2026, 9, 6, 9, 0).toISOString(), "The next run is set once this one started");
  assert.equal(item.lastRun.status, "running");

  // Still busy when the next run is due: the missed run is recorded as skipped and the new one runs.
  failWith(busy());
  setClock(local(2026, 9, 6, 9, 0, 5));
  await automations.tick();
  failWith(null);
  setClock(local(2026, 9, 7, 9, 0, 5));
  await automations.tick();
  assert.equal(sent.length, 2);
  const skipped = automations.runs(created.id).filter(run => run.status === "skipped");
  assert.deepEqual(skipped.map(run => [run.startedAt, run.error]), [[local(2026, 9, 6, 9, 0).toISOString(), null]]);
  assert.equal(automations.get(created.id).nextRunAt, local(2026, 9, 8, 9, 0).toISOString());
});

test("a run that can't start for another reason is retried, then recorded as failed when the next one is due", async t => {
  const { automations, sent, setClock, failWith } = setup(t);
  const created = automations.create({ name: "Hourly", instructions: "Look around.", agentId: "agent-1", schedule: { kind: "hourly", minute: 0 } });
  failWith(new Error("Codex isn't ready."));
  setClock(local(2026, 9, 5, 9, 0, 5));
  await automations.tick();
  setClock(local(2026, 9, 5, 9, 1, 10));
  await automations.tick();
  assert.equal(automations.get(created.id).lastRun, null);
  setClock(local(2026, 9, 5, 10, 0, 5));
  await automations.tick();
  const [failed] = automations.runs(created.id);
  assert.deepEqual([failed.status, failed.error, failed.startedAt], ["failed", "Codex isn't ready.", local(2026, 9, 5, 9, 0).toISOString()]);
  failWith(null);
  setClock(local(2026, 9, 5, 10, 1, 10));
  await automations.tick();
  assert.equal(sent.length, 1);
  assert.equal(automations.get(created.id).nextRunAt, local(2026, 9, 5, 11, 0).toISOString());
});

test("an automation turned off while its run starts stays off", async t => {
  const { automations, setClock, holdUntil } = setup(t);
  const created = automations.create({ name: "Brief", instructions: "Brief me.", agentId: "agent-1", schedule: { kind: "daily", time: "09:00" } });
  let release;
  holdUntil(new Promise(resolve => { release = resolve; }));
  setClock(local(2026, 9, 5, 9, 0, 10));
  const ticking = automations.tick();
  await new Promise(resolve => setImmediate(resolve));
  automations.update(created.id, { enabled: false });
  release();
  await ticking;
  const item = automations.get(created.id);
  assert.deepEqual([item.enabled, item.nextRunAt], [false, null]);
});

test("an archived agent's automations pass their runs over quietly and can still be changed or deleted", async t => {
  const { store, automations, sent, setClock } = setup(t);
  const created = automations.create({ name: "Brief", instructions: "Brief me.", agentId: "agent-1", schedule: { kind: "daily", time: "09:00" } });
  store.agents.update("agent-1", { archivedAt: new Date().toISOString() });
  setClock(local(2026, 9, 5, 9, 0, 10));
  await automations.tick();
  assert.equal(sent.length, 0);
  assert.equal(automations.get(created.id).lastRun, null, "No failed run every day");
  assert.equal(automations.get(created.id).nextRunAt, local(2026, 9, 6, 9, 0).toISOString());
  automations.update(created.id, { name: "Renamed", instructions: "Still here.", enabled: false });
  assert.deepEqual([automations.get(created.id).name, automations.get(created.id).enabled], ["Renamed", false]);
  await assert.rejects(automations.runNow(created.id), /missing/);
  automations.remove(created.id);
  assert.deepEqual(automations.list(), []);
});

test("Run now while the chat replies waits for the reply to end", async t => {
  const { automations, sent, failWith } = setup(t);
  const created = automations.create({ name: "Brief", instructions: "Brief me.", agentId: "agent-1", schedule: { kind: "daily", time: "09:00" } });
  failWith(busy());
  const record = await automations.runNow(created.id);
  assert.equal(record.status, "queued");
  assert.equal((await automations.runNow(created.id)).id, record.id, "A second Run now doesn't queue another run");
  failWith(null);
  automations.observe("conversation.event", { conversationId: created.conversationId, method: "turn/completed", params: { turn: { id: "user-turn", status: "completed" } } });
  await automations.tick();
  assert.equal(sent.length, 1);
  const [run] = automations.runs(created.id);
  assert.deepEqual([run.id, run.status, run.trigger, run.turnId], [record.id, "running", "manual", "turn-1"]);
});

test("an automation an agent creates runs in the chat it was asked in, wrapped as a scheduled run; one made on the agent page gets its own chat", async t => {
  const { store, automations, sent, inputs, setClock } = setup(t);
  const { createAutomationTools } = require("../app/main/automation-tools.cjs");
  const tools = createAutomationTools({ automations });
  const orbit = store.agents.get("agent-1");
  const chat = store.conversations.create({ ownerId: "user-1", agentId: "agent-1", title: "Planning" });
  const reply = await tools.call(chat.id, { tool: "create", arguments: { name: "Standup", instructions: "Summarize yesterday.", schedule: { kind: "daily", time: "09:00" } } }, orbit);
  assert.match(reply.contentItems[0].text, /runs post in this chat/);
  assert.equal(automations.list()[0].conversationId, chat.id);
  const own = automations.create({ name: "Page", instructions: "Tidy up.", agentId: "agent-1", schedule: { kind: "daily", time: "10:00" } });
  assert.notEqual(own.conversationId, chat.id);
  setClock(local(2026, 9, 5, 9, 0, 5));
  await automations.tick();
  assert.deepEqual(sent, [{ id: chat.id, text: "Summarize yesterday." }], "The chat keeps the plain instructions");
  assert.match(inputs[0], /^<scheduled-run automation="Standup" trigger="schedule" scheduled-for="[^"]+">\n/);
  assert.match(inputs[0], /nothing_to_report/);
  assert.match(inputs[0], /Summarize yesterday\.\n<\/scheduled-run>$/);
  assert.match((await tools.call(chat.id, { tool: "nothing_to_report", arguments: {} }, orbit)).contentItems[0].text, /isn't a scheduled run/);
  assert.match((await tools.call("quiet-chat", { tool: "nothing_to_report", arguments: {} }, orbit)).contentItems[0].text, /won't mark the chat unread/);
});

test("schedules run in their time zone, keep the repeated hour when clocks go back, and stop at their end or count", () => {
  const stockholm = "Europe/Stockholm";
  // 25 October 2026: Stockholm's clocks go back from 03:00 to 02:00, so 02:15 happens twice.
  assert.equal(nextRun({ kind: "hourly", minute: 15, tz: stockholm }, new Date("2026-10-25T00:15:00Z")).toISOString(), "2026-10-25T01:15:00.000Z");
  assert.equal(nextRun({ kind: "daily", time: "09:00", tz: "America/New_York" }, new Date("2026-10-10T12:00:00Z")).toISOString(), "2026-10-10T13:00:00.000Z");
  // 29 March 2026: 02:30 doesn't happen in Stockholm; that day's run is at 03:30.
  assert.equal(nextRun({ kind: "daily", time: "02:30", tz: stockholm }, new Date("2026-03-28T12:00:00Z")).toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(nextRun({ kind: "hourly", minute: 0, tz: "Asia/Kolkata" }, new Date("2026-10-10T12:00:00Z")).toISOString(), "2026-10-10T12:30:00.000Z");
  const now = new Date("2026-10-10T12:00:00Z");
  const counted = normalizeSchedule({ kind: "daily", time: "09:00", tz: "America/New_York", count: 2 }, now);
  const first = nextRun(counted, now), second = nextRun(counted, first);
  assert.deepEqual([first.toISOString(), second.toISOString(), nextRun(counted, second)], ["2026-10-10T13:00:00.000Z", "2026-10-11T13:00:00.000Z", null]);
  const ending = normalizeSchedule({ kind: "daily", time: "09:00", tz: "America/New_York", until: "2026-10-11" }, now);
  assert.equal(ending.until, "2026-10-12T03:59:59.999Z", "An end date lasts the whole day");
  assert.equal(nextRun(ending, new Date("2026-10-11T14:00:00Z")), null);
});

test("editing a schedule keeps its time zone and limits unless they're given", t => {
  const { automations } = setup(t);
  const created = automations.create({ name: "NY", instructions: "Go.", agentId: "agent-1", schedule: { kind: "daily", time: "09:00", tz: "America/New_York", count: 3 } });
  const edited = automations.update(created.id, { schedule: { kind: "weekdays", time: "08:00" } });
  assert.deepEqual([edited.schedule.tz, edited.schedule.count, edited.schedule.start], ["America/New_York", 3, created.schedule.start]);
  assert.equal(automations.update(created.id, { schedule: { kind: "weekdays", time: "08:00", count: null } }).schedule.count, undefined);
});

test("the previous app's triggers become schedules; only exact ones keep running", () => {
  const rule = text => legacySchedule(JSON.stringify([{ type: "rrule", rrule: text }]));
  assert.deepEqual(rule("DTSTART;TZID=Europe/Stockholm:20260105T090000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0"),
    { schedule: { kind: "weekly", days: [1, 3], time: "09:00", tz: "Europe/Stockholm", start: "2026-01-05T08:00:00.000Z" }, exact: true });
  assert.deepEqual(rule("DTSTART;TZID=America/New_York:20260105T083000\nRRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=10"),
    { schedule: { kind: "weekdays", time: "08:30", tz: "America/New_York", start: "2026-01-05T13:30:00.000Z", count: 10 }, exact: true });
  assert.deepEqual(rule("RRULE:FREQ=HOURLY;BYMINUTE=30"), { schedule: { kind: "hourly", minute: 30, tz: "UTC" }, exact: true }, "Without DTSTART the rule ran in UTC");
  assert.deepEqual(rule("DTSTART:20260105T080000Z\nRRULE:FREQ=MINUTELY;INTERVAL=30"), { schedule: { kind: "interval", minutes: 30, start: "2026-01-05T08:00:00.000Z" }, exact: true });
  const monthly = rule("DTSTART;TZID=Europe/Stockholm:20260131T090000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20261231T230000Z");
  assert.deepEqual([monthly.schedule.day, monthly.schedule.until, monthly.exact], [31, "2026-12-31T23:00:00.000Z", true], "The last day of the month is day 31 here");
  assert.equal(rule("DTSTART;TZID=Europe/Stockholm:20260105T090000\nRRULE:FREQ=DAILY;INTERVAL=2").exact, false);
  assert.equal(rule("DTSTART;TZID=Europe/Stockholm:20260105T090000\nRRULE:FREQ=MONTHLY;BYDAY=1MO").exact, false);
  assert.equal(rule("DTSTART;TZID=Europe/Stockholm:20260105T090000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=30").exact, false, "Day 30 skipped February before");
  assert.deepEqual(legacySchedule(JSON.stringify([{ type: "date", date: "2026-11-01T10:00:00+01:00" }])), { schedule: { kind: "once", at: "2026-11-01T09:00:00.000Z" }, exact: true });
  assert.equal(legacySchedule(JSON.stringify([{ type: "event", integrationId: "slack" }])).exact, false);
  assert.equal(legacySchedule(JSON.stringify([{ type: "rrule", rrule: "RRULE:FREQ=DAILY" }, { type: "event" }])).exact, false, "A Slack trigger alongside can't come over");
  assert.equal(legacySchedule("[]").schedule.kind, "daily");
});

test("a run reaches the agent in its note while the chat keeps the instructions, and a run with nothing to report leaves the chat read", async t => {
  const { EventEmitter } = require("node:events");
  const { createHarness } = require("../app/main/harness.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-run-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const { id } = store.conversations.create({ ownerId: "user-1", agentId: "agent-1" });
  const client = new EventEmitter(), calls = [];
  let turns = 0;
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") return { turn: { id: "turn-" + ++turns } };
    return {};
  };
  const harness = createHarness({ store, client, userId: () => "user-1", instructionsFor: () => "", modelSettings: () => null });
  const done = turnId => client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "completed" } } });

  store.conversations.update(id, { read: false });
  const first = await harness.send(id, { text: "Check the inbox." }, { run: { text: "<scheduled-run>Check the inbox.</scheduled-run>" } });
  assert.equal(calls.find(call => call.method === "turn/start").params.input[0].text, "<scheduled-run>Check the inbox.</scheduled-run>");
  assert.equal(store.messages.list(id).at(-1).text, "Check the inbox.");
  assert.equal(store.conversations.get(id).read, false, "A run doesn't mark the chat read");
  done(first.turnId);

  store.conversations.update(id, { read: true });
  const quiet = await harness.send(id, { text: "Check the inbox." }, { run: { text: "<scheduled-run>quiet</scheduled-run>" } });
  assert.equal(harness.quietRun(id), true);
  done(quiet.turnId);
  assert.equal(store.conversations.get(id).read, true, "Nothing to report: the chat stays read");
  assert.equal(harness.isQuietRun(quiet.turnId), true);

  const reported = await harness.send(id, { text: "Check the inbox." }, { run: { text: "<scheduled-run>news</scheduled-run>" } });
  done(reported.turnId);
  assert.equal(store.conversations.get(id).read, false, "A run with news marks the chat unread");

  await harness.send(id, { text: "Thanks" });
  assert.equal(harness.quietRun(id), false, "The user's own turn isn't a run");
});
