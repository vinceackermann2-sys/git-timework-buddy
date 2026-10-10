import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, GitBranch } from "lucide-react";
import { call, request, useEvent } from "../api.js";
import { threadEntries, threadState, toolRow, workerState } from "../turns.mjs";

// The previous app's task panel: run limits and stop reasons, tool and token
// counts, and the subagents an agent started, each of which can be followed.
const LABELS = { running: "Working", paused: "Needs input", interrupted: "Stopped", failed: "Failed", completed: "Finished" };
const nameOf = (path, fallback) => String(path || "").split("/").filter(Boolean).pop() || fallback || null;
const short = (text, length = 140) => { const value = String(text || "").replace(/\s+/g, " ").trim(); return value.length > length ? value.slice(0, length - 1) + "…" : value; };

// Workers announced on the main thread: spawn calls and their activity.
export function workersFrom(turns, live) {
  const workers = new Map();
  const upsert = (threadId, patch) => workers.set(threadId, { threadId, ...workers.get(threadId), ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value != null)) });
  for (const turn of turns) for (const item of turn.items || []) {
    if (item.type === "collabAgentToolCall") {
      for (const threadId of item.receiverThreadIds || []) {
        const state = item.agentsStates?.[threadId];
        upsert(threadId, { task: item.tool === "spawnAgent" ? item.prompt : undefined, status: state?.status, detail: state?.message });
      }
    }
    if (item.type === "subAgentActivity" && item.agentThreadId) {
      upsert(item.agentThreadId, { name: nameOf(item.agentPath), status: item.kind === "started" || item.kind === "interacted" ? "running" : item.kind });
    }
  }
  for (const [threadId, value] of live) upsert(threadId, value);
  return [...workers.values()];
}

// Live worker events (their own threads) reduced to name, state and the
// latest note, result or tool.
export function liveWorker(current = {}, method, params) {
  if (method === "thread/started") return { ...current, name: params.thread?.agentNickname || params.thread?.name || nameOf(params.thread?.agentRole, current.name) };
  if (method === "thread/status/changed") {
    const status = params.status || {};
    if (status.type === "systemError") return { ...current, status: "failed" };
    if (status.type !== "active") return current;
    const flags = status.activeFlags || [];
    return { ...current, status: flags.length ? "paused" : "running", reason: flags.length ? (flags.includes("waitingOnApproval") ? "Waiting for approval" : "Waiting for input") : null };
  }
  if (method === "turn/started") return { ...current, status: "running", reason: null };
  if (method === "turn/completed") return { ...current, status: params.turn?.status === "failed" ? "failed" : params.turn?.status === "interrupted" ? "interrupted" : "completed", error: params.turn?.error?.message || null, reason: null };
  if (method === "item/started") {
    const row = toolRow(params.item);
    if (row) return { ...current, detail: row.title || row.detail };
  }
  if (method === "item/completed" && params.item?.type === "agentMessage" && params.item.text) return { ...current, detail: short(params.item.text) };
  return current;
}

// A worker's own transcript reduced to its name, state and latest step.
export function workerSnapshot(value) {
  const turns = value?.turns || [];
  const state = threadState(turns, value?.status);
  const latest = threadEntries(turns, { worker: true }).reverse().find(entry => entry.kind !== "input");
  const snapshot = {
    name: value?.name, reason: state.reason, error: state.status === "failed" ? state.error.message : null,
    status: !turns.length ? "starting" : state.status,
    detail: latest ? (latest.text ? short(latest.text) : latest.tool.title || latest.tool.detail) : null,
  };
  return Object.fromEntries(Object.entries(snapshot).filter(([, entry]) => entry != null));
}
const working = status => ["running", "paused", "starting"].includes(workerState(status));

