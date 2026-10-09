import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Check, ChevronDown, ChevronRight, ChevronUp, Copy, EllipsisVertical, FileText, MessageSquareWarning, PanelRight, Pencil, Reply, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import { call, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { ATTACHED, applyEvent, blocksOf, turnsFromMessages, userFiles, userImages, userText } from "../turns.mjs";
import { ActivityGroup, PlanCard } from "./Activity.jsx";
import { ApprovalCard } from "./Approval.jsx";
import { Composer, FundingBanner, ReconnectBanner } from "./Composer.jsx";
import { Trace } from "./Trace.jsx";
import { TaskActivity } from "./TaskActivity.jsx";
import { Avatar, Dialog, Menu, useToast } from "./common.jsx";

const baseName = file => String(file).split(/[\\/]/).pop();
const GAP = 30 * 60;
// A reply starts with the quoted message.
const quote = text => String(text).trim().slice(0, 600).split("\n").map(line => "> " + line).join("\n") + "\n\n";
const stamp = seconds => new Date(seconds * 1000).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

function UserMessage({ item, failed, onRetry }) {
  const images = userImages(item), files = userFiles(item);
  return (
    <div className="tw-user-row">
      {images.length || files.length ? (
        <div className="tw-user-images">
          {images.map(file => <span key={file} className="tw-chip" title={file}><span>{baseName(file)}</span></span>)}
          {files.map(file => <span key={file} className="tw-chip" title={file}><FileText size={12} /><span>{baseName(file)}</span></span>)}
        </div>
      ) : null}
      {userText(item) ? <div className={"tw-user-message" + (failed ? " failed" : "")}>{userText(item)}</div> : null}
      {failed && onRetry ? <button type="button" className="tw-btn tw-retry" onClick={() => onRetry(item)}><RotateCcw size={13} /> Retry</button> : null}
    </div>
  );
}

// Reply and copy, shown over an agent message on hover.
function BubbleActions({ text, onReply }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="tw-bubble-actions">
      <button type="button" title="Reply" aria-label="Reply to message" onClick={() => onReply(text)}><Reply size={15} strokeWidth={1.7} /></button>
      <button type="button" title="Copy" aria-label="Copy message" onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? <Check size={15} /> : <Copy size={14} strokeWidth={1.7} />}</button>
    </span>
  );
}

function Turn({ turn, agent, onRetry, onReply }) {
  const blocks = blocksOf(turn);
  const live = turn.status === "inProgress";
  const users = blocks.filter(block => block.kind === "user");
  const side = blocks.filter(block => block.kind !== "user");
  const lastAgent = [...blocks].reverse().find(block => block.kind === "agent");
  const replied = blocks.some(block => block.kind === "agent" && block.item.text);
  const failed = turn.status === "failed" && !replied;
  const showSide = side.length || live || turn.error || turn.plan?.steps?.length || turn.reviews?.length || turn.warnings?.length;
  return (
    <>
      {users.map(block => <UserMessage key={block.key} item={block.item} failed={failed} onRetry={failed && onRetry ? item => onRetry(turn, item) : null} />)}
      {showSide ? (
        <div className="tw-agent-row">
          <div className="tw-agent-stack">
            <PlanCard plan={turn.plan} />
            {side.map(block => block.kind === "activity"
              ? <ActivityGroup key={block.key} items={block.items} live={live} />
              : <div key={block.key} className="tw-bubble"><Markdown text={block.item.text} streaming={live && block === lastAgent && block.item.status !== "completed"} />{block.item.text && !live ? <BubbleActions text={block.item.text} onReply={onReply} /> : null}</div>)}
            {live && !replied ? <span className="tw-thinking"><span className="tw-dots"><span /><span /><span /></span>{agent?.name || "Your agent"} is working</span> : null}
            {(turn.reviews || []).map(review => (
              <div key={review.id} className="tw-review" data-status={review.status}>
                <ShieldCheck size={14} />
                <span>{review.status === "inProgress" ? "Reviewing " : review.status === "approved" ? "Automatically allowed " : review.status === "denied" ? "Not allowed " : "Couldn't review "}<code>{review.action}</code>{review.rationale && review.status !== "approved" ? " — " + review.rationale : ""}</span>
              </div>
            ))}
            {(turn.warnings || []).map((warning, index) => <div key={index} className="tw-review" data-status="denied"><ShieldCheck size={14} /><span>{warning}</span></div>)}
            {turn.status === "interrupted" && !turn.error ? <span className="tw-hint">Stopped.</span> : null}
            {turn.error ? <div className="tw-turn-error">{turn.error.message || "The reply could not be completed."}</div> : null}
          </div>
          <Avatar agent={agent} />
        </div>
      ) : null}
    </>
  );
}

