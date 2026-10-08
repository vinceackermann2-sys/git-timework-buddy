import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Paperclip, Square, X } from "lucide-react";
import { call } from "../api.js";
import { Menu, useToast } from "./common.jsx";

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
  const [images, setImages] = useState([]);
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
  const canSend = !disabled && !sending && !running && (text.trim() || images.length);
  async function send() {
    if (!canSend) return;
    const message = { text: text.trim(), images };
    setSending(true);
    try {
      await onSend(message);
      setText("");
      setImages([]);
    } catch (error) { toast(error, "error"); }
    finally { setSending(false); area.current?.focus(); }
  }
  async function attach() {
    try { const files = await call("attachments.choose"); if (files.length) setImages(current => [...new Set([...current, ...files])].slice(0, 8)); }
    catch (error) { toast(error, "error"); }
  }
  return (
    <div className="tw-composer">
      <div className="tw-composer-box">
        {images.length ? (
          <div className="tw-attachments">
            {images.map(file => <span key={file} className="tw-chip" title={file}><span>{file.split(/[\\/]/).pop()}</span><button type="button" aria-label="Remove attachment" onClick={() => setImages(current => current.filter(item => item !== file))}><X size={12} /></button></span>)}
          </div>
        ) : null}
        <textarea ref={area} rows={1} value={text} placeholder={placeholder} disabled={disabled} aria-label="Message"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div className="tw-composer-row">
          <button type="button" className="tw-icon-button" title="Attach images" aria-label="Attach images" onClick={attach} disabled={disabled}><Paperclip size={16} /></button>
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
