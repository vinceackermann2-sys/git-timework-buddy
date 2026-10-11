import { useEffect, useMemo, useRef, useState } from "react";
import { call, useEvent } from "../api.js";
import { threadEntries, threadState, toolRow, workerState } from "../turns.mjs";

// The subagents a chat's agent started, for the "Waiting for …" line and the
// thread sheet. The previous app had no task panel above the chat.
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
