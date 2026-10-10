import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { call, request, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { applyEvent, formatDuration, friendlyError, groupEntries, imageSource, threadEntries, threadState, workerState } from "../turns.mjs";
import { ToolGroup } from "./Activity.jsx";
import { ImageDialog } from "../widgets.jsx";

const fileName = file => String(file || "").split(/[\\/]/).filter(Boolean).pop() || "";

// The current time, ticking each second while on.
function useNow(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

// A button that runs once until its promise settles ("Retrying…").
function useOnce(action) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = (...args) => {
    if (running.current) return;
    running.current = true; setBusy(true);
    Promise.resolve().then(() => action(...args)).catch(() => { running.current = false; setBusy(false); });
  };
  return [run, busy];
}

// Long text folds at 240px with "Show more", as before.
export function Collapsible({ children, enabled = true, className = "" }) {
  const box = useRef(null);
  const [tall, setTall] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => { if (box.current) setTall(box.current.scrollHeight > 241); }, [children]);
  if (!enabled) return children;
  return (
    <div className="tw-collapsible">
      <div ref={box} className={tall && !open ? "tw-collapsed" : undefined}>{children}</div>
      {tall ? <button type="button" className={"tw-fold-toggle " + className} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Show less" : "Show more"}</button> : null}
    </div>
  );
}

// ---- The working line and what replaces it ----------------------------

// "Agent is working": the latest interim note, shimmering; opens the agent thread.
function WorkingLine({ text, onOpen }) {
  const content = <span className="tw-working-text">{text}</span>;
  return onOpen
    ? <button type="button" className="tw-working tw-shimmer" aria-label="Agent is working" onClick={event => onOpen(event.currentTarget)}>{content}</button>
    : <div className="tw-working tw-shimmer" role="status" aria-label="Agent is working">{content}</div>;
}

function Waiting({ workers, onOpen }) {
  const label = `Waiting for ${workers.map(worker => worker.name || "Subagent").join(", ")}...`;
  return (
    <div className="tw-working tw-shimmer" role="status" aria-label={label}>
      <span className="tw-working-text">Waiting for{" "}
        {workers.map((worker, index) => <span key={worker.threadId}>{index ? ", " : ""}<button type="button" className="tw-working-name" onClick={event => onOpen(worker.threadId, event.currentTarget)}>{worker.name || "Subagent"}</button></span>)}...
      </span>
    </div>
  );
}

function Paused({ onContinue }) {
  const [run, busy] = useOnce(() => onContinue("continue"));
  return (
    <div className="tw-paused">
      <span>Paused</span>
      <button type="button" className="tw-pill-button" disabled={busy} onClick={() => run()}>{busy ? <LoaderCircle size={13} className="tw-spin" /> : null}{busy ? "Continuing…" : "Continue"}</button>
    </div>
  );
}

// A turn error in the previous app's words, with what can be done about it.
export function TurnError({ error, onContinue, funding, onSettings }) {
  const [retry, retrying] = useOnce(source => onContinue(source));
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState("");
  const [baseline] = useState(() => funding?.timewarpCredits ?? null);
  const [latest, setLatest] = useState(funding);
  // While credits are missing, check every few seconds whether some were added.
  useEffect(() => {
    if (error.recovery !== "addCredits") return;
    const check = () => call("funding.get").then(setLatest).catch(() => {});
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [error.recovery]);
  if (error.recovery === "addCredits") {
    const credits = latest?.timewarpCredits ?? null;
    const added = baseline !== null && credits !== null && credits > baseline;
    const text = added ? "Credits added. Continue to retry this request." : credits === null || credits <= 0 ? "This request needs additional credits to continue." : "There were not enough credits available to complete this request.";
    return (
      <div className="tw-turn-problem credits">
        <span>{text}</span>
        <button type="button" className={"tw-pill-button xs" + (added ? "" : " primary")} onClick={() => onSettings?.("billing")}>{latest?.plan && latest.plan !== "free" ? "Add credits" : "View plans"}</button>
        {added ? <button type="button" className="tw-pill-button xs primary" disabled={retrying} onClick={() => retry("funding-retry")}>{retrying ? <LoaderCircle size={13} className="tw-spin" /> : null}{retrying ? "Retrying…" : "Continue"}</button> : null}
      </div>
    );
  }
  const reconnect = () => {
    setConnecting(true); setProblem("");
    request("connectChatgpt").catch(failure => setProblem(failure?.message || String(failure))).finally(() => setConnecting(false));
  };
  return (
    <div className="tw-turn-problem">
      <div>{error.message}</div>
      {error.recovery === "reconnectChatGPT" ? (
        <div className="tw-turn-actions">
          <button type="button" className="tw-pill-button xs secondary" disabled={connecting} onClick={reconnect}>{connecting ? "Opening sign in..." : "Reconnect ChatGPT"}</button>
          {problem ? <span className="tw-turn-problem-error">{problem}</span> : null}
        </div>
      ) : null}
      {error.recovery === "retry" ? <button type="button" className="tw-pill-button" disabled={retrying} onClick={() => retry("retry")}>{retrying ? <LoaderCircle size={13} className="tw-spin" /> : null}{retrying ? "Retrying…" : "Try again"}</button> : null}
    </div>
  );
}

// Below the last message: what the agent is doing, or why it stopped.
// state comes from threadState(); workers are the chat's subagents.
export function AgentActivity({ state, commentary, workers, browserTab, working, onOpenThread, onOpenBrowser, onContinue, funding, onSettings }) {
  const active = state.status === "running" || state.status === "paused";
  const waiting = workers.filter(worker => ["running", "paused", "starting"].includes(workerState(worker.status)));
  const showWaiting = !commentary && waiting.length > 0;
  const text = state.retrying ? friendlyError(state.retrying, true).message : commentary || (state.status === "paused" ? state.reason : null) || "Working...";
  return (
    <div className="tw-activity-slot">
      {showWaiting ? <Waiting workers={waiting} onOpen={onOpenThread} /> : null}
      {!showWaiting && active ? (
        <div className="tw-working-stack">
          {browserTab ? <button type="button" className="tw-using-browser" aria-label="Using browser" onClick={() => onOpenBrowser(browserTab)}>Using browser</button> : null}
          <WorkingLine text={text} onOpen={element => onOpenThread("root", element)} />
        </div>
      ) : null}
      {!active && !showWaiting && state.status !== "interrupted" && state.status !== "failed" && working ? <WorkingLine text="Working..." /> : null}
      {state.status === "interrupted" ? <Paused onContinue={onContinue} /> : null}
      {state.status === "failed" ? <div className="tw-activity-error"><TurnError key={state.turnId || "failed"} error={state.error} onContinue={onContinue} funding={funding} onSettings={onSettings} /></div> : null}
    </div>
  );
}

// A generated image after its turn, with a download button; it opens at full size.
export function GeneratedImage({ item }) {
  const [large, setLarge] = useState(false);
  const src = imageSource(item);
  if (!src) return null;
  return (
    <div className="tw-generated">
      <button type="button" className="tw-generated-open" aria-label="Open generated image" onClick={() => setLarge(true)}><img src={src} alt="Generated image" /></button>
      <a href={src} download={fileName(item.savedPath) || "generated-image.png"} aria-label="Download generated image" title="Download generated image"><Download size={14} /></a>
      {large ? <ImageDialog src={src} name={fileName(item.savedPath) || "Generated image"} onClose={() => setLarge(false)} /> : null}
    </div>
  );
}

// ---- The agent thread sheet --------------------------------------------

// Rises from what was clicked to a sheet over the chat: 624px wide at most,
// 70% of its height, 8px above the bottom, as before.
function Sheet({ source, title, footer, onClose, children }) {
  const layer = useRef(null);
  const panel = useRef(null);
  const [frame, setFrame] = useState(null);
  const [closing, setClosing] = useState(false);
  const opened = useRef(false);
  const close = () => { if (!closing) { setClosing(true); setTimeout(onClose, 200); } };
  useLayoutEffect(() => {
    const host = layer.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const box = host.getBoundingClientRect();
      const width = Math.min(box.width - 48, 624), height = box.height * 0.7;
      const open = { left: (box.width - width) / 2, top: box.height - 8 - height, width, height };
      const from = source?.isConnected ? source.getBoundingClientRect() : null;
      const closed = from && from.width > 0 ? { left: from.left - box.left, top: from.top - box.top, width: from.width, height: from.height } : { ...open, top: open.top + 12 };
      setFrame({ open, closed });
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    return () => observer?.disconnect();
  }, []);
  // Start at the source, then move to the open frame on the next frame.
  const [shown, setShown] = useState(false);
  useEffect(() => { if (frame && !opened.current) { opened.current = true; requestAnimationFrame(() => requestAnimationFrame(() => { setShown(true); panel.current?.focus(); })); } }, [frame]);
  useEffect(() => {
    const escape = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  });
  const rect = frame ? (shown && !closing ? frame.open : frame.closed) : null;
  return (
    <div className="tw-sheet-layer" ref={layer}>
      <div className="tw-sheet-overlay" data-shown={shown && !closing} onMouseDown={event => { event.preventDefault(); close(); }} />
      {rect ? (
        <div ref={panel} className="tw-sheet" role="dialog" aria-modal="true" aria-labelledby="tw-sheet-title" tabIndex={-1} data-shown={shown && !closing}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          <div className="tw-sheet-inner" style={{ width: frame.open.width, height: frame.open.height }}>
            <div className="tw-sheet-head">
              <h2 id="tw-sheet-title">{title}</h2>
              <button type="button" className="tw-icon-button" aria-label="Close" onClick={close}><X size={16} /></button>
            </div>
            <div className="tw-sheet-body">{children}</div>
            {footer ? <div className="tw-sheet-foot">{footer}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// "Working for 12s" since the latest input; for the chat's own agent, which
// has no input entries, "Working...".
function SheetFooter({ state, inputAt, shimmer }) {
  const running = state.status === "running";
  const now = useNow(running);
  if (running) {
    const duration = inputAt ? Math.max(0, now - inputAt) : null;
    return <div className="tw-sheet-state"><span className={"tw-tabular" + (shimmer ? " tw-shimmer" : "")}>{duration ? `Working for ${formatDuration(duration)}` : "Working..."}</span></div>;
  }
  if (state.status === "paused") return <div className="tw-sheet-state">{state.reason || "Waiting for input"}</div>;
  if (state.status === "interrupted") return <div className="tw-sheet-state">Interrupted</div>;
  if (state.status === "failed") return <div className="tw-sheet-state failed" role="alert">Failed: {state.error.message}</div>;
  return <div className="tw-sheet-state">Completed</div>;
}

function Entries({ entries }) {
  return (
    <div className="tw-thread-entries">
      {groupEntries(entries).map(entry => Array.isArray(entry) ? <ToolGroup key={entry[0].id} entries={entry} />
        : entry.kind === "input" ? <div key={entry.id} className="tw-thread-input"><div className="tw-user-message"><Collapsible>{entry.text}</Collapsible></div></div>
          : <div key={entry.id} className={entry.kind === "commentary" ? "tw-thread-note" : "tw-thread-output"}><Markdown text={entry.text} /></div>)}
    </div>
  );
}

// A worker's transcript, kept current from its events or, since Codex
// doesn't always send a worker's events, read again while it works.
function useWorkerThread(conversationId, threadId) {
  const [thread, setThread] = useState({ status: "loading", turns: [], threadStatus: null, name: null });
  const settled = thread.status === "error" || (thread.status === "ready" && !["running", "paused"].includes(threadState(thread.turns, thread.threadStatus).status));
  useEffect(() => {
    let live = true, timer = null;
    const read = () => call("conversations.worker", { id: conversationId, threadId })
      .then(value => { if (live) setThread(current => ({ status: "ready", name: value.name, threadStatus: value.status, turns: mergeTurns(value.turns || [], current.turns) })); })
      .catch(() => { if (live) setThread(current => ({ ...current, status: current.turns.length ? "ready" : "error" })); })
      .finally(() => { if (live && !settled) timer = setTimeout(read, 2000); });
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [conversationId, threadId, settled]);
  useEvent("conversation.event", ({ conversationId: id, method, params }) => {
    if (id !== conversationId || (params?.threadId || params?.thread?.id) !== threadId) return;
    if (method === "thread/status/changed") setThread(current => ({ ...current, threadStatus: params.status }));
    else setThread(current => ({ ...current, turns: applyEvent(current.turns, method, params, { worker: true }) }));
  });
  return thread;
}
// Turns that streamed in while the transcript loaded stay.
const mergeTurns = (loaded, streamed) => [...loaded.map(turn => streamed.find(item => item.id === turn.id && item.items.length > turn.items.length) || turn), ...streamed.filter(turn => !loaded.some(item => item.id === turn.id))];

function WorkerSheet({ conversationId, worker, source, onClose }) {
  const thread = useWorkerThread(conversationId, worker.threadId);
  const ready = thread.status === "ready";
  const state = ready ? threadState(thread.turns, thread.threadStatus) : null;
  const entries = threadEntries(thread.turns, { worker: true });
  const messages = entries.filter(entry => entry.kind !== "tool");
  // The time since the worker's latest input. Codex doesn't record a
  // worker's task as an item, so its latest turn's start stands in for it.
  const latest = thread.turns.at(-1);
  const last = messages.map(entry => entry.kind === "input").lastIndexOf(true);
  const inputAt = last >= 0 ? messages[last].at : latest?.startedAt ? latest.startedAt * 1000 : null;
  const since = last >= 0 ? messages.slice(last + 1) : threadEntries(latest ? [latest] : [], { worker: true });
  return (
    <Sheet source={source} title={thread.name || worker.name || "Agent"} onClose={onClose}
      footer={state ? <SheetFooter state={state} inputAt={inputAt} shimmer={!since.some(entry => entry.kind === "commentary")} /> : null}>
      {thread.status === "loading" ? <div className="tw-sheet-note">Loading agent activity…</div>
        : state || entries.length ? <Entries entries={entries} />
          : thread.status === "error" ? <div className="tw-sheet-note">Couldn’t load agent activity.</div>
            : <div className="tw-sheet-note">This agent thread is unavailable.</div>}
    </Sheet>
  );
}

// The sheet for the chat's own agent ("root") or one of its subagents.
export function AgentThreadSheet({ conversationId, target, agentName, turns, state, workers, onClose }) {
  if (!target) return null;
  if (target.threadId !== "root") {
    const worker = workers.find(item => item.threadId === target.threadId) || { threadId: target.threadId };
    return <WorkerSheet key={target.threadId} conversationId={conversationId} worker={worker} source={target.source} onClose={onClose} />;
  }
  const entries = threadEntries(turns);
  return (
    <Sheet source={target.source} title={agentName || "Agent thread"} onClose={onClose}
      footer={<SheetFooter state={state} inputAt={null} shimmer={!entries.length} />}>
      <Entries entries={entries} />
    </Sheet>
  );
}
