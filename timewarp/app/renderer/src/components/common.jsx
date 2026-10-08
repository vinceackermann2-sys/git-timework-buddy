import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { avatarSrc, errorText } from "../api.js";

export function Avatar({ agent, size = "" }) {
  return <img className={"tw-avatar " + size} src={avatarSrc(agent)} alt="" draggable="false" />;
}

export function Dialog({ open, onClose, children, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="tw-dialog" aria-label={label} onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}
      onMouseDown={event => { if (event.target === ref.current) onClose(); }}>
      {open ? <div className="tw-dialog-body">{children}</div> : null}
    </dialog>
  );
}

// A popover anchored to its trigger; closes on outside click or Escape.
export function Menu({ trigger, children, align = "left", up = false, width }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const style = { [align]: 0, ...(up ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }), ...(width ? { width } : {}) };
  return (
    <span className="tw-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen(value => !value) })}
      {open ? <div className="tw-menu" role="menu" style={style} onClick={event => { if (event.target.closest("[data-close]")) setOpen(false); }}>{children}</div> : null}
    </span>
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

const ToastContext = createContext(() => {});
export function useToast() { return useContext(ToastContext); }
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((message, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(list => [...list.slice(-3), { id, message: kind === "error" ? errorText(message) : String(message), kind }]);
    setTimeout(() => setToasts(list => list.filter(toast => toast.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="tw-toasts" aria-live="polite">{toasts.map(toast => <div key={toast.id} className={"tw-toast " + toast.kind}>{toast.message}</div>)}</div>
    </ToastContext.Provider>
  );
}