// The chat's subagents, from its turns and their live events. Codex doesn't
// always send a worker's own events, so working subagents are also read
// again every few seconds for their name, state and latest step.
export function useWorkers(conversationId, turns) {
  const [live, setLive] = useState(() => new Map());
  const snapshots = useRef(new Map());
  const [version, setVersion] = useState(0);
  useEffect(() => { setLive(new Map()); snapshots.current = new Map(); }, [conversationId]);
  useEvent("conversation.event", ({ conversationId: id, method, params }) => {
    if (id !== conversationId || !params?.subAgent || !params.threadId && !params.thread?.id) return;
    const threadId = params.threadId || params.thread.id;
    setLive(current => { const next = new Map(current); next.set(threadId, liveWorker(current.get(threadId), method, params)); return next; });
  });
  const announced = useMemo(() => workersFrom(turns, live), [turns, live]);
  const key = announced.map(worker => worker.threadId + ":" + worker.status).join(" ");
  useEffect(() => {
    let alive = true, timer = null;
    const poll = async () => {
      // Read each subagent once, again when the chat reports a change, and
      // every few seconds while both say it's working. A new worker's thread
      // can take a moment to exist; a few misses are tried again.
      const due = announced.filter(worker => {
        const seen = snapshots.current.get(worker.threadId);
        return !seen || seen.announced !== worker.status || (seen.misses ? seen.misses < 5 : working(worker.status) && working(seen.value.status));
      });
      for (const worker of due) {
        const value = await call("conversations.worker", { id: conversationId, threadId: worker.threadId }).catch(() => null);
        if (!alive) return;
        const seen = snapshots.current.get(worker.threadId);
        snapshots.current.set(worker.threadId, value ? { announced: worker.status, value: workerSnapshot(value) }
          : { announced: worker.status, value: seen?.value || {}, misses: (seen?.announced === worker.status ? seen.misses || 0 : 0) + 1 });
      }
      if (!due.length) return;
      setVersion(current => current + 1);
      timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [conversationId, key]);
  return useMemo(() => announced.map(worker => ({ ...worker, ...snapshots.current.get(worker.threadId)?.value })), [announced, version]);
}

function detailOf(worker) {
  const state = workerState(worker.status);
  // A failed spawn's state message is its error.
  if (state === "failed") return worker.error || (worker.status === "errored" ? worker.detail : null) || "Open worker for error details";
  if (state === "paused") return worker.reason || "Waiting for input";
  return short(worker.detail || worker.task) || "Open to follow its steps and results";
}

export function TaskActivity({ conversationId, workers, onOpenThread }) {
  const [runs, setRuns] = useState([]);
  const [expanded, setExpanded] = useState(true);
  // While Codex restarts, as when the previous app lost its activity feed.
  const [offline, setOffline] = useState(false);
  const refresh = () => request("executionStatus", { conversationId }).then(value => setRuns(Array.isArray(value) ? value : [])).catch(() => {});
  useEffect(() => { setRuns([]); void refresh(); }, [conversationId]);
  useEvent("execution.changed", () => void refresh());
  useEvent("codex.status", ({ status }) => setOffline(status !== "ready" && status !== "starting"));
  if (!workers.length && !runs.some(run => run.toolCalls || run.reason)) return null;
  const states = workers.map(worker => workerState(worker.status));
  const count = state => states.filter(value => value === state).length;
  const sum = key => runs.reduce((total, run) => total + (run[key] || 0), 0);
  // "1 tool call", "2 tool calls".
  const counted = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const summary = offline ? "Reconnecting to activity…"
    : runs.some(run => run.stopped) ? (count("running") ? "Stopping…" : "Stopped")
      : count("running") ? `${count("running")} working` : count("paused") ? "Needs input" : count("failed") ? `${count("failed")} failed`
        : count("interrupted") ? "Stopped" : states.every(state => state === "completed") ? "Finished" : "Starting";
  return (
    <section className="tw-task" aria-label="Task and subagent activity">
      <button type="button" className="tw-task-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <GitBranch size={16} />
        <strong>{workers.length ? `Subagents (${workers.length})` : "Task activity"}</strong>
        <span role="status">{workers.length ? summary : counted(sum("toolCalls"), "tool call")}</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded ? (
        <div className="tw-task-body">
          {runs.filter(run => run.reason).map(run => <p key={run.id} className="tw-task-limit" role="alert">{run.reason}</p>)}
          {runs.length ? <p className="tw-task-note">{counted(sum("toolCalls"), "tool call")} · {counted(sum("failures"), "error")} · {sum("inputTokens").toLocaleString()} input tokens ({sum("cachedTokens").toLocaleString()} cached). {runs.some(run => run.usagePartial) ? "Partial usage for this session." : "Current session."}</p> : null}
          {workers.map((worker, index) => (
            <button key={worker.threadId} type="button" className="tw-task-worker" data-status={states[index]} aria-label={"Follow " + (worker.name || "Subagent")} onClick={event => onOpenThread(worker.threadId, event.currentTarget)}>
              <i aria-hidden="true" />
              <span><strong>{worker.name || "Subagent"}</strong><small>{detailOf(worker)}</small></span>
              <em>{offline ? "Disconnected" : LABELS[states[index]] || "Starting"}</em>
              <ChevronRight size={15} />
            </button>
          ))}
          {workers.length ? <p className="tw-task-note">Follow a worker to see its tools and results. Finished means its run ended; the main agent verifies the task outcome.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
