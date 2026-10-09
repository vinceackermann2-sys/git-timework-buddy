import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Files as FilesIcon, FolderOpen, Globe, KeyRound, Maximize2, Minimize2, PanelRight, Pencil, Plus, RotateCw, Settings2, Upload, UserRound, X } from "lucide-react";
import { call, useEvent } from "../api.js";
import { Avatar, Dialog, Menu, useToast } from "./common.jsx";
import { Files } from "./Files.jsx";

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; } };

// The site's own icon, never a third-party favicon service; a letter otherwise.
function SiteIcon({ url }) {
  const [failed, setFailed] = useState(false);
  let origin = null;
  try { origin = new URL(url).origin; } catch {}
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
          <button type="button" className="tw-pane-tile" onClick={() => onTool("agent")}><span><Avatar agent={agent} /></span>Agent</button>
          <button type="button" className="tw-pane-tile" onClick={() => onTool("files")}><span><FilesIcon size={28} strokeWidth={1.6} /></span>Files</button>
        </div>
      </section>
      <section>
        <h2>Recommended</h2>
        {sites.length ? (
          <div className="tw-recent">
            {sites.map(site => <button key={site.url} type="button" title={site.url} onClick={() => onOpen(site.url)}><SiteIcon url={site.url} /><span>{site.title || host(site.url)}</span></button>)}
          </div>
        ) : <p className="tw-hint">Your recent websites will appear here.</p>}
      </section>
    </div>
  );
}

// The agent: its picture, instructions and workspace folder.
function AgentPanel({ agent, onEditAgent }) {
  const [instructions, setInstructions] = useState(null);
  const toast = useToast();
  useEffect(() => { call("agents.instructions", { id: agent.id }).then(value => setInstructions(value.instructions || "")).catch(() => setInstructions("")); }, [agent.id]);
  return (
    <div className="tw-agent-panel">
      <Avatar agent={agent} size="large" />
      <h2>{agent.name}</h2>
      <div className="tw-agent-panel-actions">
        <button type="button" className="tw-btn" onClick={() => onEditAgent(agent)}><Pencil size={15} />Edit agent</button>
        <button type="button" className="tw-btn" onClick={() => call("agents.openWorkspace", { id: agent.id }).catch(error => toast(error, "error"))}><FolderOpen size={15} />Workspace folder</button>
      </div>
      <section>
        <h3>Instructions</h3>
        <p className={instructions ? "" : "tw-hint"}>{instructions === null ? "…" : instructions || "No instructions yet. Edit the agent to tell it how to work."}</p>
      </section>
    </div>
  );
}

