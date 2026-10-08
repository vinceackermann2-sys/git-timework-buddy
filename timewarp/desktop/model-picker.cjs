"use strict";

// The renderer supplies its native React, popover primitives and catalog query.
function createModelPicker({ React, jsx, Popover, Trigger, Content, Button, ChevronDown, ChevronRight, Check, useModels }) {
  const labels = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
  const modelName = model => (model.displayName || model.id.replace(/^openai\//, '')).replace(/^(gpt-[\d.]+)-?(sol|astra|luna|terra)$/i, (_, version, family) => `${version.toUpperCase()} ${family[0].toUpperCase()}${family.slice(1).toLowerCase()}`);
  const icon = path => jsx.jsx('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, children: jsx.jsx('path', { d: path }) });
  return function ModelPicker({ children, disabled = false, onChange, settings }) {
    const query = useModels(), models = query.isError ? [] : query.data || [];
    const exact = models.find(model => model.id === settings.name) || models.find(model => model.id === settings.name.replace(/^openai\//, ''));
    const selected = exact || models.find(model => model.featured) || models[0];
    const efforts = [...new Set((selected?.supportedReasoningEfforts || []).map(item => item.reasoningEffort))];
    const effort = exact && efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : selected?.defaultReasoningEffort || settings.reasoningEffort;
    const index = Math.max(0, efforts.indexOf(effort));
    const [draft, setDraft] = React.useState(null);
    const drag = React.useRef(null);
    const catalogKey = JSON.stringify([selected?.id, efforts, selected?.serviceTiers]);
    const position = draft?.key === catalogKey ? draft.position : index;
    const previewEffort = efforts[Math.round(position)] || effort;
    const effortLabel = selected ? labels[previewEffort] || previewEffort || 'Thinking' : '';
    const tiers = selected?.serviceTiers || [];
    const serviceTier = exact && tiers.some(tier => tier.value === settings.serviceTier) ? settings.serviceTier : selected?.defaultServiceTier ?? null;
    const speed = tiers.find(tier => tier.value === serviceTier);
    const speedLabel = tiers.length > 1 ? speed?.label : '';
    const name = modelName(selected || { id: settings.name });
    const [open, setOpen] = React.useState(false), [view, setView] = React.useState('thinking');
    const options = React.useRef([]), modelButton = React.useRef(null);
    const changeEffort = value => { if (!disabled && selected && efforts.includes(value)) { setDraft({ key: catalogKey, position: efforts.indexOf(value), dragging: false }); onChange({ name: selected.id, reasoningEffort: value, serviceTier }); } };
    const pointerPosition = (event, offset = 0) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return Math.max(0, Math.min(efforts.length - 1, (event.clientX - offset - bounds.left - 17) / Math.max(1, bounds.width - 34) * (efforts.length - 1)));
    };
    const startDrag = event => {
      if (event.button !== 0 || disabled || efforts.length < 2) return;
      event.preventDefault();
      const input = event.currentTarget;
      input.focus();
      // Read the painted thumb so grabbing it mid-animation keeps its position.
      const center = input.parentElement.querySelector('.timewarp-thinking-thumb').getBoundingClientRect().left;
      const grabbingThumb = Math.abs(event.clientX - center) <= 17;
      const offset = grabbingThumb ? event.clientX - center : 0;
      drag.current = { key: catalogKey, pointerId: event.pointerId, startX: event.clientX, offset,
        position: grabbingThumb ? pointerPosition(event, offset) : Math.round(pointerPosition(event)), dragging: grabbingThumb };
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
      if (current.key === catalogKey && !disabled && event.type !== 'pointercancel') changeEffort(efforts[Math.round(pointerPosition(event, current.offset))]);
      else setDraft(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const effortKey = event => {
      const moves = { ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1, Home: 0, End: efforts.length - 1, PageUp: index + 1, PageDown: index - 1 };
      if (Object.hasOwn(moves, event.key)) { event.preventDefault(); changeEffort(efforts[Math.max(0, Math.min(efforts.length - 1, moves[event.key]))]); }
    };
    const chooseModel = model => {
      onChange({ name: model.id, reasoningEffort: model.defaultReasoningEffort, serviceTier: model.defaultServiceTier ?? null });
      setView('thinking');
      requestAnimationFrame(() => modelButton.current?.focus());
    };
    React.useEffect(() => {
      if (open && view === 'models') options.current[Math.max(0, models.findIndex(model => model.id === selected?.id))]?.focus();
    }, [open, view]);
    React.useEffect(() => { drag.current = null; setDraft(null); }, [catalogKey, settings.name, settings.reasoningEffort, disabled]);
    const navigate = (event, at) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseModel(models[at]); return; }
      const moves = { ArrowDown: (at + 1) % models.length, ArrowUp: (at - 1 + models.length) % models.length, Home: 0, End: models.length - 1 };
      if (Object.hasOwn(moves, event.key)) { event.preventDefault(); options.current[moves[event.key]]?.focus(); }
    };
    return jsx.jsxs(Popover, { open, onOpenChange: value => { setOpen(value); setView('thinking'); drag.current = null; setDraft(null); if (value) void query.refetch(); }, children: [
      jsx.jsx(Trigger, { disabled, render: children?.({ label: [name, effortLabel, speedLabel].filter(Boolean).join(' · '), modelLabel: name, effortLabel, speedLabel, custom: true }) || jsx.jsxs(Button, {
        type: 'button', variant: 'ghost', size: 'sm', className: 'timewarp-model-trigger', 'aria-label': `Model and thinking: ${name}, ${effortLabel}`,
        children: [jsx.jsx('span', { className: 'timewarp-model-name', children: name }), jsx.jsx('span', { className: 'timewarp-model-effort', children: effortLabel }), speedLabel && jsx.jsx('span', { className: 'timewarp-model-speed', children: speedLabel }), jsx.jsx(ChevronDown, { 'aria-hidden': true })]
      }) }),
      jsx.jsx(Content, { align: 'end', side: 'top', sideOffset: 8, className: 'timewarp-picker-panel', 'aria-label': view === 'models' ? 'Choose model' : 'Model and thinking',
        onKeyDownCapture: event => { if (event.key === 'Escape' && view === 'models') { event.preventDefault(); event.stopPropagation(); setView('thinking'); requestAnimationFrame(() => modelButton.current?.focus()); } },
        children: !selected ? jsx.jsxs('div', { className: 'timewarp-picker-status', role: 'status', children: [
          jsx.jsx('span', { children: query.isPending ? 'Loading models…' : 'Models unavailable. Try again.' }),
          !query.isPending && jsx.jsx('button', { type: 'button', onClick: () => query.refetch(), children: 'Retry' })
        ] }) : view === 'models' ? jsx.jsxs('div', { className: 'timewarp-model-list', children: [
          jsx.jsx('div', { className: 'timewarp-model-list-title', children: 'Choose model' }),
          jsx.jsxs('div', { className: 'timewarp-model-list-heading', children: [jsx.jsx('span', { children: 'Models' }), jsx.jsx('span', { children: 'From your current AI connection' })] }),
          jsx.jsx('div', { role: 'menu', 'aria-label': 'Models', className: 'timewarp-model-options', children: models.map((model, at) => jsx.jsxs('button', {
            type: 'button', role: 'menuitemradio', 'aria-checked': model.id === selected.id, disabled, tabIndex: model.id === selected.id ? 0 : -1,
            ref: node => { options.current[at] = node; }, className: 'timewarp-model-option', onKeyDown: event => navigate(event, at), onClick: () => chooseModel(model),
            children: [jsx.jsx('span', { children: modelName(model) }), model.id === selected.id && jsx.jsx(Check, { 'aria-hidden': true })]
          }, model.id)) })
        ] }) : jsx.jsxs('div', { className: 'timewarp-thinking', children: [
          jsx.jsxs('div', { className: 'timewarp-thinking-heading', children: [
            jsx.jsx('span', { className: 'timewarp-thinking-bolt', children: icon('m13 2-9 12h7l-1 8 10-12h-7l1-8Z') }),
            jsx.jsxs('div', { className: 'timewarp-thinking-labels', children: [
              jsx.jsx('span', { className: 'timewarp-thinking-level', 'aria-live': 'polite', children: effortLabel }),
              jsx.jsxs('button', { type: 'button', ref: modelButton, className: 'timewarp-choose-model', disabled, onClick: () => setView('models'), 'aria-label': `Choose model, ${name}`, children: [name, jsx.jsx(ChevronRight, { 'aria-hidden': true })] })
            ] }),
            jsx.jsx('button', { type: 'button', className: 'timewarp-thinking-reset', disabled: disabled || effort === selected.defaultReasoningEffort, 'aria-label': 'Reset thinking to model default', title: 'Reset thinking to model default', onClick: () => changeEffort(selected.defaultReasoningEffort), children: icon('M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6') })
          ] }),
          jsx.jsxs('div', { className: 'timewarp-thinking-slider', 'data-dragging': draft?.key === catalogKey && draft.dragging, style: { '--tw-progress': `${efforts.length > 1 ? position / (efforts.length - 1) * 100 : 0}%` }, children: [
            jsx.jsx('div', { className: 'timewarp-thinking-track', 'aria-hidden': true, children: jsx.jsx('div', { className: 'timewarp-thinking-fill' }) }),
            jsx.jsx('div', { className: 'timewarp-thinking-dots', 'aria-hidden': true, children: efforts.map((value, at) => jsx.jsx('span', { 'data-filled': at <= Math.round(position) }, value)) }),
            jsx.jsx('div', { className: 'timewarp-thinking-thumb', 'aria-hidden': true }),
            jsx.jsx('input', { type: 'range', min: 0, max: Math.max(0, efforts.length - 1), step: 'any', value: position, disabled: disabled || efforts.length < 2, 'aria-label': 'Thinking effort', 'aria-valuetext': effortLabel, title: selected.supportedReasoningEfforts?.find(item => item.reasoningEffort === previewEffort)?.description,
              onPointerDown: startDrag, onPointerMove: updateDrag,
              onPointerUp: finishDrag, onPointerCancel: finishDrag, onLostPointerCapture: () => { if (drag.current) { drag.current = null; setDraft(null); } }, onKeyDown: effortKey,
              onChange: event => { if (!drag.current) changeEffort(efforts[Math.round(Number(event.target.value))]); } })
          ] }),
          jsx.jsx('div', { className: 'timewarp-thinking-endpoints', 'aria-hidden': true, children: [jsx.jsx('span', { children: labels[efforts[0]] || efforts[0] }, 'first'), jsx.jsx('span', { children: labels[efforts.at(-1)] || efforts.at(-1) }, 'last')] }),
          tiers.length > 1 && jsx.jsxs('div', { className: 'timewarp-speed', children: [
            jsx.jsx('div', { className: 'timewarp-speed-label', children: 'Speed' }),
            jsx.jsx('div', { className: 'timewarp-speed-options', role: 'group', 'aria-label': 'Response speed', children: tiers.map(tier => jsx.jsx('button', { type: 'button', disabled, 'aria-pressed': tier.value === serviceTier, title: tier.description, onClick: () => onChange({ name: selected.id, reasoningEffort: effort, serviceTier: tier.value }), children: tier.label }, tier.value || 'standard')) }),
            jsx.jsx('p', { className: 'timewarp-speed-description', children: speed?.description })
          ] })
        ] })
      })
    ] });
  };
}
module.exports = { createModelPicker };
