import React, { useEffect, useState } from "react";
import { MessageSquare, Play, Plus } from "lucide-react";
import { call, relativeTime, useEvent } from "../api.js";
import { Avatar, Dialog, PageHead, Switch, useConfirm, useToast } from "./common.jsx";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KINDS = [
  { value: "daily", label: "Every day" }, { value: "weekdays", label: "Weekdays" }, { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" }, { value: "hourly", label: "Every hour" }, { value: "interval", label: "Every few minutes" }, { value: "once", label: "Once" },
];
// A queued run waits for the chat's current reply; a skipped one came while it was busy.
const STATUS = { queued: "Waiting for the chat", running: "Running", completed: "Done", failed: "Failed", skipped: "Skipped (a reply was in progress)", stopped: "Stopped" };

const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };
const dateText = value => { const at = new Date(value); return Number.isFinite(at.getTime()) ? at.toLocaleDateString([], { dateStyle: "medium" }) : String(value); };
// When it runs, with how long it goes on ("until <date>", "<n> times") and its
// time zone when that isn't this computer's.
export function describeSchedule(schedule = {}) {
  let text;
  if (schedule.kind === "daily") text = `Every day at ${schedule.time}`;
  else if (schedule.kind === "weekdays") text = `Weekdays at ${schedule.time}`;
  else if (schedule.kind === "weekly") text = `Every ${(schedule.days || []).map(day => DAYS[day]).join(", ")} at ${schedule.time}`;
  else if (schedule.kind === "monthly") text = `Monthly on day ${schedule.day} at ${schedule.time}`;
  else if (schedule.kind === "hourly") text = `Every hour at :${String(schedule.minute).padStart(2, "0")}`;
  else if (schedule.kind === "interval") text = schedule.minutes % 60 === 0 ? `Every ${schedule.minutes / 60} hour${schedule.minutes === 60 ? "" : "s"}` : `Every ${schedule.minutes} minutes`;
  else if (schedule.kind === "once") return `Once on ${new Date(schedule.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` + (schedule.tz && schedule.tz !== localZone() ? ` (${schedule.tz})` : "");
  else return "No schedule";
  if (schedule.start && Date.parse(schedule.start) > Date.now()) text += `, from ${dateText(schedule.start)}`;
  if (schedule.until) text += `, until ${dateText(schedule.until)}`;
  if (Number(schedule.count) > 0) text += `, ${schedule.count} time${Number(schedule.count) === 1 ? "" : "s"}`;
  if (schedule.tz && schedule.tz !== localZone()) text += ` (${schedule.tz})`;
  return text;
}

