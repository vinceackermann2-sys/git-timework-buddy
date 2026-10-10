import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, ArrowDown, Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, Copy, EllipsisVertical, LoaderCircle, MessageSquareWarning, PanelRight, Pencil, Reply, Search, ShieldCheck, X } from "lucide-react";
import { call, errorText, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { copyText, stripCitations, userMessageText } from "../cards.mjs";
import { skillChips } from "../mentions.mjs";
import { applyEvent, clock, commentaryLine, mergeTurns, plainQuote, quotedMessage, replyParts, runsLabel, separatorLabel, threadState, transcript, turnsFromMessages, userContent, userFiles, userImages, userSkills, userText } from "../turns.mjs";
import { AttachmentImage, FileChip } from "../widgets.jsx";
import { AgentActivity, AgentThreadSheet, Collapsible, GeneratedImage } from "./AgentThread.jsx";
import { ApprovalCard } from "./Approval.jsx";
import { AutomationDialog } from "./Automations.jsx";
import { Composer, FundingBanner, ReconnectBanner, rememberPrompt } from "./Composer.jsx";
import { Trace } from "./Trace.jsx";
import { TaskActivity, useWorkers } from "./TaskActivity.jsx";
import { Avatar, Dialog, Menu, useToast } from "./common.jsx";

const baseName = file => String(file).split(/[\\/]/).pop();
// A reply starts with the quoted message.
const quote = text => stripCitations(text).trim().slice(0, 600).split("\n").map(line => "> " + line).join("\n") + "\n\n";
// Long messages of the user's fold at 240px.
const long = text => text.length >= 800 || text.split("\n").length >= 12;
// The cards a user's message shows: references (files, skills, people) and answers.
const USER_CARDS = ["ref", "widget-interaction"];
// Long chats show their latest rows first, as before; older ones load on request.
const PAGE = 100;
// The tab the agent is working in, for "Using browser".
const agentTab = state => state?.tabs?.find(tab => tab.agent)?.id || null;
// A message that didn't reach the agent, offered for Retry.
const undelivered = (turn, message = "This message wasn't sent.") => ({ ...turn, pending: false, undelivered: true, status: "failed", error: { message } });

function Title({ conversation, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(conversation.title || "");
  useEffect(() => { setValue(conversation.title || ""); setEditing(false); }, [conversation.id, conversation.title]);
  if (editing) {
    const commit = () => { setEditing(false); if (value.trim() && value.trim() !== conversation.title) onRename(value.trim()); };
    return <input autoFocus value={value} maxLength={200} aria-label="Conversation name" onChange={event => setValue(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); if (event.key === "Escape") setEditing(false); }} />;
  }
  return <span className="title" onDoubleClick={() => setEditing(true)}>{conversation.title || "New conversation"}</span>;
}

// The time a message was sent, beside it on hover.
const Time = ({ at }) => <time data-message-time className="tw-message-time" dateTime={new Date(at).toISOString()}>{clock(at)}</time>;

// A message's images and files: an image as a thumbnail and a file as a chip
// that open it; one known only by its name (gone from this computer, or
// still on its way) as its name.
const located = file => /[\\/]/.test(String(file));
function SentFiles({ conversationId, images = [], files = [] }) {
  if (!images.length && !files.length) return null;
  return (
    <div className="tw-user-images">
      {images.map(file => located(file) ? <AttachmentImage key={file} conversationId={conversationId} file={file} /> : <FileChip key={file} name={file} file={file} conversationId={null} />)}
      {files.map(file => <FileChip key={file} conversationId={located(file) ? conversationId : null} name={baseName(file)} file={file} />)}
    </div>
  );
}

function UserMessage({ row, conversationId, onRetry, onJump }) {
  // A message still sending (or not sent) names its files where they are.
  const waiting = !!(row.turn?.pending || row.undelivered);
  const images = userImages(row.item), files = waiting && row.turn.message?.files?.length ? row.turn.message.files : row.item.files?.length ? row.item.files : userFiles(row.item);
  // A card answer from the previous app shows as its summary, as before; a
  // reply shows the message it quotes above it, and goes to it when clicked.
  const { quote, text: shown } = replyParts(userMessageText(row.text));
  const skills = userSkills(row.item);
  const markdown = useMemo(() => skillChips(shown, skills), [shown, skills.map(skill => skill.path).join("\n")]);
  const [retrying, setRetrying] = useState(false);
  const quoted = quote ? <span>{plainQuote(quote)}</span> : null;
  return (
    <div className="tw-user-row" data-group={row.group} data-row-key={row.key}>
      <SentFiles conversationId={conversationId} images={images} files={files} />
      {quote ? (
        <div className={"tw-reply-preview" + (shown ? "" : " alone")}>
          <span className="tw-reply-label"><Reply size={12} aria-hidden="true" />You replied</span>
          {row.quoteTarget ? <button type="button" className="tw-reply-quote" title="Go to the message" onClick={() => onJump(row.quoteTarget)}>{quoted}</button> : <div className="tw-reply-quote">{quoted}</div>}
        </div>
      ) : null}
      {shown ? (
        <div className="tw-user-message" data-message-id={row.key}>
          <Collapsible enabled={long(shown)}><Markdown text={markdown} cards={{ conversationId, only: USER_CARDS }} /></Collapsible>
          <Time at={row.at} />
        </div>
      ) : null}
      {row.undelivered ? (
        <div className="tw-undelivered" role="alert">
          <CircleAlert size={14} aria-hidden="true" /><strong>Not Delivered</strong><span aria-hidden="true">·</span>
          <button type="button" disabled={retrying || !onRetry} onClick={() => { setRetrying(true); onRetry(row.turn, row.item); }}>{retrying ? <LoaderCircle size={13} className="tw-spin" /> : null}Retry</button>
        </div>
      ) : null}
    </div>
  );
}

// Reply and copy, shown over an agent message on hover. A copy leaves out
// the message's cards, as before.
function BubbleActions({ text, onReply }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="tw-bubble-actions" role="toolbar" aria-label="Message actions">
      <button type="button" title="Reply" aria-label="Reply to message" onClick={() => onReply(text)}><Reply size={15} strokeWidth={1.7} /></button>
      <button type="button" title={copied ? "Copied" : "Copy"} aria-label={copied ? "Copied message" : "Copy message"} onClick={() => navigator.clipboard.writeText(copyText(text)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}>{copied ? <Check size={15} /> : <Copy size={14} strokeWidth={1.7} />}</button>
    </span>
  );
}

function AgentMessage({ row, agent, conversationId, onReply }) {
  return (
    <div className="tw-agent-row" data-group={row.group} data-row-key={row.key}>
      <div className="tw-agent-stack">
        {row.text || row.streaming ? (
          <div className="tw-bubble" data-message-id={row.key}>
            <Markdown text={row.text} streaming={row.streaming} />
            {row.text && !row.streaming ? <BubbleActions text={row.text} onReply={onReply} /> : null}
            {row.streaming ? null : <Time at={row.at} />}
          </div>
        ) : null}
        {/* Files a message from the previous app came with. */}
        <SentFiles conversationId={conversationId} images={row.item.images} files={row.item.files} />
      </div>
      <Avatar agent={agent} />
    </div>
  );
}

// One row of the chat: a message (after its separator), an event, an
// automation's runs, a generated image or a review that stopped an action.
function Row({ row, agent, conversationId, onRetry, onReply, onJump, onAutomation }) {
  switch (row.kind) {
    case "message": return (
      <>
        {row.separator ? <div className="tw-date"><time dateTime={new Date(row.at).toISOString()}>{separatorLabel(row.separator, row.at)}</time></div> : null}
        {row.sender === "user" ? <UserMessage row={row} conversationId={conversationId} onRetry={onRetry} onJump={onJump} /> : <AgentMessage row={row} agent={agent} conversationId={conversationId} onReply={onReply} />}
      </>
    );
    // "Scheduled <name>" opens the automation.
    case "event": return row.automation ? (
      <div className="tw-chat-event"><button type="button" className="tw-chat-event-link" onClick={() => onAutomation(row.automation)}><AlarmClock size={14} aria-hidden="true" /><span>{row.text}</span></button></div>
    ) : <div className="tw-chat-event"><AlarmClock size={14} aria-hidden="true" /><span>{row.text}</span></div>;
    case "runs": return <div className="tw-chat-runs">{runsLabel(row.counts)}</div>;
    case "image": return <div className="tw-turn-extra"><GeneratedImage item={row.item} /></div>;
    case "review": {
      const { review } = row;
      return (
        <div className="tw-turn-extra tw-review" data-status={review.status}>
          <ShieldCheck size={14} />
          <span>{review.status === "denied" ? "Not allowed " : "Couldn't review "}<code>{review.action}</code>{review.rationale ? " — " + review.rationale : ""}</span>
        </div>
      );
    }
    default: return null;
  }
}

// Find in conversation, as before: matches in the messages' text (not the
// chat's intro, times or working line), across formatting, kept current as
// messages change. Enter or Ctrl/⌘+G for the next, with Shift the previous.
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SKIPPED = "[hidden], [aria-hidden='true'], [data-message-time], [data-search-ignore], .tw-bubble-actions";
export function findMatches(root, query, limit = 1000) {
  if (!root || !query.trim()) return [];
  const pattern = new RegExp(escapePattern(query), "gi"), found = [];
  const document = root.ownerDocument, filter = document.defaultView.NodeFilter;
  for (const message of root.querySelectorAll("[data-message-id]")) {
    const nodes = [], starts = [];
    let text = "";
    const walker = document.createTreeWalker(message, filter.SHOW_TEXT, { acceptNode: node => !node.nodeValue || node.parentElement?.closest(SKIPPED) ? filter.FILTER_REJECT : filter.FILTER_ACCEPT });
    while (walker.nextNode()) { starts.push(text.length); nodes.push(walker.currentNode); text += walker.currentNode.nodeValue; }
    // The text node holding a character of the message's text.
    const nodeAt = offset => { let low = 0, high = starts.length - 1; while (low <= high) { const mid = (low + high) >> 1; if (offset < starts[mid]) high = mid - 1; else if (offset >= starts[mid] + nodes[mid].nodeValue.length) low = mid + 1; else return mid; } return -1; };
    for (const match of text.matchAll(pattern)) {
      const first = nodeAt(match.index), last = nodeAt(match.index + match[0].length - 1);
      if (first < 0 || last < 0) continue;
      const range = document.createRange();
      range.setStart(nodes[first], match.index - starts[first]);
      range.setEnd(nodes[last], match.index + match[0].length - starts[last]);
      found.push(range);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

function FindBar({ root, focusKey, onClose }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [index, setIndex] = useState(0);
  const input = useRef(null);
  const moved = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusKey]);
  useEffect(() => () => { CSS.highlights?.delete("tw-find"); CSS.highlights?.delete("tw-find-current"); }, []);
  // Searched again as messages stream in or change.
  useEffect(() => {
    const node = root.current;
    let frame = 0;
    const search = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setMatches(findMatches(node, query))); };
    setMatches(findMatches(node, query));
    if (!node || !query.trim() || typeof MutationObserver !== "function") return () => cancelAnimationFrame(frame);
    const observer = new MutationObserver(search);
    observer.observe(node, { childList: true, characterData: true, subtree: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [query, root]);
  const current = matches.length ? Math.min(index, matches.length - 1) : -1;
  useEffect(() => {
    if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
    if (matches.length) CSS.highlights.set("tw-find", new Highlight(...matches)); else CSS.highlights.delete("tw-find");
    if (current >= 0) CSS.highlights.set("tw-find-current", new Highlight(matches[current])); else CSS.highlights.delete("tw-find-current");
  }, [matches, current]);
  // The match in view moves only when the search or the chosen match changes.
  useEffect(() => { moved.current = true; }, [query, index]);
  useEffect(() => {
    if (!moved.current || current < 0) return;
    moved.current = false;
    matches[current].startContainer.parentElement?.scrollIntoView?.({ block: "center" });
  }, [matches, current]);
  const move = step => { if (matches.length) setIndex(value => (Math.min(value, matches.length - 1) + step + matches.length) % matches.length); };
  const keys = useRef(null);
  keys.current = { move, onClose };
  useEffect(() => {
    const handle = event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === "KeyG") { event.preventDefault(); keys.current.move(event.shiftKey ? -1 : 1); }
      else if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]")) keys.current.onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  return (
    <div className="tw-find" role="search" aria-label="Search conversation">
      <Search size={15} aria-hidden="true" />
      <input ref={input} value={query} placeholder="Find in conversation" aria-label="Search conversation" aria-invalid={!!query.trim() && !matches.length}
        onChange={event => { setQuery(event.target.value); setIndex(0); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); } }} />
      <span className="tw-hint tw-tabular" aria-live="polite">{query.trim() ? `${matches.length ? current + 1 : 0}/${matches.length}` : ""}</span>
      <button type="button" className="tw-icon-button" aria-label="Previous match" disabled={!matches.length} onClick={() => move(-1)}><ChevronUp size={16} /></button>
      <button type="button" className="tw-icon-button" aria-label="Next match" disabled={!matches.length} onClick={() => move(1)}><ChevronDown size={16} /></button>
      <button type="button" className="tw-icon-button" aria-label="Close search" onClick={onClose}><X size={16} /></button>
    </div>
  );
}

