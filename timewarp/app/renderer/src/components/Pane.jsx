import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Files as FilesIcon, Globe, KeyRound, Maximize2, Minimize2, PanelRight, Pin, PinOff, Plus, RotateCw, Settings, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { call, useEvent } from "../api.js";
import { Avatar, ContextMenu, Menu, useToast } from "./common.jsx";
import { Files } from "./Files.jsx";
import { AGENT_SECTIONS, AgentPage } from "./AgentId.jsx";

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; } };
// The agent page opens at its instructions ("agent") or at one of its
// sections ("agent:mail" and so on).
const agentSection = tool => tool === "agent" ? "instructions" : typeof tool === "string" && tool.startsWith("agent:") && AGENT_SECTIONS.includes(tool.slice(6)) ? tool.slice(6) : null;
const toolTitle = tool => agentSection(tool) ? "Agent" : tool === "files" ? "Files" : null;

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
// menu is open and come back when it closes. With toasts: also while a toast
// shows, for a page that leaves no room beside it for toasts. First steps'
// card beside the browser leaves it showing (FirstSteps.jsx).
function useOverlayOpen(toasts = false) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector("dialog[open]:not([data-beside-browser]), .tw-menu, .timewarp-org-gate" + (toasts ? ", .tw-toast" : "")));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "data-beside-browser"] });
    return () => observer.disconnect();
  }, [toasts]);
  return open;
}
// The least room toasts need to the left of the page, margins included.
const TOAST_ROOM = 220;

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

// Which tabs show a tool (Agent, Files) and the files open in each, kept per chat.
const toolsKey = conversationId => "tw.paneTools." + conversationId;
function readTools(conversationId) {
  try { const value = JSON.parse(localStorage.getItem(toolsKey(conversationId)) || "{}"); return { tools: value.tools || {}, files: value.files || {} }; } catch { return { tools: {}, files: {} }; }
}

