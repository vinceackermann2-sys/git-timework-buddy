import React, { useState } from "react";
import { call } from "../api.js";
import { useToast } from "./common.jsx";

function Actions({ busy, options }) {
  return (
    <div className="tw-approval-actions">
      {options.map(option => <button key={option.label} type="button" className={"tw-btn " + (option.primary ? "primary" : "")} disabled={busy} onClick={option.run}>{option.label}</button>)}
    </div>
  );
}

function Questions({ questions, busy, onSubmit }) {
  const [answers, setAnswers] = useState({});
  const set = (id, value) => setAnswers(current => ({ ...current, [id]: value }));
  return (
    <form style={{ display: "grid", gap: 10 }} onSubmit={event => { event.preventDefault(); onSubmit(Object.fromEntries(questions.map(question => [question.id, { answers: [String(answers[question.id] ?? "")] }]))); }}>
      {questions.map(question => (
        <label key={question.id} className="tw-field">
          <span>{question.header ? <strong>{question.header}: </strong> : null}{question.question}</span>
          {question.options?.length && !question.isOther ? (
            <select className="tw-dropdown" value={answers[question.id] ?? ""} onChange={event => set(question.id, event.target.value)} required>
              <option value="" disabled>Choose…</option>
              {question.options.map(option => <option key={option.label} value={option.label}>{option.label}{option.description ? " — " + option.description : ""}</option>)}
            </select>
          ) : <input className="tw-input" type={question.isSecret ? "password" : "text"} value={answers[question.id] ?? ""} onChange={event => set(question.id, event.target.value)} required />}
        </label>
      ))}
      <div className="tw-approval-actions"><button type="submit" className="tw-btn primary" disabled={busy}>Send answers</button></div>
    </form>
  );
}

export function ApprovalCard({ approval }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const respond = async response => {
    setBusy(true);
    try { await call("approvals.respond", { id: approval.id, response }); }
    catch (error) { toast(error, "error"); setBusy(false); }
  };
  const p = approval.params || {};
  switch (approval.method) {
    case "item/commandExecution/requestApproval":
      return (
        <div className="tw-approval" role="alert">
          <h3>Allow this command?</h3>
          {p.reason ? <div className="tw-hint">{p.reason}</div> : null}
          {p.command ? <pre className="tw-output">{p.command}</pre> : null}
          {p.cwd ? <div className="tw-hint">In {p.cwd}</div> : null}
          <Actions busy={busy} options={[
            { label: "Allow once", primary: true, run: () => respond({ decision: "accept" }) },
            { label: "Allow for this chat", run: () => respond({ decision: "acceptForSession" }) },
            { label: "Decline", run: () => respond({ decision: "decline" }) },
            { label: "Stop the reply", run: () => respond({ decision: "cancel" }) },
          ]} />
        </div>
      );
    case "item/fileChange/requestApproval":
      return (
        <div className="tw-approval" role="alert">
          <h3>Allow these file changes?</h3>
          {p.reason ? <div className="tw-hint">{p.reason}</div> : null}
          {p.grantRoot ? <div className="tw-hint">Grants write access to {p.grantRoot}</div> : null}
          <Actions busy={busy} options={[
            { label: "Allow", primary: true, run: () => respond({ decision: "accept" }) },
            { label: "Allow for this chat", run: () => respond({ decision: "acceptForSession" }) },
            { label: "Decline", run: () => respond({ decision: "decline" }) },
          ]} />
        </div>
      );
    case "item/permissions/requestApproval": {
      const granted = { ...(p.permissions?.network ? { network: p.permissions.network } : {}), ...(p.permissions?.fileSystem ? { fileSystem: p.permissions.fileSystem } : {}) };
      return (
        <div className="tw-approval" role="alert">
          <h3>Allow extra access?</h3>
          {p.reason ? <div className="tw-hint">{p.reason}</div> : null}
          <div className="tw-hint">{[p.permissions?.network ? "Network access" : null, p.permissions?.fileSystem ? "Additional folders" : null].filter(Boolean).join(" and ") || "Additional permissions"}</div>
          <Actions busy={busy} options={[
            { label: "Allow for this reply", primary: true, run: () => respond({ permissions: granted, scope: "turn" }) },
            { label: "Allow for this chat", run: () => respond({ permissions: granted, scope: "session" }) },
            { label: "Decline", run: () => respond({ permissions: {}, scope: "turn" }) },
          ]} />
        </div>
      );
    }
    case "item/tool/requestUserInput":
      return (
        <div className="tw-approval" role="alert">
          <h3>Your agent has a question</h3>
          <Questions questions={p.questions || []} busy={busy} onSubmit={answers => respond({ answers })} />
        </div>
      );
    case "mcpServer/elicitation/request":
      return (
        <div className="tw-approval" role="alert">
          <h3>{p.serverName === "timewarp_composio" ? "A connected app" : p.serverName} needs your input</h3>
          {p.message ? <div>{p.message}</div> : null}
          <Actions busy={busy} options={[
            ...(!p.requestedSchema || !Object.keys(p.requestedSchema.properties || {}).length ? [{ label: "Continue", primary: true, run: () => respond({ action: "accept", content: {}, _meta: null }) }] : []),
            { label: "Decline", run: () => respond({ action: "decline", content: null, _meta: null }) },
            { label: "Cancel", run: () => respond({ action: "cancel", content: null, _meta: null }) },
          ]} />
        </div>
      );
    default:
      return (
        <div className="tw-approval" role="alert">
          <h3>Your agent requested an action</h3>
          <Actions busy={busy} options={[{ label: "Decline", run: () => respond({ decision: "denied" }) }]} />
        </div>
      );
  }
}