export function Pane({ conversation, agent, expanded, onExpand, onClose, onEditAgent, onSettings }) {
  const [state, setState] = useState({ tabs: [], active: null });
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState(null);
  const [naming, setNaming] = useState(false);
  const [profileName, setProfileName] = useState("");
  const content = useRef(null);
  const overlay = useOverlayOpen();
  const toast = useToast();
  const id = conversation.id;
  const active = state.tabs.find(tab => tab.id === state.active) || null;
  const run = useCallback((method, input = {}) => call(method, { conversationId: id, ...input }).then(value => { if (value?.tabs) setState(value); return value; }).catch(error => toast(error, "error")), [id, toast]);

  useEffect(() => {
    run("browser.show").then(value => { if (value && !value.tabs.length) void run("browser.newTab"); });
    call("browser.profiles").then(setProfiles).catch(() => {});
    return () => { void call("browser.bounds", { rect: null }); };
  }, [id]);
  useEvent("browser.state", value => { if (value.conversationId === id) setState(value); });
  useEvent("browser.agent", value => { if (value.conversationId === id) setTool(null); });
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
      void call("browser.bounds", { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible: active?.kind === "web" && !overlay && !tool } });
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(node);
    window.addEventListener("resize", send);
    return () => { observer.disconnect(); window.removeEventListener("resize", send); };
  }, [active?.id, active?.kind, overlay, tool]);

  const open = url => { setTool(null); return active ? run("browser.navigate", { tabId: active.id, url }) : run("browser.newTab", { url }); };
  const profile = profiles.find(item => item.id === (profileId || active?.profileId || conversation.browserProfileId)) || profiles.find(item => item.isDefault) || profiles[0];
  return (
    <aside className="tw-pane" aria-label="Browser and files">
      <div className="tw-pane-top">
        <div className="tw-pane-tabs" role="tablist">
          {tool ? <div role="tab" aria-selected className="tw-pane-tab">{tool === "files" ? <FilesIcon size={14} /> : <Avatar agent={agent} size="tiny" />}<span>{tool === "files" ? "Files" : agent.name}</span><button type="button" aria-label="Close" onClick={() => setTool(null)}><X size={13} /></button></div> : null}
          {state.tabs.length > 1 || (state.tabs.length === 1 && state.tabs[0].kind !== "home") ? state.tabs.map(tab => (
            <div key={tab.id} role="tab" aria-selected={!tool && tab.id === state.active} className="tw-pane-tab" onClick={() => { setTool(null); void run("browser.activate", { tabId: tab.id }); }} title={tab.url || "New tab"}>
              {tab.favicon ? <img src={tab.favicon} alt="" width="14" height="14" /> : <Globe size={13} />}
              <span>{tab.kind === "home" ? "New tab" : tab.title || host(tab.url)}</span>
              <button type="button" aria-label="Close tab" onClick={event => { event.stopPropagation(); void run("browser.close", { tabId: tab.id }); }}><X size={13} /></button>
            </div>
          )) : null}
        </div>
        <button type="button" className="tw-icon-button" aria-label="New tab" title="New tab" onClick={() => { setTool(null); void run("browser.newTab"); }}><Plus size={18} strokeWidth={1.6} /></button>
        <button type="button" className="tw-icon-button" aria-label={expanded ? "Restore pane" : "Expand pane"} title={expanded ? "Restore" : "Expand"} onClick={onExpand}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button type="button" className="tw-icon-button" aria-label="Hide pane" title="Hide pane" aria-pressed="true" onClick={onClose}><PanelRight size={18} strokeWidth={1.6} /></button>
      </div>
      {tool ? null : <form className="tw-pane-toolbar" onSubmit={event => { event.preventDefault(); setEditing(false); if (address.trim()) void open(address.trim()); }}>
        <Menu align="left" width={240} trigger={({ toggle }) => <button type="button" className="tw-icon-button" aria-label="Page" title="Page" onClick={toggle} disabled={active?.kind !== "web"}><Globe size={18} strokeWidth={1.6} /></button>}>
          <div className="tw-menu-head"><strong className="tw-ellipsis">{active?.title || host(active?.url)}</strong><small className="tw-ellipsis">{host(active?.url)}</small></div>
          <div className="tw-menu-sep" />
          <button type="button" className="tw-menu-item" data-close onClick={() => call("links.open", { url: active.url }).catch(error => toast(error, "error"))}><ExternalLink size={15} /><span className="grow">Open in your browser</span></button>
          <button type="button" className="tw-menu-item" data-close onClick={() => navigator.clipboard.writeText(active.url).then(() => toast("Link copied."))}><Copy size={15} /><span className="grow">Copy link</span></button>
        </Menu>
        <button type="button" className="tw-icon-button" aria-label="Back" disabled={!active?.canGoBack} onClick={() => run("browser.back", { tabId: active.id })}><ArrowLeft size={17} strokeWidth={1.6} /></button>
        <button type="button" className="tw-icon-button" aria-label="Forward" disabled={!active?.canGoForward} onClick={() => run("browser.forward", { tabId: active.id })}><ArrowRight size={17} strokeWidth={1.6} /></button>
        <button type="button" className="tw-icon-button" aria-label={active?.loading ? "Stop" : "Reload"} disabled={active?.kind !== "web"} onClick={() => run(active?.loading ? "browser.stop" : "browser.reload", { tabId: active.id })}>{active?.loading ? <X size={17} /> : <RotateCw size={16} strokeWidth={1.7} />}</button>
        <input className="tw-address" value={address} placeholder="Search or enter a URL" aria-label="Address"
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
        <Menu align="right" width={240} trigger={({ toggle }) => <button type="button" className="tw-profile-button" aria-label="Browser profile" title={profile ? "Browser profile: " + profile.label : "Browser profile"} onClick={toggle}><img src="./timewarp-logo.svg" alt="" /></button>}>
          <div className="tw-menu-label">Browser profile</div>
          {profiles.map(item => (
            <button key={item.id} type="button" className="tw-menu-item" data-close onClick={() => { if (item.id !== profile?.id) void run("browser.setProfile", { profileId: item.id }).then(() => setProfileId(item.id)); }}>
              <UserRound size={15} /><span className="grow">{item.label}</span>{item.id === profile?.id ? <Check size={15} /> : null}
            </button>
          ))}
          <div className="tw-menu-sep" />
          <button type="button" className="tw-menu-item" data-close onClick={() => { setProfileName(""); setNaming(true); }}><Plus size={15} /><span className="grow">New profile</span></button>
          <button type="button" className="tw-menu-item" data-close onClick={() => call("vault.importPasswords").then(result => { if (!result.cancelled) toast(`Imported ${result.imported} sign-in${result.imported === 1 ? "" : "s"} into the Vault. Delete the exported file now; it isn't encrypted.`); }).catch(error => toast(error, "error"))}><Upload size={15} /><span className="grow">Import passwords…</span></button>
          <button type="button" className="tw-menu-item" data-close onClick={() => onSettings?.("browser")}><Settings2 size={15} /><span className="grow">Manage profiles</span></button>
        </Menu>
      </form>}
      <Dialog open={naming} onClose={() => setNaming(false)} title="New browser profile" description="A profile keeps its own sign-ins and cookies, separate from your other profiles. This chat switches to it.">
        <form className="tw-import" onSubmit={event => {
          event.preventDefault();
          call("browser.createProfile", { label: profileName }).then(created => {
            setNaming(false);
            setProfiles(list => [...list, created]);
            return run("browser.setProfile", { profileId: created.id }).then(() => setProfileId(created.id));
          }).catch(error => toast(error, "error"));
        }}>
          <label className="tw-field"><span>Name</span><input className="tw-input" autoFocus required maxLength={60} value={profileName} placeholder="Work" onChange={event => setProfileName(event.target.value)} /></label>
          <div className="tw-dialog-actions"><button type="button" className="tw-btn" onClick={() => setNaming(false)}>Cancel</button><button type="submit" className="tw-btn primary" disabled={!profileName.trim()}>Create</button></div>
        </form>
      </Dialog>
      <div className="tw-pane-content" ref={content}>
        {tool === "files" ? <Files agent={agent} /> : tool === "agent" ? <AgentPanel agent={agent} onEditAgent={onEditAgent} />
          : !active || active.kind === "home" ? <Home conversation={conversation} agent={agent} onOpen={open} onTool={setTool} /> : null}
      </div>
    </aside>
  );
}