// Find in conversation: highlights matches in the messages.
function FindBar({ root, onClose }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ count: 0, index: 0 });
  const ranges = useRef([]);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); return () => { CSS.highlights?.delete("tw-find"); CSS.highlights?.delete("tw-find-current"); }; }, []);
  const show = (list, index) => {
    if (!CSS.highlights) return;
    CSS.highlights.set("tw-find", new Highlight(...list));
    if (list[index]) {
      CSS.highlights.set("tw-find-current", new Highlight(list[index]));
      list[index].startContainer.parentElement?.scrollIntoView({ block: "center" });
    } else CSS.highlights.delete("tw-find-current");
  };
  useEffect(() => {
    const node = root.current, needle = query.trim().toLowerCase();
    const found = [];
    if (node && needle) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.nodeValue.toLowerCase();
        for (let at = text.indexOf(needle); at >= 0 && found.length < 500; at = text.indexOf(needle, at + needle.length)) {
          const range = new Range();
          range.setStart(walker.currentNode, at); range.setEnd(walker.currentNode, at + needle.length);
          found.push(range);
        }
      }
    }
    ranges.current = found;
    setState({ count: found.length, index: 0 });
    show(found, 0);
  }, [query, root]);
  const move = step => setState(current => {
    if (!current.count) return current;
    const index = (current.index + step + current.count) % current.count;
    show(ranges.current, index);
    return { ...current, index };
  });
  return (
    <div className="tw-find" role="search">
      <Search size={15} />
      <input ref={input} value={query} placeholder="Search conversation" aria-label="Search conversation" onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") move(event.shiftKey ? -1 : 1); if (event.key === "Escape") onClose(); }} />
      <span className="tw-hint">{query.trim() ? (state.count ? `${state.index + 1} of ${state.count}` : "No results") : ""}</span>
      <button type="button" className="tw-icon-button" aria-label="Previous match" onClick={() => move(-1)}><ChevronUp size={16} /></button>
      <button type="button" className="tw-icon-button" aria-label="Next match" onClick={() => move(1)}><ChevronDown size={16} /></button>
      <button type="button" className="tw-icon-button" aria-label="Close search" onClick={onClose}><X size={16} /></button>
    </div>
  );
}

