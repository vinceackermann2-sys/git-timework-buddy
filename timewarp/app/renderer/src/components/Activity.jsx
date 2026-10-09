import React from "react";
import { Brain, ChevronRight, FileDiff, Globe, Image, ListTodo, Sparkles, Terminal, Users, Wrench } from "lucide-react";
import { running, summarize } from "../turns.mjs";

const statusClass = status => status === "inProgress" ? "running" : status === "failed" || status === "declined" ? "fail" : status === "completed" ? "ok" : "";
const short = (value, length = 140) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > length ? text.slice(0, length - 1) + "…" : text; };
const fileName = file => String(file || "").split(/[\\/]/).pop();

function Diff({ diff }) {
  if (!diff) return null;
  return (
    <pre className="tw-output tw-diff">
      {String(diff).split("\n").slice(0, 400).map((line, index) => (
        <div key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : ""}>{line || " "}</div>
      ))}
    </pre>
  );
}

function mcpText(result) {
  const parts = (result?.content || []).map(part => typeof part?.text === "string" ? part.text : "").filter(Boolean);
  return parts.join("\n").slice(0, 4000);
}

function Item({ item }) {
  switch (item.type) {
    case "reasoning": {
      const text = [...(item.summary || [])].join("\n\n").trim();
      return <div className="tw-work-item"><div className="tw-work-line"><Brain size={14} /><span>Thinking</span></div>{text ? <div className="tw-reasoning">{text}</div> : null}</div>;
    }
    case "plan":
      return <div className="tw-work-item"><div className="tw-work-line"><ListTodo size={14} /><span>Plan</span></div><div className="tw-reasoning">{item.text}</div></div>;
    case "commandExecution":
      return (
        <div className="tw-work-item">
          <div className="tw-work-line"><span className={"tw-status " + statusClass(item.status)} /><Terminal size={14} /><code title={item.command}>{short(item.command, 200)}</code>
            {Number.isInteger(item.exitCode) && item.exitCode !== 0 ? <span className="tw-tag">exit {item.exitCode}</span> : null}</div>
          {item.aggregatedOutput ? <details><summary className="tw-hint" style={{ cursor: "pointer" }}>Output</summary><pre className="tw-output">{item.aggregatedOutput.slice(-20000)}</pre></details> : null}
        </div>
      );
    case "fileChange":
      return (
        <div className="tw-work-item">
          {(item.changes || []).map(change => (
            <details key={change.path}>
              <summary className="tw-work-line" style={{ cursor: "pointer" }}>
                <span className={"tw-status " + statusClass(item.status)} /><FileDiff size={14} />
                <span title={change.path}>{change.kind?.type === "add" ? "Created " : change.kind?.type === "delete" ? "Deleted " : "Edited "}<strong>{fileName(change.path)}</strong></span>
              </summary>
              <Diff diff={change.diff} />
            </details>
          ))}
        </div>
      );
    case "mcpToolCall": {
      const text = item.error?.message || mcpText(item.result);
      return (
        <div className="tw-work-item">
          <div className="tw-work-line"><span className={"tw-status " + statusClass(item.status)} /><Wrench size={14} /><span>{item.server === "timewarp_composio" ? "Connected apps" : item.server} · {item.tool}</span></div>
          {text ? <details><summary className="tw-hint" style={{ cursor: "pointer" }}>{item.error ? "Error" : "Result"}</summary><pre className="tw-output">{text}</pre></details> : null}
        </div>
      );
    }
    case "dynamicToolCall":
      return <div className="tw-work-item"><div className="tw-work-line"><span className={"tw-status " + statusClass(item.status)} /><Wrench size={14} /><span>{item.tool}</span></div></div>;
    case "collabAgentToolCall": {
      const labels = { spawnAgent: "Started a worker", sendInput: "Sent a worker more input", resumeAgent: "Resumed a worker", wait: "Waited for workers", closeAgent: "Closed a worker", sendMessage: "Messaged a worker", followupTask: "Gave a worker a follow-up", interruptAgent: "Stopped a worker", listAgents: "Checked workers" };
      return <div className="tw-work-item"><div className="tw-work-line"><span className={"tw-status " + statusClass(item.status)} /><Users size={14} /><span>{labels[item.tool] || "Worker"}{item.prompt ? ": " + short(item.prompt, 120) : ""}</span></div></div>;
    }
    case "subAgentActivity":
      return <div className="tw-work-item"><div className="tw-work-line"><Users size={14} /><span>Worker {item.kind}</span></div></div>;
    case "webSearch": {
      const action = item.action || {};
      const label = action.type === "openPage" ? "Opened " + short(action.url, 80) : action.type === "findInPage" ? "Searched the page for " + short(action.pattern, 60) : "Searched the web for " + short(item.query || action.query || (action.queries || []).join(", "), 100);
      return <div className="tw-work-item"><div className="tw-work-line"><Globe size={14} /><span>{label}</span></div></div>;
    }
    case "imageView":
      return <div className="tw-work-item"><div className="tw-work-line"><Image size={14} /><span>Looked at {fileName(item.path)}</span></div></div>;
    case "imageGeneration":
      return <div className="tw-work-item"><div className="tw-work-line"><Sparkles size={14} /><span>Generated an image{item.savedPath ? " · " + fileName(item.savedPath) : ""}</span></div></div>;
    case "contextCompaction":
      return <div className="tw-work-item"><div className="tw-work-line"><Sparkles size={14} /><span>Condensed earlier context to keep going</span></div></div>;
    default:
      return null;
  }
}

export function ActivityGroup({ items, live }) {
  const active = live && running(items);
  return (
    <details className="tw-work" open={active || undefined}>
      <summary>
        <ChevronRight size={14} />
        {active ? <span className="tw-status running" /> : null}
        <span>{summarize(items)}</span>
      </summary>
      <div className="tw-work-items">{items.map(item => <Item key={item.id} item={item} />)}</div>
    </details>
  );
}

export function PlanCard({ plan }) {
  if (!plan?.steps?.length) return null;
  return (
    <div className="tw-card" style={{ padding: "10px 14px" }}>
      <div className="tw-work-line"><ListTodo size={14} /><strong style={{ fontSize: 13 }}>Plan</strong></div>
      {plan.explanation ? <div className="tw-hint">{plan.explanation}</div> : null}
      <ul className="tw-plan">{plan.steps.map((step, index) => <li key={index} data-status={step.status}><span>{step.status === "completed" ? "✓" : step.status === "inProgress" || step.status === "in_progress" ? "›" : "·"}</span><span>{step.step}</span></li>)}</ul>
    </div>
  );
}
