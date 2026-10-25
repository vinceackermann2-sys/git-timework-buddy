import React, { useMemo, useRef, useState } from "react";
import { ArrowRight, Check, KeyRound, Send, Trash2, Wallet, Wrench } from "lucide-react";
import { call } from "../api.js";
import { useToast } from "./common.jsx";
import { formContent, formErrors, formFields, initialValues, pageLink, questionAnswers, questionErrors } from "../requests.mjs";

// Opens a page in the chat's browser pane (Shell.jsx), as links in messages do.
const openUrl = url => window.dispatchEvent(new CustomEvent("tw:open-url", { detail: { url } }));
const idFor = (request, key) => "tw-request-" + [request, key].map(part => String(part).replace(/[^\w-]/g, "")).join("-");
// Moves to the first answer that's missing or wrong.
const focusField = (form, key) => form?.querySelector(`[data-field="${CSS.escape(String(key))}"] :is(input, select, textarea, button):not(:disabled)`)?.focus();

function Actions({ busy, options }) {
  return (
    <div className="tw-approval-actions">
      {options.map(option => <button key={option.label} type={option.submit ? "submit" : "button"} className={"tw-btn " + (option.primary ? "primary" : "")} disabled={busy} onClick={option.run}>{option.label}</button>)}
    </div>
  );
}

// Options as rows, as the chat's select card shows them: numbered for one
// answer, check boxes for several.
function Options({ options, selected, multiple = false, disabled, label, onPick }) {
  return (
    <div className="tw-request-options" role={multiple ? "group" : "radiogroup"} aria-label={label}>
      {options.map((option, index) => {
        const on = selected.includes(option.value);
        return (
          <button key={option.value} type="button" role={multiple ? "checkbox" : "radio"} aria-checked={on} disabled={disabled} className="tw-option" onClick={() => onPick(option.value)}>
            {multiple
              ? <span className={"tw-option-check" + (on ? " on" : "")} aria-hidden="true">{on ? <Check size={11} strokeWidth={3} /> : null}</span>
              : <span className={"tw-number" + (on ? " on" : "")} aria-hidden="true">{index + 1}</span>}
            <span className="tw-option-text">{option.label}{option.description ? <small>{option.description}</small> : null}</span>
          </button>
        );
      })}
    </div>
  );
}

// A field's name ("Optional" when it may stay empty), its description, and
// what's missing or wrong once the user tried to send.
function FieldShell({ field, error, errorId, group = false, children }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="tw-field tw-request-field" data-field={field.key} data-invalid={error ? "true" : undefined}>
      <span>{field.label}{field.required ? null : <em className="tw-optional">Optional</em>}</span>
      {field.description ? <small className="tw-hint">{field.description}</small> : null}
      {children}
      {error ? <small className="tw-alert" id={errorId}>{error}</small> : null}
    </Tag>
  );
}

const INPUT_TYPES = { email: "email", url: "url", date: "date", datetime: "datetime-local", number: "number", integer: "number" };