export function FeedbackDialog({ open, onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) setText(""); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} className="tw-feedback" title="Send feedback" description="Tell us what happened or what could be better. Your report, app version, and platform will be sent to Timewarp support.">
      <textarea className="tw-textarea" rows={2} autoFocus value={text} maxLength={5000} onChange={event => setText(event.target.value)} placeholder="What happened? What did you expect?" aria-label="Feedback" />
      <button type="button" className="tw-btn primary tw-wide" disabled={busy || !text.trim()} onClick={() => {
        setBusy(true);
        call("feedback.submit", { description: text, category: "general" }).then(() => { toast("Thanks, your feedback was sent."); onClose(); }).catch(error => toast(error, "error")).finally(() => setBusy(false));
      }}>{busy ? "Sending…" : "Send feedback"}</button>
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
  // Each chat keeps its own model; new chats start with the default.
  const [model, setModel] = useState(conversation.modelSettings?.name ? conversation.modelSettings : null);
  const scroller = useRef(null);
  const thread = useRef(null);
  const pinned = useRef(true);
  const toast = useToast();
  const id = conversation.id;

  const markRead = useCallback(() => {
    if (document.hasFocus()) void call("conversations.markRead", { id }).then(onChanged).catch(() => {});
  }, [id, onChanged]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setTurns([]); setApprovals([]); setNotice(null); pinned.current = true;
    setModel(conversation.modelSettings?.name ? conversation.modelSettings : null);
    Promise.all([call("conversations.history", { id }), call("conversations.status", { id })]).then(([history, status]) => {
      if (cancelled) return;
      const owner = account?.user?.id;
      setTurns(current => {
        const loaded = history.turns?.length
          ? [...turnsFromMessages(history.earlier || [], owner), ...history.turns, ...turnsFromMessages(history.failed || [], owner)]
          : turnsFromMessages(history.messages || [], owner);
        // A first message sent, or a reply that started, while the history
        // loaded stays visible.
        return [...loaded, ...current.filter(turn => !loaded.some(item => item.id === turn.id))];
      });
      if (!history.turns?.length && history.messages?.length && history.transcriptUnavailable !== undefined) setNotice("Earlier tool activity from another device isn't available here. Your messages are.");
      setRunning(current => current || !!status.running);
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
    void send(initialMessage).catch(error => toast(error, "error"));
  }, [id]);

  useEvent("conversation.event", ({ conversationId, method, params }) => {
    if (conversationId !== id) return;
    if (method === "turn/started") { setRunning(true); setTurns(current => current.filter(turn => !turn.pending)); }
    setTurns(current => applyEvent(current, method, params));
    if ((method === "turn/completed" || method === "turn/aborted") && !params.subAgent) { setRunning(false); markRead(); }
    if (method === "thread/name/updated") onChanged?.();
  });
  useEvent("approval.requested", approval => { if (approval.conversationId === id) setApprovals(current => [...current.filter(item => item.id !== approval.id), approval]); });
  useEvent("approval.resolved", ({ id: requestId, conversationId }) => { if (conversationId === id) setApprovals(current => current.filter(item => item.id !== requestId)); });
  useEffect(() => { const focus = () => markRead(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [markRead]);
  useEffect(() => {
    const find = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !document.querySelector("dialog[open]")) { event.preventDefault(); setFinding(true); } };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, []);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [turns, approvals, loading]);

  async function send(message, retryOf) {
    const clientId = crypto.randomUUID();
    pinned.current = true;
    const files = message.files || [];
    const content = [
      { type: "text", text: message.text },
      ...(files.length ? [{ type: "text", text: [ATTACHED, ...files.map(file => "- " + baseName(file))].join("\n") }] : []),
      ...(message.images || []).map(path => ({ type: "localImage", path })),
    ];
    setTurns(current => [...current, { id: "pending-" + clientId, pending: true, startedAt: Date.now() / 1000, status: "inProgress", items: [{ type: "userMessage", id: clientId, clientId, content }] }]);
    setRunning(true);
    try {
      await call("conversations.send", { id, text: message.text, images: message.images || [], files, clientId, retryOf });
      onChanged?.();
    } catch (error) {
      setRunning(false);
      setTurns(current => current.map(turn => turn.id === "pending-" + clientId ? { ...turn, pending: false, status: "failed", error: { message: error.message } } : turn));
      throw error;
    }
  }
  // Sends a message that didn't go through again, in place of the failed one.
  function retry(turn, item) {
    setTurns(current => current.filter(entry => entry !== turn));
    void send({ text: userText(item), images: userImages(item), files: [] }, item.clientId || item.id).catch(error => toast(error, "error"));
  }
  async function chooseModel(choice) {
    const previous = model;
    setModel(choice);
    try { setModel(await call("conversations.setModel", { id, ...choice }).then(value => value.modelSettings)); onChanged?.(); }
    catch (error) { setModel(previous); toast(error, "error"); }
  }

  const chatModels = models ? { ...models, selected: model || models.selected } : models;
  let previous = null;
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
          <button type="button" className="tw-menu-item" data-close onClick={() => setFinding(true)}><Search size={16} /><span className="grow">Search conversation</span><kbd className="tw-kbd">{window.tw?.platform === "darwin" ? "⌘F" : "Ctrl F"}</kbd></button>
        </Menu>
        {paneOpen ? null : <button type="button" className="tw-icon-button" title="Show pane" aria-label="Show pane" onClick={onTogglePane}><PanelRight size={18} strokeWidth={1.6} /></button>}
      </header>
      {finding ? <FindBar root={thread} onClose={() => setFinding(false)} /> : null}
      <div className="tw-messages" ref={scroller} onScroll={event => { const node = event.currentTarget; const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80; pinned.current = bottom; setAtBottom(bottom); }}>
        <div className="tw-thread" ref={thread}>
          <div className="tw-chat-start">
            <Avatar agent={agent} />
            <strong>{agent.name}</strong>
            <span>You created this conversation</span>
          </div>
          {notice ? <div className="tw-date">{notice}</div> : null}
          {turns.map(turn => {
            const at = turn.startedAt || null;
            const separator = at && (previous === null || at - previous > GAP) ? <div className="tw-date">{stamp(at)}</div> : null;
            if (at) previous = at;
            return <React.Fragment key={turn.id}>{separator}<Turn turn={turn} agent={agent} onRetry={running ? null : retry} onReply={setReply} /></React.Fragment>;
          })}
          {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} />)}
        </div>
      </div>
      {atBottom ? null : <button type="button" className="tw-jump" aria-label="Scroll to bottom" onClick={() => { const node = scroller.current; if (node) node.scrollTop = node.scrollHeight; }}><ArrowDown size={16} /></button>}
      <TaskActivity conversationId={id} turns={turns} />
      <Composer
        autoFocusKey={id} running={running} models={chatModels} onModel={chooseModel}
        placeholder="Send another message..." disabled={loading && !initialMessage}
        banner={<><ReconnectBanner /><FundingBanner funding={funding} onOptions={() => onSettings("billing")} /></>}
        reply={reply} onClearReply={() => setReply(null)}
        onSend={message => send(reply ? { ...message, text: quote(reply) + message.text } : message).then(() => setReply(null))}
        onStop={() => call("conversations.interrupt", { id }).catch(error => toast(error, "error"))}
      />
      <FeedbackDialog open={dialog === "feedback"} onClose={() => setDialog(null)} />
      <Trace open={dialog === "trace"} onClose={() => setDialog(null)} conversation={conversation} turns={turns} agent={agent} />
    </>
  );
}
