import React from "react";
import { Archive, Ellipsis, FolderOpen, LogOut, MessageSquarePlus, Pencil, Plus, Search, Settings, Star } from "lucide-react";
import { initials, relativeTime } from "../api.js";
import { Avatar, Menu } from "./common.jsx";

export function Sidebar({ account, agents, conversations, selectedId, search, onSearch, onOpenConversation, onNewChat, onOpenAgent, onNewAgent, onEditAgent, onStarAgent, onArchiveAgent, onOpenWorkspace, onArchiveConversation, onCustomize, onSignOut, view }) {
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const organization = account?.activeOrganization;
  return (
    <aside className="tw-sidebar" aria-label="Agents and chats">
      <div className="tw-brand">
        <img src="./timewarp-logo.svg" alt="" />
        <span>Timewarp</span>
        <span className="tw-brand-spacer" />
        <button type="button" className="tw-icon-button" title="New chat" aria-label="New chat" onClick={() => onNewChat()}><MessageSquarePlus size={17} /></button>
      </div>
      <label className="tw-search">
        <Search size={15} />
        <input className="tw-input" type="search" placeholder="Search chats" value={search} onChange={event => onSearch(event.target.value)} aria-label="Search conversations and agents" />
      </label>
      <div className="tw-scroll">
        <div className="tw-section-title"><span>Agents</span><button type="button" className="tw-icon-button" style={{ width: 24, height: 24 }} title="New agent" aria-label="New agent" onClick={onNewAgent}><Plus size={14} /></button></div>
        <div className="tw-list">
          {agents.map(agent => (
            <div key={agent.id} className="tw-row" style={{ paddingRight: 2 }} role="button" tabIndex={0}
              onClick={() => onOpenAgent(agent)} onKeyDown={event => { if (event.key === "Enter") onOpenAgent(agent); }}>
              <Avatar agent={agent} />
              <span className="tw-row-title">{agent.name}</span>
              {agent.starredAt ? <Star size={13} fill="currentColor" style={{ color: "var(--color-muted-foreground)" }} aria-label="Starred" /> : null}
              <span onClick={event => event.stopPropagation()}>
                <Menu align="right" trigger={({ toggle }) => <button type="button" className="tw-icon-button" style={{ width: 26, height: 26 }} aria-label={"Options for " + agent.name} onClick={toggle}><Ellipsis size={15} /></button>}>
                  <button type="button" className="tw-menu-item" data-close onClick={() => onNewChat(agent.id)}><MessageSquarePlus size={15} />New chat</button>
                  <button type="button" className="tw-menu-item" data-close onClick={() => onEditAgent(agent)}><Pencil size={15} />Edit agent</button>
                  <button type="button" className="tw-menu-item" data-close onClick={() => onStarAgent(agent)}><Star size={15} />{agent.starredAt ? "Remove star" : "Star"}</button>
                  <button type="button" className="tw-menu-item" data-close onClick={() => onOpenWorkspace(agent)}><FolderOpen size={15} />Open workspace folder</button>
                  <button type="button" className="tw-menu-item" data-close onClick={() => onArchiveAgent(agent)}><Archive size={15} />Remove agent</button>
                </Menu>
              </span>
            </div>
          ))}
        </div>
        <div className="tw-section-title"><span>{search ? "Results" : "Chats"}</span></div>
        <div className="tw-list">
          {conversations.length ? conversations.map(conversation => (
            <div key={conversation.id} className="tw-row" role="button" tabIndex={0} aria-current={view === "chat" && conversation.id === selectedId}
              onClick={() => onOpenConversation(conversation)} onKeyDown={event => { if (event.key === "Enter") onOpenConversation(conversation); }}>
              <Avatar agent={agentById.get(conversation.agentId)} size="small" />
              <span className="tw-row-title" style={{ fontWeight: conversation.read ? 400 : 600 }}>{conversation.title || "New conversation"}</span>
              {!conversation.read ? <span className="tw-unread" aria-label="Unread" /> : <span className="tw-row-meta">{relativeTime(conversation.lastActivityAt)}</span>}
              <button type="button" className="tw-icon-button" style={{ width: 24, height: 24 }} title="Archive" aria-label={"Archive " + (conversation.title || "conversation")} onClick={event => { event.stopPropagation(); onArchiveConversation(conversation); }}><Archive size={13} /></button>
            </div>
          )) : <p className="tw-hint" style={{ padding: "4px 8px" }}>{search ? "No chats match your search." : "Start a chat with one of your agents."}</p>}
        </div>
      </div>
      <div className="tw-sidebar-footer">
        <Menu up align="left" width={250} trigger={({ toggle }) => (
          <button type="button" className="tw-row tw-account" onClick={toggle} aria-label="Account">
            <span className="tw-org-picture">{organization?.logo || organization?.image ? <img src={organization.logo || organization.image} alt="" /> : initials(organization?.name || account?.user?.name)}</span>
            <span className="tw-row-title" style={{ display: "grid", lineHeight: 1.25 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{organization?.name || account?.user?.name || "Timewarp"}</span>
              <span className="tw-row-meta" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{account?.user?.email || ""}</span>
            </span>
          </button>
        )}>
          <div className="tw-menu-label">{account?.user?.email}</div>
          <button type="button" className="tw-menu-item" data-close onClick={() => onCustomize("organization")}><Settings size={15} />Organization</button>
          <button type="button" className="tw-menu-item" data-close onClick={() => onCustomize("billing")}><Settings size={15} />Billing</button>
          <button type="button" className="tw-menu-item" data-close onClick={onSignOut}><LogOut size={15} />Sign out</button>
        </Menu>
        <button type="button" className="tw-icon-button" title="Customize" aria-label="Customize" aria-pressed={view === "customize"} onClick={() => onCustomize()}><Settings size={17} /></button>
      </div>
    </aside>
  );
}
