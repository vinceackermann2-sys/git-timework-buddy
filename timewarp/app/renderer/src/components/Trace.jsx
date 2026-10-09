import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { call } from "../api.js";
import { Dialog, Segmented } from "./common.jsx";
import { userText } from "../turns.mjs";

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

export function Trace({ open, onClose, conversation, turns, agent }) {
  const [view, setView] = useState("tree");
  const [expandAll, setExpandAll] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [selected, setSelected] = useState(null);
  const [usage, setUsage] = useState([]);
  useEffect(() => {
    if (!open) return;
    setSelected(null);
    call("conversations.usage", { id: conversation.id }).then(setUsage).catch(() => setUsage([]));
  }, [open, conversation.id]);
  const byTurn = useMemo(() => new Map(usage.map(entry => [entry.turnId, entry])), [usage]);
  const rows = turns.filter(turn => !turn.pending && (turn.items || []).length);
  const start = Math.min(...rows.map(turn => turn.startedAt || Infinity));
  const end = Math.max(...rows.map(turn => turn.completedAt || turn.startedAt || 0), start + 1);
  const toggle = id => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const turnTime = turn => turn.completedAt && turn.startedAt ? (turn.completedAt - turn.startedAt) * 1000 : NaN;
  const pick = selected && rows.flatMap(turn => [{ key: turn.id, turn }, ...(turn.items || []).map(item => ({ key: turn.id + "/" + item.id, turn, item }))]).find(entry => entry.key === selected);
  return (
    <Dialog open={open} onClose={onClose} wide label="Conversation trace">
      <div className="tw-trace-head">
        <div><h2>Conversation trace</h2><p>Follow agent work in the tree or compare turn timing in the waterfall.</p></div>
        <label className="tw-check"><input type="checkbox" checked={expandAll} onChange={event => setExpandAll(event.target.checked)} /><span>Expand loaded</span></label>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: "tree", label: "Tree" }, { value: "waterfall", label: "Waterfall" }]} />
        <button type="button" className="tw-icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="tw-trace">
        <div className="tw-trace-list">
          {view === "tree" ? (
            <>
              <div className="tw-trace-cols"><span>Agent / event</span><span>Input</span><span>Cached</span><span>Output</span><span>Duration</span></div>
              {rows.length ? rows.map((turn, index) => {
                const open = expandAll || expanded.has(turn.id);
                const counts = byTurn.get(turn.id);
                return (
                  <React.Fragment key={turn.id}>
                    <button type="button" className="tw-trace-row" aria-selected={selected === turn.id} onClick={() => { setSelected(turn.id); toggle(turn.id); }}>
                      <span className="tw-ellipsis">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {agent?.name || "Agent"} · Turn {index + 1}</span>
                      <span>{number(counts?.input)}</span><span>{number(counts?.cached)}</span><span>{number(counts?.output)}</span><span>{duration(turnTime(turn))}</span>
                    </button>
                    {open ? (turn.items || []).map(item => (
                      <button key={item.id} type="button" className="tw-trace-row child" aria-selected={selected === turn.id + "/" + item.id} onClick={() => setSelected(turn.id + "/" + item.id)}>
                        <span className="tw-ellipsis">{LABELS[item.type] || item.type} · {itemTitle(item)}</span><span /><span /><span /><span>{duration(item.durationMs)}</span>
                      </button>
                    )) : null}
                  </React.Fragment>
                );
              }) : <div className="tw-trace-none">No turns yet.</div>}
            </>
          ) : (
            <div className="tw-waterfall">
              {rows.length ? rows.map((turn, index) => {
                const from = ((turn.startedAt || start) - start) / (end - start), to = ((turn.completedAt || turn.startedAt || start) - start) / (end - start);
                return (
                  <button key={turn.id} type="button" className="tw-trace-row" aria-selected={selected === turn.id} onClick={() => setSelected(turn.id)}>
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
            pick.item ? (
              <>
                <h3>{LABELS[pick.item.type] || pick.item.type}</h3>
                <p className="tw-hint">{pick.item.status ? "Status: " + pick.item.status : ""}{Number.isFinite(pick.item.durationMs) ? " · " + duration(pick.item.durationMs) : ""}</p>
                <pre className="tw-output" style={{ maxHeight: "none" }}>{details(pick.item) || "No details."}</pre>
              </>
            ) : (
              <>
                <h3>Turn {rows.indexOf(pick.turn) + 1}</h3>
                <p className="tw-hint">{pick.turn.startedAt ? new Date(pick.turn.startedAt * 1000).toLocaleString() : ""} · {pick.turn.status}</p>
                <dl className="tw-trace-facts">
                  <dt>Input tokens</dt><dd>{number(byTurn.get(pick.turn.id)?.input)}</dd>
                  <dt>Cached input</dt><dd>{number(byTurn.get(pick.turn.id)?.cached)}</dd>
                  <dt>Output tokens</dt><dd>{number(byTurn.get(pick.turn.id)?.output)}</dd>
                  <dt>Reasoning tokens</dt><dd>{number(byTurn.get(pick.turn.id)?.reasoning)}</dd>
                  <dt>Duration</dt><dd>{duration(turnTime(pick.turn))}</dd>
                  <dt>Events</dt><dd>{(pick.turn.items || []).length}</dd>
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
