import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { call } from "../api.js";

// The model and thinking picker, as in the previous app (its Timewarp picker,
// desktop/model-picker.cjs): the trigger shows the model, effort and speed;
// the popover has a thinking slider that drags continuously and saves once on
// release, a reset to the model's default, the speed when the model offers
// more than one, and a list of the current connection's models.

export const EFFORT_LABELS = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };
// "gpt-6.1-sol" and "GPT-5.6-Terra" read "GPT-6.1 Sol" and "GPT-5.6 Terra", as before.
export const modelName = choice => (choice?.displayName || String(choice?.id || "").replace(/^openai\//, ""))
  .replace(/^(gpt-[\d.]+)-?(sol|astra|luna|terra)$/i, (_, version, family) => `${version.toUpperCase()} ${family[0].toUpperCase()}${family.slice(1).toLowerCase()}`)
  .replace(/-(?=[A-Za-z][a-z]+$)/, " ");
const effortName = value => EFFORT_LABELS[value] || value || "";
// A model's Fast tier: Codex lists it as "priority", named "Fast".
const isFast = tier => tier?.value != null && (/^(priority|fast)$/i.test(tier.value) || /^fast$/i.test(tier.label || ""));
const BOLT = "m13 2-9 12h7l-1 8 10-12h-7l1-8Z";

// The thumb is 34px wide; the track runs between the centres of its two ends.
const THUMB = 34, HALF = THUMB / 2;

// The catalog every picker shares. Opening a picker reads it again
// (models.list), as before; the interface's own copy (the models prop) is
// newer when it has reloaded since (after a funding change).
let stamp = 0;
const stamps = new WeakMap();
const stampOf = list => { if (!list) return 0; if (!stamps.has(list)) stamps.set(list, ++stamp); return stamps.get(list); };
const store = { state: { value: null, error: "", loading: false, at: 0 }, listeners: new Set() };
const publish = patch => { store.state = { ...store.state, ...patch }; for (const listener of store.listeners) listener(); };
const subscribe = listener => { store.listeners.add(listener); return () => store.listeners.delete(listener); };
let reading = null;
function readCatalog() {
  if (reading) return reading;
  publish({ loading: true });
  reading = call("models.list")
    .then(value => publish({ value, error: value?.error || "", loading: false, at: ++stamp }),
      error => publish({ value: null, error: error?.message || "Models unavailable.", loading: false, at: ++stamp }))
    .finally(() => { reading = null; });
  return reading;
}

// The saved choice, for the trigger before the catalog has loaded.
let saved;
let savedRead = null;
function readSaved() {
  savedRead ||= call("settings.get").then(value => { saved = value?.modelSettings || null; }, () => { saved = null; }).finally(() => publish({}));
  return savedRead;
}

// The last catalog's names and levels, so the trigger reads the same while a
// new one loads after starting.
const CACHE = "tw.modelCatalog";
function cachedCatalog() { try { const value = JSON.parse(localStorage.getItem(CACHE) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function rememberCatalog(choices) {
  try { localStorage.setItem(CACHE, JSON.stringify(choices.map(({ id, displayName, supportedReasoningEfforts, defaultReasoningEffort, featured, serviceTiers, defaultServiceTier }) => ({ id, displayName, supportedReasoningEfforts, defaultReasoningEffort, featured, serviceTiers, defaultServiceTier })))); } catch {}
}

// The saved choice in a catalog, as requests resolve it (resolveModelSettings
// in shared/model-capabilities.cjs): the model with or without "openai/",
// otherwise the featured model; an effort or speed it doesn't offer becomes its default.
function resolve(choices, settings) {
  const name = settings?.name || "";
  const exact = choices.find(model => model.id === name) || choices.find(model => model.id === name.replace(/^openai\//, ""));
  const selected = exact || choices.find(model => model.featured) || choices[0];
  const efforts = [...new Set((selected?.supportedReasoningEfforts || []).map(item => item.reasoningEffort))];
  const effort = exact && efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : selected?.defaultReasoningEffort || settings?.reasoningEffort;
  const tiers = selected?.serviceTiers || [];
  const serviceTier = exact && tiers.some(tier => tier.value === settings.serviceTier) ? settings.serviceTier : selected?.defaultServiceTier ?? null;
  return { exact, selected, efforts, effort, tiers, serviceTier };
}

const Icon = ({ path }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;

// models: { choices, selected, error } from models.list (selected may be a
// chat's own model); onSelect({ name, reasoningEffort, serviceTier }) saves a choice.
export function ModelPicker({ models, onSelect, align = "right", up = true, disabled = false }) {
  const shared = useSyncExternalStore(subscribe, () => store.state);
  const fresh = shared.at > stampOf(models?.choices);
  const listing = fresh ? shared.value : models;
  const error = fresh ? shared.error : models?.error || "";
  const choices = useMemo(() => (error ? [] : listing?.choices) || [], [error, listing]);
  // While a choice is being saved it shows at once; changes made meanwhile are
  // saved in turn, the latest last.
  const [optimistic, setOptimistic] = useState(null);
  const [pending, setPending] = useState(false);
  const queued = useRef(null), saving = useRef(false);
  const known = models?.selected || shared.value?.selected || saved;
  const settings = optimistic || known || null;
  useEffect(() => { if (!models && !shared.value && saved === undefined) void readSaved(); }, [models, shared.value]);
  useEffect(() => { if (choices.length) rememberCatalog(choices); }, [choices]);

  const { selected, efforts, effort, tiers, serviceTier } = resolve(choices, settings || {});
  // Before the catalog loads, the trigger reads from the last one when it has the saved model.
  const label = useMemo(() => {
    if (selected) return null;
    const cached = resolve(cachedCatalog(), settings || {});
    return cached.exact ? cached : null;
  }, [selected, settings]);
  const shown = selected ? { selected, efforts, effort, tiers, serviceTier } : label;

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [view, setView] = useState("thinking");
  const [side, setSide] = useState(up ? "top" : "bottom");
  const [shift, setShift] = useState(0);
  const anchor = useRef(null), panel = useRef(null), trigger = useRef(null), modelButton = useRef(null), options = useRef([]);

  const [draft, setDraft] = useState(null);
  const drag = useRef(null);
  const catalogKey = JSON.stringify([selected?.id, efforts, selected?.serviceTiers]);
  const index = Math.max(0, efforts.indexOf(effort));
  const position = draft?.key === catalogKey ? draft.position : index;
  const previewEffort = efforts[Math.round(position)] || effort;
  const effortLabel = shown ? effortName(selected ? previewEffort : shown.effort) || "Thinking" : "";
  const speed = shown?.tiers.find(tier => tier.value === shown.serviceTier);
  // The trigger names the speed only when it isn't Standard, so Fast stands out.
  const speedLabel = shown?.tiers.length > 1 && speed?.value != null ? speed.label || "" : "";
  const fastTier = tiers.find(isFast);
  const fast = !!fastTier && serviceTier === fastTier.value;
  const name = modelName(shown?.selected || { id: settings?.name }) || (error ? "Model" : "");
  const full = [name, effortLabel, speedLabel].filter(Boolean).join(" · ");

  async function flush() {
    saving.current = true;
    setPending(true);
    while (queued.current) {
      const next = queued.current;
      queued.current = null;
      try { await onSelect?.(next); } catch {}
    }
    saving.current = false;
    setPending(false);
    setOptimistic(null);
  }
  const commit = choice => {
    setOptimistic(choice);
    queued.current = choice;
    if (!saving.current) void flush();
  };
  const changeEffort = value => {
    if (disabled || !selected || !efforts.includes(value)) return;
    setDraft({ key: catalogKey, position: efforts.indexOf(value), dragging: false });
    commit({ name: selected.id, reasoningEffort: value, serviceTier });
  };
  // The bolt turns Fast on and off; off is the model's other speed (Standard).
  const toggleFast = () => {
    if (disabled || !selected || !fastTier) return;
    commit({ name: selected.id, reasoningEffort: effort, serviceTier: fast ? tiers.find(tier => !isFast(tier))?.value ?? null : fastTier.value });
  };
  // Picking a model, even the current one, starts from its default effort and
  // speed; Fast stays on when the new model offers it.
  const chooseModel = model => {
    const keepFast = fast && (model.serviceTiers || []).find(isFast);
    commit({ name: model.id, reasoningEffort: model.defaultReasoningEffort, serviceTier: keepFast ? keepFast.value : model.defaultServiceTier ?? null });
    setView("thinking");
    requestAnimationFrame(() => modelButton.current?.focus());
  };

  const pointerPosition = (event, offset = 0) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(efforts.length - 1, (event.clientX - offset - bounds.left - HALF) / Math.max(1, bounds.width - THUMB) * (efforts.length - 1)));
  };
  const startDrag = event => {
    if (event.button !== 0 || disabled || efforts.length < 2) return;
    event.preventDefault();
    const input = event.currentTarget;
    input.focus();
    // The painted thumb, so grabbing it mid-glide keeps its place.
    const thumb = input.parentElement.querySelector(".tw-mp-thumb").getBoundingClientRect().left;
    const grabbing = Math.abs(event.clientX - thumb) <= HALF;
    const offset = grabbing ? event.clientX - thumb : 0;
    drag.current = { key: catalogKey, pointerId: event.pointerId, startX: event.clientX, offset, position: grabbing ? pointerPosition(event, offset) : Math.round(pointerPosition(event)), dragging: grabbing };
    setDraft(drag.current);
    input.setPointerCapture(event.pointerId);
  };
  const updateDrag = event => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId || current.key !== catalogKey || disabled) return;
    if (!current.dragging && Math.abs(event.clientX - current.startX) < 3) return;
    drag.current = { ...current, position: pointerPosition(event, current.offset), dragging: true };
    setDraft(drag.current);
  };
  const finishDrag = event => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.key === catalogKey && !disabled && event.type !== "pointercancel") changeEffort(efforts[Math.round(pointerPosition(event, current.offset))]);
    else setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const effortKey = event => {
    const moves = { ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1, Home: 0, End: efforts.length - 1, PageUp: index + 1, PageDown: index - 1 };
    if (Object.hasOwn(moves, event.key)) { event.preventDefault(); changeEffort(efforts[Math.max(0, Math.min(efforts.length - 1, moves[event.key]))]); }
  };
  useEffect(() => { drag.current = null; setDraft(null); }, [catalogKey, settings?.name, settings?.reasoningEffort, disabled]);

  // The popover fades and scales in and out (150ms), as the previous app's did.
  const closed = useRef(null);
  const show = value => {
    if (value === open) return;
    drag.current = null; setDraft(null);
    clearTimeout(closed.current);
    if (value) { setView("thinking"); setOpen(true); setClosing(false); setSide(up ? "top" : "bottom"); setShift(0); void readCatalog(); }
    else { setOpen(false); setClosing(true); closed.current = setTimeout(() => setClosing(false), 150); }
  };
  useEffect(() => () => clearTimeout(closed.current), []);
  const close = ({ focus = false } = {}) => { show(false); if (focus) trigger.current?.focus(); };

  // Opens toward the composer; flips when there's no room, and stays inside the window.
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    // Layout sizes, not the painted box, which is scaled while it opens.
    const base = anchor.current.getBoundingClientRect(), width = panel.current.offsetWidth, height = panel.current.offsetHeight;
    if (side === "top" && base.top - 8 - height < 8 && innerHeight - base.bottom > base.top) setSide("bottom");
    else if (side === "bottom" && base.bottom + 8 + height > innerHeight - 8 && base.top > innerHeight - base.bottom) setSide("top");
    const left = align === "left" ? base.left : base.right - width;
    const next = left < 12 ? 12 - left : left + width > innerWidth - 12 ? innerWidth - 12 - (left + width) : 0;
    if (Math.abs(next - shift) > 0.5) setShift(next);
  }, [open, side, view, selected?.id, error, shared.loading]);
  // Focus starts in the popover: the model button, or the selected model in the list.
  useEffect(() => {
    if (!open) return;
    if (view === "models") options.current[Math.max(0, choices.findIndex(model => model.id === selected?.id))]?.focus();
    else (modelButton.current || panel.current?.querySelector("button:not(:disabled), input:not(:disabled)"))?.focus();
  }, [open, view]);
  // Escape goes back from the list, otherwise closes; clicks outside close.
  useEffect(() => {
    if (!open) return;
    const away = event => { if (!anchor.current?.contains(event.target)) close(); };
    const escape = event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (view === "models") { setView("thinking"); requestAnimationFrame(() => modelButton.current?.focus()); }
      else close({ focus: true });
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape, true); };
  });

  const navigate = (event, at) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseModel(choices[at]); return; }
    const moves = { ArrowDown: (at + 1) % choices.length, ArrowUp: (at - 1 + choices.length) % choices.length, Home: 0, End: choices.length - 1 };
    if (Object.hasOwn(moves, event.key)) { event.preventDefault(); options.current[moves[event.key]]?.focus(); }
  };

  // Nothing to show until the saved choice or the catalog is known.
  if (!name) return null;
  const busy = pending || (!models && !shared.value && saved === undefined);
  const loading = !choices.length && !error && (shared.loading || !listing);
  const progress = efforts.length > 1 ? position / (efforts.length - 1) * 100 : 0;

  const content = !selected ? (
    <div className="tw-mp-status" role="status">
      <span>{loading || shared.loading ? "Loading models…" : "Models unavailable. Try again."}</span>
      {loading || shared.loading ? null : <button type="button" onClick={() => void readCatalog()}>Retry</button>}
    </div>
  ) : view === "models" ? (
    <div className="tw-mp-list">
      <div className="tw-mp-list-title">Choose model</div>
      <div className="tw-mp-list-heading"><span>Models</span><span>From your current AI connection</span></div>
      <div role="menu" aria-label="Models" className="tw-mp-options">
        {choices.map((model, at) => (
          <button key={model.id} type="button" role="menuitemradio" aria-checked={model.id === selected.id} disabled={disabled} tabIndex={model.id === selected.id ? 0 : -1}
            ref={node => { options.current[at] = node; }} className="tw-mp-option" onKeyDown={event => navigate(event, at)} onClick={() => chooseModel(model)}>
            <span>{modelName(model)}</span>{model.id === selected.id ? <Check aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </div>
  ) : (
    <div className="tw-mp-thinking">
      <div className="tw-mp-heading">
        <button type="button" className="tw-mp-bolt" aria-pressed={fast} aria-disabled={disabled || !fastTier}
          aria-label={fastTier ? "Fast" : "Fast isn't available for this model"}
          title={fastTier ? `Fast${fast ? " is on" : ""}${fastTier.description ? ": " + fastTier.description : ""}` : "Fast isn't available for this model"}
          onClick={toggleFast}><Icon path={BOLT} /></button>
        <div className="tw-mp-labels">
          <span className="tw-mp-level" aria-live="polite">{effortLabel}</span>
          <button type="button" ref={modelButton} className="tw-mp-choose" disabled={disabled} onClick={() => setView("models")} aria-label={`Choose model, ${name}`}>{name}<ChevronRight aria-hidden="true" /></button>
        </div>
        <button type="button" className="tw-mp-reset" disabled={disabled || effort === selected.defaultReasoningEffort} aria-label="Reset thinking to model default" title="Reset thinking to model default"
          onClick={() => changeEffort(selected.defaultReasoningEffort)}><Icon path="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" /></button>
      </div>
      <div className="tw-mp-slider" data-dragging={draft?.key === catalogKey && !!draft.dragging} style={{ "--tw-progress": `${progress}%` }}>
        <div className="tw-mp-track" aria-hidden="true"><div className="tw-mp-fill" /></div>
        <div className="tw-mp-dots" aria-hidden="true">{efforts.map((value, at) => <span key={value} data-filled={at <= Math.round(position)} />)}</div>
        <div className="tw-mp-thumb" aria-hidden="true" />
        <input type="range" min={0} max={Math.max(0, efforts.length - 1)} step="any" value={position} disabled={disabled || efforts.length < 2} aria-label="Thinking effort" aria-valuetext={effortLabel}
          title={selected.supportedReasoningEfforts?.find(item => item.reasoningEffort === previewEffort)?.description || undefined}
          onPointerDown={startDrag} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}
          onLostPointerCapture={() => { if (drag.current) { drag.current = null; setDraft(null); } }} onKeyDown={effortKey}
          onChange={event => { if (!drag.current) changeEffort(efforts[Math.round(Number(event.target.value))]); }} />
      </div>
      <div className="tw-mp-endpoints" aria-hidden="true"><span>{effortName(efforts[0])}</span><span>{effortName(efforts.at(-1))}</span></div>
      {tiers.length > 1 ? (
        <div className="tw-mp-speed">
          <div className="tw-mp-speed-label">Speed</div>
          <div className="tw-mp-speed-options" role="group" aria-label="Response speed">
            {tiers.map(tier => <button key={tier.value || "standard"} type="button" disabled={disabled} aria-pressed={tier.value === serviceTier} title={tier.description || undefined}
              onClick={() => commit({ name: selected.id, reasoningEffort: effort, serviceTier: tier.value })}>{tier.label}</button>)}
          </div>
          <p className="tw-mp-speed-description">{tiers.find(tier => tier.value === serviceTier)?.description}</p>
        </div>
      ) : null}
    </div>
  );

  return (
    <span className="tw-anchor tw-model-anchor" ref={anchor}>
      <button type="button" ref={trigger} className="tw-pill model" aria-expanded={open} aria-haspopup="dialog" disabled={disabled || busy} title={full} aria-label={"Model and thinking: " + full}
        onClick={() => show(!open)}>
        <span className="tw-model-name">{name}</span>
        {effortLabel ? <span className="tw-model-effort">{effortLabel}</span> : null}
        {speedLabel ? <span className="tw-model-speed" data-fast={isFast(speed) || undefined}>{isFast(speed) ? <Icon path={BOLT} /> : null}{speedLabel}</span> : null}
        <ChevronDown aria-hidden="true" />
      </button>
      {open || closing ? (
        <div ref={panel} className="tw-mp-panel" role="dialog" aria-label={view === "models" ? "Choose model" : "Model and thinking"} data-state={open ? "open" : "closed"} data-side={side}
          style={{ [align === "left" ? "left" : "right"]: align === "left" ? shift : -shift, ...(side === "top" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }) }}
          onBlur={event => { if (open && event.relatedTarget && !anchor.current?.contains(event.relatedTarget)) close(); }}>
          {content}
        </div>
      ) : null}
    </span>
  );
}