// The report goes with the chat it was sent from, the screen, and the app's
// version and platform (added in methods.cjs). Its feedback ID can be copied
// for support, as before.
export function FeedbackDialog({ open, onClose, conversationId = null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [copied, setCopied] = useState(false);
  // Why the report couldn't be sent, shown above the button as before.
  const [error, setError] = useState("");
  const toast = useToast();
  useEffect(() => { if (open) { setText(""); setSent(null); setCopied(false); setError(""); } }, [open]);
  const copy = () => navigator.clipboard.writeText(sent).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => toast("Unable to copy the feedback ID.", "error"));
  if (sent) return (
    <Dialog open={open} onClose={onClose} className="tw-feedback" title="Feedback sent">
      <button type="button" className="tw-link" onClick={copy}>{copied ? "Copied feedback ID" : "Copy feedback ID"}</button>
    </Dialog>
  );
  return (
    <Dialog open={open} onClose={onClose} className="tw-feedback" title="Send feedback" description="Tell us what happened or what could be better. Your report, app version, and platform will be sent to Timewarp support.">
      <textarea className="tw-textarea" rows={5} autoFocus value={text} maxLength={5000} onChange={event => setText(event.target.value)} placeholder="What happened? What did you expect?" aria-label="Feedback" />
      {error ? <div className="tw-feedback-error" role="alert">{error}</div> : null}
      <button type="button" className="tw-btn primary tw-wide" disabled={busy || !text.trim()} onClick={() => {
        setBusy(true); setError("");
        call("feedback.submit", { description: text, category: "general", conversationId, route: location.hash || "#/" })
          .then(result => { if (result?.traceId) setSent(result.traceId); else { toast("Thanks, your feedback was sent."); onClose(); } })
          .catch(failure => setError(failure?.message ? errorText(failure) : "Unable to send feedback right now.")).finally(() => setBusy(false));
      }}>{busy ? <><LoaderCircle size={14} className="tw-spin" />Sending...</> : "Send feedback"}</button>
    </Dialog>
  );
}

