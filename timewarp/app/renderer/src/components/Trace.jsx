import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch, X } from "lucide-react";
import { call } from "../api.js";
import { Dialog, Segmented } from "./common.jsx";
import { approxTokens, shortCount, userText, workerThreads } from "../turns.mjs";

const LABELS = {
  userMessage: "Message", agentMessage: "Reply", reasoning: "Thinking", plan: "Plan", commandExecution: "Command", fileChange: "File change",
  mcpToolCall: "Tool", dynamicToolCall: "Tool", collabAgentToolCall: "Worker", subAgentActivity: "Worker", webSearch: "Web search",
  imageView: "Image", imageGeneration: "Image generation", contextCompaction: "Context condensed",
};
const number = value => Number.isFinite(value) ? value.toLocaleString() : "—";
const duration = ms => !Number.isFinite(ms) || ms < 0 ? "—" : ms < 1000 ? Math.round(ms) + " ms" : ms < 60000 ? (ms / 1000).toFixed(1) + " s" : Math.floor(ms / 60000) + " m " + Math.round((ms % 60000) / 1000) + " s";
const short = (value, length = 80) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > length ? text.slice(0, length - 1) + "…" : text; };

function itemTitle(item) {
  switch (item.type) {
    case "userMessage": return short(userText(item)) || "Message";
    case "agentMessage": return short(item.text) || "Reply";
    case "commandExecution": return short(item.command);
    case "fileChange": return (item.changes || []).map(change => String(change.path).split(/[\\/]/).pop()).join(", ");
    case "mcpToolCall": return `${item.server === "timewarp_composio" ? "Connected apps" : item.server} · ${item.tool}`;
    case "dynamicToolCall": return item.tool;
    case "webSearch": return short(item.query || item.action?.query || item.action?.url || "");
    default: return LABELS[item.type] || item.type;
  }
}

function details(item) {
  switch (item.type) {
    case "userMessage": return userText(item);
    case "agentMessage": return item.text;
    case "reasoning": return [...(item.summary || [])].join("\n\n");
    case "commandExecution": return [`$ ${item.command}`, item.cwd ? `in ${item.cwd}` : "", Number.isInteger(item.exitCode) ? `exit ${item.exitCode}` : "", item.aggregatedOutput ? "\n" + item.aggregatedOutput.slice(-8000) : ""].filter(Boolean).join("\n");
    case "fileChange": return (item.changes || []).map(change => `${change.path}\n${change.diff || ""}`).join("\n\n").slice(0, 12000);
    case "mcpToolCall": return JSON.stringify({ arguments: item.arguments, result: item.result, error: item.error }, null, 2).slice(0, 12000);
    default: return JSON.stringify(item, null, 2).slice(0, 12000);
  }
}

const PAGE = 20;
const APPROX = "Approximate text tokens (bytes ÷ 4), not model usage";
const turnTime = turn => turn.completedAt && turn.startedAt ? (turn.completedAt - turn.startedAt) * 1000 : NaN;
const shownTurns = list => (list || []).filter(turn => !turn.pending && (turn.items || []).length);

// The trace's shared state: what's open, what's selected, model usage by
// turn, and the subagents read so far.
const TraceContext = React.createContext(null);

function UsageCells({ usage }) {
  return <><span title={usage ? "Model usage" : undefined}>{number(usage?.input)}</span><span>{number(usage?.cached)}</span><span>{number(usage?.output)}</span><span>—</span></>;
}

