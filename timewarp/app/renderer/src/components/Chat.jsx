import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Archive, FileText, FolderOpen, PanelRight, RotateCcw } from "lucide-react";
import { call, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { ATTACHED, applyEvent, blocksOf, turnsFromMessages, userFiles, userImages, userText } from "../turns.mjs";
import { ActivityGroup, PlanCard } from "./Activity.jsx";
import { ApprovalCard } from "./Approval.jsx";
import { Composer } from "./Composer.jsx";
import { Avatar, useToast } from "./common.jsx";

const baseName = file => String(file).split(/[\\/]/).pop();

function Title({ conversation, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(conversation.title || "");
  useEffect(() => { setValue(conversation.title || ""); setEditing(false); }, [conversation.id, conversation.title]);
  if (editing) {
    const commit = () => { setEditing(false); if (value.trim() && value.trim() !== conversation.title) onRename(value.trim()); };
    return <input className="tw-input" autoFocus value={value} maxLength={200} aria-label="Conversation name" onChange={event => setValue(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); if (event.key === "Escape") setEditing(false); }} />;
  }
  return <button type="button" title="Rename" onClick={() => setEditing(true)}>{conversation.title || "New conversation"}</button>;
}

function UserMessage({ item, failed, onRetry }) {
  const images = userImages(item), files = userFiles(item);
  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
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

function Turn({ turn, agent, onRetry }) {
  const blocks = blocksOf(turn);
  const live = turn.status === "inProgress";
  const groups = [];
  for (const block of blocks) {
    if (block.kind === "user") groups.push(block);
    else if (groups.at(-1)?.kind === "agent-side") groups.at(-1).blocks.push(block);
    else groups.push({ kind: "agent-side", key: "side-" + block.key, blocks: [block] });
  }
  const lastAgent = [...blocks].reverse().find(block => block.kind === "agent");
  const replied = blocks.some(block => block.kind === "agent" && block.item.text);
  const failed = turn.status === "failed" && !replied;
  const showSide = groups.some(group => group.kind === "agent-side") || live || turn.error || turn.plan;
  return (
    <>
      {groups.filter(group => group.kind === "user").map(group => <UserMessage key={group.key} item={group.item} failed={failed} onRetry={failed && onRetry ? item => onRetry(turn, item) : null} />)}
      {showSide ? (
        <div className="tw-agent-message">
          <Avatar agent={agent} />
          <div className="tw-agent-body">
            <PlanCard plan={turn.plan} />
            {groups.filter(group => group.kind === "agent-side").flatMap(group => group.blocks).map(block => block.kind === "activity"
              ? <ActivityGroup key={block.key} items={block.items} live={live} />
              : <Markdown key={block.key} text={block.item.text} streaming={live && block === lastAgent && block.item.status !== "completed"} />)}
            {live && !replied ? <span className="tw-thinking"><span className="tw-dots"><span /><span /><span /></span>{agent?.name || "Your agent"} is working</span> : null}
            {turn.status === "interrupted" && !turn.error ? <span className="tw-hint">Stopped.</span> : null}
            {turn.error ? <div className="tw-turn-error">{turn.error.message || "The reply could not be completed."}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function Chat({ conversation, agent, account, models, onChanged, paneOpen, onTogglePane }) {
  const [turns, setTurns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [approvals, setApprovals] = useState([]);
  const [notice, setNotice] = useState(null);
  // Each chat keeps its own model; new chats start with the default.
  const [model, setModel] = useState(conversation.modelSettings?.name ? conversation.modelSettings : null);
  const scroller = useRef(null);
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
      setTurns(history.turns?.length
        ? [...turnsFromMessages(history.earlier || [], owner), ...history.turns, ...turnsFromMessages(history.failed || [], owner)]
        : turnsFromMessages(history.messages || [], owner));
      if (!history.turns?.length && history.messages?.length && history.transcriptUnavailable !== undefined) setNotice("Earlier tool activity from another device isn't available here. Your messages are.");
      setRunning(!!status.running);
      setApprovals(status.approvals || []);
      // Open the agent's session now so the first message starts right away.
      if (!status.running) void call("conversations.warm", { id }).catch(() => {});
    }).catch(error => { if (!cancelled) toast(error, "error"); }).finally(() => { if (!cancelled) setLoading(false); });
    markRead();
    return () => { cancelled = true; };
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
      ...message.images.map(path => ({ type: "localImage", path })),
    ];
    setTurns(current => [...current, { id: "pending-" + clientId, pending: true, status: "inProgress", items: [{ type: "userMessage", id: clientId, clientId, content }] }]);
    setRunning(true);
    try {
      await call("conversations.send", { id, text: message.text, images: message.images, files, clientId, retryOf });
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
  return (
    <section className="tw-main" aria-label={conversation.title || "Conversation"}>
      <header className="tw-chat-header">
        <div className="tw-chat-title"><Avatar agent={agent} size="small" /><Title conversation={conversation} onRename={title => call("conversations.rename", { id, title }).then(onChanged).catch(error => toast(error, "error"))} /></div>
        <button type="button" className="tw-icon-button" title={paneOpen ? "Hide browser" : "Show browser"} aria-label={paneOpen ? "Hide browser" : "Show browser"} aria-pressed={!!paneOpen} onClick={onTogglePane}><PanelRight size={16} /></button>
        <button type="button" className="tw-icon-button" title="Open workspace folder" aria-label="Open workspace folder" onClick={() => call("agents.openWorkspace", { id: agent.id }).catch(error => toast(error, "error"))}><FolderOpen size={16} /></button>
        <button type="button" className="tw-icon-button" title="Archive" aria-label="Archive conversation" onClick={() => call("conversations.archive", { id }).then(() => onChanged?.({ archived: true })).catch(error => toast(error, "error"))}><Archive size={16} /></button>
      </header>
      <div className="tw-messages" ref={scroller} onScroll={event => { const node = event.currentTarget; pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }}>
        {!loading && !turns.length ? (
          <div className="tw-blank">
            <Avatar agent={agent} size="large" />
            <h2>Chat with {agent?.name || "your agent"}</h2>
            <p>Ask for research, writing, files on this computer, or work across the web and your connected apps.</p>
          </div>
        ) : (
          <div className="tw-thread">
            {notice ? <div className="tw-hint" style={{ textAlign: "center" }}>{notice}</div> : null}
            {turns.map(turn => <Turn key={turn.id} turn={turn} agent={agent} onRetry={running ? null : retry} />)}
            {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} />)}
          </div>
        )}
      </div>
      <Composer
        autoFocusKey={id} running={running} models={chatModels} onModel={chooseModel}
        placeholder={"Message " + (agent?.name || "your agent")} disabled={loading || !agent}
        onSend={message => send(message)}
        onStop={() => call("conversations.interrupt", { id }).catch(error => toast(error, "error"))}
      />
    </section>
  );
}
