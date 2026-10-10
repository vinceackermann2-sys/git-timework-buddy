"use strict";
// Scheduled agent work. Every run sends the automation's instructions to its
// chat: the chat an agent created it from, or a chat of its own when it was
// made on the agent page. Results and approvals appear like any other reply.
// Runs happen while Timewarp is open; a run missed while it was closed happens
// once at the next start. A run that can't start (the chat is still replying,
// Codex isn't ready) is tried again every minute until the next one is due.
const fail = (status, message) => Object.assign(new Error(message), { status });
const KINDS = new Set(["hourly", "daily", "weekdays", "weekly", "monthly", "interval", "once"]);
const TICK_MS = 30_000, RETRY_MS = 60_000, HOUR_MS = 3_600_000, DAY_MS = 86_400_000;
const MAX_COUNT = 1000;
const pad = value => String(value).padStart(2, "0");

// Wall-clock schedules run in a time zone: the one they were made in (an IANA
// name such as Europe/Stockholm), or this computer's for schedules without one.
const systemZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
function validZone(zone) {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}
const formats = new Map();
// The date and time on a clock in `zone` (null: this computer's) at an instant.
function wall(ms, zone) {
  if (!zone) { const d = new Date(ms); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }; }
  let format = formats.get(zone);
  if (!format) formats.set(zone, format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
  const parts = {};
  for (const { type, value } of format.formatToParts(new Date(ms))) if (type !== "literal") parts[type] = Number(value);
  return parts;
}
// The instant a clock in `zone` shows a date and time. A time skipped when the
// clocks go forward moves later by the gap; a time shown twice is the first.
function instant(zone, year, month, day, hour, minute) {
  if (!zone) return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
  const guess = Date.UTC(year, month - 1, day, hour, minute), wanted = new Date(guess);
  const offset = at => { const p = wall(at, zone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at; };
  const before = offset(guess - DAY_MS), after = offset(guess + DAY_MS);
  for (const at of [guess - before, guess - after].sort((a, b) => a - b)) {
    const p = wall(at, zone);
    if (p.day === wanted.getUTCDate() && p.hour === wanted.getUTCHours() && p.minute === wanted.getUTCMinutes()) return at;
  }
  return guess - before;
}
// The calendar date `offset` days after a date, with its weekday (0 = Sunday).
function addDays(date, offset) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

// The first time the schedule's rule matches strictly after `from` (ms), ignoring its limits.
function occurrence(schedule, from) {
  const zone = schedule.tz || null;
  if (schedule.kind === "once") { const at = Date.parse(schedule.at); return at > from ? at : null; }
  if (schedule.kind === "interval") {
    // An interval with a start (such as an imported rule) keeps to it; others count from the last run.
    const step = schedule.minutes * 60000, start = Date.parse(schedule.start);
    if (!Number.isFinite(start)) return from + step;
    return from < start ? start : start + (Math.floor((from - start) / step) + 1) * step;
  }
  if (schedule.kind === "hourly") {
    // Whole hours later, so the hour repeated when the clocks go back runs too.
    const minute = from - (((from % 60000) + 60000) % 60000);
    let next = minute + ((schedule.minute - wall(minute, zone).minute + 60) % 60) * 60000;
    if (next <= from) next += HOUR_MS;
    return next;
  }
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const today = wall(from, zone);
  for (let offset = 0; offset <= 400; offset++) {
    const day = addDays(today, offset);
    if (schedule.kind === "weekdays" && (day.weekday === 0 || day.weekday === 6)) continue;
    if (schedule.kind === "weekly" && !schedule.days.includes(day.weekday)) continue;
    if (schedule.kind === "monthly" && day.day !== Math.min(schedule.day, new Date(Date.UTC(day.year, day.month, 0)).getUTCDate())) continue;
    const at = instant(zone, day.year, day.month, day.day, hours, minutes);
    if (at > from) return at;
  }
  return null;
}

// The last run a schedule with a count allows: its count-th run from its start.
const lasts = new Map();
function lastRun(schedule) {
  const key = JSON.stringify(schedule);
  if (lasts.has(key)) return lasts.get(key);
  let at = Date.parse(schedule.start);
  if (!Number.isFinite(at)) return Infinity;
  at -= 1;
  for (let index = 0; index < schedule.count; index++) {
    const next = occurrence(schedule, at);
    if (next === null) { at = Infinity; break; }
    at = next;
  }
  if (lasts.size > 200) lasts.clear();
  lasts.set(key, at);
  return at;
}

// An end given as a date lasts to the end of that day.
function untilOf(value, zone) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (date && +date[2] >= 1 && +date[2] <= 12 && +date[3] >= 1 && +date[3] <= 31) {
    const next = addDays({ year: +date[1], month: +date[2], day: +date[3] }, 1);
    return new Date(instant(zone, next.year, next.month, next.day, 0, 0) - 1).toISOString();
  }
  const at = date ? NaN : Date.parse(value);
  if (!Number.isFinite(at)) throw fail(400, "Choose a valid end date.");
  return new Date(at).toISOString();
}

