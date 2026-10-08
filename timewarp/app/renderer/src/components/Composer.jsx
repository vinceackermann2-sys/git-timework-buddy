import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, LoaderCircle, Mic, Paperclip, Square, X } from "lucide-react";
import { call } from "../api.js";
import { Menu, useToast } from "./common.jsx";
import { useDictation } from "../dictation.js";

const MAX_ATTACHMENT = 100 * 1024 * 1024;
const EFFORT_LABELS = { minimal: "Minimal", low: "Fast", medium: "Balanced", high: "Detailed", xhigh: "Extra detailed" };

export function ModelPicker({ models, onSelect }) {
  const choices = models?.choices || [];
  const selected = choices.find(choice => choice.id === models?.selected?.name) || choices[0];
  if (!selected) return null;
  const effort = models?.selected?.reasoningEffort || selected.defaultReasoningEffort;
  return (
    <Menu up align="left" width={300} trigger={({ toggle, open }) => (
      <button type="button" className="tw-btn ghost" style={{ height: 30, padding: "0 8px", fontWeight: 500 }} aria-expanded={open} onClick={toggle} aria-label="Model">
        <span>{selected.displayName || selected.id}</span>
        {effort ? <span className="tw-hint">{EFFORT_LABELS[effort] || effort}</span> : null}
        <ChevronDown size={14} />
      </button>
    )}>
      <div className="tw-menu-label">Model</div>
      {choices.map(choice => (
        <button key={choice.id} type="button" className="tw-menu-item" aria-selected={choice.id === selected.id} data-close onClick={() => onSelect({ name: choice.id, reasoningEffort: choice.id === selected.id ? effort : choice.defaultReasoningEffort })}>
          <span style={{ flex: 1 }}>{choice.displayName || choice.id}<small>{choice.description}</small></span>
          {choice.id === selected.id ? <Check size={15} /> : null}
        </button>
      ))}
      {selected.supportedReasoningEfforts?.length ? (
        <>
          <div className="tw-menu-label">Reasoning</div>
          {selected.supportedReasoningEfforts.map(option => (
            <button key={option.reasoningEffort} type="button" className="tw-menu-item" aria-selected={option.reasoningEffort === effort} data-close onClick={() => onSelect({ name: selected.id, reasoningEffort: option.reasoningEffort })}>
              <span style={{ flex: 1 }}>{EFFORT_LABELS[option.reasoningEffort] || option.reasoningEffort}<small>{option.description}</small></span>
              {option.reasoningEffort === effort ? <Check size={15} /> : null}
            </button>
          ))}
        </>
      ) : null}
    </Menu>
  );
}

export function Composer({ disabled, running, models, onModel, onSend, onStop, placeholder, autoFocusKey }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const area = useRef(null);
  const toast = useToast();
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(240, node.scrollHeight) + "px";
  }, [text]);
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
  return (
    <div className="tw-composer">
      <div className="tw-composer-box">
        {attachments.length ? (
          <div className="tw-attachments">
            {attachments.map(file => <span key={file.path} className="tw-chip" title={file.path}><span>{file.path.split(/[\\/]/).pop()}</span><button type="button" aria-label="Remove attachment" onClick={() => setAttachments(current => current.filter(item => item.path !== file.path))}><X size={12} /></button></span>)}
          </div>
        ) : null}
        <textarea ref={area} rows={1} value={text} placeholder={placeholder} disabled={disabled} aria-label="Message"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div className="tw-composer-row">
          <button type="button" className="tw-icon-button" title="Attach files" aria-label="Attach files" onClick={attach} disabled={disabled}><Paperclip size={16} /></button>
          {dictation.status === "recording" ? (
            <span className="tw-dictation" role="status">
              <i aria-hidden="true" />{clock(dictation.seconds)}
              <button type="button" className="tw-icon-button" title="Discard recording" aria-label="Discard recording" onClick={dictation.cancel}><X size={15} /></button>
              <button type="button" className="tw-icon-button" title="Finish and transcribe" aria-label="Finish and transcribe" onClick={dictation.stop}><Check size={15} /></button>
            </span>
          ) : dictation.status === "transcribing" ? (
            <span className="tw-dictation" role="status"><LoaderCircle size={14} className="tw-spin" /> Transcribing…</span>
          ) : (
            <button type="button" className="tw-icon-button" title="Dictate" aria-label="Dictate" onClick={() => void dictation.start()} disabled={disabled}><Mic size={16} /></button>
          )}
          <ModelPicker models={models} onSelect={onModel} />
          <span className="grow" />
          {running
            ? <button type="button" className="tw-send" title="Stop" aria-label="Stop" onClick={onStop}><Square size={13} fill="currentColor" /></button>
            : <button type="button" className="tw-send" title="Send" aria-label="Send" disabled={!canSend} onClick={() => void send()}><ArrowUp size={17} /></button>}
        </div>
      </div>
    </div>
  );
}
