// Builds the visible conversation from Codex turns and streaming events.
// Pure functions: no DOM, no React.

const ACTIVITY = new Set([
  "reasoning", "plan", "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall",
  "subAgentActivity", "webSearch", "imageView", "imageGeneration", "contextCompaction", "functionCallOutput",
  "enteredReviewMode", "exitedReviewMode", "sleep", "hookPrompt",
]);

const cloneTurn = turn => ({ ...turn, items: [...(turn.items || [])] });

function upsertTurn(turns, id, patch = {}) {
  const index = turns.findIndex(turn => turn.id === id);
  if (index < 0) return [...turns, { id, items: [], status: "inProgress", error: null, plan: null, ...patch }];
  const next = [...turns];
  next[index] = { ...next[index], ...patch };
  return next;
}

function withItem(turns, turnId, itemId, update) {
  let next = turns.some(turn => turn.id === turnId) ? turns : upsertTurn(turns, turnId);
  next = next.map(turn => {
    if (turn.id !== turnId) return turn;
    const copy = cloneTurn(turn);
    const index = copy.items.findIndex(item => item.id === itemId);
    const current = index >= 0 ? copy.items[index] : null;
    const value = update(current);
    if (!value) return turn;
    if (index >= 0) copy.items[index] = value; else copy.items.push(value);
    return copy;
  });
  return next;
}

export function applyEvent(turns, method, params) {
  if (params?.subAgent) return turns;
  switch (method) {
    case "turn/started":
      return upsertTurn(turns, params.turn.id, { status: "inProgress", error: null, startedAt: params.turn.startedAt });
    case "item/started":
    case "item/completed":
      return withItem(turns, params.turnId, params.item.id, current => {
        // Streamed text may arrive before the started event of the same item.
        if (method === "item/started" && current) return { ...params.item, ...current, status: params.item.status ?? current.status };
        return { ...params.item };
      });
    case "item/agentMessage/delta":
      return withItem(turns, params.turnId, params.itemId, current => ({ ...(current || { type: "agentMessage", id: params.itemId, text: "" }), text: (current?.text || "") + params.delta }));
    case "item/reasoning/summaryTextDelta":
      return withItem(turns, params.turnId, params.itemId, current => {
        const item = current || { type: "reasoning", id: params.itemId, summary: [], content: [] };
        const summary = [...(item.summary || [])];
        summary[params.summaryIndex || 0] = (summary[params.summaryIndex || 0] || "") + params.delta;
        return { ...item, summary };
      });
    case "item/commandExecution/outputDelta":
      return withItem(turns, params.turnId, params.itemId, current => current && { ...current, aggregatedOutput: ((current.aggregatedOutput || "") + params.delta).slice(-200000) });
    case "turn/plan/updated":
      return upsertTurn(turns, params.turnId, { plan: { explanation: params.explanation, steps: params.plan || [] } });
    case "turn/completed": {
      const known = turns.find(turn => turn.id === params.turn.id);
      const items = known?.items?.length ? known.items : params.turn.items || [];
      return upsertTurn(turns, params.turn.id, { status: params.turn.status, error: params.turn.error || null, items, completedAt: params.turn.completedAt });
    }
    case "error":
      if (params.willRetry || !params.turnId) return turns;
      return upsertTurn(turns, params.turnId, { error: params.error });
    case "turn/aborted":
      return turns.map(turn => turn.status === "inProgress" ? { ...turn, status: "interrupted", error: { message: params.reason || "The reply stopped." } } : turn);
    default:
      return turns;
  }
}

export function isActivity(item) { return ACTIVITY.has(item?.type); }

// Splits a turn into display blocks: user messages, agent messages and
// activity groups made of the tool items between them.
export function blocksOf(turn) {
  const blocks = [];
  let group = null;
  for (const item of turn.items || []) {
    if (item.type === "userMessage") { group = null; blocks.push({ kind: "user", key: item.id, item }); continue; }
    if (item.type === "agentMessage") {
      group = null;
      if (item.text || turn.status === "inProgress") blocks.push({ kind: "agent", key: item.id, item });
      continue;
    }
    if (!isActivity(item)) continue;
    if (!group) { group = { kind: "activity", key: "activity-" + item.id, items: [] }; blocks.push(group); }
    group.items.push(item);
  }
  return blocks;
}

export function summarize(items) {
  const count = type => items.filter(item => item.type === type).length;
  const parts = [];
  const commands = count("commandExecution"), files = items.filter(item => item.type === "fileChange").reduce((total, item) => total + (item.changes?.length || 1), 0);
  const tools = count("mcpToolCall") + count("dynamicToolCall"), searches = count("webSearch"), workers = count("collabAgentToolCall");
  if (commands) parts.push(`Ran ${commands} command${commands === 1 ? "" : "s"}`);
  if (files) parts.push(`Changed ${files} file${files === 1 ? "" : "s"}`);
  if (tools) parts.push(`Used ${tools} tool${tools === 1 ? "" : "s"}`);
  if (searches) parts.push(`Searched the web${searches > 1 ? ` ${searches} times` : ""}`);
  if (workers) parts.push(`Coordinated ${workers === 1 ? "a worker" : workers + " worker actions"}`);
  const started = items.filter(item => item.type === "subAgentActivity" && item.kind === "started").length;
  const finished = items.filter(item => item.type === "subAgentActivity" && item.kind === "completed").length;
  if (started) parts.push(started === 1 ? "Started a worker" : `Started ${started} workers`);
  if (finished) parts.push(finished === 1 ? "A worker finished" : `${finished} workers finished`);
  if (!parts.length && count("reasoning")) parts.push("Thought it through");
  if (!parts.length) parts.push("Worked on it");
  return parts.join(" · ");
}

export function running(items) {
  return items.some(item => item.status === "inProgress" || item.status === "in_progress");
}

// Restored chats can have messages without a Codex transcript on this device.
export function turnsFromMessages(messages, ownerId) {
  return messages.map(message => ({
    id: "message-" + message.id, startedAt: Date.parse(message.createdAt) / 1000 || null, status: message.status === "failed" ? "failed" : "completed", error: message.status === "failed" ? { message: "This message wasn't sent." } : null,
    items: [message.authorId === ownerId
      ? { type: "userMessage", id: message.id, clientId: message.id, content: [{ type: "text", text: message.text }] }
      : { type: "agentMessage", id: message.id, text: message.text }],
  }));
}

// The message part that lists attached files (see ATTACHED in harness.cjs).
export const ATTACHED = "[Attached files, saved in your workspace]";
export function userText(item) {
  return (item.content || []).filter(part => part.type === "text" && !part.text.startsWith(ATTACHED)).map(part => part.text).join("\n");
}
export function userFiles(item) {
  const part = (item.content || []).find(part => part.type === "text" && part.text.startsWith(ATTACHED));
  return part ? part.text.split("\n").slice(1).map(line => line.replace(/^- /, "")).filter(Boolean) : [];
}
export function userImages(item) {
  return (item.content || []).filter(part => part.type === "localImage" || part.type === "image").map(part => part.path || part.url);
}
