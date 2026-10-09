import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, TriangleAlert, X } from "lucide-react";
import { avatarSrc, errorText } from "../api.js";

export function Avatar({ agent, size = "" }) {
  return <img className={"tw-avatar " + size} src={avatarSrc(agent)} alt="" draggable="false" />;
}

// A modal dialog. With a title it draws the heading, description and close
// button used throughout the app.
export function Dialog({ open, onClose, children, label, title, description, wide = false, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={"tw-dialog" + (wide ? " wide" : "") + (className ? " " + className : "")} aria-label={label || title} onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}
      onMouseDown={event => { if (event.target === ref.current) onClose(); }}>
      {open ? (
        <div className="tw-dialog-body">
          {title ? (
            <div className="tw-dialog-head">
              <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
              <button type="button" className="tw-icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

// A popover anchored to its trigger; closes on outside click or Escape.
export function Menu({ trigger, children, align = "left", up = false, width, className = "", onOpenChange }) {
  const [open, setOpenState] = useState(false);
  const ref = useRef(null);
  const setOpen = useCallback(value => setOpenState(current => {
    const next = typeof value === "function" ? value(current) : value;
    if (next !== current) onOpenChange?.(next);
    return next;
  }), [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape, true); };
  }, [open, setOpen]);
  const style = { [align]: 0, ...(up ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }), ...(width ? { width } : {}) };
  return (
    <span className="tw-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen(value => !value), close: () => setOpen(false) })}
      {open ? (
        <div className={"tw-menu " + className} role="menu" style={style} onClick={event => { if (event.target.closest("[data-close]")) setOpen(false); }}>
          {typeof children === "function" ? children({ close: () => setOpen(false) }) : children}
        </div>
      ) : null}
    </span>
  );
}

// A menu at the pointer, for right-clicks on sidebar rows.
export function ContextMenu({ at, onClose, children, width = 176 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!at) return;
    const away = event => { if (!ref.current?.contains(event.target)) onClose(); };
    const escape = event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", onClose);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape, true); window.removeEventListener("blur", onClose); };
  }, [at, onClose]);
  if (!at) return null;
  const style = { position: "fixed", left: Math.max(8, Math.min(at.x, innerWidth - width - 8)), top: Math.max(8, Math.min(at.y, innerHeight - 140)), width };
  return (
    <div ref={ref} className="tw-menu tw-context-menu" role="menu" style={style} onClick={event => { if (event.target.closest("[data-close]")) onClose(); }}>
      {children}
    </div>
  );
}

// A compact dropdown: the current value with a chevron, options in a menu.
export function Select({ value, options, onChange, label, icon, align = "right", width = 200 }) {
  const current = options.find(option => option.value === value) || options[0];
  return (
    <Menu align={align} width={width} trigger={({ toggle, open }) => (
      <button type="button" className="tw-picker" aria-label={label} aria-expanded={open} onClick={toggle}>
        {current?.icon || icon || null}<span>{current?.label}</span><ChevronDown size={15} />
      </button>
    )}>
      {options.map(option => (
        <button key={option.value} type="button" className="tw-menu-item" data-close onClick={() => onChange(option.value)}>
          {option.icon || null}<span className="grow">{option.label}{option.description ? <small>{option.description}</small> : null}</span>
          {option.value === current?.value ? <Check size={15} /> : null}
        </button>
      ))}
    </Menu>
  );
}

export function SearchField({ value, onChange, placeholder, label, shortcut = false, autoFocus = false }) {
  const input = useRef(null);
  useEffect(() => {
    if (!shortcut) return;
    const find = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); input.current?.focus(); input.current?.select(); } };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, [shortcut]);
  const mac = window.tw?.platform === "darwin";
  return (
    <label className="tw-search-field">
      <Search size={17} />
      <input ref={input} className="tw-input" type="search" value={value} placeholder={placeholder} aria-label={label || placeholder} autoFocus={autoFocus} onChange={event => onChange(event.target.value)} />
      {shortcut && !value ? <span className="tw-keys"><kbd>{mac ? "⌘" : "Ctrl"}</kbd><kbd>F</kbd></span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return <button type="button" role="switch" className="tw-switch" aria-checked={!!checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="tw-segmented" role="group" aria-label={label}>
      {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  );
}

// A settings row: title and description on the left, a control on the right.
export function Row({ title, description, children }) {
  return (
    <div className="tw-set-row">
      <div><strong>{title}</strong>{description ? <span className="desc">{description}</span> : null}</div>
      {children}
    </div>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="tw-page-head">
      <div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
      {children}
    </div>
  );
}

const ToastContext = createContext(() => {});
export function useToast() { return useContext(ToastContext); }
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // A message, or { title, body } for a notice like the previous app's.
  const show = useCallback((message, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    const notice = message && typeof message === "object" && "title" in message;
    setToasts(list => [...list.slice(-3), { id, kind, title: notice ? message.title : null, message: notice ? message.body : kind === "error" ? errorText(message) : String(message) }]);
    setTimeout(() => setToasts(list => list.filter(toast => toast.id !== id)), kind === "error" || notice ? 8000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="tw-toasts" aria-live="polite">{toasts.map(toast => (
        <div key={toast.id} className={"tw-toast " + toast.kind}>
          {toast.kind === "warning" || toast.kind === "error" ? <TriangleAlert size={20} fill="currentColor" stroke="var(--surface)" /> : null}
          <div>{toast.title ? <strong>{toast.title}</strong> : null}<span>{toast.message}</span></div>
          <button type="button" aria-label="Dismiss" onClick={() => setToasts(list => list.filter(item => item.id !== toast.id))}><X size={14} /></button>
        </div>
      ))}</div>
    </ToastContext.Provider>
  );
}