function FormField({ request, field, value, error, disabled, onChange }) {
  const errorId = error ? idFor(request, field.key) : undefined;
  if (field.kind === "boolean") {
    return (
      <div className="tw-request-field" data-field={field.key}>
        <label className="tw-check"><input type="checkbox" checked={value === true} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span>{field.label}</span></label>
        {field.description ? <small className="tw-hint">{field.description}</small> : null}
      </div>
    );
  }
  if (field.kind === "choice" || field.kind === "choices") {
    const multiple = field.kind === "choices";
    const selected = multiple ? value || [] : value ? [value] : [];
    const pick = choice => onChange(!multiple ? choice : selected.includes(choice) ? selected.filter(item => item !== choice) : [...selected, choice]);
    // A long list of single choices is a dropdown.
    if (!multiple && field.options.length > 8) {
      return (
        <FieldShell field={field} error={error} errorId={errorId}>
          <select className="tw-dropdown" value={value} disabled={disabled} aria-invalid={!!error} aria-describedby={errorId} onChange={event => onChange(event.target.value)}>
            <option value="" disabled={field.required}>Choose…</option>
            {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
      );
    }
    return (
      <FieldShell field={field} error={error} errorId={errorId} group>
        <Options options={field.options} selected={selected} multiple={multiple} disabled={disabled} label={field.label} onPick={pick} />
      </FieldShell>
    );
  }
  return (
    <FieldShell field={field} error={error} errorId={errorId}>
      <input className="tw-input" type={INPUT_TYPES[field.kind] || "text"} value={value} disabled={disabled} autoComplete="off"
        step={field.kind === "integer" ? 1 : field.kind === "number" ? "any" : undefined} min={field.minimum} max={field.maximum} maxLength={field.maxLength}
        aria-required={field.required} aria-invalid={!!error} aria-describedby={errorId} onChange={event => onChange(event.target.value)} />
    </FieldShell>
  );
}

// A form an app sends (MCP elicitation). Its required fields are checked
// before it goes, and the first one missing gets the focus.
function FormRequest({ request, schema, busy, onSend, refuse }) {
  const { fields, unsupported } = useMemo(() => formFields(schema), [schema]);
  const [values, setValues] = useState(() => initialValues(fields));
  const [tried, setTried] = useState(false);
  const form = useRef(null);
  if (unsupported) return <><div className="tw-hint">Timewarp can't show this form.</div><Actions busy={busy} options={refuse} /></>;
  if (!fields.length) return <Actions busy={busy} options={[{ label: "Continue", primary: true, run: () => onSend({}) }, ...refuse]} />;
  const errors = tried ? formErrors(fields, values) : {};
  const submit = event => {
    event.preventDefault();
    const found = formErrors(fields, values);
    const first = fields.find(field => found[field.key]);
    if (first) { setTried(true); focusField(form.current, first.key); return; }
    onSend(formContent(fields, values));
  };
  return (
    <form ref={form} className="tw-request-form" noValidate onSubmit={submit}>
      {fields.map(field => <FormField key={field.key} request={request} field={field} value={values[field.key]} error={errors[field.key]} disabled={busy} onChange={value => setValues(current => ({ ...current, [field.key]: value }))} />)}
      <Actions busy={busy} options={[{ label: "Send", primary: true, submit: true }, ...refuse]} />
    </form>
  );
}

// The agent's questions: options as rows, and the user's own words where a
// question takes them. Each needs an answer before they're sent; a single
// question with options only goes as soon as one is picked.
function Questions({ request, questions, busy, onSubmit }) {
  const [drafts, setDrafts] = useState({}); // question id -> { option, text }
  const [tried, setTried] = useState(false);
  const form = useRef(null);
  const answers = Object.fromEntries(questions.map(question => [question.id, drafts[question.id]?.option ?? drafts[question.id]?.text ?? ""]));
  const errors = tried ? questionErrors(questions, answers) : {};
  const quick = questions.length === 1 && !!questions[0].options?.length && !questions[0].isOther;
  const send = current => {
    const found = questionErrors(questions, current);
    const first = questions.find(question => found[question.id]);
    if (first) { setTried(true); focusField(form.current, first.id); return; }
    onSubmit(questionAnswers(questions, current));
  };
  const set = (id, draft) => setDrafts(current => ({ ...current, [id]: draft }));
  return (
    <form ref={form} className="tw-request-form" noValidate onSubmit={event => { event.preventDefault(); send(answers); }}>
      {questions.map(question => {
        const draft = drafts[question.id] || {};
        const options = (question.options || []).map(option => ({ value: option.label, label: option.label, description: option.description }));
        const error = errors[question.id], errorId = error ? idFor(request, question.id) : undefined;
        return (
          <div key={question.id} className="tw-field tw-request-field" data-field={question.id} data-invalid={error ? "true" : undefined}>
            <span>{question.header ? <strong>{question.header}: </strong> : null}{question.question}</span>
            {options.length ? <Options options={options} selected={draft.option ? [draft.option] : []} disabled={busy} label={question.question}
              onPick={label => { set(question.id, { option: label, text: "" }); if (quick) send({ [question.id]: label }); }} /> : null}
            {question.isOther || !options.length ? (
              <input className="tw-input" type={question.isSecret ? "password" : "text"} autoComplete="off" value={draft.text ?? ""} disabled={busy}
                placeholder={options.length ? "Something else" : undefined} aria-label={options.length ? "Something else" : question.question}
                aria-invalid={!!error} aria-describedby={errorId} onChange={event => set(question.id, { option: null, text: event.target.value })} />
            ) : null}
            {error ? <small className="tw-alert" id={errorId}>{error}</small> : null}
          </div>
        );
      })}
      {quick ? null : <Actions busy={busy} options={[{ label: questions.length > 1 ? "Send answers" : "Send answer", primary: true, submit: true }]} />}
    </form>
  );
}

// Sending, paying or deleting, as Timewarp read it from the call itself
// (app/main/approvals.cjs), and using a vault item (vault-tools.cjs): where
// it happens, to whom, the text, the amount. Only the reason is the agent's own words.
const ACTION_ICONS = { send: Send, pay: Wallet, delete: Trash2, use: KeyRound };
function ActionCard({ p, busy, respond }) {
  const Icon = ACTION_ICONS[p.kind];
  return (
    <div className="tw-approval tw-action-card" data-kind={p.kind} role="alert">
      <h3>{p.title}</h3>
      {p.app ? <div className="tw-action-app"><Icon size={14} aria-hidden="true" /><span>{p.app}{p.account ? ` · ${p.account}` : ""}</span></div> : null}
      {p.lines?.length ? (
        <dl className="tw-action-lines">
          {p.lines.map((line, index) => <div key={index}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}
        </dl>
      ) : null}
      {p.body ? <div className="tw-action-body">{p.body}</div> : null}
      {/^data:image\/(?:jpeg|png);base64,/.test(p.image || "") ? <img className="tw-action-shot" src={p.image} alt="The page as it is now" /> : null}
      {p.reason ? <div className="tw-hint"><strong>{p.agent || "Your agent"}:</strong> {p.reason}</div> : null}
      <div className="tw-approval-actions">
        <button type="button" className={"tw-btn " + (p.kind === "delete" ? "destructive" : "primary")} disabled={busy} onClick={() => respond({ decision: "accept" })}>{p.action || "Allow"}</button>
        <button type="button" className="tw-btn" disabled={busy} onClick={() => respond({ decision: "decline" })}>Don't allow</button>
      </div>
    </div>
  );
}

// Codex asking before an MCP server's tool runs (approvals set to ask): the
// tool by its title, the values it gets, and whether to allow it for this chat.
const shortValue = value => { const text = typeof value === "string" ? value : JSON.stringify(value); return text && text.length > 300 ? text.slice(0, 299) + "…" : text; };
function ToolApproval({ p, busy, respond }) {
  const meta = p._meta || {};
  const tool = meta.tool_title || /run tool "([^"]+)"/.exec(p.message || "")?.[1] || "this tool";
  const lines = (meta.tool_params_display || []).filter(item => item && item.value !== undefined && item.value !== null && item.value !== "").slice(0, 8);
  const answer = persist => respond({ action: "accept", content: null, _meta: persist ? { persist } : null });
  const server = p.serverName === "timewarp_composio" ? "Connected apps" : p.serverName || "This server";
  const label = name => { const text = String(name || "").replace(/[_-]+/g, " ").trim(); return text ? text[0].toUpperCase() + text.slice(1) : ""; };
  return (
    <div className="tw-approval tw-action-card" role="alert">
      <h3>Allow {server} to run “{tool}”?</h3>
      <div className="tw-action-app"><Wrench size={14} aria-hidden="true" /><span>{server}</span></div>
      {lines.length ? <dl className="tw-action-lines">{lines.map(item => <div key={item.name}><dt>{label(item.display_name || item.name)}</dt><dd>{shortValue(item.value)}</dd></div>)}</dl> : null}
      {meta.tool_description ? <div className="tw-hint">{meta.tool_description}</div> : null}
      <Actions busy={busy} options={[
        { label: "Allow", primary: true, run: () => answer(null) },
        ...((meta.persist || []).includes("session") ? [{ label: "Allow for this chat", run: () => answer("session") }] : []),
        { label: "Decline", run: () => respond({ action: "decline", content: null, _meta: null }) },
      ]} />
    </div>
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
    // Timewarp's own question for an agent's request (app/main/app-tools.cjs):
    // the changes are Timewarp's checked values; only the reason is the agent's words.
    case "timewarp/confirm":
      if (ACTION_ICONS[p.kind]) return <ActionCard p={p} busy={busy} respond={respond} />;
      return (
        <div className="tw-approval tw-confirm-card" role="alert">
          <h3>{p.title || "Allow this change?"}</h3>
          {p.reason ? <div className="tw-hint"><strong>{p.agent || "Your agent"}:</strong> {p.reason}</div> : null}
          {p.changes?.length ? (
            <dl className="tw-confirm-changes">
              {p.changes.map(change => (
                <div key={change.key}>
                  <dt>{change.label}</dt>
                  <dd><span>{change.from}</span><ArrowRight size={13} aria-label="to" /><strong>{change.to}</strong></dd>
                </div>
              ))}
            </dl>
          ) : null}
          <Actions busy={busy} options={[
            { label: "Allow", primary: true, run: () => respond({ decision: "accept" }) },
            { label: "Don't allow", run: () => respond({ decision: "decline" }) },
          ]} />
        </div>
      );
    case "item/tool/requestUserInput":
      return (
        <div className="tw-approval" role="alert">
          <h3>{(p.questions || []).length > 1 ? "Your agent has questions" : "Your agent has a question"}</h3>
          <Questions request={approval.id} questions={p.questions || []} busy={busy} onSubmit={answers => respond({ answers })} />
        </div>
      );
    // An MCP server asking for something: a form (its schema), or a page to
    // open, such as a sign-in or an approval. The app's words are plain text.
    case "mcpServer/elicitation/request": {
      if (p._meta?.codex_approval_kind === "mcp_tool_call") return <ToolApproval p={p} busy={busy} respond={respond} />;
      const name = p.serverName === "timewarp_composio" ? "A connected app" : p.serverName || "An app";
      const refuse = [
        { label: "Decline", run: () => respond({ action: "decline", content: null, _meta: null }) },
        { label: "Cancel", run: () => respond({ action: "cancel", content: null, _meta: null }) },
      ];
      if (p.mode === "url") {
        const link = pageLink(p.url);
        return (
          <div className="tw-approval" role="alert">
            <h3>{name} asks you to open a page</h3>
            {p.message ? <div className="tw-request-message">{p.message}</div> : null}
            {link ? <div className="tw-request-host" title={link.href}>{link.host}</div> : <div className="tw-alert">This page can't be opened: its address isn't a secure web address.</div>}
            <Actions busy={busy} options={[
              ...(link ? [{ label: "Open page", primary: true, run: () => { openUrl(link.href); void respond({ action: "accept", content: null, _meta: null }); } }] : []),
              ...refuse,
            ]} />
          </div>
        );
      }
      return (
        <div className="tw-approval" role="alert">
          <h3>{name} needs your input</h3>
          {p.message ? <div className="tw-request-message">{p.message}</div> : null}
          <FormRequest request={approval.id} schema={p.requestedSchema} busy={busy} refuse={refuse} onSend={content => respond({ action: "accept", content, _meta: null })} />
        </div>
      );
    }
    default:
      return (
        <div className="tw-approval" role="alert">
          <h3>Your agent requested an action</h3>
          <Actions busy={busy} options={[{ label: "Decline", run: () => respond({ decision: "denied" }) }]} />
        </div>
      );
  }
}