const localInput = date => { const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function draftOf(automation, agents) {
  const schedule = automation?.schedule || { kind: "daily", time: "09:00" };
  return {
    name: automation?.name || "", instructions: automation?.instructions || "", agentId: automation?.agentId || agents[0]?.id || "",
    kind: schedule.kind, time: schedule.time || "09:00", days: schedule.days || [1], day: schedule.day || 1, minute: schedule.minute ?? 0,
    minutes: schedule.minutes || 60, at: schedule.at ? localInput(new Date(schedule.at)) : localInput(new Date(Date.now() + 3600000)),
  };
}
function scheduleOf(draft) {
  if (draft.kind === "weekly") return { kind: "weekly", days: draft.days, time: draft.time };
  if (draft.kind === "monthly") return { kind: "monthly", day: Number(draft.day), time: draft.time };
  if (draft.kind === "hourly") return { kind: "hourly", minute: Number(draft.minute) };
  if (draft.kind === "interval") return { kind: "interval", minutes: Number(draft.minutes) };
  if (draft.kind === "once") return { kind: "once", at: new Date(draft.at).toISOString() };
  return { kind: draft.kind, time: draft.time };
}
const nextText = automation => automation.enabled ? automation.nextRunAt ? "Next run " + new Date(automation.nextRunAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "No next run" : "Paused";

// Repeat, time and days: the schedule part of a draft.
function ScheduleFields({ draft, set, disabled = false }) {
  return (
    <>
      <div className="tw-schedule">
        <label className="tw-field"><span>Repeat</span>
          <select className="tw-dropdown" value={draft.kind} disabled={disabled} onChange={event => set({ kind: event.target.value })}>{KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select>
        </label>
        {["daily", "weekdays", "weekly", "monthly"].includes(draft.kind) ? <label className="tw-field"><span>Time</span><input className="tw-input" type="time" value={draft.time} required disabled={disabled} onChange={event => set({ time: event.target.value })} /></label> : null}
        {draft.kind === "monthly" ? <label className="tw-field"><span>Day of month</span><input className="tw-input" type="number" min="1" max="31" value={draft.day} disabled={disabled} onChange={event => set({ day: event.target.value })} /></label> : null}
        {draft.kind === "hourly" ? <label className="tw-field"><span>Minute past the hour</span><input className="tw-input" type="number" min="0" max="59" value={draft.minute} disabled={disabled} onChange={event => set({ minute: event.target.value })} /></label> : null}
        {draft.kind === "interval" ? <label className="tw-field"><span>Minutes between runs</span><input className="tw-input" type="number" min="15" max="10080" step="5" value={draft.minutes} disabled={disabled} onChange={event => set({ minutes: event.target.value })} /></label> : null}
        {draft.kind === "once" ? <label className="tw-field"><span>Date and time</span><input className="tw-input" type="datetime-local" value={draft.at} required disabled={disabled} onChange={event => set({ at: event.target.value })} /></label> : null}
      </div>
      {draft.kind === "weekly" ? (
        <div className="tw-segmented" role="group" aria-label="Days">
          {DAYS.map((label, day) => <button key={day} type="button" disabled={disabled} aria-pressed={draft.days.includes(day)} onClick={() => set({ days: draft.days.includes(day) ? draft.days.filter(item => item !== day) : [...draft.days, day].sort() })}>{label}</button>)}
        </div>
      ) : null}
    </>
  );
}

function Editor({ automation, agents, onSaved, onCancel }) {
  const [draft, setDraft] = useState(() => draftOf(automation, agents));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const input = { name: draft.name, instructions: draft.instructions, agentId: draft.agentId, schedule: scheduleOf(draft) };
      const saved = automation ? await call("automations.update", { id: automation.id, ...input }) : await call("automations.create", input);
      toast(automation ? "Automation saved." : "Automation created.");
      onSaved(saved);
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  return (
    <form className="tw-card tw-automation-editor" onSubmit={save}>
      <h3>{automation ? "Edit automation" : "New automation"}</h3>
      <label className="tw-field"><span>Name</span><input className="tw-input" value={draft.name} maxLength={80} required onChange={event => set({ name: event.target.value })} placeholder="Morning briefing" /></label>
      <label className="tw-field"><span>Agent</span>
        <select className="tw-dropdown" value={draft.agentId} onChange={event => set({ agentId: event.target.value })}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
      </label>
      <label className="tw-field"><span>What should the agent do?</span>
        <textarea className="tw-input tw-notes" style={{ minHeight: 110 }} value={draft.instructions} maxLength={20000} required onChange={event => set({ instructions: event.target.value })} placeholder="Check my calendar and email, then summarize what needs my attention today." />
      </label>
      <ScheduleFields draft={draft} set={set} />
      <span className="tw-hint">Automations run while Timewarp is open. A run missed while it was closed happens when you open Timewarp.</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="tw-btn primary" disabled={busy || !draft.agentId}>{busy ? "Saving…" : automation ? "Save" : "Create"}</button>
        <button type="button" className="tw-btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Runs({ automation }) {
  const [runs, setRuns] = useState(null);
  useEffect(() => { call("automations.runs", { id: automation.id }).then(setRuns).catch(() => setRuns([])); }, [automation.id, automation.lastRun?.id, automation.lastRun?.status]);
  if (!runs) return <span className="tw-hint">Loading runs…</span>;
  if (!runs.length) return <span className="tw-hint">No runs yet.</span>;
  return (
    <div className="tw-rows">
      {runs.slice(0, 10).map(run => (
        <div key={run.id} className="tw-rows-item" style={{ padding: "6px 4px" }}>
          <span className={"tw-tag" + (run.status === "completed" ? " ok" : "")}>{STATUS[run.status] || run.status}</span>
          <span className="tw-hint" style={{ flex: 1 }}>{run.trigger === "manual" ? "Run now" : "Scheduled"} · {relativeTime(run.startedAt)}{run.error ? " · " + run.error : ""}</span>
        </div>
      ))}
    </div>
  );
}

// An automation opened from its agent's page, as in the previous app: name,
// instructions, on or off, when it runs and recent runs, with Delete, Test run
// and Save changes. Imported automations arrive paused and are turned on here.
// onRan(conversationId) follows a test run to the automation's chat.
export function AutomationDialog({ automation, onClose, onRan }) {
  return (
    <Dialog open={!!automation} onClose={onClose} title={automation?.name || "Automation"} className="tw-automation-dialog">
      {automation ? <AutomationDetails key={automation.id} automation={automation} onClose={onClose} onRan={onRan} /> : null}
    </Dialog>
  );
}

function AutomationDetails({ automation, onClose, onRan }) {
  const [draft, setDraft] = useState(() => ({ ...draftOf(automation, []), enabled: !!automation.enabled }));
  const [rescheduled, setRescheduled] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const toggled = draft.enabled !== !!automation.enabled;
  const dirty = rescheduled || toggled || draft.name !== automation.name || draft.instructions !== automation.instructions;
  const act = async work => { setBusy(true); try { await work(); } catch (error) { toast(error, "error"); } finally { setBusy(false); } };
  const save = event => {
    event.preventDefault();
    void act(async () => {
      await call("automations.update", { id: automation.id, name: draft.name.trim(), instructions: draft.instructions.trim(), ...(toggled ? { enabled: draft.enabled } : {}), ...(rescheduled ? { schedule: scheduleOf(draft) } : {}) });
      toast("Automation saved.");
      onClose();
    });
  };
  const run = () => act(async () => {
    const record = await call("automations.run", { id: automation.id });
    onClose();
    onRan?.(record?.conversationId || automation.conversationId);
  });
  const remove = async () => {
    if (!await confirm({ title: "Delete automation?", body: `"${automation.name}" stops running. Its chat stays.`, action: "Delete", danger: true })) return;
    await act(async () => { await call("automations.remove", { id: automation.id }); onClose(); });
  };
  return (
    <form className="tw-import tw-automation-form" onSubmit={save}>
      <label className="tw-field"><span>Name</span><input className="tw-input" value={draft.name} maxLength={80} required disabled={busy} onChange={event => set({ name: event.target.value })} /></label>
      <label className="tw-field"><span>Instructions</span>
        <textarea className="tw-input tw-notes" style={{ minHeight: 110 }} value={draft.instructions} maxLength={20000} required disabled={busy} onChange={event => set({ instructions: event.target.value })} />
      </label>
      <div className="tw-automation-enabled"><span>Enabled</span><Switch label="Enabled" checked={draft.enabled} disabled={busy} onChange={enabled => set({ enabled })} /></div>
      <div className="tw-field"><span className="tw-automation-when"><span>When to run</span><span className="tw-hint">{nextText(automation)}</span></span></div>
      <ScheduleFields draft={draft} set={patch => { set(patch); setRescheduled(true); }} disabled={busy} />
      <div className="tw-field"><span>Recent runs</span><Runs automation={automation} /></div>
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn ghost danger tw-push-left" disabled={busy} onClick={() => void remove()}>Delete automation</button>
        <button type="button" className="tw-btn ghost" disabled={busy || dirty} title={dirty ? "Save your changes first" : undefined} onClick={() => void run()}><Play size={14} />Test run</button>
        <button type="submit" className="tw-btn primary" disabled={busy || !dirty || !draft.name.trim() || !draft.instructions.trim()}>Save changes</button>
      </div>
    </form>
  );
}

export function Automations({ agents }) {
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const load = () => call("automations.list").then(setItems).catch(error => toast(error, "error"));
  useEffect(() => { void load(); }, []);
  useEvent("automations.changed", () => void load());
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const toggle = (automation, enabled) => call("automations.update", { id: automation.id, enabled }).then(load).catch(error => toast(error, "error"));
  const remove = async automation => {
    if (!await confirm({ title: "Delete automation?", body: `"${automation.name}" stops running. Its chat stays.`, action: "Delete", danger: true })) return;
    call("automations.remove", { id: automation.id }).then(load).catch(error => toast(error, "error"));
  };
  return (
    <div className="tw-page">
      <PageHead title="Automations" subtitle="Give an agent recurring work. Each automation has its own chat, where every run's results appear.">
        {editing ? null : <button type="button" className="tw-btn" disabled={!agents.length} onClick={() => setEditing("new")}><Plus size={15} />New automation</button>}
      </PageHead>
      {editing ? <Editor automation={editing === "new" ? null : editing} agents={agents} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
      {items === null ? <p className="tw-hint">Loading automations…</p> : null}
      {items?.length === 0 && !editing ? <div className="tw-empty-box">No automations yet.</div> : null}
      {items?.map(automation => {
        const agent = agentById.get(automation.agentId);
        return (
          <div key={automation.id} className="tw-card">
            <div className="tw-setting">
              <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                {agent ? <Avatar agent={agent} /> : null}
                <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <strong className="tw-ellipsis">{automation.name}</strong>
                  <span className="tw-hint">{describeSchedule(automation.schedule)}{agent ? " · " + agent.name : ""}</span>
                  <span className="tw-hint">{automation.enabled && automation.nextRunAt ? "Next run " + new Date(automation.nextRunAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Paused"}{automation.lastRun ? " · Last run " + (STATUS[automation.lastRun.status] || automation.lastRun.status).toLowerCase() + " " + relativeTime(automation.lastRun.startedAt) : ""}</span>
                </div>
              </div>
              <Switch label={"Run " + automation.name} checked={automation.enabled} onChange={value => toggle(automation, value)} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="tw-btn" onClick={() => call("automations.run", { id: automation.id }).then(() => { toast("Running now."); void load(); }).catch(error => toast(error, "error"))}><Play size={14} /> Run now</button>
              {automation.conversationId ? <button type="button" className="tw-btn" onClick={() => { location.hash = "#/conversation/" + automation.conversationId; }}><MessageSquare size={14} /> Open chat</button> : null}
              <button type="button" className="tw-btn" onClick={() => setEditing(automation)}>Edit</button>
              <button type="button" className="tw-btn" onClick={() => setOpen(open === automation.id ? null : automation.id)}>{open === automation.id ? "Hide runs" : "Runs"}</button>
              <button type="button" className="tw-btn danger" onClick={() => void remove(automation)}>Delete</button>
            </div>
            {open === automation.id ? <Runs automation={automation} /> : null}
          </div>
        );
      })}
    </div>
  );
}