// openFile: { conversationId, path, at } from a file card in this chat; it opens
// in Files in a new tab, as before, and onFileOpened clears the request.
// openTool: { conversationId, tool, at } shows a tool, such as the agent page
// for the sidebar's Edit. onRegisterClose gets the Ctrl/⌘+W handler.
export function Pane({ conversation, agent, expanded, narrow = false, onExpand, onClose, onEditAgent, onAgentChanged, onSettings, onArchiveAgent, openFile: fileRequest = null, onFileOpened, openTool = null, onToolOpened, onRegisterClose }) {
  const [state, setState] = useState({ tabs: [], active: null });
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const saved = useRef(null);
  if (!saved.current) saved.current = readTools(conversation.id);
  const [tools, setTools] = useState(saved.current.tools);
  const [fileStates, setFileStates] = useState(saved.current.files);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState(null);
  const [tabMenu, setTabMenu] = useState(null);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  const content = useRef(null);
  const [covered, setCovered] = useState(false);
  const overlay = useOverlayOpen(covered);
  const toast = useToast();
  const id = conversation.id;
  const openFile = fileRequest?.conversationId === id ? fileRequest : null;
  const active = state.tabs.find(tab => tab.id === state.active) || null;
  const tool = active && active.kind === "home" ? tools[active.id] || null : null;
  // Resolves null after a failure (shown as a toast), so callers can tell.
  const run = useCallback((method, input = {}) => call(method, { conversationId: id, ...input }).then(value => { if (value?.tabs) setState(value); return value ?? true; }).catch(error => { toast(error, "error"); return null; }), [id, toast]);
  const setTool = value => { if (active) setTools(current => ({ ...current, [active.id]: value })); };
  const filesOf = tabId => fileStates[tabId] || { open: [], active: null };
  const setFilesOf = (tabId, value) => setFileStates(current => ({ ...current, [tabId]: value }));
  // Tools and files are remembered for the chat's tabs that still exist.
  useEffect(() => {
    if (!state.tabs.length) return;
    const ids = new Set(state.tabs.map(tab => tab.id));
    const keep = map => Object.fromEntries(Object.entries(map).filter(([tabId, value]) => ids.has(tabId) && value));
    try { localStorage.setItem(toolsKey(id), JSON.stringify({ tools: keep(tools), files: keep(fileStates) })); } catch {}
  }, [id, tools, fileStates, state.tabs]);

  // The chat's tabs, once shown; a requested tool waits for them.
  const shown = useRef(null);
  const latestState = useRef(state), latestTools = useRef(tools);
  latestState.current = state; latestTools.current = tools;
  useEffect(() => {
    shown.current = run("browser.show").then(value => { if (value?.tabs && !value.tabs.length && !openFile && !openTool) return run("browser.newTab"); return value; });
    call("browser.profiles").then(setProfiles).catch(() => {});
    return () => { void call("browser.bounds", { rect: null }); };
  }, [id]);
  useEvent("browser.state", value => { if (value.conversationId === id) setState(value); });
  // A tool opens on the new tab page that's showing, or in a new tab.
  const showTool = async (name, snapshot = null) => {
    const now = snapshot?.tabs ? snapshot : latestState.current, used = latestTools.current;
    const current = now.tabs.find(tab => tab.id === now.active);
    const same = tool => tool === name || (agentSection(name) && agentSection(tool));
    let tabId = current?.kind === "home" && (!used[current.id] || same(used[current.id])) ? current.id : null;
    if (!tabId) { const tab = await call("browser.newTab", { conversationId: id }).catch(error => { toast(error, "error"); return null; }); tabId = tab?.id; }
    if (!tabId) return;
    setTools(value => ({ ...value, [tabId]: name }));
  };
  const [fileTab, setFileTab] = useState(null);
  useEffect(() => {
    if (!openFile?.path) return;
    onFileOpened?.();
    call("browser.newTab", { conversationId: id }).then(tab => {
      if (!tab?.id) return;
      setTools(current => ({ ...current, [tab.id]: "files" }));
      setFileTab({ ...openFile, tabId: tab.id });
    }).catch(error => toast(error, "error"));
  }, [openFile?.at]);
  useEffect(() => {
    if (!openTool?.tool) return;
    onToolOpened?.();
    void Promise.resolve(shown.current).then(value => showTool(openTool.tool, value));
  }, [openTool?.at]);
  // "Add automation" asks in this chat, which then shows, as before.
  const ask = text => {
    const event = new CustomEvent("tw:chat-send", { detail: { conversationId: id, text }, cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) { toast("Open the conversation to send this.", "error"); return; }
    onClose();
    Promise.resolve(event.detail.result).catch(error => toast(error, "error"));
  };
  // Pinned tabs stay open, as before (browser.pin keeps the pin with the tab).
  const pin = (tab, pinned) => run("browser.pin", { tabId: tab.id, id: tab.id, pinned });
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
      const visible = active?.kind === "web" && !overlay;
      void call("browser.bounds", { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible } });
      // Toasts move left of the page, which would cover them, when there's room;
      // otherwise a toast hides the page while it shows (see useOverlayOpen).
      const room = visible && rect.left >= TOAST_ROOM, root = document.documentElement.style;
      if (room) { root.setProperty("--toasts-right", Math.round(innerWidth - rect.left + 18) + "px"); root.setProperty("--toasts-width", Math.round(Math.min(360, rect.left - 36)) + "px"); }
      else { root.removeProperty("--toasts-right"); root.removeProperty("--toasts-width"); }
      setCovered(active?.kind === "web" && rect.left < TOAST_ROOM);
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(node);
    window.addEventListener("resize", send);
    return () => { observer.disconnect(); window.removeEventListener("resize", send); document.documentElement.style.removeProperty("--toasts-right"); document.documentElement.style.removeProperty("--toasts-width"); };
  }, [active?.id, active?.kind, overlay]);

  const open = url => active ? run("browser.navigate", { tabId: active.id, url }) : run("browser.newTab", { url });
  // The last tab closing hides the pane when asked to (Ctrl/⌘+W); otherwise a new tab replaces it.
  const closeTab = (tab, { hideWhenLast = false } = {}) => run("browser.close", { tabId: tab.id }).then(value => {
    if (!value) return;
    setTools(current => { const next = { ...current }; delete next[tab.id]; return next; });
    setFileStates(current => { const next = { ...current }; delete next[tab.id]; return next; });
    if (value.tabs && !value.tabs.length) { if (hideWhenLast) onClose(); else void run("browser.newTab"); }
  });
  // Browser home leaves the current page as it is, as before: a page or tool
  // tab switches to a new tab page (main reuses one that's open).
  const goHome = () => {
    if (active?.kind === "web") { void run("browser.home", { tabId: active.id }); return; }
    if (!tool) return;
    const blank = state.tabs.find(tab => tab.kind === "home" && !tools[tab.id] && tab.id !== active?.id);
    void (blank ? run("browser.activate", { tabId: blank.id }) : run("browser.newTab"));
  };
  // Ctrl/⌘+W: the open file, then the agent or Files tab, then the browser tab;
  // the last tab (or a pinned one) hides the pane. Resolves whether it did something.
  const latest = useRef(null);
  latest.current = async () => {
    if (!active) { onClose(); return true; }
    const files = filesOf(active.id);
    if (tool === "files" && files.active) {
      const index = files.open.indexOf(files.active), rest = files.open.filter(item => item !== files.active);
      setFilesOf(active.id, { open: rest, active: rest[Math.min(index, rest.length - 1)] ?? null });
      return true;
    }
    if (active.pinned) { onClose(); return true; }
    await closeTab(active, { hideWhenLast: true });
    return true;
  };
  useEffect(() => { onRegisterClose?.(() => latest.current()); return () => onRegisterClose?.(null); }, []);
  const profile = profiles.find(item => item.id === (profileId || active?.profileId || conversation.browserProfileId)) || profiles.find(item => item.isDefault) || profiles[0];
  const tabTitle = tab => (tab.kind === "home" ? toolTitle(tools[tab.id]) || "New tab" : tab.title || host(tab.url) || "New tab");
  const menuTab = tabMenu && state.tabs.find(tab => tab.id === tabMenu.tabId);
  return (
    <aside className="tw-pane" aria-label="Browser and files">
      <div className="tw-pane-top">
        <div className="tw-pane-tabs" role="tablist">
          {state.tabs.map(tab => (
            <div key={tab.id} role="tab" tabIndex={0} aria-selected={tab.id === state.active} className={"tw-pane-tab" + (tab.pinned ? " pinned" : "")} title={tab.url || tabTitle(tab)}
              onClick={() => { if (tab.id !== state.active) void run("browser.activate", { tabId: tab.id }); }}
              onKeyDown={event => {
                if (event.key === "Enter") void run("browser.activate", { tabId: tab.id });
                // The context menu key (or Shift+F10) opens the tab's menu, as before.
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setTabMenu({ x: box.left, y: box.bottom, tabId: tab.id }); }
              }}
              onContextMenu={event => { event.preventDefault(); setTabMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); }}
              onAuxClick={event => { if (event.button === 1 && !tab.pinned) void closeTab(tab); }}>
              {tab.kind === "web" && tab.favicon ? <img src={tab.favicon} alt="" width="14" height="14" /> : tab.kind === "home" && agentSection(tools[tab.id]) ? <Avatar agent={agent} size="tiny" /> : tab.kind === "home" && tools[tab.id] === "files" ? <FilesIcon size={14} strokeWidth={1.7} /> : <Globe size={14} strokeWidth={1.7} />}
              <span>{tabTitle(tab)}</span>
              {tab.pinned ? <Pin size={11} className="tw-pin-mark" aria-label="Pinned" /> : <button type="button" aria-label={"Close " + tabTitle(tab)} onClick={event => { event.stopPropagation(); void closeTab(tab); }}><X size={12} /></button>}
            </div>
          ))}
        </div>
        {/* Right after the newest tab, as in Chrome. */}
        <button type="button" className="tw-icon-button tw-pane-add" aria-label="Add browser tab" title="New tab" onClick={() => void run("browser.newTab")}><Plus size={12} strokeWidth={2} /></button>
        <ContextMenu at={menuTab ? tabMenu : null} onClose={closeTabMenu}>
          {menuTab ? (
            <>
              {/* Tabs report "pinned" once the browser can pin them. */}
              {typeof menuTab.pinned === "boolean" ? <button type="button" className="tw-menu-item" data-close onClick={() => void pin(menuTab, !menuTab.pinned)}>{menuTab.pinned ? <PinOff size={16} /> : <Pin size={16} />}<span className="grow">{menuTab.pinned ? "Unpin" : "Pin"}</span></button> : null}
              {menuTab.pinned ? null : <button type="button" className="tw-menu-item" data-close onClick={() => void closeTab(menuTab)}><X size={16} /><span className="grow">Close tab</span></button>}
            </>
          ) : null}
        </ContextMenu>
        <div className="tw-pane-controls">
          {narrow ? null : <button type="button" className="tw-icon-button" aria-label={expanded ? "Restore secondary pane" : "Expand secondary pane"} title={expanded ? "Restore" : "Expand"} onClick={onExpand}>{expanded ? <Minimize2 size={16} strokeWidth={1.7} /> : <Maximize2 size={16} strokeWidth={1.7} />}</button>}
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
            <button key={item.id} type="button" className="tw-menu-item" data-close onClick={() => { if (item.id !== profile?.id) void run("browser.setProfile", { profileId: item.id }).then(value => { if (value) setProfileId(item.id); }); }}>
              <ProfileFace profile={item} /><span className="grow">{item.label}</span>{item.id === profile?.id ? <Check size={15} /> : null}
            </button>
          ))}
          <div className="tw-menu-sep" />
          <button type="button" className="tw-menu-item" data-close onClick={() => onSettings?.("browser")}><Settings size={16} strokeWidth={1.7} /><span className="grow">Manage browser profiles</span></button>
        </Menu>
      </form>
      <div className="tw-pane-content" ref={content}>
        {tool === "files" ? <ToolPage title="Files" onBack={() => setTool(null)}><Files key={active.id} agent={agent} files={filesOf(active.id)} onChange={value => setFilesOf(active.id, value)} openPath={fileTab?.tabId === active?.id ? fileTab : null} /></ToolPage>
          : agentSection(tool) ? <ToolPage title="Agent" onBack={() => setTool(null)}><AgentPage agent={agent} conversationId={id} section={agentSection(tool)} onSection={section => setTool(section === "instructions" ? "agent" : "agent:" + section)}
            onEditAgent={onEditAgent} onAgentChanged={onAgentChanged} onSettings={onSettings} onArchiveAgent={onArchiveAgent} onAsk={ask} /></ToolPage>
          : !active || active.kind === "home" ? <Home conversation={conversation} agent={agent} onOpen={open} onTool={setTool} /> : null}
      </div>
    </aside>
  );
}
