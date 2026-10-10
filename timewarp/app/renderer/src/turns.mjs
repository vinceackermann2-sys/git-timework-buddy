// Builds the visible conversation from Codex turns and streaming events.
// Pure functions: no DOM, no React.
import { stripCitations } from "./cards.mjs";

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

// Worker threads apply their own events with { worker: true }; the chat
// ignores them.
export function applyEvent(turns, method, params, { worker = false } = {}) {
  if (params?.subAgent && !worker) return turns;
  // A retried error ("Connection lost") lasts until the turn's next event.
  if (method !== "error" && params?.turnId && turns.some(turn => turn.id === params.turnId && turn.retrying)) turns = upsertTurn(turns, params.turnId, { retrying: null });
  switch (method) {
    case "turn/started":
      return upsertTurn(turns, params.turn.id, { status: "inProgress", error: null, startedAt: params.turn.startedAt });
    case "item/started":
    case "item/completed":
      return withItem(turns, params.turnId, params.item.id, current => {
        // Streamed text may arrive before the started event of the same item.
        if (method === "item/started" && current) return { ...params.item, ...current, status: params.item.status ?? current.status, phase: params.item.phase ?? current.phase };
        // When a message arrived, for its time in the chat.
        return { ...params.item, ...(params.completedAtMs ? { completedAtMs: params.completedAtMs } : {}) };
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
      if (!params.turnId) return turns;
      if (params.willRetry) return turns.some(turn => turn.id === params.turnId) ? upsertTurn(turns, params.turnId, { retrying: params.error || {} }) : turns;
      return upsertTurn(turns, params.turnId, { error: params.error });
    // Codex's automatic approval reviewer: one entry per review, on its turn.
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed": {
      const turn = turns.find(item => item.id === params.turnId);
      if (!turn) return turns;
      const review = { id: params.reviewId, status: method.endsWith("started") ? "inProgress" : params.review?.status, risk: params.review?.riskLevel || null, rationale: params.review?.rationale || null, action: reviewedAction(params.action) };
      const reviews = [...(turn.reviews || []).filter(item => item.id !== review.id), review];
      return upsertTurn(turns, params.turnId, { reviews });
    }
    case "guardianWarning": {
      const turn = [...turns].reverse().find(item => item.status === "inProgress");
      return turn ? upsertTurn(turns, turn.id, { warnings: [...(turn.warnings || []), String(params.message || "")] }) : turns;
    }
    // Codex itself stopped (see harness.cjs): a system error, not a stop.
    case "turn/aborted":
      return turns.map(turn => turn.status === "inProgress" ? { ...turn, status: "interrupted", aborted: true, error: { message: params.reason || "The reply stopped." } } : turn);
    default:
      return turns;
  }
}

// A short description of the action an approval review looked at.
export function reviewedAction(action) {
  if (!action) return "an action";
  if (action.type === "command") return shellCommand(action.command);
  if (action.type === "execve") return [action.program, ...(action.argv || []).slice(1)].join(" ");
  if (action.type === "applyPatch") return "changing " + (action.files || []).map(fileName).join(", ");
  if (action.type === "networkAccess") return "network access to " + action.host;
  if (action.type === "mcpToolCall") return `${action.server} · ${action.toolName || action.tool || "tool"}`;
  if (action.type === "writeStdin") return "input to a running command";
  return action.type || "an action";
}

// The shell wrapper ("powershell.exe" -Command "…", bash -lc '…') is noise.
function shellCommand(command) {
  const text = String(command || "").replace(/\\\\/g, "\\");
  const inner = /^\s*"?[^"\s]*(?:powershell|pwsh|bash|zsh|sh|cmd)(?:\.exe)?"?\s+(?:-NoProfile\s+)?(?:-Command|-lc|-c|\/c)\s+(["']?)([\s\S]*)\1\s*$/i.exec(text);
  return inner ? inner[2] : text;
}

const fileName = file => { const parts = String(file || "").split(/[\\/]/).filter(Boolean); return parts.at(-1) || String(file || ""); };
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
// "close_tab", "fillSignIn" → "Close Tab", "Fill Sign In".
export const titleCase = name => String(name || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean).map(capitalize).join(" ");
const nameOf = path => String(path || "").split("/").filter(Boolean).pop() || null;

// ---- Messages ----------------------------------------------------------

// Interim notes ("I'll open the page first") feed the working line and the
// agent thread, never a chat bubble, as in the previous app.
export const isCommentary = item => item?.type === "agentMessage" && item.phase === "commentary";

