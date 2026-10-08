"use strict";

// Consumes the existing native activity subscription. No additional model calls,
// polling, cloud uploads, or second copy of the execution log.
function createTaskActivity({ React, jsx, useActivity }) {
  const labels = { running: 'Working', paused: 'Needs input', interrupted: 'Stopped', failed: 'Failed', completed: 'Finished' };
  return function TaskActivity({ onOpenDetails }) {
    const context = useActivity();
    const activities = context?.activities || [];
    const states = new Map();
    for (const item of activities) if (item.kind === 'state') states.set(item.threadId, item);
    const workers = [...states.values()].filter(item => item.parentThreadId != null);
    const [expanded, setExpanded] = React.useState(true);
    const [runs, setRuns] = React.useState([]);
    React.useEffect(() => {
      let cancelled=false;
      setRuns([]);
      let sequence=0;
      const refresh=()=>{if(!context?.conversationId||!window.timewarp?.request)return;const current=++sequence;void window.timewarp.request('executionStatus',{conversationId:context.conversationId}).then(value=>{if(!cancelled&&current===sequence&&Array.isArray(value))setRuns(value);}).catch(()=>{});};
      refresh();const unsubscribe=window.timewarp?.onExecutionChanged?.(refresh);
      return()=>{cancelled=true;unsubscribe?.();};
    },[context?.conversationId]);
    const active = workers.filter(item => item.state?.status === 'running');
    const paused = workers.filter(item => item.state?.status === 'paused');
    const failed = workers.filter(item => item.state?.status === 'failed');
    const latest = new Map();
    for (const item of activities) {
      if (!['commentary', 'tool', 'output'].includes(item.kind)) continue;
      const previous = latest.get(item.threadId);
      if (!previous || Date.parse(item.createdAt) >= Date.parse(previous.createdAt)) latest.set(item.threadId, item);
    }
    if (!workers.length&&!runs.some(run=>run.toolCalls||run.reason)) return null;
    const stopping = runs.some(run=>run.stopped);
    const summary = context?.error ? 'Reconnecting to activity…' : stopping ? (active.length?'Stopping…':'Stopped') : active.length ? `${active.length} working` : paused.length ? 'Needs input' : failed.length ? `${failed.length} failed` : workers.some(item=>item.state?.status==='interrupted') ? 'Stopped' : workers.every(item=>item.state?.status==='completed') ? 'Finished' : 'Starting';
    const text = (value,fallback) => typeof value === 'string' && value.trim() ? value : fallback;
    const detail = item => {
      if (item.state?.status === 'failed') return text(item.state.error?.message,'Open worker for error details');
      if (item.state?.status === 'paused') return text(item.state.reason,'Waiting for input');
      const last = latest.get(item.threadId);
      return text(last?.text || last?.description || last?.title,'Open to follow its steps and results');
    };
    return jsx.jsxs('section', { className: 'timewarp-task-activity', 'aria-label': 'Task and subagent activity', children: [
      jsx.jsxs('button', { type: 'button', className: 'timewarp-activity-toggle', 'aria-expanded': expanded, onClick: () => setExpanded(value => !value), children: [
        jsx.jsx('span', { className: 'timewarp-activity-branch', 'aria-hidden': true, children: '⑂' }),
        jsx.jsx('span', { className: 'timewarp-activity-title', children: workers.length?`Subagents (${workers.length})`:'Task activity' }),
        jsx.jsx('span', { className: 'timewarp-activity-summary', role: 'status', children: workers.length?summary:`${runs.reduce((count,run)=>count+run.toolCalls,0)} tool calls` }),
        jsx.jsx('span', { 'aria-hidden': true, children: expanded ? '⌃' : '⌄' })
      ] }),
      expanded && jsx.jsxs('div', { className: 'timewarp-activity-workers', children: [
        ...runs.filter(run=>run.reason).map(run=>jsx.jsx('p',{className:'timewarp-run-limit',role:'alert',children:run.reason},run.id)),
        runs.length>0&&jsx.jsx('p',{className:'timewarp-activity-note',children:`${runs.reduce((n,r)=>n+r.toolCalls,0)} tool calls · ${runs.reduce((n,r)=>n+r.failures,0)} errors · ${runs.reduce((n,r)=>n+r.inputTokens,0).toLocaleString()} input tokens (${runs.reduce((n,r)=>n+r.cachedTokens,0).toLocaleString()} cached). ${runs.some(r=>r.usagePartial)?'Partial usage for this session.':'Current session.'}`}),
        ...workers.map(item => jsx.jsxs('button', { type: 'button', className: 'timewarp-activity-worker', 'data-status': item.state?.status || 'unknown', 'aria-label': `Follow ${item.name || 'Subagent'}`, onClick: event => onOpenDetails(item.threadId, event.currentTarget), children: [
          jsx.jsx('span', { className: 'timewarp-worker-dot', 'aria-hidden': true }),
          jsx.jsxs('span', { className: 'timewarp-worker-copy', children: [jsx.jsx('strong', { children: item.name || 'Subagent' }), jsx.jsx('span', { children: detail(item) })] }),
          jsx.jsx('span', { className: 'timewarp-worker-status', children: context?.error ? 'Disconnected' : labels[item.state?.status] || 'Starting' }),
          jsx.jsx('span', { 'aria-hidden': true, children: '›' })
        ] }, item.threadId)),
        workers.length>0&&jsx.jsx('p', { className: 'timewarp-activity-note', children: 'Follow a worker to see its tools and results. Finished means its run ended; the main agent verifies the task outcome.' })
      ] })
    ] });
  };
}
module.exports = { createTaskActivity };
