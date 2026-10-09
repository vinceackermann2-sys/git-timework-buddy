import React, { useEffect, useRef, useState } from "react";
import { Archive, Bell, ChevronUp, Ellipsis, FolderOpen, LogOut, Pencil, Plug, Plus, Search, Settings, Star, UserPlus, UserRound, X } from "lucide-react";
import { relativeTime } from "../api.js";
import { Avatar, Menu } from "./common.jsx";

const VISIBLE = 5;
const readList = key => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
const writeList = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

function dayLabel(iso) {
  const time = new Date(iso || 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(time).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "";
  if (days < 7) return time.toLocaleDateString(undefined, { weekday: "long" });
  return time.toLocaleDateString(undefined, { month: "long", day: "numeric", ...(time.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

function ConversationRow({ conversation, current, onOpen, onArchive }) {
  return (
    <div role="link" tabIndex={0} className={"tw-convo" + (conversation.read ? "" : " unread")} aria-current={current}
      onClick={() => onOpen(conversation)} onKeyDown={event => { if (event.key === "Enter") onOpen(conversation); }}>
      <span>{conversation.title || "New conversation"}</span>
      {conversation.read ? <time>{relativeTime(conversation.lastActivityAt)}</time> : <i className="tw-unread-dot" aria-label="Unread" />}
      <button type="button" className="tw-icon-button" title="Archive" aria-label={"Archive " + (conversation.title || "conversation")} onClick={event => { event.stopPropagation(); onArchive(conversation); }}><Archive size={15} /></button>
    </div>
  );
}

function AgentGroup({ agent, conversations, selectedId, collapsed, onToggle, onOpen, onArchive, onNewChat, onEditAgent, onStarAgent, onOpenWorkspace, onArchiveAgent, drag }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? conversations : conversations.slice(0, VISIBLE);
  return (
    <div className="tw-agent-group">
      <div className="tw-agent-head" role="button" tabIndex={0} aria-expanded={!collapsed} title={(collapsed ? "Expand " : "Collapse ") + agent.name + " tasks"}
        onClick={onToggle} onKeyDown={event => { if (event.key === "Enter") onToggle(); }} {...drag}>
        <Avatar agent={agent} />
        <span>{agent.name}</span>
        <span onClick={event => event.stopPropagation()} style={{ display: "flex" }}>
          <Menu align="right" width={220} trigger={({ toggle, open }) => <button type="button" className="tw-icon-button" style={open ? { opacity: 1 } : null} aria-label={"Options for " + agent.name} onClick={toggle}><Ellipsis size={15} /></button>}>
            <button type="button" className="tw-menu-item" data-close onClick={() => onEditAgent(agent)}><Pencil size={15} /><span className="grow">Edit agent</span></button>
            <button type="button" className="tw-menu-item" data-close onClick={() => onStarAgent(agent)}><Star size={15} /><span className="grow">{agent.starredAt ? "Remove star" : "Star"}</span></button>
            <button type="button" className="tw-menu-item" data-close onClick={() => onOpenWorkspace(agent)}><FolderOpen size={15} /><span className="grow">Open workspace folder</span></button>
            <div className="tw-menu-sep" />
            <button type="button" className="tw-menu-item" data-close onClick={() => onArchiveAgent(agent)}><Archive size={15} /><span className="grow">Remove agent</span></button>
          </Menu>
          <button type="button" className="tw-icon-button" title={"New task with " + agent.name} aria-label={"New task with " + agent.name} onClick={() => onNewChat(agent.id)}><Plus size={16} /></button>
        </span>
      </div>
      {collapsed ? null : (
        <>
          {shown.map(conversation => <ConversationRow key={conversation.id} conversation={conversation} current={conversation.id === selectedId} onOpen={onOpen} onArchive={onArchive} />)}
          {conversations.length > VISIBLE ? <button type="button" className="tw-show-more" onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show more"}</button> : null}
        </>
      )}
    </div>
  );
}

function Feed({ conversations, agentById, selectedId, onOpen }) {
  let previous = null;
  const sorted = [...conversations].sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
  if (!sorted.length) return <p className="tw-side-empty">Activity from your agents shows up here.</p>;
  return sorted.map(conversation => {
    const label = dayLabel(conversation.lastActivityAt);
    const heading = label !== previous && label ? <div className="tw-day" key={"day-" + conversation.id}>{label}</div> : null;
    previous = label;
    const agent = agentById.get(conversation.agentId);
    return (
      <React.Fragment key={conversation.id}>
        {heading}
        <button type="button" className="tw-feed-item" aria-current={conversation.id === selectedId} onClick={() => onOpen(conversation)}>
          <Avatar agent={agent} />
          <strong>{agent?.name || "Agent"}</strong>
          <p>{conversation.lastText?.replace(/[*_`#>~]+/g, "").replace(/\s+/g, " ").trim() || conversation.title || "Start a conversation"}</p>
          <time>{relativeTime(conversation.lastActivityAt)}</time>
        </button>
      </React.Fragment>
    );
  });
}

export function OrgPicture({ organization }) {
  const picture = organization?.logo || organization?.image;
  return <span className="tw-org-picture">{picture ? <img className="photo" src={picture} alt="" /> : <img src="./timewarp-logo.svg" alt="" />}</span>;
}

export function Sidebar({ account, agents, conversations, selectedId, view, search, onSearch, usage, onNewTask, onOpenConversation, onNewChat, onNewAgent, onEditAgent,
  onStarAgent, onArchiveAgent, onOpenWorkspace, onArchiveConversation, onReorder, onSettings, onProfile, onSignOut }) {
  const [mode, setMode] = useState("tasks");
  const [collapsed, setCollapsed] = useState(() => new Set(readList("tw.collapsed")));
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const searchInput = useRef(null);
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  useEffect(() => { if (mode !== "search" && search) onSearch(""); if (mode === "search") searchInput.current?.focus(); }, [mode]);
  const toggle = id => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    writeList("tw.collapsed", [...next]);
    return next;
  });
  const drag = agent => ({
    draggable: true,
    "data-dragging": dragging === agent.id,
    "data-drop": dropTarget === agent.id && dragging !== agent.id,
    onDragStart: event => { setDragging(agent.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", agent.id); },
    onDragEnd: () => { setDragging(null); setDropTarget(null); },
    onDragOver: event => { if (dragging) { event.preventDefault(); setDropTarget(agent.id); } },
    onDrop: event => {
      event.preventDefault();
      if (!dragging || dragging === agent.id) return;
      const ids = agents.map(item => item.id).filter(id => id !== dragging);
      ids.splice(ids.indexOf(agent.id), 0, dragging);
      setDragging(null); setDropTarget(null);
      onReorder(ids);
    },
  });
  const organization = account?.activeOrganization;
  const open = conversation => { onOpenConversation(conversation); };
  let body;
  if (mode === "activity") body = <Feed conversations={conversations} agentById={agentById} selectedId={view === "chat" ? selectedId : null} onOpen={open} />;
  else if (mode === "search") {
    body = search.trim()
      ? (conversations.length ? conversations.map(conversation => (
        <button key={conversation.id} type="button" className="tw-feed-item" aria-current={view === "chat" && conversation.id === selectedId} onClick={() => open(conversation)}>
          <Avatar agent={agentById.get(conversation.agentId)} />
          <strong>{conversation.title || "New conversation"}</strong>
          <p>{agentById.get(conversation.agentId)?.name}</p>
          <time>{relativeTime(conversation.lastActivityAt)}</time>
        </button>
      )) : <p className="tw-side-empty">No conversations match your search.</p>)
      : <p className="tw-side-empty">Search conversation titles and messages.</p>;
  } else {
    body = (
      <>
        {agents.map(agent => (
          <AgentGroup key={agent.id} agent={agent} conversations={conversations.filter(item => item.agentId === agent.id)} selectedId={view === "chat" ? selectedId : null}
            collapsed={collapsed.has(agent.id)} onToggle={() => toggle(agent.id)} onOpen={open} onArchive={onArchiveConversation} onNewChat={onNewChat}
            onEditAgent={onEditAgent} onStarAgent={onStarAgent} onOpenWorkspace={onOpenWorkspace} onArchiveAgent={onArchiveAgent} drag={drag(agent)} />
        ))}
        <button type="button" className="tw-add-agent" onClick={onNewAgent}><Plus size={18} strokeWidth={1.6} /><span>Add agent</span></button>
      </>
    );
  }
  return (
    <aside className="tw-sidebar" aria-label="Agents and tasks">
      <div className="tw-brand">
        <img src="./timewarp-logo.svg" alt="" />
        <span>Timewarp</span>
        <button type="button" className="tw-icon-button" title="Search" aria-label="Search" aria-pressed={mode === "search"} onClick={() => setMode(mode === "search" ? "tasks" : "search")}><Search size={19} strokeWidth={1.7} /></button>
        <button type="button" className="tw-icon-button" title={mode === "activity" ? "Hide activity" : "Show activity"} aria-label={mode === "activity" ? "Hide activity" : "Show activity"} aria-pressed={mode === "activity"} onClick={() => setMode(mode === "activity" ? "tasks" : "activity")}><Bell size={19} strokeWidth={1.7} /></button>
      </div>
      {mode === "search" ? (
        <label className="tw-search-field tw-side-search">
          <Search size={16} />
          <input ref={searchInput} className="tw-input" type="search" placeholder="Search conversations" value={search} onChange={event => onSearch(event.target.value)} aria-label="Search conversations"
            onKeyDown={event => { if (event.key === "Escape") setMode("tasks"); }} />
          <button type="button" className="tw-icon-button tw-side-search-close" aria-label="Close search" onClick={() => setMode("tasks")}><X size={15} /></button>
        </label>
      ) : (
        <button type="button" className="tw-new-task" onClick={() => onNewTask()}><Plus size={18} strokeWidth={1.6} /><span>New Task</span></button>
      )}
      <div className="tw-side-scroll">{body}</div>
      {usage}
      <Menu up align="left" width={272} className="tw-account-menu" trigger={({ toggle, open }) => (
        <button type="button" className="tw-account" aria-expanded={open} onClick={toggle} aria-label="Account">
          <OrgPicture organization={organization} />
          <span><strong>{organization?.name || account?.user?.name || "Timewarp"}</strong><small>{account?.user?.email || ""}</small></span>
          <ChevronUp size={17} />
        </button>
      )}>
        <div className="tw-menu-head"><strong>{account?.user?.name || organization?.name}</strong><small>{account?.user?.email}</small></div>
        <div className="tw-menu-sep" />
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("organization")}><UserPlus size={16} /><span className="grow">Invite members</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={onProfile}><UserRound size={16} /><span className="grow">Profile</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("tools")}><Plug size={16} /><span className="grow">Connect Tools</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("general")}><Settings size={16} /><span className="grow">Settings</span></button>
        <div className="tw-menu-sep" />
        <button type="button" className="tw-menu-item" data-close onClick={onSignOut}><LogOut size={16} /><span className="grow">Log out</span></button>
      </Menu>
    </aside>
  );
}

// ChatGPT / Codex usage, or Timewarp credits on a paid plan.
export function UsageCard({ funding, chatgpt, onOpen }) {
  if (!funding) return null;
  let title = "ChatGPT / Codex usage", detail = "Connect in Billing", percent = 0;
  if (funding.source === "chatgpt") {
    const primary = chatgpt?.rateLimits?.primary;
    percent = Math.min(100, Math.max(0, Number(primary?.usedPercent) || 0));
    detail = primary ? `${Math.round(percent)}% used` : chatgpt?.status === "reauth_required" ? "Reconnect in Billing" : "Connected";
  } else if (!funding.subscriptionAllowed) {
    title = "Timewarp credits";
    detail = `${Math.max(0, Math.floor(Number(funding.timewarpCredits) || 0)).toLocaleString()} left`;
    percent = null;
  }
  return (
    <button type="button" className="tw-usage" aria-label={title + " — open Billing"} onClick={onOpen}>
      <div><span>{title}</span><span>{detail}</span></div>
      {percent === null ? null : <div className="tw-usage-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><i style={{ width: percent + "%" }} /></div>}
    </button>
  );
}