// Chats from the previous app replied through its send_message tool; those
// turns' final answers were internal.
const SEND_MESSAGE = "send_message";
const sentMessage = item => item?.type === "dynamicToolCall" && item.tool === SEND_MESSAGE && item.status === "completed" && item.success === true;
function sentResult(item) {
  const text = (item.contentItems || []).find(part => part.type === "inputText")?.text;
  try { const value = JSON.parse(text); return value && typeof value === "object" ? value : null; } catch { return null; }
}

// The user's text without the interaction notes the previous app added.
// A new agent's introduction request isn't shown either: the chat opens with
// the agent's own introduction, as in the previous app.
const shownText = text => String(text || "").replace(/<user-interaction\b[^>]*>[\s\S]*?<\/user-interaction>\s*/g, "").replace(/<(scheduled-run|agent-introduction)\b[^>]*>[\s\S]*?<\/\1>\s*/g, "").trim();

// The chat as the previous app showed it: messages with day and time
// separators, runs of one sender grouped, then each finished turn's generated
// images. Tools and thinking stay out of it (they are in the agent thread).
// runs: Map of turn id → automation name, for turns an automation started.
export function transcript(turns, { conversationId = null, runs = new Map() } = {}) {
  const rows = [];
  let previous = null, group = null;
  const message = (row, at) => {
    const separator = !previous || !sameDay(previous.at, at) ? "day" : at - previous.at >= GAP ? "time" : null;
    const value = { kind: "message", ...row, at, separator, group: "single" };
    // Consecutive messages of one sender: first, middle …, last.
    if (!separator && group?.sender === row.sender) {
      group.group = group.group === "single" ? "first" : "middle";
      value.group = "last";
    }
    rows.push(value);
    previous = value; group = value;
  };
  for (const turn of turns) {
    const startedAt = (turn.startedAt || 0) * 1000 || Date.now();
    const finishedAt = (turn.completedAt || turn.startedAt || 0) * 1000 || startedAt;
    const replied = (turn.items || []).some(sentMessage);
    const automation = runs.get(turn.id);
    // The reply being written: the turn's latest message, until it completes.
    const writing = turn.status === "inProgress" ? (turn.items || []).findLast(item => item.type === "agentMessage" && !isCommentary(item) && !item.completedAtMs) : null;
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        // An automation's instructions show as "<name> ran 2 times".
        if (automation) {
          const last = rows.at(-1);
          if (last?.kind === "runs") last.counts.set(automation, (last.counts.get(automation) || 0) + 1);
          else rows.push({ kind: "runs", key: "runs-" + turn.id, counts: new Map([[automation, 1]]) });
          group = null;
          continue;
        }
        const text = shownText(userText(item));
        if (!text && !userImages(item).length && !userFiles(item).length) continue;
        message({ key: item.clientId || item.id, sender: "user", item, text, turn, undelivered: !!turn.undelivered }, startedAt);
      } else if (item.type === "agentMessage") {
        if (isCommentary(item) || (replied && item.phase === "final_answer")) continue;
        if (!item.text && !item.files?.length && !item.images?.length && turn.status !== "inProgress") continue;
        message({ key: item.id, sender: "agent", item, text: item.text || "", turn, streaming: item === writing }, item.completedAtMs || finishedAt);
      } else if (sentMessage(item)) {
        const result = sentResult(item) || {};
        if (conversationId && result.conversationId && result.conversationId !== conversationId) continue;
        const text = result.message || item.arguments?.message;
        if (!text) continue;
        message({ key: item.id, sender: "agent", item, text, turn }, Date.parse(result.sentAt || "") || finishedAt);
      } else if (scheduled(item)) {
        rows.push({ kind: "event", key: "event-" + item.id, text: item.arguments?.name ? `Scheduled ${item.arguments.name}` : "Automation scheduled", automation: { id: createdAutomation(item), name: item.arguments?.name || null } });
        group = null;
      }
    }
    // Automatic approval reviews that stopped an action (allowed ones stay quiet).
    for (const review of turn.reviews || []) if (review.status && review.status !== "inProgress" && review.status !== "approved") rows.push({ kind: "review", key: "review-" + review.id, review });
    if (turn.status !== "inProgress") {
      for (const item of turn.items || []) if (item.type === "imageGeneration" && imageSource(item)) rows.push({ kind: "image", key: "image-" + item.id, item });
    }
  }
  return rows;
}

