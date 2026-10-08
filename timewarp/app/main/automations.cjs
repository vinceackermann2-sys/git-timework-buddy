"use strict";
// Scheduled agent work. Each automation has its own chat; every run sends the
// automation's instructions there as a new message, so results and approvals
// appear like any other reply. Runs happen while Timewarp is open; a run
// missed while it was closed happens once at the next start.
const fail = (status, message) => Object.assign(new Error(message), { status });
const KINDS = new Set(["hourly", "daily", "weekdays", "weekly", "monthly", "interval", "once"]);
const TICK_MS = 30_000;
const pad = value => String(value).padStart(2, "0");

function normalizeSchedule(input, now = new Date()) {
  const kind = input?.kind;
  if (!KINDS.has(kind)) throw fail(400, "Choose when the automation runs.");
  if (kind === "hourly") {
    const minute = Number(input.minute ?? 0);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw fail(400, "Choose a minute between 0 and 59.");
    return { kind, minute };
  }
  if (kind === "interval") {
    const minutes = Number(input.minutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10080) throw fail(400, "Choose an interval between 15 minutes and 7 days.");
    return { kind, minutes };
  }
  if (kind === "once") {
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) throw fail(400, "Choose a date and time.");
    if (at <= now.getTime()) throw fail(400, "Choose a time in the future.");
    return { kind, at: new Date(at).toISOString() };
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(input.time || ""));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw fail(400, "Choose a valid time.");
  const time = pad(Number(match[1])) + ":" + match[2];
  if (kind === "weekly") {
    const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number))].filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort();
    if (!days.length) throw fail(400, "Choose at least one day.");
    return { kind, days, time };
  }
  if (kind === "monthly") {
    const day = Number(input.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw fail(400, "Choose a day of the month.");
    return { kind, day, time };
  }
  return { kind, time };
}

// The first run strictly after `after`, in local time, or null.
function nextRun(schedule, after = new Date()) {
  const from = after.getTime();
  if (schedule.kind === "once") { const at = Date.parse(schedule.at); return at > from ? new Date(at) : null; }
  if (schedule.kind === "interval") return new Date(from + schedule.minutes * 60000);
  if (schedule.kind === "hourly") {
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(schedule.minute);
    if (next.getTime() <= from) next.setHours(next.getHours() + 1);
    return next;
  }
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const start = new Date(from);
  for (let offset = 0; offset <= 400; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, hours, minutes, 0, 0);
    if (day.getTime() <= from) continue;
    if (schedule.kind === "weekdays" && (day.getDay() === 0 || day.getDay() === 6)) continue;
    if (schedule.kind === "weekly" && !schedule.days.includes(day.getDay())) continue;
    if (schedule.kind === "monthly") {
      const last = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
      if (day.getDate() !== Math.min(schedule.day, last)) continue;
    }
    return day;
  }
  return null;
}

