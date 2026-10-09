import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, GitBranch } from "lucide-react";
import { call, request, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { blocksOf } from "../turns.mjs";
import { ActivityGroup } from "./Activity.jsx";
import { Dialog } from "./common.jsx";

// The previous app's task panel: run limits and stop reasons, tool and token
// counts, and the workers an agent started, each of which can be followed.
const LABELS = { running: "Working", pendingInit: "Starting", completed: "Finished", errored: "Failed", failed: "Failed", interrupted: "Stopped", shutdown: "Finished", notFound: "Unavailable", paused: "Needs input" };
const nameOf = (path, fallback) => String(path || "").split("/").filter(Boolean).pop() || fallback || "Worker";
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

// Live worker events (their own threads) reduced to name, status and step.
export function liveWorker(current = {}, method, params) {
  if (method === "thread/started") return { ...current, name: params.thread?.agentNickname || params.thread?.name || nameOf(params.thread?.agentRole, current.name) };
  if (method === "turn/started") return { ...current, status: "running" };
  if (method === "turn/completed") return { ...current, status: params.turn?.status === "failed" ? "failed" : params.turn?.status === "interrupted" ? "interrupted" : "completed", detail: params.turn?.error?.message || current.detail };
  if (method === "item/started") {
    const item = params.item || {};
    if (item.type === "commandExecution") return { ...current, detail: "Running " + short(item.command, 80) };
    if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") return { ...current, detail: "Using " + (item.tool || "a tool") };
    if (item.type === "webSearch") return { ...current, detail: "Searching the web" };
  }
  if (method === "item/completed" && params.item?.type === "agentMessage" && params.item.text) return { ...current, detail: short(params.item.text) };
  return current;
}

function WorkerDialog({ conversationId, worker, onClose }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!worker) return;
    setState(null);
    call("conversations.worker", { id: conversationId, threadId: worker.threadId }).then(setState).catch(error => setState({ error: error.message }));
  }, [worker?.threadId]);
  return (
    <Dialog open={!!worker} onClose={onClose} title={state?.name || worker?.name || "Worker"} description={worker?.task ? short(worker.task, 300) : LABELS[worker?.status] || null}>
      <div className="tw-worker-thread">
        {state === null ? <p className="tw-hint">Loading the worker's activity…</p> : state.error ? <p className="tw-alert">{state.error}</p> : state.turns.length ? state.turns.map(turn => (
          <div key={turn.id} className="tw-agent-stack">
            {blocksOf(turn).map(block => block.kind === "activity" ? <ActivityGroup key={block.key} items={block.items} live={turn.status === "inProgress"} />
              : block.kind === "agent" ? <div key={block.key} className="tw-bubble"><Markdown text={block.item.text} /></div>
                : <div key={block.key} className="tw-user-message">{(block.item.content || []).map(part => part.text).filter(Boolean).join("\n")}</div>)}
            {turn.error ? <div className="tw-turn-error">{turn.error.message}</div> : null}
          </div>
        )) : <p className="tw-hint">This worker hasn't recorded any steps yet.</p>}
      </div>
    </Dialog>
  );
}

export function TaskActivity({ conversationId, turns }) {
  const [runs, setRuns] = useState([]);
  const [live, setLive] = useState(() => new Map());
  const [expanded, setExpanded] = useState(true);
  const [following, setFollowing] = useState(null);
  const refresh = () => request("executionStatus", { conversationId }).then(value => setRuns(Array.isArray(value) ? value : [])).catch(() => {});
  useEffect(() => { setRuns([]); setLive(new Map()); void refresh(); }, [conversationId]);
  useEvent("execution.changed", () => void refresh());
  useEvent("conversation.event", ({ conversationId: id, method, params }) => {
    if (id !== conversationId || !params?.subAgent || !params.threadId && !params.thread?.id) return;
    const threadId = params.threadId || params.thread.id;
    setLive(current => { const next = new Map(current); next.set(threadId, liveWorker(current.get(threadId), method, params)); return next; });
  });
  const workers = useMemo(() => workersFrom(turns, live), [turns, live]);
  const tools = runs.reduce((count, run) => count + (run.toolCalls || 0), 0);
  if (!workers.length && !runs.some(run => run.toolCalls || run.reason)) return null;
  const active = workers.filter(worker => ["running", "pendingInit"].includes(worker.status));
  const failed = workers.filter(worker => ["errored", "failed"].includes(worker.status));
  const stopped = runs.some(run => run.stopped);
  const summary = workers.length
    ? stopped ? (active.length ? "Stopping…" : "Stopped") : active.length ? `${active.length} working` : failed.length ? `${failed.length} failed` : workers.every(worker => ["completed", "shutdown"].includes(worker.status)) ? "Finished" : "Starting"
    : stopped ? "Stopped" : `${tools} tool call${tools === 1 ? "" : "s"}`;
  const sum = key => runs.reduce((count, run) => count + (run[key] || 0), 0);
  return (
    <section className="tw-task" aria-label="Task and worker activity">
      <button type="button" className="tw-task-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <GitBranch size={16} />
        <strong>{workers.length ? `Workers (${workers.length})` : "Task activity"}</strong>
        <span role="status">{summary}</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded ? (
        <div className="tw-task-body">
          {runs.filter(run => run.reason).map(run => <p key={run.id} className="tw-task-limit" role="alert">{run.reason}</p>)}
          {runs.length ? <p className="tw-task-note">{sum("toolCalls")} tool calls · {sum("failures")} errors · {sum("inputTokens").toLocaleString()} input tokens ({sum("cachedTokens").toLocaleString()} cached) · {sum("outputTokens").toLocaleString()} output{runs.some(run => run.usagePartial) ? " · partial usage" : ""}</p> : null}
          {workers.map(worker => (
            <button key={worker.threadId} type="button" className="tw-task-worker" data-status={worker.status || "pendingInit"} aria-label={"Follow " + (worker.name || "worker")} onClick={() => setFollowing(worker)}>
              <i aria-hidden="true" />
              <span><strong>{worker.name || "Worker"}</strong><small>{short(worker.detail || worker.task) || "Open to follow its steps and results"}</small></span>
              <em>{LABELS[worker.status] || "Starting"}</em>
              <ChevronRight size={15} />
            </button>
          ))}
          {workers.length ? <p className="tw-task-note">Follow a worker to see its tools and results. Finished means its run ended; the main agent verifies the task outcome.</p> : null}
        </div>
      ) : null}
      <WorkerDialog conversationId={conversationId} worker={following} onClose={() => setFollowing(null)} />
    </section>
  );
}
