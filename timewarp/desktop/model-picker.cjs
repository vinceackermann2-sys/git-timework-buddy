"use strict";

// The renderer supplies its native React, popover primitives and catalog query.
function createModelPicker({ React, jsx, Popover, Trigger, Content, Button, ChevronDown, ChevronRight, Check, useModels }) {
  const labels = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
  const modelName = model => (model.displayName || model.id.replace(/^openai\//, '')).replace(/^(gpt-[\d.]+)-?(sol|astra|luna|terra)$/i, (_, version, family) => `${version.toUpperCase()} ${family[0].toUpperCase()}${family.slice(1).toLowerCase()}`);
  const icon = path => jsx.jsx('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, children: jsx.jsx('path', { d: path }) });
  return function ModelPicker({ children, disabled = false, onChange, settings }) {
    const query = useModels(), models = query.data || [];
    const selected = models.find(model => model.id === settings.name) || models.find(model => model.id === settings.name.replace(/^openai\//, '')) || models.find(model => model.featured) || models[0];
    const efforts = [...new Set((selected?.supportedReasoningEfforts || []).map(item => item.reasoningEffort))];
    const effort = efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : selected?.defaultReasoningEffort || settings.reasoningEffort;
    const index = Math.max(0, efforts.indexOf(effort));
    const effortLabel = labels[effort] || effort || 'Thinking';
    const name = modelName(selected || { id: settings.name });
    const [open, setOpen] = React.useState(false), [view, setView] = React.useState('thinking');
    const options = React.useRef([]), modelButton = React.useRef(null);
    const changeEffort = value => onChange({ name: selected.id, reasoningEffort: value, serviceTier: selected.defaultServiceTier ?? null });
    const chooseModel = model => {
      onChange({ name: model.id, reasoningEffort: model.defaultReasoningEffort, serviceTier: model.defaultServiceTier ?? null });
      setView('thinking');
      requestAnimationFrame(() => modelButton.current?.focus());
    };
    React.useEffect(() => {
      if (open && view === 'models') options.current[Math.max(0, models.findIndex(model => model.id === selected?.id))]?.focus();
    }, [open, view]);
    const navigate = (event, at) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseModel(models[at]); return; }
      const moves = { ArrowDown: (at + 1) % models.length, ArrowUp: (at - 1 + models.length) % models.length, Home: 0, End: models.length - 1 };
      if (Object.hasOwn(moves, event.key)) { event.preventDefault(); options.current[moves[event.key]]?.focus(); }
    };
    return jsx.jsxs(Popover, { open, onOpenChange: value => { setOpen(value); setView('thinking'); if (value) void query.refetch(); }, children: [
      jsx.jsx(Trigger, { disabled, render: children?.({ label: `${name} ${effortLabel}`, modelLabel: name, effortLabel, custom: true }) || jsx.jsxs(Button, {
        type: 'button', variant: 'ghost', size: 'sm', className: 'timewarp-model-trigger', 'aria-label': `Model and thinking: ${name}, ${effortLabel}`,
        children: [jsx.jsx('span', { className: 'timewarp-model-name', children: name }), jsx.jsx('span', { className: 'timewarp-model-effort', children: effortLabel }), jsx.jsx(ChevronDown, { 'aria-hidden': true })]
      }) }),
      jsx.jsx(Content, { align: 'end', side: 'top', sideOffset: 8, className: 'timewarp-picker-panel', 'aria-label': view === 'models' ? 'Choose model' : 'Model and thinking',
        onKeyDownCapture: event => { if (event.key === 'Escape' && view === 'models') { event.preventDefault(); event.stopPropagation(); setView('thinking'); requestAnimationFrame(() => modelButton.current?.focus()); } },
        children: !selected ? jsx.jsxs('div', { className: 'timewarp-picker-status', role: 'status', children: [
          jsx.jsx('span', { children: query.isPending ? 'Loading models…' : 'Models unavailable. Try again.' }),
          !query.isPending && jsx.jsx('button', { type: 'button', onClick: () => query.refetch(), children: 'Retry' })
        ] }) : view === 'models' ? jsx.jsxs('div', { className: 'timewarp-model-list', children: [
          jsx.jsx('div', { className: 'timewarp-model-list-title', children: 'Choose model' }),
          jsx.jsxs('div', { className: 'timewarp-model-list-heading', children: [jsx.jsx('span', { children: 'Standard' }), jsx.jsx('span', { children: 'Recommended selection of models' })] }),
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
          jsx.jsxs('div', { className: 'timewarp-thinking-slider', style: { '--tw-progress': `${efforts.length > 1 ? index / (efforts.length - 1) * 100 : 0}%` }, children: [
            jsx.jsx('div', { className: 'timewarp-thinking-dots', 'aria-hidden': true, children: efforts.map((value, at) => jsx.jsx('span', { 'data-filled': at <= index }, value)) }),
            jsx.jsx('input', { type: 'range', min: 0, max: Math.max(0, efforts.length - 1), step: 1, value: index, disabled: disabled || efforts.length < 2, 'aria-label': 'Thinking effort', 'aria-valuetext': effortLabel, title: selected.supportedReasoningEfforts?.find(item => item.reasoningEffort === effort)?.description, onChange: event => changeEffort(efforts[Number(event.target.value)]) })
          ] })
        ] })
      })
    ] });
  };
}
module.exports = { createModelPicker };