// Optional parts of repeating schedules: tz (an IANA time zone, defaulting to
// this computer's), start (no run before it), until (no run after it) and
// count (at most this many runs from the start, which is the first run unless given).
function withLimits(schedule, input, now) {
  if (schedule.kind === "once") return schedule;
  const out = { ...schedule };
  if (schedule.kind !== "interval") {
    const tz = input.tz ?? null;
    if (tz !== null && !validZone(tz)) throw fail(400, "Choose a valid time zone, such as Europe/Stockholm.");
    const zone = tz || systemZone();
    if (zone) out.tz = zone;
  }
  if (input.start != null && input.start !== "") {
    const start = Date.parse(input.start);
    if (!Number.isFinite(start)) throw fail(400, "Choose a valid start time.");
    out.start = new Date(start).toISOString();
  }
  if (input.until != null && input.until !== "") out.until = untilOf(input.until, out.tz || null);
  // count 0 (or "") removes a count, as null does.
  if (input.count != null && input.count !== "" && Number(input.count) !== 0) {
    const count = Number(input.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw fail(400, "Choose a number of runs between 1 and 1,000.");
    out.count = count;
    if (!out.start) out.start = new Date(occurrence(out, now.getTime()) ?? now.getTime()).toISOString();
  }
  return out;
}

function normalizeSchedule(input, now = new Date()) {
  return withLimits(ruleOf(input, now), input, now);
}

function ruleOf(input, now) {
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

// The first run strictly after `after`, within the schedule's start, end and
// count, or null when there is none.
function nextRun(schedule, after = new Date()) {
  let from = after.getTime();
  const start = Date.parse(schedule.start);
  if (Number.isFinite(start) && from < start && schedule.kind !== "interval") from = start - 1;
  const at = occurrence(schedule, from);
  if (at === null) return null;
  if (schedule.until && at > Date.parse(schedule.until)) return null;
  if (schedule.count && at > lastRun(schedule)) return null;
  return new Date(at);
}

// The latest run time that is due by `now`, starting from a due one: of the
// runs missed while Timewarp was closed, only the latest happens.
function latestDue(schedule, due, now) {
  let at = due;
  for (let guard = 0; guard < 50000; guard++) {
    const next = nextRun(schedule, new Date(at));
    if (!next || next.getTime() > now) break;
    at = next.getTime();
  }
  return at;
}

// The previous app's triggers (JSON: { type: "date", date } and { type: "rrule",
// rrule: "DTSTART…\nRRULE:…" }, plus Slack events, which Timewarp doesn't have)
// as one schedule. exact is false when the schedule only comes close; such
// automations come over paused.
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const RULE_PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYHOUR", "BYMINUTE", "BYSECOND", "COUNT", "UNTIL", "WKST"]);
function legacySchedule(raw) {
  let triggers = null;
  try { triggers = typeof raw === "string" ? JSON.parse(raw || "[]") : raw; } catch {}
  const all = Array.isArray(triggers) ? triggers : [];
  const timed = all.filter(item => item?.type === "date" || item?.type === "rrule");
  const mapped = timed.map(item => item.type === "date" ? fromDate(item.date) : fromRule(item.rrule)).filter(Boolean);
  if (!mapped.length) return { schedule: withLimits({ kind: "daily", time: "09:00" }, {}, new Date()), exact: false };
  return { schedule: mapped[0].schedule, exact: mapped[0].exact && mapped.length === all.length && all.length === 1 };
}
function fromDate(value) {
  const at = Date.parse(value);
  return Number.isFinite(at) ? { schedule: { kind: "once", at: new Date(at).toISOString() }, exact: true } : null;
}
function fromRule(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const rule = lines.find(line => /^RRULE:/i.test(line)), dtstart = lines.find(line => /^DTSTART[;:]/i.test(line));
  if (!rule) return null;
  // Without DTSTART the previous app counted from 1970-01-01 00:00 UTC.
  let zone = "UTC", start = { year: 1970, month: 1, day: 1, hour: 0, minute: 0 }, explicit = false;
  if (dtstart) {
    const match = /^DTSTART(?:;TZID=([^:;]+))?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(dtstart);
    if (!match || (match[1] ? !validZone(match[1]) : !match[8])) return null;
    zone = match[1] || "UTC";
    start = { year: +match[2], month: +match[3], day: +match[4], hour: +match[5], minute: +match[6] };
    explicit = true;
  }
  const parts = {};
  for (const item of rule.slice(rule.indexOf(":") + 1).split(";")) {
    const [key, value = ""] = item.split("=");
    if (key) parts[key.trim().toUpperCase()] = value.trim().toUpperCase();
  }
  const list = key => parts[key] ? parts[key].split(",").filter(Boolean) : [];
  const numbers = key => list(key).map(Number);
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  let exact = Number.isInteger(interval) && interval >= 1 && Object.keys(parts).every(key => RULE_PARTS.has(key)) && numbers("BYSECOND").every(second => second === 0);
  const hours = numbers("BYHOUR"), minutes = numbers("BYMINUTE"), monthDays = numbers("BYMONTHDAY");
  if (hours.length > 1 || minutes.length > 1) exact = false;
  const hour = hours.length ? hours[0] : start.hour, minute = minutes.length ? minutes[0] : start.minute;
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) return null;
  const time = pad(hour) + ":" + pad(minute);
  const days = list("BYDAY").map(token => /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token));
  if (days.some(day => !day)) return null;
  const ordinal = days.some(day => day[1]);
  const weekdays = [...new Set(days.map(day => WEEKDAYS.indexOf(day[2])))].sort();
  const startDay = new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay();
  const at = (h, m) => new Date(instant(zone, start.year, start.month, start.day, h, m)).toISOString();
  let schedule;
  switch (parts.FREQ) {
    case "MINUTELY": case "HOURLY": {
      if (parts.FREQ === "HOURLY" && interval === 1 && !hours.length && !days.length && !monthDays.length) { schedule = { kind: "hourly", minute, tz: zone }; break; }
      const step = interval * (parts.FREQ === "HOURLY" ? 60 : 1), minutesBetween = Math.min(10080, Math.max(15, step || 60));
      if (minutesBetween !== step || hours.length || days.length || monthDays.length || (parts.FREQ === "MINUTELY" && minutes.length)) exact = false;
      schedule = { kind: "interval", minutes: minutesBetween, start: at(start.hour, parts.FREQ === "HOURLY" ? minute : start.minute) };
      break;
    }
    case "DAILY": case "WEEKLY": {
      if (monthDays.length || ordinal) exact = false;
      const chosen = weekdays.length ? weekdays : parts.FREQ === "WEEKLY" ? [startDay] : [];
      if (interval !== 1) {
        exact = false;
        // Every few days becomes an interval from the first run; the clock change shifts it by an hour.
        if (parts.FREQ === "DAILY" && !chosen.length && interval <= 7) { schedule = { kind: "interval", minutes: interval * 1440, start: at(hour, minute) }; break; }
      }
      schedule = !chosen.length || chosen.length === 7 ? { kind: "daily", time, tz: zone }
        : chosen.join() === "1,2,3,4,5" ? { kind: "weekdays", time, tz: zone }
        : { kind: "weekly", days: chosen, time, tz: zone };
      break;
    }
    case "MONTHLY": {
      // Day -1 is the month's last day, as day 31 is here. Days 29 to 31 run on a
      // shorter month's last day here, where the previous app skipped those months.
      let day = monthDays.length ? monthDays[0] : start.day;
      if (day === -1) day = 31;
      else if (!(day >= 1 && day <= 28)) exact = false;
      if (days.length || interval !== 1 || monthDays.length > 1) exact = false;
      schedule = { kind: "monthly", day: Math.min(31, Math.max(1, Math.abs(day) || 1)), time, tz: zone };
      break;
    }
    default: return { schedule: { kind: "daily", time, tz: zone }, exact: false };
  }
  if (explicit && !schedule.start) schedule.start = at(start.hour, start.minute);
  if (parts.COUNT) {
    const count = Number(parts.COUNT);
    if (!Number.isInteger(count) || count < 1) exact = false;
    else {
      if (count > MAX_COUNT) exact = false;
      schedule.count = Math.min(count, MAX_COUNT);
      schedule.start ||= at(start.hour, start.minute);
    }
  }
  if (parts.UNTIL) {
    const until = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(parts.UNTIL);
    if (until) schedule.until = new Date(until[4] ? Date.UTC(+until[1], +until[2] - 1, +until[3], +until[4], +until[5], +until[6]) : Date.UTC(+until[1], +until[2] - 1, +until[3] + 1) - 1).toISOString();
    else exact = false;
  }
  return { schedule, exact };
}

