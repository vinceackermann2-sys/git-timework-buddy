import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BookMarked, CalendarClock, Check, ChevronLeft, ChevronRight, FileText, Files as FilesIcon, Globe, KeyRound, Maximize2, Minimize2, PanelRight, Pencil, Pin, PinOff, Plus, RotateCw, Settings, Trash2, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { call, relativeTime, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { Avatar, ContextMenu, Dialog, Menu, Switch, useConfirm, useToast } from "./common.jsx";
import { AppIcon, useApps } from "./Composer.jsx";
import { AutomationDialog, describeSchedule } from "./Automations.jsx";
import { Files, recentFiles } from "./Files.jsx";

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
// menu is open and come back when it closes. With toasts: also while a toast
// shows, for a page that leaves no room beside it for toasts.
function useOverlayOpen(toasts = false) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector("dialog[open], .tw-menu, .timewarp-org-gate" + (toasts ? ", .tw-toast" : "")));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
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

// The agent: picture, instructions, the connected apps it can use and vault access.
// What "Add workflow" and "Add automation" ask, in the chat the pane belongs to.
const AUTOMATION_PROMPT = "Help me set up an automation for this agent. Work out with me whether it should run on a schedule or when something happens.";
const WORKFLOW_PROMPT = "Help me create a new workflow for this agent. Work out the steps with me, then save it as a skill in your workspace so you can repeat it.";
const within = (root, file) => {
  const norm = value => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const [base, target] = window.tw?.platform === "win32" ? [norm(root).toLowerCase(), norm(file).toLowerCase()] : [norm(root), norm(file)];
  return !!base && target.startsWith(base + "/");
};
const relativeTo = (root, file) => String(file).replace(/\\/g, "/").slice(String(root).replace(/\\/g, "/").replace(/\/+$/, "").length + 1);