// A subagent under the event that started it: its turns once opened.
function WorkerSection({ threadId, depth }) {
  const trace = React.useContext(TraceContext);
  const worker = trace.workers.get(threadId);
  const key = "thread:" + threadId;
  const open = trace.isOpen(key, worker?.status === "ready");
  useEffect(() => { if (open) trace.loadWorker(threadId); }, [open, threadId]);
  const name = worker?.name || "Subagent";
  return (
    <section>
      <button type="button" className="tw-trace-row worker" style={{ paddingLeft: 12 + depth * 18 }} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${name}`} onClick={() => trace.toggle(key)}>
        <span className="tw-ellipsis">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <GitBranch size={13} aria-hidden="true" /> {name}</span>
        <span /><span /><span /><span /><span />
      </button>
      {open ? (
        !worker || worker.status === "loading" ? <p className="tw-trace-note" role="status" style={{ paddingLeft: 30 + depth * 18 }}>Loading subagent…</p>
          : worker.status === "error" ? <p className="tw-trace-note" role="alert" style={{ paddingLeft: 30 + depth * 18 }}>{worker.error || "This subagent couldn't be read."}</p>
            : <TurnList threadId={threadId} name={name} turns={shownTurns(worker.turns)} depth={depth + 1} />
      ) : null}
    </section>
  );
}

// A thread's turns, the latest 20 first, with their events.
function TurnList({ threadId, name, turns, depth }) {
  const [limit, setLimit] = useState(PAGE);
  if (!turns.length) return <p className="tw-trace-note" style={{ paddingLeft: 12 + depth * 18 }}>No turns yet.</p>;
  const hidden = Math.max(0, turns.length - limit);
  return (
    <>
      {hidden ? <div className="tw-trace-more" style={{ paddingLeft: 12 + depth * 18 }}><button type="button" className="tw-link" onClick={() => setLimit(value => value + PAGE)}>Load {Math.min(PAGE, hidden)} older turns</button></div> : null}
      {turns.slice(hidden).map((turn, index) => <TurnRows key={turn.id} threadId={threadId} name={name} turn={turn} number={hidden + index + 1} depth={depth} />)}
    </>
  );
}

function TurnRows({ threadId, name, turn, number: position, depth }) {
  const trace = React.useContext(TraceContext);
  const [limit, setLimit] = useState(PAGE);
  const key = "turn:" + threadId + ":" + turn.id;
  const open = trace.isOpen(key, true);
  const items = turn.items || [];
  const selected = trace.selected;
  return (
    <>
      <button type="button" className="tw-trace-row" style={{ paddingLeft: 12 + depth * 18 }} aria-selected={selected?.kind === "turn" && selected.turn.id === turn.id} aria-expanded={open}
        onClick={() => { trace.select({ kind: "turn", threadId, name, position, turn }); trace.toggle(key); }}>
        <span className="tw-ellipsis">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {name} · Turn {position}{turn.status && turn.status !== "completed" ? " · " + turn.status : ""}</span>
        <UsageCells usage={trace.usage.get(turn.id)} /><span>{duration(turnTime(turn))}</span>
      </button>
      {open ? (
        <>
          {items.slice(0, limit).map(item => {
            const tokens = approxTokens(item), workers = workerThreads(item);
            return (
              <React.Fragment key={item.id}>
                <button type="button" className="tw-trace-row child" style={{ paddingLeft: 30 + depth * 18 }} aria-selected={selected?.kind === "item" && selected.item.id === item.id && selected.turn.id === turn.id}
                  onClick={() => trace.select({ kind: "item", threadId, name, position, turn, item })}>
                  <span className="tw-ellipsis">{LABELS[item.type] || item.type} · {itemTitle(item)}</span>
                  <span title={APPROX}>{shortCount(tokens.input)}</span><span /><span title={APPROX}>{shortCount(tokens.output)}</span><span /><span>{duration(item.durationMs)}</span>
                </button>
                {workers.map(threadId => <WorkerSection key={threadId} threadId={threadId} depth={depth + 2} />)}
              </React.Fragment>
            );
          })}
          {items.length > limit ? <div className="tw-trace-more" style={{ paddingLeft: 30 + depth * 18 }}><button type="button" className="tw-link" onClick={() => setLimit(value => value + PAGE)}>Load {Math.min(PAGE, items.length - limit)} more events</button></div> : null}
        </>
      ) : null}
    </>
  );
}

export function Trace({ open, onClose, conversation, turns, agent }) {
  const [view, setView] = useState("tree");
  const [expandAll, setExpandAll] = useState(false);
  // Turns start closed and subagents start closed; toggled ones flip that.
  const [toggled, setToggled] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  const [usage, setUsage] = useState([]);
  const [workers, setWorkers] = useState(() => new Map());
  useEffect(() => {
    if (!open) return;
    setSelected(null);
    call("conversations.usage", { id: conversation.id }).then(setUsage).catch(() => setUsage([]));
  }, [open, conversation.id]);
  useEffect(() => { setWorkers(new Map()); setToggled(new Set()); }, [conversation.id]);
  const byTurn = useMemo(() => new Map(usage.map(entry => [entry.turnId, entry])), [usage]);
  const rows = shownTurns(turns);
  const start = Math.min(...rows.map(turn => turn.startedAt || Infinity));
  const end = Math.max(...rows.map(turn => turn.completedAt || turn.startedAt || 0), start + 1);
  const loading = useRef(new Set());
  const trace = {
    usage: byTurn, workers, selected, select: setSelected,
    // "Expand loaded" opens every turn and every subagent already read.
    isOpen: (key, loaded) => expandAll && loaded ? !toggled.has(key) : toggled.has(key),
    toggle: key => setToggled(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
    loadWorker: threadId => {
      if (loading.current.has(threadId)) return;
      loading.current.add(threadId);
      setWorkers(current => new Map(current).set(threadId, { status: "loading" }));
      call("conversations.worker", { id: conversation.id, threadId })
        .then(value => setWorkers(current => new Map(current).set(threadId, { status: "ready", name: value.name, turns: value.turns || [] })))
        .catch(error => { loading.current.delete(threadId); setWorkers(current => new Map(current).set(threadId, { status: "error", error: error.message })); });
    },
  };
  const pick = selected;
  const pickUsage = pick?.kind === "turn" ? byTurn.get(pick.turn.id) : null;
  const pickTokens = pick?.kind === "item" ? approxTokens(pick.item) : null;
  return (
    <Dialog open={open} onClose={onClose} wide label="Conversation trace">
      <div className="tw-trace-head">
        <div><h2>Conversation trace</h2><p>Follow agent work in the tree or compare turn timing in the waterfall.</p></div>
        <label className="tw-check"><input type="checkbox" checked={expandAll} aria-label="Expand or collapse all loaded trace sections" onChange={event => { setExpandAll(event.target.checked); setToggled(new Set()); }} /><span>Expand loaded</span></label>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: "tree", label: "Tree" }, { value: "waterfall", label: "Waterfall" }]} />
        <button type="button" className="tw-icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="tw-trace">
        <div className="tw-trace-list">
          {view === "tree" ? (
            <TraceContext.Provider value={trace}>
              <div className="tw-trace-cols"><span>Agent / event</span><span>Input</span><span>Cached</span><span>Output</span><span>Billed</span><span>Duration</span></div>
              {rows.length ? <TurnList threadId="root" name={agent?.name || "Agent"} turns={rows} depth={0} /> : <div className="tw-trace-none">No turns yet.</div>}
            </TraceContext.Provider>
          ) : (
            <div className="tw-waterfall">
              {rows.length ? rows.map((turn, index) => {
                const from = ((turn.startedAt || start) - start) / (end - start), to = ((turn.completedAt || turn.startedAt || start) - start) / (end - start);
                return (
                  <button key={turn.id} type="button" className="tw-trace-row" aria-selected={pick?.kind === "turn" && pick.turn.id === turn.id} onClick={() => setSelected({ kind: "turn", threadId: "root", name: agent?.name || "Agent", position: index + 1, turn })}>
                    <span className="tw-ellipsis">Turn {index + 1}</span>
                    <span className="tw-bar"><i style={{ left: from * 100 + "%", width: Math.max(0.5, (to - from) * 100) + "%" }} /></span>
                    <span>{duration(turnTime(turn))}</span>
                  </button>
                );
              }) : <div className="tw-trace-none">No turns yet.</div>}
            </div>
          )}
        </div>
        <div className="tw-trace-detail">
          {pick ? (
            pick.kind === "item" ? (
              <>
                <h3>{LABELS[pick.item.type] || pick.item.type}</h3>
                <p className="tw-hint">{pick.name} · Turn {pick.position}{pick.item.status ? " · " + pick.item.status : ""}{Number.isFinite(pick.item.durationMs) ? " · " + duration(pick.item.durationMs) : ""}</p>
                {pickTokens.input != null || pickTokens.output != null ? (
                  <dl className="tw-trace-facts" title={APPROX}>
                    <dt>Input (approx.)</dt><dd>{number(pickTokens.input)}</dd>
                    <dt>Output (approx.)</dt><dd>{number(pickTokens.output)}</dd>
                  </dl>
                ) : null}
                <pre className="tw-output" style={{ maxHeight: "none" }}>{details(pick.item) || "No details."}</pre>
              </>
            ) : (
              <>
                <h3>{pick.name} · Turn {pick.position}</h3>
                <p className="tw-hint">{pick.turn.startedAt ? new Date(pick.turn.startedAt * 1000).toLocaleString() : ""} · {pick.turn.status}</p>
                <dl className="tw-trace-facts">
                  <dt>Input tokens</dt><dd>{number(pickUsage?.input)}</dd>
                  <dt>Cached input</dt><dd>{number(pickUsage?.cached)}</dd>
                  <dt>Output tokens</dt><dd>{number(pickUsage?.output)}</dd>
                  <dt>Reasoning tokens</dt><dd>{number(pickUsage?.reasoning)}</dd>
                  <dt>Duration</dt><dd>{duration(turnTime(pick.turn))}</dd>
                  <dt>Events</dt><dd>{(pick.turn.items || []).length}</dd>
                  {pick.threadId !== "root" ? <><dt>Thread</dt><dd className="tw-mono">{pick.threadId}</dd></> : null}
                </dl>
                {pick.turn.error ? <div className="tw-turn-error">{pick.turn.error.message}</div> : null}
              </>
            )
          ) : <div className="tw-trace-empty">Select a turn or event to inspect it here.</div>}
        </div>
      </div>
    </Dialog>
  );
}
