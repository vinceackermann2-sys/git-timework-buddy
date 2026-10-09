import React, { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Bell, BellDot, Blocks, Building2, ChevronRight, ChevronUp, GripVertical, LogOut, Pencil, Plus, Search, Settings2, UserPlus, UserRound } from "lucide-react";
import { call, relativeTime } from "../api.js";
import { Avatar, ContextMenu, Menu, useToast } from "./common.jsx";

const VISIBLE = 5;
const readList = key => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
const writeList = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

function dayLabel(iso) {
  const time = new Date(iso || 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(time).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Today";
  if (days < 7) return time.toLocaleDateString(undefined, { weekday: "long" });
  return time.toLocaleDateString(undefined, { month: "long", day: "numeric", ...(time.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

// Plain text for one-line previews: no markdown marks or code-fence languages.
export function previewText(value) {
  return String(value || "").replace(/```[\w+-]*/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>~|]+/g, "").replace(/\s+/g, " ").trim();
}

// A chat in its agent's group. Right-click: mark as unread, rename, archive.
function ConversationRow({ conversation, current, onArchive, onChanged }) {
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const toast = useToast();
  const closeMenu = useCallback(() => setMenu(null), []);
  const commit = () => {
    setRenaming(false);
    const value = title.trim();
    if (value && value !== conversation.title) call("conversations.rename", { id: conversation.id, title: value }).then(onChanged).catch(error => toast(error, "error"));
  };
  if (renaming) {
    return (
      <div className="tw-convo editing">
        <input autoFocus value={title} maxLength={200} aria-label="Conversation name" onChange={event => setTitle(event.target.value)} onBlur={commit}
          onKeyDown={event => { if (event.key === "Enter") commit(); if (event.key === "Escape") setRenaming(false); }} />
      </div>
    );
  }
  return (
    <>
      <a href={"#/conversation/" + conversation.id} className={"tw-convo" + (conversation.read ? "" : " unread")} aria-current={current ? "page" : undefined}
        onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}>
        <span>{conversation.title || "New conversation"}</span>
        {conversation.read ? <time>{relativeTime(conversation.lastActivityAt)}</time> : <i className="tw-unread-dot" aria-label="Unread" />}
        <button type="button" className="tw-icon-button" title="Archive" aria-label="Archive" onClick={event => { event.preventDefault(); event.stopPropagation(); onArchive(conversation); }}><Archive size={15} /></button>
      </a>
      <ContextMenu at={menu} onClose={closeMenu}>
        <button type="button" className="tw-menu-item" data-close onClick={() => call("conversations.markUnread", { id: conversation.id }).then(onChanged).catch(error => toast(error, "error"))}><BellDot size={16} /><span className="grow">Mark as unread</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => { setTitle(conversation.title || ""); setRenaming(true); }}><Pencil size={16} /><span className="grow">Rename</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onArchive(conversation)}><Archive size={16} /><span className="grow">Archive</span></button>
      </ContextMenu>
    </>
  );
}

// An agent and its chats. Hover shows the drag handle and new task; right-click: edit, archive.
function AgentGroup({ agent, conversations, selectedId, current, collapsed, onToggle, onArchive, onChanged, onNewChat, onEditAgent, onArchiveAgent, drag }) {
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const shown = expanded ? conversations : conversations.slice(0, VISIBLE);
  return (
    <div className="tw-agent-group">
      <div className="tw-agent-head" role="button" tabIndex={0} aria-expanded={!collapsed} aria-current={current ? "true" : undefined} aria-label={(collapsed ? "Expand " : "Collapse ") + agent.name + " tasks"}
        onClick={onToggle} onKeyDown={event => { if (event.key === "Enter") onToggle(); }}
        onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }} {...drag}>
        <span className="tw-agent-face" aria-label={"Drag " + agent.name}><Avatar agent={agent} /><GripVertical size={16} className="grip" /></span>
        <span>{agent.name}</span>
        <button type="button" className="tw-icon-button" title={"New task with " + agent.name} aria-label={"New task with " + agent.name} onClick={event => { event.stopPropagation(); onNewChat(agent.id); }}><Plus size={16} /></button>
      </div>
      <ContextMenu at={menu} onClose={closeMenu}>
        <button type="button" className="tw-menu-item" data-close onClick={() => onEditAgent(agent)}><Pencil size={16} /><span className="grow">Edit</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onArchiveAgent(agent)}><Archive size={16} /><span className="grow">Archive</span></button>
      </ContextMenu>
      {collapsed ? null : (
        <>
          {shown.map(conversation => <ConversationRow key={conversation.id} conversation={conversation} current={conversation.id === selectedId} onArchive={onArchive} onChanged={onChanged} />)}
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
          <strong>{conversation.title && conversation.title !== "New conversation" ? conversation.title : agent?.name || "Agent"}</strong>
          <p>{previewText(conversation.lastText) || "Start a conversation"}</p>
          <time>{relativeTime(conversation.lastActivityAt)}</time>
        </button>
      </React.Fragment>
    );
  });
}

// The account menu's first row: the organization, with its settings and a way to add one.
function OrganizationRow({ organization, account, onSettings }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tw-org-row" onMouseLeave={() => setOpen(false)}>
      <button type="button" className="tw-menu-item tw-org-item" aria-haspopup="menu" aria-expanded={open} onMouseEnter={() => setOpen(true)} onClick={() => setOpen(true)}>
        <OrgPicture organization={organization} />
        <span className="grow"><strong>{organization?.name || account?.user?.name || "Timewarp"}</strong><small>{account?.user?.email}</small></span>
        <ChevronRight size={16} />
      </button>
      {open ? (
        <div className="tw-menu tw-submenu" role="menu">
          <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("organization")}><Building2 size={16} /><span className="grow">Organization Settings</span></button>
          <button type="button" className="tw-menu-item" data-close onClick={() => { onSettings("organization"); setTimeout(() => window.dispatchEvent(new Event("tw:new-organization")), 50); }}><Plus size={16} /><span className="grow">Add organization</span></button>
        </div>
      ) : null}
    </div>
  );
}

export function OrgPicture({ organization }) {
  const picture = organization?.logo || organization?.image;
  return <span className="tw-org-picture">{picture ? <img className="photo" src={picture} alt="" /> : <img src="./timewarp-logo.svg" alt="" />}</span>;
}

// Search over conversations and agents, opened from the sidebar.
function SearchDialog({ open, onClose, agents, agentById, onOpenConversation, onAgent }) {
  const ref = useRef(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { setQuery(""); setActive(0); dialog.showModal(); }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => call("conversations.list", { search: query.trim() || undefined })
      .then(list => { if (!cancelled) { setResults(list.filter(item => agentById.has(item.agentId))); setActive(0); } }).catch(() => {}), query ? 150 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query]);
  const needle = query.trim().toLowerCase();
  const found = agents.filter(agent => !needle || agent.name.toLowerCase().includes(needle));
  const items = [...found.map(agent => ({ key: "agent-" + agent.id, run: () => onAgent(agent.id) })), ...results.map(conversation => ({ key: conversation.id, run: () => onOpenConversation(conversation) }))];
  const choose = index => { const item = items[index]; if (!item) return; onClose(); item.run(); };
  const option = (index, content) => (
    <div key={items[index].key} id={"tw-search-" + index} role="option" aria-selected={index === active} className="tw-palette-option"
      onMouseMove={() => setActive(index)} onClick={() => choose(index)}>{content}</div>
  );
  return (
    <dialog ref={ref} className="tw-dialog tw-palette" aria-label="Search conversations and agents" onClose={onClose}
      onCancel={event => { event.preventDefault(); onClose(); }} onMouseDown={event => { if (event.target === ref.current) onClose(); }}>
      {open ? (
        <>
          <label className="tw-palette-input">
            <Search size={18} strokeWidth={1.7} />
            <input autoFocus role="combobox" aria-expanded="true" aria-controls="tw-search-list" aria-activedescendant={items.length ? "tw-search-" + active : undefined}
              placeholder="Search conversations and assistants..." value={query} onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(items.length - 1, index + 1)); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
                else if (event.key === "Enter") { event.preventDefault(); choose(active); }
              }} />
          </label>
          <div className="tw-palette-list" role="listbox" id="tw-search-list">
            {found.map((agent, index) => option(index, <><Avatar agent={agent} size="tiny" /><span className="grow">{agent.name}</span></>))}
            {found.length && results.length ? <div className="tw-palette-gap" role="presentation" /> : null}
            {results.map((conversation, position) => option(found.length + position, <><span className="grow">{conversation.title || "New conversation"}</span><time>{relativeTime(conversation.lastActivityAt)}</time></>))}
            {items.length ? null : <p className="tw-palette-empty">No results</p>}
          </div>
        </>
      ) : null}
    </dialog>
  );
}

export function Sidebar({ account, agents, conversations, selectedId, view, homeAgentId, usage, onNewTask, onOpenConversation, onNewChat, onNewAgent, onEditAgent,
  onArchiveAgent, onArchiveConversation, onConversationsChanged, onReorder, onSettings, onProfile, onSignOut }) {
  const [mode, setMode] = useState("tasks");
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set(readList("tw.collapsed")));
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
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
  else {
    body = (
      <>
        {agents.map(agent => (
          <AgentGroup key={agent.id} agent={agent} conversations={conversations.filter(item => item.agentId === agent.id)} selectedId={view === "chat" ? selectedId : null}
            current={view === "home" && agent.id === homeAgentId} collapsed={collapsed.has(agent.id)} onToggle={() => toggle(agent.id)} onArchive={onArchiveConversation} onChanged={onConversationsChanged} onNewChat={onNewChat}
            onEditAgent={onEditAgent} onArchiveAgent={onArchiveAgent} drag={drag(agent)} />
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
        <button type="button" className="tw-icon-button" title="Search" aria-label="Search" onClick={() => setSearching(true)}><Search size={19} strokeWidth={1.7} /></button>
        <button type="button" className="tw-icon-button" title={mode === "activity" ? "Hide activity" : "Show activity"} aria-label={mode === "activity" ? "Hide activity" : "Show activity"} aria-pressed={mode === "activity"} onClick={() => setMode(mode === "activity" ? "tasks" : "activity")}><Bell size={19} strokeWidth={1.7} /></button>
      </div>
      <button type="button" className="tw-new-task" onClick={() => onNewTask()}><Plus size={18} strokeWidth={1.6} /><span>New Task</span></button>
      <div className={"tw-side-scroll" + (mode === "activity" ? " feed" : "")}>{body}</div>
      {usage}
      <Menu up align="left" width={272} className="tw-account-menu" trigger={({ toggle, open }) => (
        <button type="button" className="tw-account" aria-expanded={open} onClick={toggle} aria-label="Account">
          <OrgPicture organization={organization} />
          <span><strong>{organization?.name || account?.user?.name || "Timewarp"}</strong><small>{account?.user?.email || ""}</small></span>
          <ChevronUp size={17} />
        </button>
      )}>
        <OrganizationRow organization={organization} account={account} onSettings={onSettings} />
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("organization")}><UserPlus size={16} /><span className="grow">Invite members</span></button>
        <div className="tw-menu-sep" />
        <button type="button" className="tw-menu-item" data-close onClick={onProfile}><UserRound size={16} /><span className="grow">Profile</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("tools")}><Blocks size={16} /><span className="grow">Connect Tools</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("general")}><Settings2 size={16} /><span className="grow">Settings</span></button>
        <div className="tw-menu-sep" />
        <button type="button" className="tw-menu-item" data-close onClick={onSignOut}><LogOut size={16} /><span className="grow">Log out</span></button>
      </Menu>
      <SearchDialog open={searching} onClose={() => setSearching(false)} agents={agents} agentById={agentById} onOpenConversation={open} onAgent={onNewChat} />
    </aside>
  );
}

// ChatGPT / Codex usage, or Timewarp credits on a paid plan.
export function UsageCard({ funding, chatgpt, onOpen }) {
  if (!funding) return null;
  let title = "ChatGPT / Codex usage", detail = "Connect in Billing", percent = 0;
  if (funding.source === "chatgpt") {
    // As before: the plan in the title, and how much of the current window is left.
    // A plan can report only its weekly window, so the tighter of the two counts.
    const windows = [chatgpt?.rateLimits?.primary, chatgpt?.rateLimits?.secondary].filter(limit => limit && Number.isFinite(Number(limit.usedPercent)));
    const used = windows.length ? Math.max(...windows.map(limit => Number(limit.usedPercent))) : null;
    const plan = chatgpt?.account?.planType;
    if (plan && chatgpt?.status === "available") title = `ChatGPT / Codex · ${plan} usage`;
    percent = used === null ? 0 : Math.min(100, Math.max(0, 100 - used));
    detail = used !== null ? `${Math.round(percent)}% left` : chatgpt?.status === "reauth_required" ? "Reconnect in Billing" : "Connected";
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