const GAP = 30 * 60 * 1000;
const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };

// An automation the agent created from this chat.
const scheduled = item => (item.type === "mcpToolCall" && item.server === "timewarp_automations" || item.type === "dynamicToolCall" && item.namespace === "timewarp_automations")
  && item.tool === "create" && item.status === "completed" && item.success !== false && !item.error;

// The automation a create call made, from its result ("Created:\n<id> | <name> | …",
// see automation-tools.cjs), so its event can open it.
function createdAutomation(item) {
  const text = item.type === "mcpToolCall" ? (item.result?.content || []).map(part => part?.text || "").join("\n")
    : (item.contentItems || []).filter(part => part?.type === "inputText").map(part => part.text || "").join("\n");
  return /Created:\s*\n\s*([^\s|]+)\s*\|/.exec(text)?.[1] || null;
}

// "Daily digest ran 3 times, Inbox ran 1 time".
export const runsLabel = counts => [...counts].map(([name, count]) => `${name} ran ${count} ${count === 1 ? "time" : "times"}`).join(", ");

// A generated image as an address the page can show.
export function imageSource(item) {
  const result = String(item?.result || "");
  if (/^data:image\//.test(result)) return result;
  return /^[A-Za-z0-9+/=\s]{64,}$/.test(result) ? "data:image/png;base64," + result.replace(/\s+/g, "") : null;
}

// Separator text: "Today, 2:03 PM", "Yesterday, 9:15 AM", "Mon, Oct 6, 4:20 PM",
// or only the time after a pause of half an hour or more.
export function separatorLabel(kind, at, now = Date.now()) {
  const time = clock(at);
  if (kind !== "day") return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const day = sameDay(at, now) ? "Today" : sameDay(at, yesterday) ? "Yesterday"
    : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" }).format(at);
  return `${day}, ${time}`;
}
export const clock = at => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at);

// ---- The agent's state -------------------------------------------------

// Derived as the previous app did from the thread and its latest turn:
// running, paused (and why), failed (with a friendly error), interrupted
// (shown as "Paused" with Continue) or completed.
export function threadState(turns, status, running = false) {
  // A message that wasn't delivered shows as such; the state is the thread's.
  const turn = [...turns].reverse().find(item => !item.undelivered);
  const flags = status?.type === "active" ? status.activeFlags || [] : [];
  if (turn?.error && !turn.aborted && turn.status !== "interrupted") return { status: "failed", turnId: turn.id, error: friendlyError(turn.error) };
  if (turn?.status !== "inProgress" && (turn?.aborted || turn?.status === "failed" || status?.type === "systemError")) return { status: "failed", turnId: turn?.id || null, error: { message: "Execution encountered a system error.", recovery: "retry" } };
  if (flags.length) return { status: "paused", reason: flags.includes("waitingOnApproval") ? "Waiting for approval" : "Waiting for input" };
  if (turn?.status === "interrupted") return answered(turn) ? { status: "completed" } : { status: "interrupted", turnId: turn.id };
  if (status?.type === "active" || turn?.status === "inProgress" || running) return { status: "running", retrying: turn?.retrying || null };
  return { status: "completed" };
}
const answered = turn => (turn.items || []).some(item => sentMessage(item) || (item.type === "agentMessage" && !isCommentary(item) && item.text));

// The working line: the first line of the latest interim note since the
// user's last message, as plain text.
export function commentaryLine(turns) {
  // A message waiting to join the running turn doesn't hide its note.
  const turn = turns.findLast(item => !item.pending);
  if (!turn || turn.status !== "inProgress") return null;
  const items = turn.items || [];
  const start = items.map(item => item.type === "userMessage").lastIndexOf(true);
  let line = null;
  for (const item of items.slice(start + 1)) if (isCommentary(item) && item.text?.trim()) line = plainLine(item.text) || line;
  return line;
}

