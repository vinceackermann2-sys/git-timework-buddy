import React, { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Bell, BellDot, Blocks, Building2, CalendarClock, ChevronRight, ChevronUp, GripVertical, LoaderCircle, LogOut, MailOpen, Pencil, Plus, Search, Settings2, UserPlus, UserRound } from "lucide-react";
import { call, relativeTime } from "../api.js";
import { Avatar, ContextMenu, Dialog, Menu, Tip, menuKeys, modKey, useToast } from "./common.jsx";
import { PAGE, activityGroups, byActivity, dropSide, moveId, shownCount } from "../shell.mjs";

const readList = key => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
const writeList = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const readFlag = key => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const writeFlag = (key, value) => { try { localStorage.setItem(key, value ? "1" : "0"); } catch {} };

// Plain text for one-line previews: no markdown marks or code-fence languages.
export function previewText(value) {
  return String(value || "").replace(/```[\w+-]*/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>~|]+/g, "").replace(/\s+/g, " ").trim();
}

// "Rename conversation", as before.
function RenameDialog({ conversation, onClose, onChanged }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (conversation) { setTitle(conversation.title?.trim() || "New conversation"); setError(""); setBusy(false); } }, [conversation?.id]);
  const save = event => {
    event.preventDefault();
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    call("conversations.rename", { id: conversation.id, title: value }).then(() => { onChanged?.(); onClose(); })
      .catch(failure => { setError(failure?.message || String(failure)); setBusy(false); });
  };
  return (
    <Dialog open={!!conversation} onClose={onClose} title="Rename conversation" className="tw-rename-dialog">
      <form className="tw-import" onSubmit={save}>
        <input className="tw-input" autoFocus value={title} maxLength={200} placeholder="Conversation name" aria-label="Conversation name" onChange={event => setTitle(event.target.value)} />
        {error ? <p className="tw-alert" role="alert">{error}</p> : null}
        <button type="submit" className="tw-btn primary tw-wide" disabled={!title.trim() || busy}>{busy ? "Saving..." : "Save"}</button>
      </form>
    </Dialog>
  );
}

// A chat row: in its agent's group, or with the agent's picture and the latest
// message in the activity feed. Right-click: mark as read or unread, rename,
// archive. A chat an automation runs in shows "Has automation" with its names.
function ConversationRow({ conversation, agent = null, current, working, automations = [], onArchive, onChanged }) {
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const toast = useToast();
  const closeMenu = useCallback(() => setMenu(null), []);
  const unread = !conversation.read;
  const names = automations.filter(item => item.enabled).map(item => item.name);
  const setRead = read => call(read ? "conversations.markRead" : "conversations.markUnread", { id: conversation.id }).then(onChanged).catch(error => toast(error, "error"));
  const title = conversation.title?.trim() || agent?.name || "New conversation";
  return (
    <>
      <a href={"#/conversation/" + conversation.id} className={"tw-convo" + (agent ? " feed" : "") + (unread ? " unread" : "")} aria-current={current ? "page" : undefined}
        onClick={() => { if (unread) void setRead(true); }}
        onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}>
        {agent ? <Avatar agent={agent} /> : null}
        <span className="tw-convo-text">
          <span className="tw-convo-title">{title}</span>
          {agent ? <span className="tw-convo-preview">{previewText(conversation.lastText) || "Start a conversation"}</span> : null}
        </span>
        {names.length ? <Tip label={<span className="tw-tip-lines">{names.map((name, index) => <span key={name + index}>{name}</span>)}</span>}><span className="tw-convo-automation" aria-label="Has automation" role="img"><CalendarClock size={15} /></span></Tip> : null}
        <span className="tw-convo-status">
          {working ? <span className="tw-working" aria-label="Agent is working" role="img"><LoaderCircle size={12} /></span>
            : unread ? <i className="tw-unread-dot" aria-label="Unread" /> : <time>{relativeTime(conversation.lastActivityAt)}</time>}
          <Tip label="Archive"><button type="button" className="tw-icon-button" aria-label="Archive" onClick={event => { event.preventDefault(); event.stopPropagation(); onArchive(conversation); }}><Archive size={14} /></button></Tip>
        </span>
      </a>
      <ContextMenu at={menu} onClose={closeMenu}>
        <button type="button" className="tw-menu-item" data-close onClick={() => void setRead(unread)}>{unread ? <MailOpen size={16} /> : <BellDot size={16} />}<span className="grow">{unread ? "Mark as read" : "Mark as unread"}</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => setRenaming(true)}><Pencil size={16} /><span className="grow">Rename</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onArchive(conversation)}><Archive size={16} /><span className="grow">Archive</span></button>
      </ContextMenu>
      {renaming ? <RenameDialog conversation={conversation} onClose={() => setRenaming(false)} onChanged={onChanged} /> : null}
    </>
  );
}

// An agent and its chats, newest first: five, then five more per "Show more"
// (with a dot when the hidden ones include unread chats), always including the
// open chat. Hover shows the drag handle and New task; right-click: Edit, Archive.
function AgentGroup({ agent, conversations, selectedId, current, collapsed, onToggle, running, automationsFor, onArchive, onChanged, onNewChat, onEditAgent, onArchiveAgent, drag }) {
  const [count, setCount] = useState(PAGE);
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const sorted = [...conversations].sort(byActivity);
  const limit = shownCount(sorted.map(item => item.id), selectedId, count);
  useEffect(() => { if (limit !== count) setCount(limit); }, [limit]);
  const shown = sorted.slice(0, limit), hidden = sorted.slice(limit);
  // A collapsed group still shows that it has unread chats, as before.
  const unread = collapsed && conversations.some(conversation => !conversation.read);
  // Collapsing starts the list over at five.
  const toggle = () => { if (!collapsed) setCount(PAGE); onToggle(); };
  return (
    <div className="tw-agent-group">
      <div className="tw-agent-head" role="button" tabIndex={0} aria-expanded={!collapsed} aria-current={current ? "true" : undefined} aria-label={(collapsed ? "Expand " : "Collapse ") + agent.name + " tasks"}
        onClick={toggle} onKeyDown={event => { if (event.key === "Enter") toggle(); }}
        onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }} {...drag}>
        <span className="tw-agent-face" aria-label={"Drag " + agent.name}><Avatar agent={agent} /><GripVertical size={16} className="grip" /></span>
        <span>{agent.name}</span>
        {unread ? <i className="tw-unread-dot" aria-label="Unread tasks" /> : null}
        <Tip label={"New task with " + agent.name}><button type="button" className="tw-icon-button" aria-label={"New task with " + agent.name} onClick={event => { event.stopPropagation(); onNewChat(agent.id); }}><Plus size={16} /></button></Tip>
      </div>
      <ContextMenu at={menu} onClose={closeMenu}>
        <button type="button" className="tw-menu-item" data-close onClick={() => onEditAgent(agent)}><Pencil size={16} /><span className="grow">Edit</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onArchiveAgent(agent)}><Archive size={16} /><span className="grow">Archive</span></button>
      </ContextMenu>
      {collapsed ? null : (
        <>
          {shown.map(conversation => <ConversationRow key={conversation.id} conversation={conversation} current={conversation.id === selectedId} working={running.has(conversation.id)}
            automations={automationsFor(conversation.id)} onArchive={onArchive} onChanged={onChanged} />)}
          {hidden.length ? (
            <button type="button" className="tw-show-more" onClick={() => setCount(value => value + PAGE)}>
              <span>Show more</span>{hidden.some(item => !item.read) ? <i className="tw-unread-dot" aria-label="Unread tasks" /> : null}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

// The activity feed: unread and working chats under Priority, then by day.
function Feed({ conversations, agentById, selectedId, running, automationsFor, onArchive, onChanged }) {
  if (!conversations.length) return <p className="tw-side-empty">Activity from your agents shows up here.</p>;
  return activityGroups(conversations, { running }).map(group => (
    <section key={group.label} className="tw-feed-group">
      <div className="tw-day">{group.label}</div>
      {group.items.map(conversation => <ConversationRow key={conversation.id} conversation={conversation} agent={agentById.get(conversation.agentId)} current={conversation.id === selectedId}
        working={running.has(conversation.id)} automations={automationsFor(conversation.id)} onArchive={onArchive} onChanged={onChanged} />)}
    </section>
  ));
}

// The account menu's first row: the organization. Its submenu switches to
// another organization, opens Organization Settings or adds one, as before.
function OrganizationRow({ organization, account, onSettings, onSwitch, onCreate }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(null);
  const submenu = useRef(null);
  const others = (account?.organizations || []).filter(item => item.id !== organization?.id);
  const choose = item => {
    if (switching) return;
    setSwitching(item.id);
    Promise.resolve(onSwitch(item.id)).finally(() => setSwitching(null));
  };
  const enter = () => { setOpen(true); setTimeout(() => submenu.current?.querySelector(".tw-menu-item")?.focus(), 0); };
  return (
    <div className="tw-org-row" onMouseLeave={() => setOpen(false)}>
      <button type="button" className="tw-menu-item tw-org-item" aria-haspopup="menu" aria-expanded={open} onMouseEnter={() => setOpen(true)} onClick={enter}
        onKeyDown={event => { if (event.key === "ArrowRight") { event.preventDefault(); enter(); } }}>
        <OrgPicture organization={organization} />
        <span className="grow"><strong>{organization?.name || account?.user?.name || "Timewarp"}</strong><small>{account?.user?.email}</small></span>
        <ChevronRight size={16} />
      </button>
      {open ? (
        <div className="tw-menu tw-submenu" role="menu" ref={submenu} onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); event.currentTarget.parentElement?.querySelector(".tw-org-item")?.focus(); }
          else menuKeys(event, submenu.current);
        }}>
          {others.length ? (
            <>
              <div className="tw-menu-label">Switch organization</div>
              {others.map(item => (
                <button key={item.id} type="button" className="tw-menu-item" disabled={!!switching} data-close onClick={() => choose(item)}>
                  <OrgPicture organization={item} /><span className="grow">{item.name}</span>{switching === item.id ? <LoaderCircle size={15} className="tw-spin" /> : null}
                </button>
              ))}
              <div className="tw-menu-sep" />
            </>
          ) : null}
          <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("organization")}><Building2 size={16} /><span className="grow">Organization Settings</span></button>
          <button type="button" className="tw-menu-item" data-close onClick={onCreate}><Plus size={16} /><span className="grow">Add organization</span></button>
        </div>
      ) : null}
    </div>
  );
}

export function OrgPicture({ organization }) {
  const picture = organization?.logo || organization?.image;
  return <span className="tw-org-picture">{picture ? <img className="photo" src={picture} alt="" /> : <img src="./timewarp-logo.svg" alt="" />}</span>;
}

// The matched part of a search snippet, highlighted.
function Snippet({ text, highlight }) {
  if (!highlight || highlight.start < 0 || highlight.end <= highlight.start || highlight.end > text.length) return text;
  return <>{text.slice(0, highlight.start)}<mark>{text.slice(highlight.start, highlight.end)}</mark>{text.slice(highlight.end)}</>;
}

// Search over conversations and agents (Ctrl/⌘+K), as before: agents by
// name; from three characters, chat names and message text with the match
// highlighted (a message opens its chat at that message); otherwise the 50
// most recent chats, unread first.
export const SEARCH_MIN = 3;
export function SearchDialog({ open, onClose, agents, agentById, conversations, onOpenConversation, onAgent }) {
  const ref = useRef(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState({ query: "", results: null, error: null });
  const [active, setActive] = useState(0);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { setQuery(""); setFound({ query: "", results: null, error: null }); setActive(0); dialog.showModal(); }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const text = query.trim();
  const searching = [...text].length >= SEARCH_MIN;
  useEffect(() => {
    if (!open || !searching) return;
    let cancelled = false;
    const timer = setTimeout(() => call("conversations.search", { query: text })
      .then(results => { if (!cancelled) setFound({ query: text, results, error: null }); })
      .catch(error => { if (!cancelled) setFound({ query: text, results: null, error: error?.message || String(error) }); }), 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, text, searching]);
  useEffect(() => setActive(0), [text, found]);
  const needle = text.toLocaleLowerCase();
  const matchingAgents = agents.filter(agent => agent.name.toLocaleLowerCase().includes(needle));
  const unread = new Set(conversations.filter(item => !item.read).map(item => item.id));
  const pending = searching && found.query !== text;
  const titleOf = conversation => conversation.title?.trim() || "New conversation";
  const rows = !searching
    ? [...conversations].sort((a, b) => (a.read === b.read ? 0 : a.read ? 1 : -1) || byActivity(a, b)).slice(0, 50)
      .map(conversation => ({ key: conversation.id, id: conversation.id, messageId: null, title: titleOf(conversation), at: conversation.lastActivityAt }))
    : pending || !found.results ? [] : [
      ...found.results.conversations.map(item => ({ key: item.conversation.id + ":", id: item.conversation.id, agentId: item.conversation.agentId, messageId: null, title: titleOf(item.conversation), at: item.conversation.lastActivityAt, snippet: item })),
      ...found.results.messages.map(item => ({ key: item.conversation.id + ":" + item.messageId, id: item.conversation.id, agentId: item.conversation.agentId, messageId: item.messageId, title: titleOf(item.conversation), at: item.createdAt, snippet: item })),
    ].filter(row => agentById.has(row.agentId));
  const items = [...matchingAgents.map(agent => ({ key: "agent-" + agent.id, run: () => onAgent(agent.id) })), ...rows.map(row => ({ key: row.key, run: () => onOpenConversation({ id: row.id }, row.messageId) }))];
  const choose = index => { const item = items[index]; if (!item) return; onClose(); item.run(); };
  const option = (index, content, className = "") => (
    <div key={items[index].key} id={"tw-search-" + index} role="option" aria-selected={index === active} className={"tw-palette-option" + className}
      onMouseMove={() => setActive(index)} onClick={() => choose(index)}>{content}</div>
  );
  const loading = pending || (searching && !found.results && !found.error);
  return (
    <dialog ref={ref} className="tw-dialog tw-palette" aria-label="Search conversations and agents" onClose={onClose}
      onCancel={event => { event.preventDefault(); onClose(); }} onMouseDown={event => { if (event.target === ref.current) onClose(); }}>
      {open ? (
        <>
          <label className="tw-palette-input">
            <Search size={18} strokeWidth={1.7} />
            <input autoFocus role="combobox" aria-expanded="true" aria-controls="tw-search-list" aria-activedescendant={items.length ? "tw-search-" + active : undefined}
              placeholder="Search conversations and agents..." value={query} onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(items.length - 1, index + 1)); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
                else if (event.key === "Enter") { event.preventDefault(); choose(active); }
              }} />
          </label>
          <div className="tw-palette-list" role="listbox" id="tw-search-list">
            {matchingAgents.map((agent, index) => option(index, <><Avatar agent={agent} size="tiny" /><span className="grow">{agent.name}</span></>))}
            {matchingAgents.length && rows.length ? <div className="tw-palette-gap" role="presentation" /> : null}
            {rows.map((row, position) => option(matchingAgents.length + position, (
              <>
                <span className="grow">
                  <span className="tw-palette-title">{row.title}</span>
                  {row.snippet ? <span className="tw-palette-snippet"><Snippet text={row.snippet.snippet} highlight={row.snippet.highlight} /></span> : null}
                </span>
                {unread.has(row.id) ? <i className="tw-unread-dot" aria-label="Unread" /> : <time>{relativeTime(row.at)}</time>}
              </>
            ), row.snippet ? " result" : ""))}
            {loading ? <p className="tw-palette-empty" role="status">Loading conversations...</p> : null}
            {found.error && searching && !pending ? <p className="tw-palette-empty tw-alert" role="alert">Couldn't search conversations: {found.error}</p> : null}
            {!items.length && !loading && !(found.error && searching) ? <p className="tw-palette-empty">No results found.</p> : null}
          </div>
        </>
      ) : null}
    </dialog>
  );
}

export function Sidebar({ account, agents, conversations, selectedId, view, homeAgentId, usage, running = new Set(), automations = [], onNewTask, onNewChat, onNewAgent, onEditAgent,
  onArchiveAgent, onArchiveConversation, onConversationsChanged, onReorder, onSettings, onProfile, onSignOut, onSearch, onSwitchOrganization, onCreateOrganization, onInviteMembers }) {
  // The activity view is remembered, as before.
  const [mode, setModeState] = useState(() => readFlag("tw.activityView") ? "activity" : "tasks");
  const setMode = value => { setModeState(value); writeFlag("tw.activityView", value === "activity"); };
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
  const ids = agents.map(item => item.id);
  // Dragged down, an agent lands after the one it is dropped on; dragged up, before it.
  const drag = agent => ({
    draggable: true,
    "data-dragging": dragging === agent.id,
    "data-drop": dropTarget === agent.id && dragging && dragging !== agent.id ? dropSide(ids, dragging, agent.id) : undefined,
    onDragStart: event => { setDragging(agent.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", agent.id); },
    onDragEnd: () => { setDragging(null); setDropTarget(null); },
    onDragOver: event => { if (dragging) { event.preventDefault(); setDropTarget(agent.id); } },
    onDrop: event => {
      event.preventDefault();
      if (!dragging || dragging === agent.id) return;
      const next = moveId(ids, dragging, agent.id);
      setDragging(null); setDropTarget(null);
      if (next.join() !== ids.join()) onReorder(next);
    },
  });
  const organization = account?.activeOrganization;
  // Owners and admins invite people, in a dialog over the current page.
  const manager = (organization?.roles || []).some(role => ["owner", "admin"].includes(role));
  const automationsFor = id => automations.filter(item => item.conversationId === id);
  const unreadCount = conversations.filter(item => !item.read).length;
  const activeId = view === "chat" ? selectedId : null;
  let body;
  if (mode === "activity") body = <Feed conversations={conversations} agentById={agentById} selectedId={activeId} running={running} automationsFor={automationsFor} onArchive={onArchiveConversation} onChanged={onConversationsChanged} />;
  else {
    body = (
      <>
        {agents.map(agent => (
          <AgentGroup key={agent.id} agent={agent} conversations={conversations.filter(item => item.agentId === agent.id)} selectedId={activeId} running={running} automationsFor={automationsFor}
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
        <Tip label="Search" keys={[modKey(), "K"]}><button type="button" className="tw-icon-button" aria-label="Search" onClick={onSearch}><Search size={19} strokeWidth={1.7} /></button></Tip>
        <Tip label="Activity">
          <button type="button" className="tw-icon-button tw-bell" aria-label={mode === "activity" ? "Hide activity" : "Show activity"} title={mode === "activity" ? "Hide activity" : "Show activity"} aria-pressed={mode === "activity"} onClick={() => setMode(mode === "activity" ? "tasks" : "activity")}>
            <Bell size={19} strokeWidth={1.7} />{mode !== "activity" && unreadCount ? <i className="tw-bell-dot" role="status" aria-label="Unread tasks" /> : null}
          </button>
        </Tip>
      </div>
      <Tip label="New Task" keys={[modKey(), "N"]}><button type="button" className="tw-new-task" onClick={() => onNewTask()}><Plus size={18} strokeWidth={1.6} /><span>New Task</span></button></Tip>
      <div className={"tw-side-scroll" + (mode === "activity" ? " feed" : "")}>{body}</div>
      {usage}
      <Menu up align="left" width={272} className="tw-account-menu" trigger={({ toggle, open }) => (
        <button type="button" className="tw-account" aria-expanded={open} onClick={toggle} aria-label="Account">
          <OrgPicture organization={organization} />
          <span><strong>{organization?.name || account?.user?.name || "Timewarp"}</strong><small>{account?.user?.email || ""}</small></span>
          <ChevronUp size={16} />
        </button>
      )}>
        <OrganizationRow organization={organization} account={account} onSettings={onSettings} onSwitch={onSwitchOrganization} onCreate={onCreateOrganization} />
        {manager ? <button type="button" className="tw-menu-item" data-close onClick={onInviteMembers}><UserPlus size={16} /><span className="grow">Invite members</span></button> : null}
        <div className="tw-menu-sep" />
        <button type="button" className="tw-menu-item" data-close onClick={onProfile}><UserRound size={16} /><span className="grow">Profile</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("tools")}><Blocks size={16} /><span className="grow">Connect Tools</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => onSettings("general")}><Settings2 size={16} /><span className="grow">Settings</span></button>
        <div className="tw-menu-sep" />
        <button type="button" className="tw-menu-item" data-close onClick={onSignOut}><LogOut size={16} /><span className="grow">Log out</span></button>
      </Menu>
    </aside>
  );
}

// ChatGPT / Codex usage on Free, or the plan's monthly Timewarp credits on a paid plan.
export function UsageCard({ funding, chatgpt, onOpen }) {
  if (!funding) return null;
  let title = "ChatGPT / Codex usage", detail = "Connect in Billing", percent = 0, hint, credits = null;
  if (!funding.subscriptionAllowed) {
    // As before: "<Plan> usage" with the monthly credits left, and the whole
    // balance in dollars (USD 0.125 per credit). Codex isn't offered on paid plans.
    const plan = funding.planUsage;
    if (plan) {
      percent = Math.round(Math.min(100, Math.max(0, plan.left / plan.allowance * 100)));
      title = `${plan.name} usage`;
      detail = `${percent}% left`;
      hint = `Monthly credits: ${percent}% left${plan.resetsAt ? `; resets ${new Date(plan.resetsAt).toLocaleString()}` : ""}`;
    } else { title = "Usage"; detail = "Unavailable"; }
    const balance = Number(funding.timewarpCredits) || 0;
    if (balance > 0) credits = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Math.floor(balance * 125000) / 1e6);
  } else if (funding.source === "chatgpt") {
    // As before: the plan in the title, and how much of the current window is left.
    // A plan can report only its weekly window, so the tighter of the two counts.
    const windows = [chatgpt?.rateLimits?.primary, chatgpt?.rateLimits?.secondary].filter(limit => limit && Number.isFinite(Number(limit.usedPercent)));
    const used = windows.length ? Math.max(...windows.map(limit => Number(limit.usedPercent))) : null;
    const plan = chatgpt?.account?.planType;
    if (plan && chatgpt?.status === "available") title = `ChatGPT / Codex · ${plan} usage`;
    percent = used === null ? 0 : Math.min(100, Math.max(0, 100 - used));
    detail = used !== null ? `${Math.round(percent)}% left` : chatgpt?.status === "reauth_required" ? "Reconnect in Billing" : "Connected";
  }
  return (
    <button type="button" className="tw-usage" aria-label={title + " — open Billing"} title={hint} onClick={onOpen}>
      <div><span>{title}</span><span>{detail}</span></div>
      <div className="tw-usage-meter" role="progressbar" aria-label={title + " remaining"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={detail} data-empty={percent <= 0 || undefined}><i style={{ width: percent + "%" }} /></div>
      {credits ? <div className="tw-usage-credits"><span>Credits</span><span>{credits}</span></div> : null}
    </button>
  );
}