// A workflow (a skill in the agent's workspace) and what it does.
function WorkflowDialog({ skill, onClose }) {
  const [text, setText] = useState(null);
  useEffect(() => { setText(null); if (skill) call("skills.read", { path: skill.path }).then(value => setText(value.text || "")).catch(() => setText("")); }, [skill?.path]);
  return (
    <Dialog open={!!skill} onClose={onClose} title={skill?.title} description={skill?.description}>
      {skill ? (text === null ? <p className="tw-hint">Loading workflow…</p> : <div className="tw-skill-text"><Markdown text={text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")} /></div>) : null}
    </Dialog>
  );
}

function AgentPage({ agent, conversationId, onEditAgent, onAgentChanged, onSettings, onArchiveAgent, onAsk, onOpenFiles }) {
  const [automations, setAutomations] = useState([]);
  useEffect(() => { call("automations.list").then(setAutomations).catch(() => setAutomations([])); }, [agent.id]);
  useEvent("automations.changed", () => { call("automations.list").then(setAutomations).catch(() => {}); });
  const mine = automations.filter(item => item.agentId === agent.id);
  // An automation's row opens its details, as before; it closes if the automation goes.
  const [openAutomation, setOpenAutomation] = useState(null);
  const detail = mine.find(item => item.id === openAutomation) || null;
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
  // The account comes back connected for this agent.
  const reconnect = entry => call("integrations.beginConnect", { integrationId: entry.app.id, agentId: agent.id, reconnectAccountId: entry.account.id }).then(() => toast("Finish connecting in your browser.")).catch(error => toast(error, "error"));
  const setVault = value => call("agents.update", { id: agent.id, vaultAccess: value }).then(() => onAgentChanged?.()).catch(error => toast(error, "error"));
  const confirm = useConfirm();
  // Instructions are its AGENTS.md, edited here as Markdown, as before.
  const [draft, setDraft] = useState(null);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const saveInstructions = () => {
    setSavingInstructions(true);
    call("agents.saveWorkspaceInstructions", { id: agent.id, instructions: draft }).then(value => { setInstructions(value.instructions || ""); setDraft(null); })
      .catch(error => toast(error, "error")).finally(() => setSavingInstructions(false));
  };
  // Workflows are the skills kept in its workspace.
  const [workflows, setWorkflows] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  useEffect(() => {
    call("skills.list").then(value => setWorkflows((value.skills || []).filter(skill => within(agent.workspace, skill.path)))).catch(() => setWorkflows([]));
  }, [agent.id, agent.workspace]);
  // Files opened from its workspace, newest first.
  const [recent, setRecent] = useState(() => recentFiles(agent.id));
  useEffect(() => {
    setRecent(recentFiles(agent.id));
    const update = ({ detail }) => { if (detail?.agentId === agent.id) setRecent(recentFiles(agent.id)); };
    window.addEventListener("tw:recent-files", update);
    return () => window.removeEventListener("tw:recent-files", update);
  }, [agent.id]);
  const remove = async () => {
    if (await confirm({ title: `Remove ${agent.name}?`, body: "This removes the agent and its conversations from your sidebar. Its workspace folder stays on this computer.", action: "Remove", danger: true })) onArchiveAgent(agent);
  };
  return (
    <div className="tw-agent-page">
      <div className="tw-agent-page-head">
        <button type="button" className="tw-agent-picture" title="Edit agent" aria-label="Edit agent picture" onClick={() => onEditAgent(agent)}>
          <Avatar agent={agent} /><span className="badge"><Pencil size={14} /></span>
        </button>
        <button type="button" className="tw-agent-name" title="Edit agent" onClick={() => onEditAgent(agent)}><span>{agent.name}</span><Pencil size={14} /></button>
      </div>
      <div className="tw-agent-page-row first">
        <h3>Instructions</h3>
        {draft === null && instructions !== null ? <button type="button" className="tw-agent-add" onClick={() => setDraft(instructions)}>Edit</button> : null}
      </div>
      {draft !== null ? (
        <div className="tw-agent-editor">
          <textarea className="tw-textarea" autoFocus value={draft} maxLength={50000} aria-label="Instructions (Markdown)" disabled={savingInstructions} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setDraft(null); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saveInstructions(); }} />
          <div className="tw-dialog-actions">
            <button type="button" className="tw-btn" disabled={savingInstructions} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="tw-btn primary" disabled={savingInstructions || draft === instructions} onClick={saveInstructions}>{savingInstructions ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : (
        <div className="tw-agent-card tw-agent-instructions">
          {instructions === null ? <p className="tw-hint">…</p> : instructions ? <Markdown text={instructions} /> : <p className="tw-hint">No instructions yet.</p>}
        </div>
      )}
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
            <AppIcon app={entry.app} /><strong>{entry.app.displayName}</strong><span className="desc">{entry.account.displayName} (Authentication expired — reconnect required)</span>
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
      <div className="tw-agent-page-row">
        <h3>Workflows</h3>
        {workflows?.length ? <button type="button" className="tw-agent-add" onClick={() => onAsk(WORKFLOW_PROMPT)}><Plus size={12} />New</button> : null}
      </div>
      <div className="tw-agent-card">
        {(workflows || []).map(skill => (
          <button key={skill.path} type="button" className="tw-agent-tool tw-agent-tool-button" onClick={() => setWorkflow(skill)}>
            <BookMarked size={16} strokeWidth={1.7} /><strong>{skill.title}</strong><span className="desc">{skill.description}</span>
          </button>
        ))}
        {workflows === null ? <p className="tw-hint tw-agent-note">Loading…</p> : workflows.length ? null : <button type="button" className="tw-agent-action" onClick={() => onAsk(WORKFLOW_PROMPT)}><Plus size={16} />Add workflow</button>}
      </div>
      <WorkflowDialog skill={workflow} onClose={() => setWorkflow(null)} />
      <h3 className="tw-agent-section">Automations</h3>
      <div className="tw-agent-card">
        {mine.map(item => (
          <button key={item.id} type="button" className="tw-agent-tool tw-agent-tool-button tw-agent-automation" onClick={() => setOpenAutomation(item.id)}>
            <CalendarClock size={16} strokeWidth={1.7} /><strong>{item.name}</strong><span className="desc">{item.enabled ? describeSchedule(item.schedule) : "Paused"}</span>
          </button>
        ))}
        <button type="button" className={"tw-agent-action" + (mine.length ? " inner" : "")} onClick={() => onAsk(AUTOMATION_PROMPT)}><Plus size={16} />Add automation</button>
      </div>
      <AutomationDialog automation={detail} onClose={() => setOpenAutomation(null)} onRan={ranIn => { if (ranIn) location.hash = "#/conversation/" + ranIn; }} />
      <div className="tw-agent-page-row">
        <h3>Recent files</h3>
        <button type="button" className="tw-agent-add" onClick={() => onOpenFiles(null)}>View all</button>
      </div>
      <div className="tw-agent-card">
        {recent.map(item => (
          <button key={item.path} type="button" className="tw-agent-tool tw-agent-tool-button" title={item.path} onClick={() => onOpenFiles(item.path)}>
            <FileText size={16} strokeWidth={1.7} /><strong className="tw-ellipsis">{item.path.split("/").pop()}</strong><span className="desc" /><time className="tw-hint">{relativeTime(item.openedAt)}</time>
          </button>
        ))}
        {recent.length ? null : <button type="button" className="tw-agent-action" onClick={() => onOpenFiles(null)}><Plus size={16} />Add files</button>}
      </div>
      <h3 className="tw-agent-section">Manage agent</h3>
      <button type="button" className="tw-agent-card tw-agent-action tw-danger-hover" onClick={() => void remove()}><Trash2 size={16} />Remove agent</button>
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
  const showTool = async (name, files, snapshot = null) => {
    const now = snapshot?.tabs ? snapshot : latestState.current, used = latestTools.current;
    const current = now.tabs.find(tab => tab.id === now.active);
    let tabId = current?.kind === "home" && (!used[current.id] || used[current.id] === name) ? current.id : null;
    if (!tabId) { const tab = await call("browser.newTab", { conversationId: id }).catch(error => { toast(error, "error"); return null; }); tabId = tab?.id; }
    if (!tabId) return;
    setTools(value => ({ ...value, [tabId]: name }));
    if (files) setFileStates(value => ({ ...value, [tabId]: files(value[tabId] || { open: [], active: null }) }));
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
    void Promise.resolve(shown.current).then(value => showTool(openTool.tool, null, value));
  }, [openTool?.at]);
  // "Add workflow" and "Add automation" ask in this chat, which then shows, as before.
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
  const tabTitle = tab => (tab.kind === "home" ? TOOLS[tools[tab.id]] || "New tab" : tab.title || host(tab.url) || "New tab");
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
              {tab.kind === "web" && tab.favicon ? <img src={tab.favicon} alt="" width="14" height="14" /> : tab.kind === "home" && tools[tab.id] === "agent" ? <Avatar agent={agent} size="tiny" /> : tab.kind === "home" && tools[tab.id] === "files" ? <FilesIcon size={14} strokeWidth={1.7} /> : <Globe size={14} strokeWidth={1.7} />}
              <span>{tabTitle(tab)}</span>
              {tab.pinned ? <Pin size={11} className="tw-pin-mark" aria-label="Pinned" /> : <button type="button" aria-label={"Close " + tabTitle(tab)} onClick={event => { event.stopPropagation(); void closeTab(tab); }}><X size={12} /></button>}
            </div>
          ))}
        </div>
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
          <button type="button" className="tw-icon-button add" aria-label="Add browser tab" title="New tab" onClick={() => void run("browser.newTab")}><Plus size={12} strokeWidth={2} /></button>
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
          : tool === "agent" ? <ToolPage title="Agent" onBack={() => setTool(null)}><AgentPage agent={agent} conversationId={id} onEditAgent={onEditAgent} onAgentChanged={onAgentChanged} onSettings={onSettings} onArchiveAgent={onArchiveAgent} onAsk={ask}
            onOpenFiles={file => void showTool("files", file ? current => ({ open: current.open.includes(file) ? current.open : [...current.open, file], active: file }) : null)} /></ToolPage>
          : !active || active.kind === "home" ? <Home conversation={conversation} agent={agent} onOpen={open} onTool={setTool} /> : null}
      </div>
    </aside>
  );
}
