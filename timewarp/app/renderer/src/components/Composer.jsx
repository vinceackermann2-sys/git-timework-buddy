import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Gauge, LoaderCircle, Mic, Plus, RotateCcw, Search, Square, X, Zap } from "lucide-react";
import { call, initials, useEvent } from "../api.js";
import { Avatar, Menu, useToast } from "./common.jsx";
import { useDictation } from "../dictation.js";

const MAX_ATTACHMENT = 100 * 1024 * 1024;
export const EFFORT_LABELS = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high" };

// The selected model and reasoning level. The level is a slider; the model
// name opens the list of models.
export function ModelPicker({ models, onSelect, align = "right", up = true }) {
  const choices = models?.choices || [];
  const selected = choices.find(choice => choice.id === models?.selected?.name) || choices[0];
  const [view, setView] = useState("effort");
  if (!selected) return null;
  const efforts = (selected.supportedReasoningEfforts || []).map(option => option.reasoningEffort);
  const chosen = models?.selected?.name === selected.id ? models?.selected?.reasoningEffort : null;
  const effort = efforts.includes(chosen) ? chosen : selected.defaultReasoningEffort || efforts[0];
  const index = Math.max(0, efforts.indexOf(effort));
  const last = Math.max(1, efforts.length - 1);
  const name = selected.displayName || selected.id.replace(/^openai\//, "");
  return (
    <Menu up={up} align={align} className="tw-model-pop" onOpenChange={open => { if (open) setView("effort"); }} trigger={({ toggle, open }) => (
      <button type="button" className="tw-pill model" aria-expanded={open} onClick={toggle} aria-label="Model and reasoning">
        <span>{name}</span>{effort ? <em>{EFFORT_LABELS[effort] || effort}</em> : null}<ChevronDown size={15} />
      </button>
    )}>
      {view === "models" ? (
        <div className="tw-model-list">
          <button type="button" className="tw-menu-item" onClick={() => setView("effort")}><ArrowLeft size={15} /><span className="grow">Models</span></button>
          <div className="tw-menu-sep" />
          {choices.map(choice => (
            <button key={choice.id} type="button" className="tw-menu-item" onClick={() => { onSelect({ name: choice.id, reasoningEffort: choice.id === selected.id ? effort : choice.defaultReasoningEffort }); setView("effort"); }}>
              <span className="grow">{choice.displayName || choice.id}<small>{choice.description}</small></span>
              {choice.id === selected.id ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      ) : (
        <>
          <header>
            <Zap size={20} className="tw-model-icon" />
            <div>
              <strong>{EFFORT_LABELS[effort] || effort || "Thinking"}</strong>
              <button type="button" className="model" onClick={() => setView("models")}>{name}<ChevronRight size={14} /></button>
            </div>
            <button type="button" className="tw-icon-button" title="Reset to default" aria-label="Reset to default" disabled={effort === selected.defaultReasoningEffort}
              onClick={() => onSelect({ name: selected.id, reasoningEffort: selected.defaultReasoningEffort })}><RotateCcw size={18} /></button>
          </header>
          {efforts.length > 1 ? (
            <>
              <div className="tw-effort">
                {efforts.map((option, position) => position === index ? null : <i key={option} className="stop" style={{ left: `calc((100% - 34px) * ${position / last} + 15px)` }} />)}
                <span className="knob" style={{ left: `calc((100% - 34px) * ${index / last} + 1px)` }} />
                <input type="range" min="0" max={efforts.length - 1} step="1" value={index} aria-label="Reasoning"
                  aria-valuetext={EFFORT_LABELS[effort] || effort}
                  onChange={event => onSelect({ name: selected.id, reasoningEffort: efforts[Number(event.target.value)] })} />
              </div>
              <div className="tw-effort-ends"><span>{EFFORT_LABELS[efforts[0]] || efforts[0]}</span><span>{EFFORT_LABELS[efforts.at(-1)] || efforts.at(-1)}</span></div>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}

// Connected apps, shared by the tools picker and Settings → Tools.
let appsCache = null;
export function useApps() {
  const [state, setState] = useState(appsCache || { items: null, error: "" });
  const load = () => call("integrations.list", {}).then(value => { appsCache = { items: value.items || [], error: "" }; setState(appsCache); })
    .catch(error => setState(current => ({ items: current.items || [], error: error.message })));
  useEffect(() => { void load(); }, []);
  useEvent("integrations.changed", () => void load());
  return { ...state, reload: load };
}

export function AppIcon({ app, size = 16 }) {
  const [failed, setFailed] = useState(false);
  if (app?.iconUrl && !failed) return <img src={app.iconUrl} alt="" width={size} height={size} style={{ borderRadius: 3, flex: "none" }} onError={() => setFailed(true)} />;
  return <span className="tw-app-letter" style={{ width: size, height: size, fontSize: size * 0.6 }}>{initials(app?.displayName).slice(0, 1)}</span>;
}

// Which connected apps the chosen agent can use, and featured apps to connect.
export function ToolsPicker({ agentId, onBrowse }) {
  const { items } = useApps();
  const [access, setAccess] = useState(undefined);
  const [query, setQuery] = useState("");
  const toast = useToast();
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    call("integrations.getAccess", { agentId }).then(value => { if (!cancelled) setAccess(value.items ?? null); }).catch(() => { if (!cancelled) setAccess(null); });
    return () => { cancelled = true; };
  }, [agentId, items]);
  const connected = (items || []).filter(app => app.accounts?.length);
  const accounts = connected.flatMap(app => app.accounts.map(account => ({ app, account })));
  const allowed = app => access == null || access.some(item => item.integrationId === app.id);
  const enabled = connected.filter(allowed);
  async function toggle(app) {
    const on = allowed(app);
    const current = accounts.filter(entry => access == null || access.some(item => item.integrationId === entry.app.id && item.accountId === entry.account.id));
    const next = on ? current.filter(entry => entry.app.id !== app.id) : [...current, ...app.accounts.map(account => ({ app, account }))];
    const value = next.length === accounts.length ? null : next.map(entry => ({ kind: "integration", owner: "user", integrationId: entry.app.id, accountId: entry.account.id }));
    const previous = access;
    setAccess(value);
    try { await call("integrations.setAccess", { agentId, items: value }); } catch (error) { setAccess(previous); toast(error, "error"); }
  }
  const match = app => !query.trim() || app.displayName.toLowerCase().includes(query.trim().toLowerCase());
  const featured = (items || []).filter(app => !app.accounts?.length && (query.trim() ? true : app.featured)).filter(match).slice(0, query.trim() ? 12 : 5);
  return (
    <Menu up={false} align="left" width={240} className="tw-tools-menu" trigger={({ toggle, open }) => (
      <button type="button" className="tw-pill" aria-expanded={open} onClick={toggle} aria-label="Tools">
        {enabled.length ? <span className="tw-pill-icons">{enabled.slice(0, 3).map(app => <AppIcon key={app.id} app={app} />)}</span> : null}
        <span>Tools</span><ChevronDown size={15} />
      </button>
    )}>
      <label className="tw-menu-search"><Search size={16} /><input autoFocus value={query} placeholder="Search tools..." aria-label="Search tools" onChange={event => setQuery(event.target.value)} /></label>
      {items === null ? <div className="tw-menu-label">Loading…</div> : null}
      {connected.filter(match).length ? <div className="tw-menu-label">Connected</div> : null}
      {connected.filter(match).map(app => (
        <button key={app.id} type="button" className={"tw-menu-item" + (allowed(app) ? " selected" : "")} aria-pressed={allowed(app)} onClick={() => void toggle(app)}>
          <AppIcon app={app} /><span className="grow">{app.displayName}</span>{allowed(app) ? <Check size={15} /> : null}
        </button>
      ))}
      {featured.length ? <div className="tw-menu-label">{query.trim() ? "Available" : "Featured"}</div> : null}
      {featured.map(app => (
        <button key={app.id} type="button" className="tw-menu-item" data-close onClick={() => call("integrations.beginConnect", { integrationId: app.id }).then(() => toast("Finish connecting in your browser.")).catch(error => toast(error, "error"))}>
          <AppIcon app={app} /><span className="grow">{app.displayName}</span><Plus size={16} />
        </button>
      ))}
      <div className="tw-menu-sep" />
      <button type="button" className="tw-menu-item" data-close onClick={onBrowse}><span className="grow">Browse all tools</span><ArrowUpRight size={16} /></button>
    </Menu>
  );
}

export function AgentPicker({ agents, value, onChange, onNewAgent }) {
  const agent = agents.find(item => item.id === value) || agents[0];
  if (!agent) return null;
  return (
    <Menu up={false} align="left" width={224} trigger={({ toggle, open }) => (
      <button type="button" className="tw-pill agent" aria-expanded={open} onClick={toggle} aria-label="Agent">
        <Avatar agent={agent} size="tiny" /><span>{agent.name}</span><ChevronDown size={15} />
      </button>
    )}>
      {agents.map(item => (
        <button key={item.id} type="button" className="tw-menu-item" data-close onClick={() => onChange(item.id)}>
          <Avatar agent={item} size="tiny" /><span className="grow">{item.name}</span>{item.id === agent.id ? <Check size={15} /> : null}
        </button>
      ))}
      <div className="tw-menu-sep" />
      <button type="button" className="tw-menu-item" data-close onClick={onNewAgent}><Plus size={16} /><span className="grow">New Agent</span></button>
    </Menu>
  );
}

// The strip above the composer when AI usage can't be funded.
export function FundingBanner({ funding, onOptions }) {
  if (!funding || funding.canFundUsage !== false) return null;
  const text = funding.subscriptionAllowed ? "Use your ChatGPT plan with Timewarp." : "Add credits or change your plan to keep going.";
  return (
    <button type="button" className="tw-banner" onClick={onOptions}>
      <Gauge size={14} /><strong>Limit reached</strong><span aria-hidden="true">·</span><span className="grow">{text}</span><span className="end">See options</span>
    </button>
  );
}

export function Composer({ variant = "compact", disabled, running, models, onModel, onSend, onStop, placeholder, autoFocusKey, tools, banner }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [tall, setTall] = useState(false);
  const area = useRef(null);
  const toast = useToast();
  const large = variant === "large";
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(large ? 260 : 200, node.scrollHeight) + "px";
    setTall(node.scrollHeight > 44);
  }, [text, large]);
  useEffect(() => { area.current?.focus(); }, [autoFocusKey]);
  const canSend = !disabled && !sending && !running && (text.trim() || attachments.length);
  async function send() {
    if (!canSend) return;
    const message = { text: text.trim(), images: attachments.filter(file => file.image).map(file => file.path), files: attachments.filter(file => !file.image).map(file => file.path) };
    setSending(true);
    try {
      await onSend(message);
      setText("");
      setAttachments([]);
    } catch (error) { toast(error, "error"); }
    finally { setSending(false); area.current?.focus(); }
  }
  const dictation = useDictation({
    onText: spoken => { setText(current => (current.trim() ? current.replace(/\s*$/, " ") : "") + spoken); area.current?.focus(); },
    onError: error => toast(error, "error"),
  });
  const clock = seconds => Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  async function attach() {
    try {
      const chosen = await call("attachments.choose");
      if (chosen.some(file => file.size > MAX_ATTACHMENT)) toast("Files over 100 MB can't be attached.", "error");
      const usable = chosen.filter(file => file.size <= MAX_ATTACHMENT);
      if (usable.length) setAttachments(current => [...current, ...usable.filter(file => !current.some(item => item.path === file.path))].slice(0, 10));
    }
    catch (error) { toast(error, "error"); }
  }
  const chips = attachments.length ? (
    <div className="tw-attachments">
      {attachments.map(file => <span key={file.path} className="tw-chip" title={file.path}><span>{file.path.split(/[\\/]/).pop()}</span><button type="button" aria-label="Remove attachment" onClick={() => setAttachments(current => current.filter(item => item.path !== file.path))}><X size={12} /></button></span>)}
    </div>
  ) : null;
  const input = (
    <textarea ref={area} rows={1} value={text} placeholder={placeholder} disabled={disabled} aria-label="Message"
      onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
  );
  const add = <button type="button" className="tw-round" title="Add context" aria-label="Add context" onClick={attach} disabled={disabled}><Plus size={20} strokeWidth={1.6} /></button>;
  const end = (
    <>
      {dictation.status === "recording" ? (
        <span className="tw-dictation" role="status">
          <i aria-hidden="true" />{clock(dictation.seconds)}
          <button type="button" className="tw-round" title="Discard recording" aria-label="Discard recording" onClick={dictation.cancel}><X size={16} /></button>
          <button type="button" className="tw-round" title="Finish and transcribe" aria-label="Finish and transcribe" onClick={dictation.stop}><Check size={16} /></button>
        </span>
      ) : dictation.status === "transcribing" ? (
        <span className="tw-dictation" role="status"><LoaderCircle size={14} className="tw-spin" /> Transcribing…</span>
      ) : (
        <>
          <ModelPicker models={models} onSelect={onModel} />
          <button type="button" className="tw-round" title="Start voice input" aria-label="Start voice input" onClick={() => void dictation.start()} disabled={disabled}><Mic size={18} strokeWidth={1.7} /></button>
        </>
      )}
      {running
        ? <button type="button" className="tw-send stop" title="Stop" aria-label="Stop" onClick={onStop}><Square size={12} fill="currentColor" /></button>
        : <button type="button" className="tw-send" title="Send" aria-label="Send" disabled={!canSend} onClick={() => void send()}><ArrowUp size={18} strokeWidth={1.8} /></button>}
    </>
  );
  return (
    <div className="tw-composer">
      <div className="tw-composer-inner">
        {banner}
        {large ? (
          <div className="tw-composer-box large">
            {chips}
            {input}
            <div className="tw-composer-row">{add}{tools}<span className="grow" />{end}</div>
          </div>
        ) : (
          <div className={"tw-composer-box compact" + (tall || attachments.length ? " tall" : "")}>
            {add}
            <div className="tw-compact-input">{chips}{input}</div>
            {end}
          </div>
        )}
      </div>
    </div>
  );
}