export function Chat({ conversation, agent, account, models, funding, onChanged, paneOpen, onTogglePane, onEditAgent, onNewTask, onSettings, initialMessage, onInitialSent }) {
  const [reply, setReply] = useState(null);
  const [turns, setTurns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [approvals, setApprovals] = useState([]);
  const [notice, setNotice] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const [finding, setFinding] = useState(false);
  const [dialog, setDialog] = useState(null);
  // The agent's thread status (active with what it waits for, idle, error).
  const [threadStatus, setThreadStatus] = useState(null);
  const [browserTab, setBrowserTab] = useState(null);
  // Turns an automation started, by turn id: the automation's name.
  const [automationRuns, setAutomationRuns] = useState(() => new Map());
  // The agent thread sheet: { threadId: "root" | a subagent's, source }.
  const [sheet, setSheet] = useState(null);
  // Each chat keeps its own model; new chats start with the default.
  const [model, setModel] = useState(conversation.modelSettings?.name ? conversation.modelSettings : null);
  const scroller = useRef(null);
  const thread = useRef(null);
  const pinned = useRef(true);
  // Whether the chat's own turn events arrived while it opened: they are
  // newer than the status and history it loads.
  const live = useRef(false);
  const runningNow = useRef(false);
  runningNow.current = running;
  const toast = useToast();
  const id = conversation.id;

  const markRead = useCallback(() => {
    if (document.hasFocus()) void call("conversations.markRead", { id }).then(onChanged).catch(() => {});
  }, [id, onChanged]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setTurns([]); setApprovals([]); setNotice(null); pinned.current = true; live.current = false;
    setModel(conversation.modelSettings?.name ? conversation.modelSettings : null);
    Promise.all([call("conversations.history", { id }), call("conversations.status", { id })]).then(([history, status]) => {
      if (cancelled) return;
      const owner = account?.user?.id;
      // A first message sent, or a reply that started or finished, while the
      // history loaded stays as the events left it.
      setTurns(current => mergeTurns(history.turns?.length
        ? [...turnsFromMessages(history.earlier || [], owner), ...history.turns, ...turnsFromMessages(history.failed || [], owner)]
        : turnsFromMessages(history.messages || [], owner), current));
      if (!history.turns?.length && history.messages?.length && history.transcriptUnavailable !== undefined) setNotice("Earlier tool activity from another device isn't available here. Your messages are.");
      setThreadStatus(current => current || (live.current ? null : history.thread?.status) || null);
      if (!live.current) setRunning(current => current || !!status.running);
      setApprovals(status.approvals || []);
      // Open the agent's session now so the first message starts right away.
      if (!status.running && !initialMessage) void call("conversations.warm", { id }).catch(() => {});
    }).catch(error => { if (!cancelled) toast(error, "error"); }).finally(() => { if (!cancelled) setLoading(false); });
    markRead();
    return () => { cancelled = true; };
  }, [id]);

  // The first message of a chat started from the home screen.
  useEffect(() => {
    if (!initialMessage) return;
    onInitialSent?.();
    // The first message is the chat's first prompt to recall, as before.
    rememberPrompt(id, initialMessage.text);
    void send(initialMessage).catch(error => toast(error, "error"));
  }, [id]);

  useEvent("conversation.event", ({ conversationId, method, params }) => {
    if (conversationId !== id) return;
    if ((method === "turn/started" || method === "turn/completed" || method === "turn/aborted") && !params.subAgent) live.current = true;
    if (method === "turn/started" && !params.subAgent) { setRunning(true); setTurns(current => current.filter(turn => !turn.pending)); }
    if (method === "thread/status/changed" && !params.subAgent) setThreadStatus(params.status || null);
    setTurns(current => {
      const next = applyEvent(current, method, params);
      if (params.subAgent) return next;
      // A message sent while the agent worked shows in its turn once Codex
      // adds it; one still waiting when that turn ends wasn't delivered.
      const item = params.item;
      if ((method === "item/started" || method === "item/completed") && item?.type === "userMessage" && item.clientId) return next.filter(turn => !(turn.pending && turn.items[0]?.clientId === item.clientId));
      if (method === "turn/completed" || method === "turn/aborted") return next.map(turn => turn.pending && turn.steeredInto && (method === "turn/aborted" || turn.steeredInto === params.turn.id) ? undelivered(turn) : turn);
      return next;
    });
    if ((method === "turn/completed" || method === "turn/aborted") && !params.subAgent) { setRunning(false); markRead(); }
    if (method === "turn/aborted") setThreadStatus(null);
    if (method === "thread/name/updated") onChanged?.();
  });
  // "Using browser" while the agent works in one of the chat's tabs.
  useEffect(() => { call("browser.state", { conversationId: id }).then(value => setBrowserTab(agentTab(value))).catch(() => {}); }, [id]);
  useEvent("browser.state", value => { if (value.conversationId === id) setBrowserTab(agentTab(value)); });
  // An automation's runs show as "<name> ran 2 times" instead of its instructions.
  const loadRuns = useCallback(async () => {
    const mine = (await call("automations.list").catch(() => [])).filter(item => item.conversationId === id);
    const runs = new Map();
    for (const automation of mine) {
      for (const run of await call("automations.runs", { id: automation.id }).catch(() => [])) if (run.turnId) runs.set(run.turnId, automation.name);
    }
    setAutomationRuns(runs);
  }, [id]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEvent("automations.changed", () => void loadRuns());
  // Other parts of the chat, such as a subagent link in a reply, open an
  // agent thread with { conversationId, threadId, source }.
  useEffect(() => {
    const open = ({ detail }) => { if (detail?.conversationId === id && detail.threadId) setSheet({ threadId: detail.threadId, source: detail.source || null }); };
    window.addEventListener("tw:open-thread", open);
    return () => window.removeEventListener("tw:open-thread", open);
  }, [id]);
  useEvent("approval.requested", approval => { if (approval.conversationId === id) setApprovals(current => [...current.filter(item => item.id !== approval.id), approval]); });
  useEvent("approval.resolved", ({ id: requestId, conversationId }) => { if (conversationId === id) setApprovals(current => current.filter(item => item.id !== requestId)); });
  useEffect(() => { const focus = () => markRead(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [markRead]);
  // Ctrl/⌘+F finds in the conversation (again: selects what's typed), and
  // Ctrl/⌘+Alt+F reports an issue, as before.
  const [findFocus, setFindFocus] = useState(0);
  useEffect(() => {
    const keys = event => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.code !== "KeyF" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (event.altKey) setDialog("feedback");
      else { setFinding(true); setFindFocus(value => value + 1); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  const workers = useWorkers(id, turns);
  const rows = useMemo(() => {
    const list = transcript(turns, { conversationId: id, runs: automationRuns });
    // A reply goes to the message it quotes, when that's in the chat.
    list.forEach((row, index) => {
      if (row.kind !== "message" || row.sender !== "user") return;
      const { quote: quoted } = replyParts(userMessageText(row.text));
      if (quoted) row.quoteTarget = quotedMessage(list, index, quoted);
    });
    return list;
  }, [turns, id, automationRuns]);
  const state = threadState(turns, threadStatus, running);
  // The latest rows of a long chat, as before; Find searches them all.
  const [limit, setLimit] = useState(PAGE);
  const hidden = finding ? 0 : Math.max(0, rows.length - limit);
  const shown = hidden ? rows.slice(hidden) : rows;
  // Older messages appear above without moving what's in view.
  const keep = useRef(null);
  const showOlder = (count = PAGE) => { const node = scroller.current; if (node) keep.current = node.scrollHeight - node.scrollTop; setLimit(value => value + count); };
  // Going to a quoted message: shown first if it's among the older ones.
  const target = useRef(null);
  const jump = key => {
    const index = rows.findIndex(row => row.key === key);
    if (index < 0) return;
    target.current = key;
    if (index < hidden) setLimit(rows.length - index + 10);
    requestAnimationFrame(() => {
      const element = [...(thread.current?.querySelectorAll("[data-row-key]") || [])].find(node => node.dataset.rowKey === target.current);
      target.current = null;
      if (!element) return;
      pinned.current = false;
      element.scrollIntoView({ block: "center" });
      element.classList.remove("tw-flash"); void element.offsetWidth; element.classList.add("tw-flash");
    });
  };

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (keep.current !== null) { node.scrollTop = node.scrollHeight - keep.current; keep.current = null; return; }
    if (pinned.current) node.scrollTop = node.scrollHeight;
  }, [rows, approvals, loading, state.status, limit]);
  // A chat at the bottom stays there when its width changes, such as when the pane opens.
  useEffect(() => {
    const node = scroller.current, content = thread.current;
    if (!node || !content || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => { if (pinned.current) node.scrollTop = node.scrollHeight; });
    observer.observe(node);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // While the agent works, the message joins its current turn (see
  // harness.cjs). The pending row keeps the message as sent, with its files, for Retry.
  async function send(message, retryOf) {
    const clientId = crypto.randomUUID(), pendingId = "pending-" + clientId;
    const steering = runningNow.current;
    pinned.current = true;
    // Skills chosen with @ or $ go with the message for Codex.
    const skills = Array.isArray(message.skills) ? message.skills : [];
    message = { text: message.text || "", images: message.images || [], files: message.files || [], ...(skills.length ? { skills } : {}) };
    setTurns(current => [...current, { id: pendingId, pending: true, message, startedAt: Date.now() / 1000, status: "inProgress", items: [{ type: "userMessage", id: clientId, clientId, content: userContent(message) }] }]);
    setRunning(true);
    try {
      const result = await call("conversations.send", { id, ...message, clientId, retryOf });
      // A steered message waits for Codex to add it to the turn.
      if (result?.steered) setTurns(current => current.map(turn => turn.id !== pendingId || !turn.pending ? turn
        : current.some(item => item.id === result.turnId && item.status !== "inProgress") ? undelivered(turn) : { ...turn, steeredInto: result.turnId }));
      onChanged?.();
    } catch (error) {
      if (!steering) setRunning(false);
      setTurns(current => current.map(turn => turn.id === pendingId ? undelivered(turn, error.message) : turn));
      throw error;
    }
  }
  // Cards in agent messages (an answer, a draft to send) send through the
  // chat, so the message shows at once.
  useEffect(() => {
    const handle = event => {
      if (event.detail?.conversationId !== id) return;
      event.preventDefault();
      event.detail.result = send({ text: event.detail.text, images: [], files: [] });
    };
    window.addEventListener("tw:chat-send", handle);
    return () => window.removeEventListener("tw:chat-send", handle);
  });
  // A message picked in search (App.jsx): { conversationId, messageId }, shown
  // like a quoted one once the chat has it; preventDefault says it was shown.
  useEffect(() => {
    const show = event => {
      if (event.detail?.conversationId !== id || !rows.some(row => row.key === event.detail.messageId)) return;
      event.preventDefault();
      jump(event.detail.messageId);
    };
    window.addEventListener("tw:show-message", show);
    return () => window.removeEventListener("tw:show-message", show);
  });
  // Sends a message that didn't go through again, with its files, in place of the failed one.
  function retry(turn, item) {
    setTurns(current => current.filter(entry => entry !== turn));
    void send(turn.message || { text: userText(item), images: userImages(item), files: [], skills: userSkills(item) }, item.clientId || item.id).catch(error => toast(error, "error"));
  }
  // "Scheduled <name>" opens the automation it made, as it is now.
  const [automation, setAutomation] = useState(null);
  async function openAutomation({ id: automationId, name }) {
    try {
      const list = await call("automations.list");
      const found = list.find(item => item.id === automationId) || (!automationId && list.find(item => item.name === name && item.agentId === agent.id));
      if (found) setAutomation(found); else toast("This automation no longer exists.", "error");
    } catch (error) { toast(error, "error"); }
  }
  useEvent("automations.changed", () => { if (automation) void call("automations.list").then(list => setAutomation(list.find(item => item.id === automation.id) || null)).catch(() => {}); });
  // "Continue" after a stop, and "Try again" after an error, as before.
  const resume = () => send({ text: "Continue" }).catch(error => { toast(error, "error"); throw error; });
  const openThread = (threadId, source) => setSheet({ threadId, source });
  async function chooseModel(choice) {
    const previous = model;
    setModel(choice);
    try { setModel(await call("conversations.setModel", { id, ...choice }).then(value => value.modelSettings)); onChanged?.(); }
    catch (error) { setModel(previous); toast(error, "error"); }
  }

  // Until the model list loads, the chat's own model shows, not the default.
  const chatModels = { ...(models || {}), selected: model || models?.selected || null };
  return (
    <>
      <header className="tw-chat-header">
        <div className="tw-crumbs-chat">
          <a className="agent" href="#/" onClick={event => { event.preventDefault(); onNewTask(agent.id); }}><Avatar agent={agent} size="small" /><span>{agent.name}</span></a>
          <ChevronRight size={16} />
          <Title conversation={conversation} onRename={title => call("conversations.rename", { id, title }).then(onChanged).catch(error => toast(error, "error"))} />
        </div>
        <button type="button" className="tw-head-btn muted" aria-label="Report issue to the team" title="Report issue to the team" onClick={() => setDialog("feedback")}><MessageSquareWarning size={17} strokeWidth={1.6} />Report</button>
        <button type="button" className="tw-head-btn" aria-label="View task activity" title="View task activity" onClick={() => setDialog("trace")}>Activity</button>
        <Menu align="right" width={224} trigger={({ toggle, open }) => <button type="button" className="tw-icon-button" aria-label="Thread actions" aria-expanded={open} onClick={toggle}><EllipsisVertical size={18} /></button>}>
          <button type="button" className="tw-menu-item" data-close onClick={() => onEditAgent(agent)}><Pencil size={16} /><span className="grow">Edit agent</span></button>
          <button type="button" className="tw-menu-item" data-close onClick={() => { setFinding(true); setFindFocus(value => value + 1); }}><Search size={16} /><span className="grow">Search conversation</span><kbd className="tw-kbd">{window.tw?.platform === "darwin" ? "⌘F" : "Ctrl F"}</kbd></button>
        </Menu>
        {paneOpen ? null : <button type="button" className="tw-icon-button" title="Show pane" aria-label="Show pane" onClick={onTogglePane}><PanelRight size={18} strokeWidth={1.6} /></button>}
      </header>
      {finding ? <FindBar root={thread} focusKey={findFocus} onClose={() => setFinding(false)} /> : null}
      {/* At the top of the chat, before the messages, as before. */}
      <TaskActivity conversationId={id} workers={workers} onOpenThread={openThread} />
      <div className="tw-messages" ref={scroller} onScroll={event => { const node = event.currentTarget; const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80; pinned.current = bottom; setAtBottom(bottom); }}>
        <div className="tw-thread" ref={thread}>
          <div className="tw-chat-start">
            <button type="button" className="tw-chat-start-agent" title="Edit agent" onClick={() => onEditAgent(agent)}>
              <Avatar agent={agent} />
              <strong>{agent.name}</strong>
            </button>
            <span>You created this conversation</span>
          </div>
          {notice ? <div className="tw-date">{notice}</div> : null}
          {hidden ? <div className="tw-older"><button type="button" className="tw-pill-button" onClick={() => showOlder()}>Load older messages</button></div> : null}
          {shown.map(row => <Row key={row.key} row={row} agent={agent} conversationId={id} onRetry={retry} onReply={setReply} onJump={jump} onAutomation={value => void openAutomation(value)} />)}
          {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} />)}
          {loading ? null : (
            <AgentActivity state={state} commentary={commentaryLine(turns)} workers={workers} browserTab={browserTab} working={running}
              onOpenThread={openThread} onOpenBrowser={tabId => window.dispatchEvent(new CustomEvent("tw:open-tab", { detail: { conversationId: id, tabId } }))}
              onContinue={resume} funding={funding} onSettings={onSettings} />
          )}
        </div>
      </div>
      {atBottom ? null : <div className="tw-jump-anchor"><button type="button" className="tw-jump" aria-label="Scroll to latest message" onClick={() => { const node = scroller.current; if (node) node.scrollTop = node.scrollHeight; }}><ArrowDown size={16} /></button></div>}
      <Composer
        autoFocusKey={id} historyKey={id} draftKey={id} agentId={agent.id} running={running} models={chatModels} onModel={chooseModel}
        placeholder={reply ? "Reply..." : "Send another message..."} disabled={loading && !initialMessage}
        banner={<><ReconnectBanner agentId={agent.id} /><FundingBanner funding={funding} onOptions={() => onSettings("billing")} /></>}
        reply={reply} onClearReply={() => setReply(null)}
        onSend={message => {
          // The reply clears with the box, and comes back with it if sending fails.
          const replied = reply;
          setReply(null);
          return send(replied ? { ...message, text: quote(replied) + message.text } : message).catch(error => { setReply(current => current ?? replied); throw error; });
        }}
        onStop={() => call("conversations.interrupt", { id }).catch(error => toast(error, "error"))}
      />
      <FeedbackDialog open={dialog === "feedback"} onClose={() => setDialog(null)} conversationId={id} />
      <AutomationDialog automation={automation} onClose={() => setAutomation(null)} onRan={conversationId => { if (conversationId && conversationId !== id) location.hash = "#/conversation/" + conversationId; }} />
      <Trace open={dialog === "trace"} onClose={() => setDialog(null)} conversation={conversation} turns={turns} agent={agent} />
      <AgentThreadSheet conversationId={id} target={sheet} agentName={agent.name} turns={turns} state={state} workers={workers} onClose={() => setSheet(null)} />
    </>
  );
}
