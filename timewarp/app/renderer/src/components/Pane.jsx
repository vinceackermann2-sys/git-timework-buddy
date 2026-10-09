import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Files as FilesIcon, Globe, KeyRound, Maximize2, Minimize2, PanelRight, Pencil, Plus, RotateCw, Settings, Trash2, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { call, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { Avatar, Menu, Switch, useToast } from "./common.jsx";
import { AppIcon, useApps } from "./Composer.jsx";
import { Files } from "./Files.jsx";

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; } };
const TOOLS = { agent: "Agent", files: "Files" };

// The site's own icon, never a third-party favicon service; a letter otherwise.
// A page's title, or its address when only that was saved (titles saved before the page had one).
const siteLabel = site => { const title = String(site.title || "").trim(); const bare = site.url.replace(/^https?:\/\//, ""); return !title || bare.startsWith(title) || title.startsWith(host(site.url) + "/") ? host(site.url) : title; };

function SiteIcon({ url, fallback = "letter" }) {
  const [failed, setFailed] = useState(false);
  let origin = null;
  try { origin = new URL(url).origin; } catch {}
  if ((failed || !origin) && fallback === "globe") return <Globe size={30} strokeWidth={1.4} className="tw-site-globe" />;
  if (failed || !origin) return <span className="tw-site-letter">{(host(url)[0] || "?").toUpperCase()}</span>;
  return <img src={origin + "/favicon.ico"} alt="" width="32" height="32" onError={() => setFailed(true)} />;
}

// Native browser views sit above the page, so they hide while a dialog or
// menu is open and come back when it closes.
function useOverlayOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector("dialog[open], .tw-menu, .timewarp-org-gate"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  return open;
}

// A new tab: the agent's tools and recently visited sites.
function Home({ conversation, agent, onOpen, onTool }) {
  const [recent, setRecent] = useState([]);
  useEffect(() => { call("browser.recent", { conversationId: conversation.id }).then(setRecent).catch(() => {}); }, [conversation.id]);
  const seen = new Set();
  const sites = recent.filter(site => { const key = host(site.url); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 4);
  return (
    <div className="tw-pane-home">
      <section>
        <h2>Tools</h2>
        <div className="tw-pane-tiles">
          <button type="button" className="tw-pane-tile" onClick={() => onTool("agent")}><span><Avatar agent={agent} /></span><strong>Agent</strong></button>
          <button type="button" className="tw-pane-tile" onClick={() => onTool("files")}><span><FilesIcon size={30} strokeWidth={1.6} /></span><strong>Files</strong></button>
        </div>
      </section>
      <section>
        <h2>Recommended</h2>
        {sites.length ? (
          <div className="tw-recent">
            {sites.map(site => <button key={site.url} type="button" title={site.url} onClick={() => onOpen(site.url)}><span className="tw-site-box"><SiteIcon url={site.url} fallback="globe" /></span><strong>{siteLabel(site)}</strong></button>)}
          </div>
        ) : <p className="tw-hint">Your recent websites will appear here.</p>}
      </section>
    </div>
  );
}

// The agent: picture, instructions, the connected apps it can use and vault access.
// What "Add workflow" and "Add automation" ask the agent, as in the previous app.
const AUTOMATION_PROMPT = "Help me create an automation for this assistant. Determine whether it needs a schedule or a native event trigger.";
const WORKFLOW_PROMPT = "Help me create a workflow for this assistant. Work out the steps with me, then save it as a skill so you can repeat it.";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function scheduleText(schedule) {
  switch (schedule?.kind) {
    case "hourly": return `Every hour at :${String(schedule.minute).padStart(2, "0")}`;
    case "daily": return "Every day at " + schedule.time;
    case "weekdays": return "Weekdays at " + schedule.time;
    case "weekly": return schedule.days.map(day => DAYS[day]).join(", ") + " at " + schedule.time;
    case "monthly": return `Day ${schedule.day} of each month at ${schedule.time}`;
    case "interval": return schedule.minutes % 60 ? `Every ${schedule.minutes} minutes` : `Every ${schedule.minutes / 60} hours`;
    case "once": return "Once, " + new Date(schedule.at).toLocaleString();
    default: return "";
  }
}

function AgentPage({ agent, onEditAgent, onAgentChanged, onSettings, onStart, onArchiveAgent }) {
  const [automations, setAutomations] = useState([]);
  useEffect(() => { call("automations.list").then(setAutomations).catch(() => setAutomations([])); }, [agent.id]);
  useEvent("automations.changed", () => { call("automations.list").then(setAutomations).catch(() => {}); });
  const mine = automations.filter(item => item.agentId === agent.id);
  const [instructions, setInstructions] = useState(null);
  const [access, setAccess] = useState(undefined);
  const { items } = useApps();
  const toast = useToast();
  // Its workspace AGENTS.md, as the previous app showed it.
  useEffect(() => { call("agents.workspaceInstructions", { id: agent.id }).then(value => setInstructions(value.instructions || "")).catch(() => setInstructions("")); }, [agent.id, agent.name, agent.updatedAt]);
  useEffect(() => { call("integrations.getAccess", { agentId: agent.id }).then(value => setAccess(value.items ?? null)).catch(() => setAccess(null)); }, [agent.id, items]);
  const accounts = (items || []).filter(app => app.accounts?.length).flatMap(app => app.accounts.map(account => ({ app, account })));
  const allowed = entry => access == null || access.some(item => item.integrationId === entry.app.id && item.accountId === entry.account.id);
  const save = async next => {
    const value = next.length === accounts.length ? null : next.map(entry => ({ kind: "integration", owner: "user", integrationId: entry.app.id, accountId: entry.account.id }));
    const previous = access;
    setAccess(value);
    try { await call("integrations.setAccess", { agentId: agent.id, items: value }); } catch (error) { setAccess(previous); toast(error, "error"); }
  };
  const using = accounts.filter(allowed), other = accounts.filter(entry => !allowed(entry));
  // Accounts waiting to reconnect are listed too, as before; choosing one reconnects it.
  const waiting = (items || []).filter(app => app.pendingAccounts?.length).flatMap(app => app.pendingAccounts.map(account => ({ app, account, pending: true })));
  const rows = [...using, ...waiting].sort((a, b) => a.app.displayName.localeCompare(b.app.displayName));
  const reconnect = entry => call("integrations.beginConnect", { integrationId: entry.app.id }).then(() => toast("Finish connecting in your browser.")).catch(error => toast(error, "error"));
  const setVault = value => call("agents.update", { id: agent.id, vaultAccess: value }).then(() => onAgentChanged?.()).catch(error => toast(error, "error"));
  return (
    <div className="tw-agent-page">
      <div className="tw-agent-page-head">
        <button type="button" className="tw-agent-picture" title="Edit agent" aria-label="Edit agent picture" onClick={() => onEditAgent(agent)}>
          <Avatar agent={agent} /><span className="badge"><Pencil size={14} /></span>
        </button>
        <button type="button" className="tw-agent-name" title="Edit agent" onClick={() => onEditAgent(agent)}><span>{agent.name}</span><Pencil size={14} /></button>
      </div>
      <h3>Instructions</h3>
      <div className="tw-agent-card tw-agent-instructions">
        {instructions === null ? <p className="tw-hint">…</p> : instructions ? <Markdown text={instructions} /> : <p className="tw-hint">No instructions yet. Edit the agent to tell it how to work.</p>}
      </div>
      <div className="tw-agent-page-row">
        <h3>Tools</h3>
        <Menu align="right" width={260} trigger={({ toggle }) => <button type="button" className="tw-agent-add" onClick={toggle}><Plus size={12} />Add</button>}>
          {other.map(entry => (
            <button key={entry.app.id + entry.account.id} type="button" className="tw-menu-item" data-close onClick={() => void save([...using, entry])}>
              <AppIcon app={entry.app} /><span className="grow">{entry.app.displayName}<small>{entry.account.displayName}</small></span>
            </button>
          ))}
          {other.length ? <div className="tw-menu-sep" /> : null}
          <button type="button" className="tw-menu-item" data-close onClick={() => onSettings?.("tools")}><Plus size={15} /><span className="grow">Connect a tool</span></button>
        </Menu>
      </div>
      <div className="tw-agent-card tw-agent-tools">
        {rows.map(entry => entry.pending ? (
          <button key={entry.app.id + entry.account.id} type="button" className="tw-agent-tool tw-agent-tool-button" title="Reconnect" onClick={() => void reconnect(entry)}>
            <AppIcon app={entry.app} /><strong>{entry.app.displayName}</strong><span className="desc">{entry.account.displayName} (Authentication expired — reconnect)</span>
          </button>
        ) : (
          <div key={entry.app.id + entry.account.id} className="tw-agent-tool">
            <AppIcon app={entry.app} /><strong>{entry.app.displayName}</strong><span className="desc">{entry.account.displayName}</span>
            <button type="button" className="tw-icon-button" title="Remove" aria-label={`Remove ${entry.app.displayName} ${entry.account.displayName}`} onClick={() => void save(using.filter(item => item !== entry))}><X size={12} /></button>
          </div>
        ))}
        <div className="tw-agent-tool">
          <KeyRound size={16} strokeWidth={1.7} /><strong>Vault access</strong><span className="desc">Use all vault credentials and create passkeys without asking again</span>
          <Switch label={`${agent.name} can use the vault`} checked={!!agent.vaultAccess} onChange={setVault} />
        </div>
      </div>
      <h3 className="tw-agent-section">Workflows</h3>
      <button type="button" className="tw-agent-card tw-agent-action" onClick={() => onStart(agent.id, { text: WORKFLOW_PROMPT })}><Plus size={16} />Add workflow</button>
      <h3 className="tw-agent-section">Automations</h3>
      <div className="tw-agent-card">
        {mine.map(item => (
          <a key={item.id} className="tw-agent-tool tw-agent-automation" href={"#/conversation/" + item.conversationId}>
            <CalendarClock size={16} strokeWidth={1.7} /><strong>{item.name}</strong><span className="desc">{item.enabled ? scheduleText(item.schedule) : "Off"}</span>
          </a>
        ))}
        <button type="button" className={"tw-agent-action" + (mine.length ? " inner" : "")} onClick={() => onStart(agent.id, { text: AUTOMATION_PROMPT })}><Plus size={16} />Add automation</button>
      </div>
      <h3 className="tw-agent-section">Manage agent</h3>
      <button type="button" className="tw-agent-card tw-agent-action" onClick={() => onArchiveAgent(agent)}><Trash2 size={16} />Remove agent</button>
    </div>
  );
}

// A tool page in a tab, with a way back to the new tab page.
function ToolPage({ title, onBack, children }) {
  return (
    <div className="tw-tool-page">
      <header><button type="button" className="tw-icon-button" aria-label="Back" title="Back" onClick={onBack}><ChevronLeft size={16} /></button><strong>{title}</strong></header>
      <div className="tw-tool-body">{children}</div>
    </div>
  );
}

function ProfileFace({ profile }) {
  const badge = profile?.source?.type && profile.source.type !== "timewarp" ? `./onboarding-icons/${profile.source.type === "edge" || profile.source.type === "chrome" ? profile.source.type + "-color" : profile.source.type}.svg` : "./timewarp-logo.svg";
  return <span className="tw-profile-face"><span><UserRound size={10} strokeWidth={2.2} /></span><img src={badge} alt="" /></span>;
}

export function Pane({ conversation, agent, expanded, onExpand, onClose, onEditAgent, onAgentChanged, onSettings, onStart, onArchiveAgent }) {
  const [state, setState] = useState({ tabs: [], active: null });
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [tools, setTools] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState(null);
  const content = useRef(null);
  const overlay = useOverlayOpen();
  const toast = useToast();
  const id = conversation.id;
  const active = state.tabs.find(tab => tab.id === state.active) || null;
  const tool = active && active.kind === "home" ? tools[active.id] || null : null;
  const run = useCallback((method, input = {}) => call(method, { conversationId: id, ...input }).then(value => { if (value?.tabs) setState(value); return value; }).catch(error => toast(error, "error")), [id, toast]);
  const setTool = value => { if (active) setTools(current => ({ ...current, [active.id]: value })); };

  useEffect(() => {
    run("browser.show").then(value => { if (value && !value.tabs.length) void run("browser.newTab"); });
    call("browser.profiles").then(setProfiles).catch(() => {});
    return () => { void call("browser.bounds", { rect: null }); };
  }, [id]);
  useEvent("browser.state", value => { if (value.conversationId === id) setState(value); });
  useEffect(() => { if (!editing) setAddress(active?.kind === "web" ? active.url : ""); }, [active?.url, active?.kind, editing]);
  // Saved sign-ins for the page, offered from the address bar.
  const [signIns, setSignIns] = useState([]);
  useEffect(() => {
    if (active?.kind !== "web" || active.loading) { setSignIns([]); return; }
    call("vault.signInsForPage", { conversationId: id, tabId: active.id }).then(setSignIns).catch(() => setSignIns([]));
  }, [id, active?.id, active?.url, active?.kind, active?.loading]);
  const fill = item => call("vault.fillPage", { conversationId: id, tabId: active.id, id: item.id }).then(() => toast("Sign-in filled.")).catch(error => toast(error, "error"));

  // Keep the native page view on top of the content area.
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const send = () => {
      const rect = node.getBoundingClientRect();
      void call("browser.bounds", { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible: active?.kind === "web" && !overlay } });
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(node);
    window.addEventListener("resize", send);
    return () => { observer.disconnect(); window.removeEventListener("resize", send); };
  }, [active?.id, active?.kind, overlay]);

  const open = url => active ? run("browser.navigate", { tabId: active.id, url }) : run("browser.newTab", { url });
  const closeTab = tab => run("browser.close", { tabId: tab.id }).then(value => {
    setTools(current => { const next = { ...current }; delete next[tab.id]; return next; });
    if (value && !value.tabs.length) void run("browser.newTab");
  });
  const goHome = () => { if (tool) setTool(null); else if (active?.kind === "web") void run("browser.home", { tabId: active.id }); };
  const profile = profiles.find(item => item.id === (profileId || active?.profileId || conversation.browserProfileId)) || profiles.find(item => item.isDefault) || profiles[0];
  const tabTitle = tab => (tab.kind === "home" ? TOOLS[tools[tab.id]] || "New tab" : tab.title || host(tab.url) || "New tab");
  return (
    <aside className="tw-pane" aria-label="Browser and files">
      <div className="tw-pane-top">
        <div className="tw-pane-tabs" role="tablist">
          {state.tabs.map(tab => (
            <div key={tab.id} role="tab" tabIndex={0} aria-selected={tab.id === state.active} className="tw-pane-tab" title={tab.url || tabTitle(tab)}
              onClick={() => { if (tab.id !== state.active) void run("browser.activate", { tabId: tab.id }); }}
              onKeyDown={event => { if (event.key === "Enter") void run("browser.activate", { tabId: tab.id }); }}>
              {tab.kind === "web" && tab.favicon ? <img src={tab.favicon} alt="" width="14" height="14" /> : <Globe size={14} strokeWidth={1.7} />}
              <span>{tabTitle(tab)}</span>
              <button type="button" aria-label={"Close " + tabTitle(tab)} onClick={event => { event.stopPropagation(); void closeTab(tab); }}><X size={12} /></button>
            </div>
          ))}
        </div>
        <div className="tw-pane-controls">
          <button type="button" className="tw-icon-button add" aria-label="Add browser tab" title="New tab" onClick={() => void run("browser.newTab")}><Plus size={12} strokeWidth={2} /></button>
          <button type="button" className="tw-icon-button" aria-label={expanded ? "Restore secondary pane" : "Expand secondary pane"} title={expanded ? "Restore" : "Expand"} onClick={onExpand}>{expanded ? <Minimize2 size={16} strokeWidth={1.7} /> : <Maximize2 size={16} strokeWidth={1.7} />}</button>
          <button type="button" className="tw-icon-button" aria-label="Hide pane" title="Hide pane" onClick={onClose}><PanelRight size={16} strokeWidth={1.7} /></button>
        </div>
      </div>
      <form className="tw-pane-toolbar" onSubmit={event => { event.preventDefault(); setEditing(false); event.target.querySelector("input")?.blur(); if (address.trim()) { if (tool) setTool(null); void open(address.trim()); } }}>
        <button type="button" className="tw-icon-button" aria-label="Browser home" title="Browser home" onClick={goHome}><Globe size={16} strokeWidth={1.7} /></button>
        <button type="button" className="tw-icon-button" aria-label="Go back" title="Back" disabled={!tool && !active?.canGoBack} onClick={() => tool ? setTool(null) : run("browser.back", { tabId: active.id })}><ChevronLeft size={16} strokeWidth={1.7} /></button>
        <button type="button" className="tw-icon-button" aria-label="Go forward" title="Forward" disabled={!!tool || !active?.canGoForward} onClick={() => run("browser.forward", { tabId: active.id })}><ChevronRight size={16} strokeWidth={1.7} /></button>
        <button type="button" className="tw-icon-button" aria-label={active?.loading ? "Stop" : "Refresh"} title={active?.loading ? "Stop" : "Refresh"} onClick={() => active?.kind === "web" ? run(active.loading ? "browser.stop" : "browser.reload", { tabId: active.id }) : null}>{active?.loading ? <X size={16} /> : <RotateCw size={16} strokeWidth={1.7} />}</button>
        {active?.kind === "web" ? <button type="button" className="tw-icon-button" aria-label={active.muted ? "Unmute tab" : "Mute tab"} title={active.muted ? "Unmute tab" : "Mute tab"} onClick={() => run("browser.setMuted", { tabId: active.id, muted: !active.muted })}>{active.muted ? <VolumeX size={16} strokeWidth={1.7} /> : <Volume2 size={16} strokeWidth={1.7} />}</button> : null}
        <input className="tw-address" value={address} placeholder="Search or enter a URL" aria-label="Search or enter a URL"
          onFocus={event => { setEditing(true); event.target.select(); }} onBlur={() => setEditing(false)} onChange={event => setAddress(event.target.value)} />
        {signIns.length ? (
          <Menu align="right" width={260} trigger={({ toggle }) => <button type="button" className="tw-icon-button" title="Fill a saved sign-in" aria-label="Fill a saved sign-in" onClick={() => signIns.length === 1 ? void fill(signIns[0]) : toggle()}><KeyRound size={16} /></button>}>
            <div className="tw-menu-label">Fill a saved sign-in</div>
            {signIns.map(item => <button key={item.id} type="button" className="tw-menu-item" data-close onClick={() => void fill(item)}><KeyRound size={14} /><span className="grow">{item.username || item.label}</span></button>)}
          </Menu>
        ) : null}
        {active?.agent && !state.userControl ? <span className="tw-pane-agent" title={active.agent.action}><Avatar agent={active.agent} size="tiny" />{active.agent.action}</span> : null}
        {state.userControl
          ? <button type="button" className="tw-btn tw-control" title="Let the agent use the browser again" onClick={() => run("browser.handBack")}>Hand back</button>
          : active?.agent ? <button type="button" className="tw-btn tw-control" title="Pause the agent's browser actions and use the page yourself" onClick={() => run("browser.takeControl")}>Take over</button> : null}
        <Menu align="right" width={224} className="tw-profile-menu" trigger={({ toggle }) => <button type="button" className="tw-icon-button tw-profile-button" aria-label={"Browser profile: " + (profile?.label || "Timewarp")} title={"Browser profile: " + (profile?.label || "Timewarp")} onClick={toggle}><ProfileFace profile={profile} /></button>}>
          {profiles.map(item => (
            <button key={item.id} type="button" className="tw-menu-item" data-close onClick={() => { if (item.id !== profile?.id) void run("browser.setProfile", { profileId: item.id }).then(() => setProfileId(item.id)); }}>
              <ProfileFace profile={item} /><span className="grow">{item.label}</span>{item.id === profile?.id ? <Check size={15} /> : null}
            </button>
          ))}
          <div className="tw-menu-sep" />
          <button type="button" className="tw-menu-item" data-close onClick={() => onSettings?.("browser")}><Settings size={16} strokeWidth={1.7} /><span className="grow">Manage browser profiles</span></button>
        </Menu>
      </form>
      <div className="tw-pane-content" ref={content}>
        {tool === "files" ? <ToolPage title="Files" onBack={() => setTool(null)}><Files agent={agent} /></ToolPage>
          : tool === "agent" ? <ToolPage title="Agent" onBack={() => setTool(null)}><AgentPage agent={agent} onEditAgent={onEditAgent} onAgentChanged={onAgentChanged} onSettings={onSettings} onStart={onStart} onArchiveAgent={onArchiveAgent} /></ToolPage>
          : !active || active.kind === "home" ? <Home conversation={conversation} agent={agent} onOpen={open} onTool={setTool} /> : null}
      </div>
    </aside>
  );
}