// What the agent receives for a run: the instructions, with a note that
// Timewarp started the turn and when it was due, so that a scheduled run tells
// the user only what's worth telling. The chat keeps the plain instructions.
const attribute = value => String(value).replace(/[&"<>]/g, char => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]);
function runInput(automation, trigger, scheduledFor) {
  const at = new Date(scheduledFor);
  let when;
  try { when = at.toLocaleString("en-US", { timeZone: automation.schedule?.tz || undefined, dateStyle: "full", timeStyle: "short" }); }
  catch { when = at.toLocaleString("en-US"); }
  const instructions = String(automation.instructions).replace(/<(\/?)scheduled-run/gi, "&lt;$1scheduled-run");
  const note = trigger === "manual"
    ? `The user started this run of your automation "${automation.name}" with Run now. Do the work below and tell them what you found.`
    : `Timewarp started this turn because your automation "${automation.name}" was due ${when}. The user didn't write this message and may not be looking at the chat.\n`
      + "Do the work below. Then reply only if something is new, something needs the user, or the instructions ask for a report every time. "
      + "If there's nothing worth telling the user, call the nothing_to_report tool (Timewarp automations) and end with one short line: the chat isn't marked unread and no notification is shown.";
  return `<scheduled-run automation="${attribute(automation.name)}" trigger="${trigger}" scheduled-for="${at.toISOString()}">\n${note}\n\nInstructions:\n${instructions}\n</scheduled-run>`;
}

function createAutomations({ store, harness, userId, notify = () => {}, log = () => {}, clock = () => new Date() }) {
  let timer = null, ticking = false;
  // Scheduled runs that couldn't start yet, by automation id: { occurrence (ISO), retryAt, error, busy, conversationId }.
  const waiting = new Map();
  // Manual runs waiting for their chat to finish a reply, by automation id: { recordId, retryAt, conversationId }.
  const queued = new Map();
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
  const limits = schedule => Object.fromEntries(["tz", "start", "until", "count"].filter(key => schedule?.[key] !== undefined).map(key => [key, schedule[key]]));

  function fields(input, current = null) {
    const name = String(input.name ?? current?.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) throw fail(400, "Give the automation a name of up to 80 characters.");
    const instructions = String(input.instructions ?? current?.instructions ?? "").trim();
    if (!instructions || instructions.length > 20000) throw fail(400, "Write what the agent should do (up to 20,000 characters).");
    const agentId = input.agentId ?? current?.agentId;
    // The agent is checked when it's chosen, so an automation whose agent was
    // archived can still be renamed, turned off or deleted.
    if (!current || agentId !== current.agentId) harness.agents.get(agentId);
    // A new schedule keeps the time zone, start, end and count it had unless they're given (null clears them).
    const schedule = input.schedule ? normalizeSchedule(current ? { ...limits(current.schedule), ...input.schedule } : input.schedule, clock()) : current?.schedule;
    if (!schedule) throw fail(400, "Choose when the automation runs.");
    const enabled = input.enabled === undefined ? current?.enabled ?? true : !!input.enabled;
    return { name, instructions, agentId, schedule, enabled };
  }

  function chatFor(automation) {
    let conversation = automation.conversationId ? store.conversations.get(automation.conversationId) : null;
    if (!conversation || conversation.agentId !== automation.agentId || conversation.ownerId !== automation.ownerId) {
      conversation = harness.conversations.create({ agentId: automation.agentId, title: automation.name });
      store.automations.update(automation.id, { conversationId: conversation.id });
    } else if (conversation.archivedAt) store.conversations.update(conversation.id, { archivedAt: null });
    return conversation;
  }

  // Starts a run in the automation's chat and records it. When it can't start
  // (409: the chat is still replying) it throws and leaves no record, or puts a
  // queued manual run (recordId) back in the queue.
  async function begin(automation, trigger, scheduledFor, recordId = null) {
    const conversation = chatFor(automation);
    const record = (recordId && store.automations.runs.update(recordId, { status: "running" }))
      || store.automations.runs.create({ automationId: automation.id, conversationId: conversation.id, trigger, status: "running" });
    try {
      const result = await harness.send(conversation.id, { text: automation.instructions }, { run: { text: runInput(automation, trigger, scheduledFor) } });
      store.automations.runs.update(record.id, { turnId: result.turnId });
    } catch (error) {
      if (recordId) store.automations.runs.update(record.id, { status: "queued" });
      else store.automations.runs.remove(record.id);
      throw error;
    }
    changed(automation.id);
    return store.automations.runs.get(record.id);
  }

  // Moves on to the next run once this one started (or was passed over),
  // unless the automation was changed meanwhile. Re-read, so a change made
  // during the run (such as turning it off) stays.
  function advance(id, occurrence, ran) {
    const fresh = store.automations.get(id);
    if (!fresh) return;
    const patch = ran ? { lastRunAt: clock().toISOString() } : {};
    if (fresh.nextRunAt === occurrence) {
      const next = fresh.enabled ? nextRun(fresh.schedule, clock()) : null;
      patch.nextRunAt = next ? next.toISOString() : null;
      if (ran && fresh.schedule.kind === "once") patch.enabled = false;
    }
    store.automations.update(id, patch);
    changed(id);
  }

  // A scheduled run that never started, recorded once the next one is due.
  function passedOver(automation, pending, now) {
    store.automations.runs.create({
      automationId: automation.id, conversationId: pending.conversationId, trigger: "schedule", status: pending.busy ? "skipped" : "failed",
      error: pending.busy ? null : pending.error, startedAt: pending.occurrence, finishedAt: new Date(now).toISOString(),
    });
    changed(automation.id);
  }

  async function attempt(id, now) {
    let automation = store.automations.get(id);
    if (!automation?.enabled || automation.ownerId !== userId() || !automation.nextRunAt || Date.parse(automation.nextRunAt) > now) return;
    const occurrence = new Date(latestDue(automation.schedule, Date.parse(automation.nextRunAt), now)).toISOString();
    const pending = waiting.get(id);
    if (pending && pending.occurrence !== occurrence) { passedOver(automation, pending, now); waiting.delete(id); }
    else if (pending && pending.retryAt > now) return;
    if (occurrence !== automation.nextRunAt) automation = store.automations.update(id, { nextRunAt: occurrence });
    // An archived agent's automations pass their runs over quietly.
    const agent = store.agents.get(automation.agentId);
    if (!agent || agent.archivedAt) { advance(id, occurrence, false); return; }
    try {
      await begin(automation, "schedule", occurrence);
      waiting.delete(id);
      advance(id, occurrence, true);
    } catch (error) {
      waiting.set(id, { occurrence, retryAt: now + RETRY_MS, error: error.message, busy: error.status === 409, conversationId: store.automations.get(id)?.conversationId || automation.conversationId });
      log(`Automation "${automation.name}" didn't start; trying again in a minute:`, error.message);
    }
  }

  async function retryQueued(now) {
    for (const [id, entry] of [...queued]) {
      if (entry.retryAt > now) continue;
      const automation = store.automations.get(id);
      if (!automation || automation.ownerId !== userId()) {
        queued.delete(id);
        store.automations.runs.update(entry.recordId, { status: "stopped", finishedAt: clock().toISOString() });
        continue;
      }
      try { await begin(automation, "manual", clock().toISOString(), entry.recordId); queued.delete(id); }
      catch (error) {
        if (error.status === 409) { entry.retryAt = now + RETRY_MS; continue; }
        queued.delete(id);
        store.automations.runs.update(entry.recordId, { status: "failed", error: error.message, finishedAt: clock().toISOString() });
        changed(id);
      }
    }
  }

  async function tick() {
    if (ticking || !userId()) return;
    ticking = true;
    try {
      const now = clock().getTime();
      for (const { id } of store.automations.due(userId(), new Date(now).toISOString())) {
        try { await attempt(id, now); } catch (error) { log("An automation could not run:", error.message); }
      }
      await retryQueued(now);
    } catch (error) { log("Automations could not run:", error.message); }
    finally { ticking = false; }
  }

  // Records how a run ended. Several automations can post in one chat, and the
  // user's own turns there aren't runs: a finished turn ends the run with its id.
  function finish(conversationId, status, error = null, turnId = null) {
    for (const automation of store.automations.list(userId() || "").filter(item => item.conversationId === conversationId)) {
      for (const record of store.automations.runs.list(automation.id, 5)) {
        if (record.status !== "running" || record.conversationId !== conversationId || (turnId && record.turnId !== turnId)) continue;
        store.automations.runs.update(record.id, { status, error, finishedAt: clock().toISOString() });
        changed(automation.id);
      }
    }
  }
  // A chat that finished replying takes the runs waiting for it soon after, instead of at the next retry.
  function wake(conversationId) {
    let found = false;
    for (const entry of [...waiting.values(), ...queued.values()]) if (entry.conversationId === conversationId) { entry.retryAt = 0; found = true; }
    if (found) setTimeout(() => void tick(), 1000).unref?.();
  }

  return {
    list: () => store.automations.list(owner()).map(view),
    get: id => view(owned(id)),
    runs: id => { owned(id); return store.automations.runs.list(id, 30); },
    // conversationId: the chat an agent was asked in, where its runs post (the
    // previous app's agent tool made automations "for this conversation").
    // Without one, as from the agent page, the automation gets its own chat.
    create(input) {
      const value = fields(input);
      const chat = input.conversationId ? store.conversations.get(String(input.conversationId)) : null;
      const conversationId = chat && chat.ownerId === owner() && chat.agentId === value.agentId ? chat.id
        : harness.conversations.create({ agentId: value.agentId, title: value.name }).id;
      const next = value.enabled ? nextRun(value.schedule, clock()) : null;
      const automation = store.automations.create({ ownerId: owner(), ...value, conversationId, nextRunAt: next ? next.toISOString() : null });
      changed(automation.id);
      return view(automation);
    },
    update(id, input) {
      const current = owned(id), value = fields(input, current);
      const reschedule = input.schedule !== undefined || input.enabled !== undefined;
      if (reschedule) waiting.delete(id);
      const next = value.enabled ? (reschedule || !current.nextRunAt ? nextRun(value.schedule, clock()) : new Date(current.nextRunAt)) : null;
      const automation = store.automations.update(id, { ...value, nextRunAt: next ? next.toISOString() : null });
      changed(id);
      return view(automation);
    },
    remove(id) {
      owned(id);
      waiting.delete(id);
      if (queued.has(id)) { store.automations.runs.update(queued.get(id).recordId, { status: "stopped", finishedAt: clock().toISOString() }); queued.delete(id); }
      store.automations.remove(id);
      changed(id);
      return { removed: true };
    },
    // A manual run while the chat is replying waits for it (status "queued")
    // and starts when the reply ends.
    async runNow(id) {
      const automation = owned(id);
      harness.agents.get(automation.agentId);
      if (queued.has(id)) return store.automations.runs.get(queued.get(id).recordId);
      try { return await begin(automation, "manual", clock().toISOString()); }
      catch (error) {
        const conversationId = store.automations.get(id)?.conversationId || automation.conversationId;
        if (error.status !== 409) {
          log(`Automation "${automation.name}" did not start:`, error.message);
          const record = store.automations.runs.create({ automationId: id, conversationId, trigger: "manual", status: "failed", error: error.message, finishedAt: clock().toISOString() });
          changed(id);
          return record;
        }
        const record = store.automations.runs.create({ automationId: id, conversationId, trigger: "manual", status: "queued" });
        queued.set(id, { recordId: record.id, retryAt: clock().getTime() + RETRY_MS, conversationId });
        changed(id);
        return record;
      }
    },
    // The agent says a run turned up nothing for the user: the chat keeps its
    // read state when the turn ends. False outside a run.
    quiet: conversationId => !!harness.quietRun?.(conversationId),
    // Follows chat events to record how each run ended.
    observe(name, payload) {
      if (name !== "conversation.event" || payload?.params?.subAgent || !userId()) return;
      if (payload.method === "turn/completed") {
        const turn = payload.params.turn || {};
        const status = turn.status === "completed" ? "completed" : turn.status === "interrupted" ? "stopped" : "failed";
        finish(payload.conversationId, status, turn.error?.message || null, turn.id || null);
        wake(payload.conversationId);
      } else if (payload.method === "turn/aborted") {
        finish(payload.conversationId, "failed", payload.params.reason || "The run stopped.");
        wake(payload.conversationId);
      }
    },
    start() {
      // Runs that were going or waiting when Timewarp closed did not finish.
      store.db.prepare("update automation_runs set status = 'stopped', finished_at = ? where status in ('running', 'queued')").run(clock().toISOString());
      timer = setInterval(() => void tick(), TICK_MS);
      timer.unref?.();
      setTimeout(() => void tick(), 5000).unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    tick,
  };
}

module.exports = { createAutomations, normalizeSchedule, nextRun, legacySchedule, runInput, systemZone };