function createAutomations({ store, harness, userId, notify = () => {}, log = () => {}, clock = () => new Date() }) {
  let timer = null, ticking = false;
  const owner = () => { const id = userId(); if (!id) throw fail(401, "Sign in to Timewarp."); return id; };
  const owned = id => {
    const automation = store.automations.get(id);
    if (!automation || automation.ownerId !== owner()) throw fail(404, "This automation is unavailable.");
    return automation;
  };
  const changed = id => notify("automations.changed", { id });
  const view = automation => {
    const [last] = store.automations.runs.list(automation.id, 1);
    return { ...automation, lastRun: last || null };
  };

  function fields(input, current = {}) {
    const name = String(input.name ?? current.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) throw fail(400, "Give the automation a name of up to 80 characters.");
    const instructions = String(input.instructions ?? current.instructions ?? "").trim();
    if (!instructions || instructions.length > 20000) throw fail(400, "Write what the agent should do (up to 20,000 characters).");
    const agentId = input.agentId ?? current.agentId;
    harness.agents.get(agentId);
    const schedule = input.schedule ? normalizeSchedule(input.schedule, clock()) : current.schedule;
    if (!schedule) throw fail(400, "Choose when the automation runs.");
    const enabled = input.enabled === undefined ? current.enabled ?? true : !!input.enabled;
    return { name, instructions, agentId, schedule, enabled };
  }

  async function run(automation, trigger) {
    let conversation = automation.conversationId ? store.conversations.get(automation.conversationId) : null;
    if (!conversation || conversation.agentId !== automation.agentId || conversation.ownerId !== automation.ownerId) {
      conversation = harness.conversations.create({ agentId: automation.agentId, title: automation.name });
      store.automations.update(automation.id, { conversationId: conversation.id });
    } else if (conversation.archivedAt) store.conversations.update(conversation.id, { archivedAt: null });
    const record = store.automations.runs.create({ automationId: automation.id, conversationId: conversation.id, trigger, status: "running" });
    try {
      const result = await harness.send(conversation.id, { text: automation.instructions });
      store.automations.runs.update(record.id, { turnId: result.turnId });
    } catch (error) {
      store.automations.runs.update(record.id, { status: error.status === 409 ? "skipped" : "failed", error: error.message, finishedAt: clock().toISOString() });
      log(`Automation "${automation.name}" did not start:`, error.message);
    }
    changed(automation.id);
    return store.automations.runs.list(automation.id, 1)[0];
  }

  async function tick() {
    if (ticking || !userId()) return;
    ticking = true;
    try {
      const at = clock();
      for (const automation of store.automations.due(userId(), at.toISOString())) {
        if (automation.ownerId !== userId()) continue;
        const next = nextRun(automation.schedule, at);
        store.automations.update(automation.id, { lastRunAt: at.toISOString(), nextRunAt: next ? next.toISOString() : null, enabled: automation.schedule.kind === "once" ? false : automation.enabled });
        await run(store.automations.get(automation.id), "schedule");
      }
    } catch (error) { log("Automations could not run:", error.message); }
    finally { ticking = false; }
  }

  function finish(conversationId, status, error = null, turnId = null) {
    const automation = store.automations.list(userId() || "").find(item => item.conversationId === conversationId);
    if (!automation) return;
    for (const record of store.automations.runs.list(automation.id, 5)) {
      if (record.status !== "running" || (turnId && record.turnId && record.turnId !== turnId)) continue;
      store.automations.runs.update(record.id, { status, error, finishedAt: clock().toISOString() });
      changed(automation.id);
    }
  }

  return {
    list: () => store.automations.list(owner()).map(view),
    get: id => view(owned(id)),
    runs: id => { owned(id); return store.automations.runs.list(id, 30); },
    create(input) {
      const value = fields(input);
      const conversation = harness.conversations.create({ agentId: value.agentId, title: value.name });
      const next = value.enabled ? nextRun(value.schedule, clock()) : null;
      const automation = store.automations.create({ ownerId: owner(), ...value, conversationId: conversation.id, nextRunAt: next ? next.toISOString() : null });
      changed(automation.id);
      return view(automation);
    },
    update(id, input) {
      const current = owned(id), value = fields(input, current);
      const reschedule = input.schedule !== undefined || input.enabled !== undefined;
      const next = value.enabled ? (reschedule || !current.nextRunAt ? nextRun(value.schedule, clock()) : new Date(current.nextRunAt)) : null;
      const automation = store.automations.update(id, { ...value, nextRunAt: next ? next.toISOString() : null });
      changed(id);
      return view(automation);
    },
    remove(id) { owned(id); store.automations.remove(id); changed(id); return { removed: true }; },
    runNow: id => run(owned(id), "manual"),
    // Follows chat events to record how each run ended.
    observe(name, payload) {
      if (name !== "conversation.event" || payload?.params?.subAgent || !userId()) return;
      if (payload.method === "turn/completed") {
        const turn = payload.params.turn || {};
        const status = turn.status === "completed" ? "completed" : turn.status === "interrupted" ? "stopped" : "failed";
        finish(payload.conversationId, status, turn.error?.message || null, turn.id || null);
      } else if (payload.method === "turn/aborted") finish(payload.conversationId, "failed", payload.params.reason || "The run stopped.");
    },
    start() {
      // Runs that were still going when Timewarp closed did not finish.
      store.db.prepare("update automation_runs set status = 'stopped', finished_at = ? where status = 'running'").run(clock().toISOString());
      timer = setInterval(() => void tick(), TICK_MS);
      timer.unref?.();
      setTimeout(() => void tick(), 5000).unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    tick,
  };
}

module.exports = { createAutomations, normalizeSchedule, nextRun };