// The first non-empty line of markdown without its formatting.
export function plainLine(markdown) {
  for (const raw of stripCitations(markdown).split("\n")) {
    const line = raw.trim()
      .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1").replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~|[*_`])/g, "").trim();
    if (line && !/^(`{3,}|-{3,}|\*{3,})/.test(raw.trim())) return line;
  }
  return "";
}

// "12s", "1m 5s", "2h 3m".
export function formatDuration(ms) {
  if (ms == null) return null;
  const seconds = Math.max(1, Math.round(ms / 1000)), minutes = Math.floor(seconds / 60), rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60), left = minutes % 60;
  return left ? `${hours}h ${left}m` : `${hours}h`;
}

// ---- Errors ------------------------------------------------------------

const CODEX_ERRORS = {
  unauthorized: "Your OpenAI session expired. Please sign in again.",
  contextWindowExceeded: "This chat got too large to continue. Start a new chat or compact the thread.",
  internalServerError: "OpenAI had an internal error. Please try again in a moment.",
  badRequest: "That request couldn't be processed. Try editing your message and sending it again.",
  sandboxError: "I couldn't access something I needed on this machine. Please try again.",
  threadRollbackFailed: "I couldn't restore this chat's state. Reload the chat and try again.",
};
const SERVICE_DOWN = "Our AI service is temporarily unavailable. This is on our side—we've been notified. Please try again later.";
const REAUTHORIZE = "Your ChatGPT account is connected, but we could not refresh its authorization.";
// The service's quota codes, such as <provider>_openai_quota_exhausted.
const QUOTA = /_(?:openai_quota|anthropic_billing|openrouter_billing)_exhausted/;
const CONNECTION = ["httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts"];

// JSON objects inside an error's text.
function jsonIn(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  const candidates = start < 0 || end <= start || (start === 0 && end === text.length - 1) ? [text] : [text, text.slice(start, end + 1)];
  return candidates.map(candidate => { try { return JSON.parse(candidate); } catch { return null; } }).filter(value => value && typeof value === "object");
}

// A connected ChatGPT plan's limit, as the previous app showed it (no action),
// with when it resets. Codex says "You’ve hit your usage limit." followed by the
// plan's upgrade or admin advice and "try again at <time>" (the previous app's
// Codex build said "your ChatGPT usage limit"); a bare "You've hit your usage
// limit." is the Timewarp cloud's, which needs credits instead.
function chatGptLimit(details) {
  if (/Your workspace is out of credits\./.test(details)) return { message: details.split(/(?<=\.)\s+/).slice(0, 2).join(" "), recovery: null };
  if (!/You[’']ve hit your (?:ChatGPT usage limit|usage limit\b(?=[\s\S]*?(?:chatgpt\.com|ChatGPT|your admin|another model)))/.test(details)) return null;
  if (/usage limit for /.test(details)) return { message: "Your ChatGPT usage limit for this model was reached. Choose another model in the composer, then try again.", recovery: null };
  const reset = /\btry again (at|in) ([^\n]+?)\.?\s*$/i.exec(details);
  return { message: reset ? `Your ChatGPT usage limit was reached. Try again ${reset[1].toLowerCase()} ${reset[2]}.` : "Your ChatGPT usage limit was reached. Try again when it resets.", recovery: null };
}

// The previous app's wording for a turn error, and what the user can do:
// recovery is "retry", "reconnectChatGPT", "addCredits" or null.
export function friendlyError(error, retrying = false) {
  if (retrying) return { message: "Connection lost. Reconnecting...", recovery: null };
  error = error || {};
  const details = String(error.additionalDetails ?? error.message ?? "");
  const info = error.codexErrorInfo, infoText = !info ? "" : typeof info === "string" ? info : JSON.stringify(info);
  const texts = [details, String(error.message || ""), infoText];
  const has = test => texts.some(text => typeof test === "string" ? text.includes(test) : test.test(text));
  const parsed = [error.additionalDetails, error.message].filter(Boolean).flatMap(text => jsonIn(String(text)));
  if (details.includes("ChatGPT did not begin responding in time.")) return { message: "ChatGPT didn't respond in time. Try again.", recovery: "retry" };
  const chatgptLimit = chatGptLimit(details);
  if (chatgptLimit) return chatgptLimit;
  if (has(QUOTA) || has(SERVICE_DOWN)) return { message: SERVICE_DOWN, recovery: "retry" };
  if (has("Selected model is at capacity.")) return { message: "This model is at capacity. Choose another model in the composer, then try again.", recovery: "retry" };
  if (parsed.some(value => value.error?.code === "model_not_found")) return { message: "This model is unavailable. Choose another model in the composer, then try again.", recovery: "retry" };
  if (has("invalid_prompt") || has("flagged as potentially violating our usage policy")) return { message: "This request was stopped by a safety check. Try a different prompt or start a new chat.", recovery: null };
  if (info === "serverOverloaded") return { message: "The AI service is temporarily busy. Try again in a moment.", recovery: "retry" };
  if (info === "usageLimitExceeded") return { message: "This request needs additional credits to continue.", recovery: "addCredits" };
  const limit = parsed.map(value => value.error).find(value => ["concurrency_limit_reached", "organization_daily_usage_limit_reached", "user_daily_usage_limit_reached"].includes(value?.type) && value.message);
  if (limit) return { message: limit.message, recovery: limit.type === "concurrency_limit_reached" ? "retry" : null };
  if (has("CHATGPT_AUTH_TOKEN_UNAVAILABLE") || has("chatgpt_reauth_required") || has(REAUTHORIZE) || has(/Reconnect ChatGPT on the \w+ website\./)) return { message: REAUTHORIZE + " Reconnect ChatGPT to continue.", recovery: "reconnectChatGPT" };
  if (typeof info === "string" && CODEX_ERRORS[info]) return { message: CODEX_ERRORS[info], recovery: info === "unauthorized" ? "reconnectChatGPT" : null };
  if (details.includes("Your session has ended. Please log in again.") || (details.includes("Failed to refresh token") && details.includes("Please log in again"))) return { message: "Your OpenAI session expired. Reconnect ChatGPT to continue.", recovery: "reconnectChatGPT" };
  if ((info && typeof info === "object" && CONNECTION.some(key => key in info)) || details.includes("stream disconnected before completion") || details.includes("error sending request for url")) return { message: "Couldn't reach OpenAI. Check your connection and try again.", recovery: "retry" };
  return { message: "I couldn't complete that request.", recovery: "retry" };
}

// ---- Tool rows ---------------------------------------------------------

// Timewarp's own tool servers, shown by their tool names alone.
const OWN = new Set(["timewarp_browser", "timewarp_vault", "timewarp_automations"]);
const row = (icon, title, detail = null, extra = {}) => ({ icon, title, detail: detail == null || detail === "" ? null : String(detail), pageUrl: extra.pageUrl || null, app: extra.app || null });
// Icons by browser action, as before.
const BROWSER_ICONS = {
  open: "globe", click: "mousePointerClick", dblclick: "mousePointerClick", type: "type", fill: "type", press: "keyboard", keyboard: "keyboard",
  hover: "mousePointer2", focus: "mousePointer2", drag: "move", snapshot: "eye", screenshot: "camera", wait: "clock", select: "list",
  upload: "upload", download: "download", pdf: "fileText", close: "x", close_tab: "x", back: "arrowLeft", mouse: "mouse", scroll: "scroll", scrollintoview: "scroll",
};
const COMMAND_ICONS = { read: "filePenLine", listFiles: "folderSearch", search: "search" };
const COLLAB = {
  spawnAgent: ["bot", "Start agent"], sendInput: ["bot", "Sent agent input"], followupTask: ["bot", "Sent agent input"], resumeAgent: ["refreshCcw", "Resume agent"],
  wait: ["timer", "Wait for agent"], closeAgent: ["bot", "Close agent"], sendMessage: ["messageSquareText", "Sent agent message"], sendToAgent: ["messageSquareText", "Sent agent message"],
  interruptAgent: ["bot", "Interrupted agent"], listAgents: ["bot", "Listed agents"],
};

// One line per tool: an icon name, a title and a detail for the badge, as
// in the previous app's agent thread. Null for items it didn't list.
export function toolRow(item) {
  switch (item?.type) {
    case "functionCallOutput": return row("squareTerminal", "Tool result", item.name);
    case "hookPrompt": return row("messageSquareText", "Read hook prompt");
    case "plan": return String(item.text || "").trim() ? row("gitBranch", "Updated plan") : null;
    case "commandExecution": {
      const icon = COMMAND_ICONS[item.commandActions?.[0]?.type] || "squareTerminal";
      return item.description ? row(icon, item.description) : row(icon, "", shellCommand(item.command));
    }
    case "fileChange": {
      const changes = item.changes || [];
      if (!changes.length) return null;
      return changes.length === 1 ? row("filePenLine", capitalize(changes[0].kind?.type || "update"), fileName(changes[0].path)) : row("filePenLine", `Changed ${changes.length} files`);
    }
    case "mcpToolCall": return toolCall(item.server, item.tool, item.arguments);
    case "dynamicToolCall": {
      if (item.tool === SEND_MESSAGE || item.tool === "report_issue") return null;
      if (item.namespace) return toolCall(item.namespace, item.tool, item.arguments, true);
      if (item.tool === "open") return row("compass", "Open", item.arguments?.target);
      if (item.tool === "browser") {
        const commands = Array.isArray(item.arguments?.commands) ? item.arguments.commands : [];
        return commands.length ? row(BROWSER_ICONS[String(commands[0]?.[0] || "").trim().toLowerCase()] || "globe", item.arguments.description || "") : null;
      }
      return row("wrench", titleCase(item.tool), item.tool);
    }
    case "collabAgentToolCall": {
      const [icon, title] = COLLAB[item.tool] || ["bot", titleCase(item.tool)];
      const count = (item.receiverThreadIds || []).length;
      return row(icon, title, count && item.tool !== "listAgents" ? `${count} agent${count === 1 ? "" : "s"}` : null);
    }
    case "subAgentActivity": return row("gitBranch", item.kind, item.agentNickname || nameOf(item.agentPath));
    case "webSearch": {
      const action = item.action || {};
      if (action.type === "openPage" || action.type === "open_page") return row("globe", "Open", action.url, { pageUrl: action.url });
      if (action.type === "findInPage" || action.type === "find_in_page") return row("compass", "Find text", [action.pattern, action.url].filter(Boolean).join(" · "), { pageUrl: action.url });
      return row("search", "Search", action.type === "search" ? action.query ?? action.queries?.[0] ?? item.query : item.query);
    }
    case "imageView": return row("fileImage", "View image", fileName(item.path));
    case "imageGeneration": return row("fileImage", item.savedPath ? "Generated image" : "Generating image");
    case "enteredReviewMode": return row("filePenLine", "Start reviewing", item.review);
    case "exitedReviewMode": return row("filePenLine", "Done reviewing", item.review);
    case "contextCompaction": return row("refreshCcw", "Compacted context");
    case "sleep": return row("refreshCcw", "Waiting", `${item.durationMs} ms`);
    case "autoApprovalReview": return row("filePenLine", "Reviewed approval", item.review?.status);
    default: return null;
  }
}

function toolCall(server, tool, args = {}, dynamic = false) {
  args = args && typeof args === "object" ? args : {};
  if (server === "timewarp_browser") return browserRow(tool, args);
  if (server === "timewarp_composio") return appRow(tool, args);
  if (OWN.has(server)) return row("wrench", titleCase(tool));
  // Other tool servers: "Used github" with the tool's name, as before.
  return dynamic ? row("wrench", titleCase(tool), `${server}.${tool}`) : row("wrench", `Used ${server}`, tool);
}

function browserRow(tool, args) {
  const icon = BROWSER_ICONS[tool] || "globe";
  switch (tool) {
    case "open": return row(icon, "Open", args.url, { pageUrl: /^https?:\/\//i.test(args.url || "") ? args.url : null });
    case "press": return row(icon, "Press", args.key);
    case "scroll": return row(icon, "Scroll", args.direction);
    case "select": return row(icon, "Select", args.option);
    case "wait": return row(icon, "Wait", args.text || (args.seconds ? `${args.seconds} s` : null));
    case "upload": return row(icon, "Upload", Array.isArray(args.files) ? args.files.map(fileName).join(", ") : null);
    default: return row(icon, titleCase(tool));
  }
}

// Connected apps: the app's action ("Send Email") with its logo, or
// "Used Gmail" with the action when the logo isn't known.
function appRow(tool, args) {
  if (tool === "composio_execute") {
    const slug = String(args.toolSlug || args.tool_slug || "");
    const [app, ...action] = slug.split("_");
    return row("wrench", titleCase(action.join("_").toLowerCase()) || titleCase(slug.toLowerCase()), null, { app: app ? app.toLowerCase() : null });
  }
  return row("wrench", titleCase(String(tool || "").replace(/^composio_/, "")), args.query || null, { app: args.toolkit ? String(args.toolkit).toLowerCase() : null });
}

// ---- Agent thread ------------------------------------------------------

// What the agent thread sheet lists, as before: for the chat's own agent only
// its interim notes; for a worker its input, notes, results and tools.
// Each entry: { id, kind: "input" | "commentary" | "output" | "tool", at, text | tool }.
export function threadEntries(turns, { worker = false } = {}) {
  const entries = [];
  for (const turn of turns) {
    const at = (turn.startedAt || 0) * 1000 || null;
    for (const item of turn.items || []) {
      const id = turn.id + ":" + item.id;
      if (item.type === "userMessage" || item.type === "interAgentMessage") {
        if (!worker) continue;
        const text = item.type === "userMessage" ? userText(item).trim() : String(item.content || "").trim();
        if (text) entries.push({ id, kind: "input", at, text });
        continue;
      }
      if (item.type === "agentMessage") {
        if (!String(item.text || "").trim()) continue;
        if (isCommentary(item)) entries.push({ id, kind: "commentary", at: item.completedAtMs || at, text: item.text });
        else if (worker) entries.push({ id, kind: "output", at: item.completedAtMs || at, text: item.text });
        continue;
      }
      if (!worker || item.type === "reasoning") continue;
      const tool = toolRow(item);
      if (tool) entries.push({ id, kind: "tool", at, tool });
    }
    if (worker) for (const review of turn.reviews || []) entries.push({ id: turn.id + ":review:" + review.id, kind: "tool", at, tool: row("filePenLine", "Reviewed approval", review.status) });
  }
  return entries;
}

// Runs of consecutive tools become one group; messages stay on their own.
export function groupEntries(entries) {
  const groups = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (entry.kind !== "tool") groups.push(entry);
    else if (Array.isArray(last)) last.push(entry);
    else groups.push([entry]);
  }
  return groups;
}

// A turn as user messages, agent messages and groups of the tool items
// between them, with a one-line summary per group. The chat no longer uses
// these; widgets.jsx's worker dialog does.
const ACTIVITY = new Set(["reasoning", "plan", "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall",
  "subAgentActivity", "webSearch", "imageView", "imageGeneration", "contextCompaction", "functionCallOutput", "enteredReviewMode", "exitedReviewMode", "sleep", "hookPrompt"]);
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
    if (!ACTIVITY.has(item.type)) continue;
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

// ---- Workers -----------------------------------------------------------

// The worker states the previous app used: running, paused, interrupted,
// failed or completed ("starting" until a worker reports in).
const WORKER_STATES = { pendingInit: "starting", running: "running", interrupted: "interrupted", completed: "completed", shutdown: "completed", notFound: "completed", errored: "failed", failed: "failed", paused: "paused" };
export const workerState = status => WORKER_STATES[status] || status || "starting";

// Restored chats can have messages without a Codex transcript on this device.
// A message that wasn't sent keeps what it was sent with (its attached files
// and images, from harness.cjs) for Retry.
export function turnsFromMessages(messages, ownerId) {
  return messages.map(message => {
    const failed = message.status === "failed", { images, files } = attachmentsOf(message);
    const skills = Array.isArray(message.skills) ? message.skills : [];
    return {
      id: "message-" + message.id, startedAt: Date.parse(message.createdAt) / 1000 || null, status: failed ? "failed" : "completed",
      ...(failed ? { undelivered: true, error: { message: "This message wasn't sent." }, message: { text: message.text, images, files, ...(skills.length ? { skills } : {}) } } : { error: null }),
      // The stored files keep where they are (a path, or only a name when the
      // file is gone) for the chat to open them.
      items: [message.authorId === ownerId
        ? { type: "userMessage", id: message.id, clientId: message.id, content: userContent({ text: message.text, images, files, skills }), ...(files.length ? { files } : {}) }
        : { type: "agentMessage", id: message.id, text: message.text, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) }],
    };
  });
}

// A stored message's images and files. Messages brought over from the
// previous app can list theirs as attachments ({ path, name, contentType }).
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
function attachmentsOf(message) {
  const listed = (Array.isArray(message.attachments) ? message.attachments : []).filter(item => typeof item?.path === "string" && item.path);
  const image = item => /^image\//.test(item.contentType || item.mimeType || "") || IMAGE_FILE.test(item.path);
  return {
    images: [...(message.images || []), ...listed.filter(image).map(item => item.path)],
    files: [...(message.files || []), ...listed.filter(item => !image(item)).map(item => item.path)],
  };
}

// A message as Codex shows it: its text, the files it names, its images and
// the skills it attached.
export function userContent({ text = "", images = [], files = [], skills = [] }) {
  const name = file => String(file).split(/[\\/]/).pop();
  return [
    { type: "text", text },
    ...(files.length ? [{ type: "text", text: [ATTACHED, ...files.map(file => "- " + name(file))].join("\n") }] : []),
    ...images.map(path => ({ type: "localImage", path })),
    ...skills.map(skill => ({ type: "skill", name: skill.name, path: skill.path })),
  ];
}

// Turns loaded with the history and the same turns built from events that
// arrived meanwhile: the events are newer. A turn they finished keeps its
// finished state, and items keep the most of each (a message streamed since
// opening has only its end).
export function mergeTurns(loaded, streamed) {
  const newer = (old, item) => item.type === "agentMessage" && (old.text || "").length > (item.text || "").length ? { ...item, ...old } : { ...old, ...item };
  const merged = loaded.map(turn => {
    const live = streamed.find(item => item.id === turn.id);
    if (!live) return turn;
    const items = [...(turn.items || []).map(old => { const item = live.items.find(entry => entry.id === old.id); return item ? newer(old, item) : old; }),
      ...live.items.filter(item => !(turn.items || []).some(old => old.id === item.id))];
    return live.status === "inProgress" ? { ...turn, items } : { ...turn, ...live, items };
  });
  return [...merged, ...streamed.filter(turn => !loaded.some(item => item.id === turn.id))];
}

// A reply starts with the quoted message: "> " lines, then a blank line.
export function replyParts(value) {
  const match = /^((?:>[^\n]*(?:\n|$))+)(?:\n([\s\S]*))?$/.exec(String(value || ""));
  if (!match) return { quote: null, text: String(value || "") };
  const quote = match[1].replace(/\n$/, "").split("\n").map(line => line.replace(/^> ?/, "")).join("\n").trim();
  return quote ? { quote, text: (match[2] || "").trim() } : { quote: null, text: String(value || "") };
}

// A quoted reply as plain text, as the previous app showed it: no Markdown
// marks, code blocks shortened to their code, links to their text.
export function plainQuote(value) {
  return stripCitations(value)
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|`|\*(?=\S)|\b_(?=\S))([^\n]*?\S)\1/g, "$2")
    .replace(/\n{2,}/g, "\n")
    .trim();
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
// Skills a message attached for Codex (from @ and $ in the composer).
export function userSkills(item) {
  return (item.content || []).filter(part => part.type === "skill" && part.name && part.path).map(part => ({ name: part.name, path: part.path }));
}

// The agent message a reply quotes: the latest one before it whose text
// starts as the quote does (the quote is its first 600 characters).
export function quotedMessage(rows, index, quote) {
  const flat = text => stripCitations(text).replace(/\s+/g, " ").trim();
  const wanted = flat(quote);
  if (!wanted) return null;
  for (let at = Math.min(index, rows.length) - 1; at >= 0; at--) {
    const row = rows[at];
    if (row.kind !== "message" || row.sender !== "agent") continue;
    const text = flat(String(row.text || "").trim().slice(0, 600));
    if (text === wanted || text.startsWith(wanted) || (wanted.length >= 40 && wanted.startsWith(text))) return row.key;
  }
  return null;
}

// ---- Trace ---------------------------------------------------------------

// Approximate text tokens of an event, as before (UTF-8 bytes ÷ 4): what it
// gave the model (input) and what the model wrote (output). Not model usage.
const bytes = value => { const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value); return text ? new TextEncoder().encode(text).length : 0; };
const tokens = (...values) => { const total = values.reduce((sum, value) => sum + bytes(value), 0); return total ? Math.ceil(total / 4) : null; };
export function approxTokens(item) {
  switch (item?.type) {
    case "userMessage": return { input: tokens(userText(item)), output: null };
    case "agentMessage": return { input: null, output: tokens(item.text) };
    case "reasoning": return { input: null, output: tokens(...(item.summary || []), ...(item.content || [])) };
    case "commandExecution": return { input: tokens(item.aggregatedOutput), output: tokens(item.command) };
    case "fileChange": return { input: null, output: tokens(...(item.changes || []).map(change => change.diff || "")) };
    case "mcpToolCall": return { input: tokens(item.result, item.error), output: tokens(item.arguments) };
    case "dynamicToolCall": return { input: tokens(item.contentItems), output: tokens(item.arguments) };
    case "collabAgentToolCall": return { input: null, output: tokens(item.prompt) };
    case "webSearch": return { input: null, output: tokens(item.query || item.action?.query || item.action?.url) };
    default: return { input: null, output: null };
  }
}
// "940", "1.2k".
export const shortCount = value => value == null ? "" : value < 1000 ? String(value) : (value / 1000).toFixed(1) + "k";
// The subagents an event started, shown under it.
export const workerThreads = item => item?.type === "collabAgentToolCall" && item.tool === "spawnAgent" ? [...new Set(item.receiverThreadIds || [])] : [];
