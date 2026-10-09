"use strict";
const crypto = require('node:crypto');

// Local, content-free run counters. The native transcript remains the source of
// detailed tool evidence. These counters are never sent to a telemetry service.
// Tool items as the official app server reports them (countItems), for
// runtimes without item/toolCall/completed.
const TOOL_ITEMS = new Set(['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'fileChange', 'webSearch', 'imageGeneration']);
function toolOutcome(item) {
  const failed = ['failed', 'declined'].includes(item.status) || item.success === false || !!item.error ||
    (item.type === 'commandExecution' && Number.isInteger(item.exitCode) && item.exitCode !== 0);
  const signature = item.type === 'commandExecution' ? [item.type, item.command]
    : item.type === 'mcpToolCall' ? [item.type, item.server, item.tool, item.arguments]
      : item.type === 'dynamicToolCall' ? [item.type, item.namespace, item.tool, item.arguments]
        : [item.type, item.changes?.map(change => change.path) || item.query || null];
  return { failed, signature };
}
function bindExecutionGuard(client, { userId, onChange = () => {}, now = Date.now,
  maxToolCalls = 200, maxDurationMs = 20 * 60 * 1000, countItems = false } = {}) {
  const raw = client.request.bind(client), threads = new Map();
  let owner = null;
  const clear = () => { for (const row of threads.values()) clearTimeout(row.timer); threads.clear(); };
  const account = () => { const current = userId(); if (current !== owner) { clear(); owner = current; } return current; };
  const rowOf = id => { let row = threads.get(id); if (!row) threads.set(id, row = { id, parent: null, activeTurn: null, task: null, usage: null, completed: new Set(), resumed: false, commandFailed: false }); return row; };
  const rootOf = id => { let row = threads.get(id); const seen = new Set(); while (row?.parent && !seen.has(row.id)) { seen.add(row.id); row = threads.get(row.parent) || row; } return row; };
  async function stop(root, reason) {
    if (!root?.task || root.task.stopped) return;
    root.task.stopped = true; root.task.reason = reason; root.task.endedAt = now();
    // Interrupted requests may never emit their final token totals.
    root.task.usagePartial = true; clearTimeout(root.timer);
    onChange();
    const active=[...threads.values()].filter(row => rootOf(row.id)?.id === root.id && row.activeTurn);
    const results=await Promise.allSettled(active.map(row => raw('turn/interrupt', { threadId: row.id, turnId: row.activeTurn })));
    const main=results[active.findIndex(row=>row.id===root.id)];
    return main?.status==='fulfilled'?{handled:true,result:main.value}:null;
  }
  function arm(root) {
    if (!root?.task || root.task.stopped) return;
    clearTimeout(root.timer); root.task.endedAt = null;
    root.timer = setTimeout(() => void stop(root, 'This run reached its time budget. Review the activity and continue if more work is needed.'), Math.max(0, maxDurationMs - (now() - root.task.startedAt)));
    root.timer.unref?.();
  }
  function finish(root) {
    if (root?.task && ![...threads.values()].some(row => rootOf(row.id)?.id === root.id && row.activeTurn)) {
      clearTimeout(root.timer); root.task.endedAt ??= now();
    }
  }
  client.request = async (method, params) => {
    account();
    if (method === 'turn/interrupt') {
      const root = rootOf(params?.threadId);
      // A parent's Stop also cancels its workers. Stopping one worker remains local.
      if (root?.id === params?.threadId && root.task) {
        const result=await stop(root, 'Stopped by you. Review the activity for completed steps and unfinished work.');
        if(result?.handled)return result.result;
      }
    }
    if (method === 'turn/start' && params?.threadId) {
      const row = rowOf(params.threadId);
      if (!row.parent) {
        clearTimeout(row.timer);
        // Only inspect direct user text at a request boundary, never tool output.
        const text = (params.input || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
        const stopOnError = /(?:^|[.!?\n;]\s*)(?:please )?stop (?:after|on) (?:the )?first (?:runtime |tool )?error\b/i.test(text.trim());
        row.task = { id: crypto.randomUUID(), startedAt: now(), endedAt: null, stopOnError, stopped: false, reason: null, toolCalls: 0, failures: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usagePartial: false, seen: new Set(), failedCommands: new Map() };
        arm(row);
      }
    }
    try {
      const result = await raw(method, params);
      if (['thread/start', 'thread/resume', 'thread/fork'].includes(method) && result?.thread) {
        const row = rowOf(result.thread.id); row.parent = result.thread.parentThreadId || row.parent;
        if (method !== 'thread/start' && !row.usage) row.resumed = true;
      }
      if (method === 'turn/start' && result?.turn?.id) {
        const row = rowOf(params.threadId);
        row.activeTurn = result.turn.status === 'inProgress' && !row.completed.has(result.turn.id) ? result.turn.id : null;
        if (row.activeTurn) arm(rootOf(row.id)); else finish(rootOf(row.id));
      }
      if (['thread/start','thread/resume','thread/fork','turn/start','turn/interrupt'].includes(method)) onChange();
      return result;
    } catch (error) {
      if (method === 'turn/start') { const row = threads.get(params?.threadId); if (row) { row.activeTurn = null; finish(rootOf(row.id)); onChange(); } }
      throw error;
    }
  };
  client.on('notification', event => {
    if (!account()) return;
    const p = event.params || {};
    if (event.method === 'thread/started' && p.thread?.id) {
      const row = rowOf(p.thread.id);
      row.parent = p.thread.parentThreadId || p.thread.source?.subagent?.thread_spawn?.parent_thread_id || row.parent;
    }
    // Spawned workers are announced on their parent's activity stream; this
    // runtime does not always emit a separate thread/started for the child.
    if (['item/started','item/completed'].includes(event.method) && p.item?.type === 'subAgentActivity' && p.item.agentThreadId && p.threadId) {
      const child=rowOf(p.item.agentThreadId);child.parent=p.threadId;
      if(p.item.agentTurnId){
        if(p.item.kind==='completed'){
          child.completed.add(p.item.agentTurnId);
          if(child.activeTurn===p.item.agentTurnId)child.activeTurn=null;
          finish(rootOf(child.id));
        }else if(p.item.kind==='started'&&!child.completed.has(p.item.agentTurnId))child.activeTurn=p.item.agentTurnId;
      }
    }
    const id = p.threadId || p.thread?.id;
    if (!id) return;
    const row = rowOf(id), root = rootOf(id), task = root?.task;
    if (event.method === 'turn/started' && !row.completed.has(p.turn.id)) { row.activeTurn = p.turn.id; arm(root); }
    if (event.method === 'turn/completed') {
      row.completed.add(p.turn.id);
      row.activeTurn = null;
      if(task&&['interrupted','failed'].includes(p.turn.status))task.usagePartial=true;
      finish(root);
    }
    if (event.method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage?.total;
      if (u) {
        const previous = row.usage || {};
        for (const [source, target] of [['inputTokens','inputTokens'],['cachedInputTokens','cachedTokens'],['outputTokens','outputTokens']]) {
          if (task && Number.isFinite(u[source])) {
            // A resumed thread's first cumulative total includes older runs.
            // Count only its last request, and label the result partial.
            if (!row.usage && row.resumed) { task.usagePartial = true; task[target] += Math.max(0, p.tokenUsage?.last?.[source] || 0); }
            else task[target] += Math.max(0, u[source] - (previous[source] || 0));
          }
        }
        row.usage = { ...u };
      }
    }
    if (!task) return;
    // A rejected or unavailable approval review is not a retryable tool failure.
    // Stop the tree before the model can try another route to the same action.
    if ((event.method === 'guardianWarning' && /^Automatic approval review failed:/i.test(p.message || '')) ||
        (event.method === 'item/autoApprovalReview/completed' && p.review?.status === 'denied')) {
      void stop(root, 'Automatic approval review rejected or could not review an action. The run was stopped. Open activity for the action and reason before continuing.');
    }
    if (event.method === 'item/completed' && p.item?.type === 'commandExecution') {
      row.commandFailed = ['failed','declined'].includes(p.item.status) || (Number.isInteger(p.item.exitCode) && p.item.exitCode !== 0);
    }
    if (countItems && event.method === 'item/completed' && TOOL_ITEMS.has(p.item?.type) && p.item.id && !task.seen.has(p.item.id)) {
      task.seen.add(p.item.id); task.toolCalls++;
      const { failed, signature } = toolOutcome(p.item);
      const key = crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex');
      if (failed) {
        task.failures++;
        const count = (task.failedCommands.get(key) || 0) + 1; task.failedCommands.set(key, count);
        if (task.stopOnError) void stop(root, 'Stopped after the first tool error, as requested. Open activity for the exact error; the task is unfinished.');
        else if (count >= 3) void stop(root, 'A tool failed three times. The run was stopped to avoid another retry loop.');
      } else task.failedCommands.delete(key);
      if (task.toolCalls >= maxToolCalls) void stop(root, `This run reached its ${maxToolCalls}-tool-call budget. Review the activity before continuing.`);
      onChange();
    }
    // The pinned code-mode runtime reports tool failures (including blocked
    // commands) here, even when no commandExecution item was created.
    if (!countItems && event.method === 'item/toolCall/completed' && typeof p.tool === 'string') {
      const itemKey = p.callId ? `${id}:${p.callId}` : null;
      if (!itemKey || !task.seen.has(itemKey)) {
        if(itemKey)task.seen.add(itemKey); task.toolCalls++;
        const failed = p.success === false || (p.tool === 'exec_command' && row.commandFailed);
        if(p.tool === 'exec_command')row.commandFailed=false;
        const key = crypto.createHash('sha256').update(JSON.stringify([p.tool,p.argument])).digest('hex');
        if (failed) {
          task.failures++;
          const count = (task.failedCommands.get(key) || 0) + 1; task.failedCommands.set(key, count);
          if (task.stopOnError) void stop(root, 'Stopped after the first tool error, as requested. Open activity for the exact error; the task is unfinished.');
          else if (count >= 3) void stop(root, 'A tool failed three times. The run was stopped to avoid another retry loop.');
        } else task.failedCommands.delete(key);
        if (task.toolCalls >= maxToolCalls) void stop(root, `This run reached its ${maxToolCalls}-tool-call budget. Review the activity before continuing.`);
      }
    }
    // A late child start must also stop when its parent has already been stopped.
    if (task.stopped && event.method === 'turn/started') void raw('turn/interrupt', { threadId: id, turnId: p.turn.id }).catch(() => {});
    if (['turn/started','turn/completed','thread/tokenUsage/updated','item/toolCall/completed'].includes(event.method)) onChange();
  });
  client.on('status', state => { if (['stopped', 'failed'].includes(state.status)) { clear(); onChange(); } });
  return { snapshot(ids) { account(); return ids.flatMap(id => {
    const row = threads.get(id), task = row?.task;
    if (!task) return [];
    const { seen, failedCommands, ...summary } = task;
    return [{ threadId: id, ...summary, durationMs: Math.max(0, (task.endedAt ?? now()) - task.startedAt), cost: null, scope: 'current-session' }];
  }); }, stop: clear };
}
module.exports = { bindExecutionGuard };
