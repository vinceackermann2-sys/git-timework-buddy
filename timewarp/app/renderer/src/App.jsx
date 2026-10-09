import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import { call, request, useEvent } from "./api.js";
import { applyAppearance } from "./theme.js";
import { Dialog, ToastProvider, useToast } from "./components/common.jsx";
import { Sidebar, UsageCard } from "./components/Sidebar.jsx";
import { Home } from "./components/Home.jsx";
import { Chat } from "./components/Chat.jsx";
import { ALIASES, SECTIONS, Settings } from "./components/Settings.jsx";
import { AgentDialog } from "./components/AgentDialog.jsx";
import { Pane } from "./components/Pane.jsx";

const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };

function parseRoute() {
  const [, view, id] = (location.hash.replace(/^#\/?/, "") || "").match(/^([a-z]*)\/?(.*)$/) || [];
  // Chats are at #/conversation/<id>, as in the previous app (#/c/<id> also works).
  if ((view === "conversation" || view === "c") && id) return { view: "chat", id };
  if (view === "customize" || view === "settings") {
    const section = ALIASES[id] || id;
    return { view: "settings", section: SECTIONS.some(item => item.id === section) ? section : "general" };
  }
  return { view: "home" };
}
const go = hash => { if (location.hash !== hash) location.hash = hash; };

// Back and forward follow the app's own page history.
function useHistoryButtons() {
  const [state, setState] = useState({ back: false, forward: false });
  useEffect(() => {
    const nav = window.navigation;
    if (!nav) return;
    const update = () => setState({ back: !!nav.canGoBack, forward: !!nav.canGoForward });
    update();
    nav.addEventListener("currententrychange", update);
    return () => nav.removeEventListener("currententrychange", update);
  }, []);
  return state;
}

function ProfileDialog({ open, onClose, account, onAccount, onSignOut }) {
  const [name, setName] = useState("");
  const toast = useToast();
  useEffect(() => { if (open) setName(account?.user?.name || ""); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Profile" description={account?.user?.email}>
      <form className="tw-import" onSubmit={event => { event.preventDefault(); call("profile.update", { name }).then(value => { onAccount(value); toast("Name saved."); onClose(); }).catch(error => toast(error, "error")); }}>
        <label className="tw-field"><span>Preferred name</span><input className="tw-input" autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
        <div className="tw-dialog-actions">
          <button type="button" className="tw-btn" onClick={onSignOut}>Log out</button>
          <span className="grow" />
          <button type="submit" className="tw-btn primary" disabled={!name.trim() || name.trim() === account?.user?.name}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}

function Shell({ account, setAccount, settings, setSettings }) {
  const toast = useToast();
  const [route, setRoute] = useState(parseRoute);
  const [agents, setAgents] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [models, setModels] = useState(null);
  const [funding, setFunding] = useState(null);
  const [chatgpt, setChatgpt] = useState(null);
  const [dialog, setDialog] = useState({ open: false, agent: null });
  const [profileOpen, setProfileOpen] = useState(false);
  const [homeAgent, setHomeAgentState] = useState(() => read("tw.agent", ""));
  const [pane, setPaneState] = useState(() => read("tw.pane", "0") === "1" ? "open" : "closed");
  const [sidebar, setSidebarState] = useState(() => read("tw.sidebar", "shown"));
  const [width, setWidth] = useState(() => Math.min(420, Math.max(220, Number(read("tw.sidebarWidth", 288)) || 288)));
  const [first, setFirst] = useState(null);
  const refreshTimer = useRef(null);
  const history = useHistoryButtons();

  const setHomeAgent = id => { setHomeAgentState(id); write("tw.agent", id); };
  const setPane = value => { setPaneState(value); if (value !== "full") write("tw.pane", value === "open" ? "1" : "0"); };
  const setSidebar = value => { setSidebarState(value); write("tw.sidebar", value); };
  const loadAgents = useCallback(() => call("agents.list").then(setAgents).catch(error => toast(error, "error")), [toast]);
  const loadConversations = useCallback(() => call("conversations.list").then(setConversations).catch(() => {}), []);
  const loadModels = useCallback(() => call("models.list").then(setModels).catch(() => {}), []);
  const loadFunding = useCallback(() => {
    call("funding.get").then(setFunding).catch(() => {});
    request("chatgptDetails").then(setChatgpt).catch(() => {});
  }, []);
  const refreshSoon = useCallback(() => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => { void loadConversations(); }, 250); }, [loadConversations]);

  useEffect(() => { void loadAgents(); void loadModels(); loadFunding(); const timer = setInterval(loadFunding, 5 * 60 * 1000); return () => clearInterval(timer); }, [loadAgents, loadModels, loadFunding]);
  // After a crash or forced close, as in the previous app.
  useEffect(() => { call("app.info").then(info => { if (info.previousSessionUnclean) toast({ title: "Timewarp closed unexpectedly.", body: "Review your conversations before continuing." }, "warning"); }).catch(() => {}); }, []);
  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { const change = () => setRoute(parseRoute()); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  useEffect(() => { const reload = () => void loadConversations(); window.addEventListener("tw:conversations", reload); return () => window.removeEventListener("tw:conversations", reload); }, [loadConversations]);

  const agentById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const current = route.view === "chat" ? conversations.find(item => item.id === route.id) : null;
  const [opened, setOpened] = useState(null);
  useEffect(() => {
    if (route.view !== "chat") { setOpened(null); return; }
    if (current) { setOpened(current); return; }
    call("conversations.get", { id: route.id }).then(setOpened).catch(() => go("#/"));
  }, [route.view, route.id, current]);

  useEvent("conversation.event", ({ conversationId, method, params }) => {
    if (["turn/started", "turn/completed", "thread/name/updated", "turn/aborted", "item/completed"].includes(method)) refreshSoon();
    if (method === "turn/completed" && !params.subAgent) loadFunding();
    if (method === "turn/completed" && !params.subAgent && !document.hasFocus() && settings?.notifications?.replies !== false && "Notification" in window) {
      const conversation = conversations.find(item => item.id === conversationId);
      const agent = agentById.get(conversation?.agentId);
      const notice = new Notification(agent?.name || "Timewarp", { body: (conversation?.title ? conversation.title + ": " : "") + (params.turn?.status === "completed" ? "Reply ready." : "The reply stopped."), silent: false });
      notice.onclick = () => { window.focus(); go("#/conversation/" + conversationId); };
    }
  });
  useEvent("history.status", state => { if (state.state === "synced") { void loadAgents(); void loadConversations(); } });
  useEvent("funding.changed", () => { void loadModels(); loadFunding(); });
  useEvent("browser.agent", ({ conversationId }) => { if (route.view === "chat" && conversationId === route.id && pane === "closed") setPane("open"); });
  // Tab links in a chat open that tab in the pane.
  useEffect(() => {
    const openTab = ({ detail }) => {
      call("browser.activate", { conversationId: detail.conversationId, tabId: detail.tabId })
        .then(() => { if (route.view === "chat" && route.id === detail.conversationId && pane === "closed") setPane("open"); })
        .catch(() => toast("This browser tab is no longer available."));
    };
    const openUrl = ({ detail }) => {
      if (route.view !== "chat" || !route.id) { void call("links.open", { url: detail.url }).catch(error => toast(error, "error")); return; }
      const conversationId = route.id;
      if (pane === "closed") setPane("open");
      call("browser.state", { conversationId })
        .then(state => {
          const active = state.tabs.find(tab => tab.id === state.active);
          return active?.kind === "home" ? call("browser.navigate", { conversationId, tabId: active.id, url: detail.url }) : call("browser.newTab", { conversationId, url: detail.url });
        })
        .catch(error => toast(error, "error"));
    };
    window.addEventListener("tw:open-tab", openTab);
    window.addEventListener("tw:open-url", openUrl);
    return () => { window.removeEventListener("tw:open-tab", openTab); window.removeEventListener("tw:open-url", openUrl); };
  }, [route.view, route.id, pane]);

  // Starts a chat from the home screen with its first message.
  async function start(agentId, message) {
    const conversation = await call("conversations.create", { agentId });
    setConversations(list => [conversation, ...list]);
    setFirst({ conversationId: conversation.id, message });
    setOpened(conversation);
    go("#/conversation/" + conversation.id);
  }
  function newTask(agentId) {
    if (agentId) setHomeAgent(agentId);
    go("#/");
    setTimeout(() => document.querySelector(".tw-home textarea")?.focus(), 50);
  }
  async function archiveConversation(conversation) {
    try {
      await call("conversations.archive", { id: conversation.id });
      setConversations(list => list.filter(item => item.id !== conversation.id));
      if (route.view === "chat" && route.id === conversation.id) go("#/");
    } catch (error) { toast(error, "error"); }
  }
  async function archiveAgent(agent) {
    if (!window.confirm(`Archive ${agent.name}? Its workspace folder and chats stay on this computer.`)) return;
    try { await call("agents.archive", { id: agent.id }); await loadAgents(); await loadConversations(); }
    catch (error) { toast(error, "error"); }
  }
  async function reorder(ids) {
    setAgents(list => ids.map(id => list.find(agent => agent.id === id)).filter(Boolean));
    try { await call("agents.reorder", { ids }); } catch (error) { toast(error, "error"); void loadAgents(); }
  }
  async function setSetting(key, value) {
    setSettings(currentSettings => ({ ...currentSettings, [key]: value }));
    if (key === "appearance") applyAppearance(value);
    try { await call("settings.set", { key, value }); } catch (error) { toast(error, "error"); }
  }
  async function selectModel(choice) {
    try { const selected = await call("models.select", choice); setModels(value => ({ ...value, selected })); }
    catch (error) { toast(error, "error"); }
  }
  const settingsPage = section => go("#/customize/" + (section || "general"));
  function startResize(event) {
    event.preventDefault();
    const move = moveEvent => setWidth(Math.min(420, Math.max(220, moveEvent.clientX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setWidth(value => { write("tw.sidebarWidth", value); return value; }); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const chatConversations = conversations.filter(item => agentById.has(item.agentId));
  const chatAgent = opened && agentById.get(opened.agentId);
  let main;
  if (route.view === "settings") {
    main = <Settings section={route.section} onSection={settingsPage} account={account} onAccount={setAccount} settings={settings} onSetting={setSetting}
      models={models} onModel={selectModel} agents={agents} />;
  } else if (route.view === "chat" && opened && chatAgent) {
    main = <Chat key={opened.id} conversation={opened} agent={chatAgent} account={account} models={models} funding={funding}
      paneOpen={pane !== "closed"} onTogglePane={() => setPane(pane === "closed" ? "open" : "closed")}
      onEditAgent={agent => setDialog({ open: true, agent })} onNewTask={newTask} onSettings={settingsPage}
      initialMessage={first?.conversationId === opened.id ? first.message : null} onInitialSent={() => setFirst(null)}
      onChanged={info => { if (info?.archived) { go("#/"); } void loadConversations(); }} />;
  } else if (route.view === "chat") {
    main = null;
  } else {
    main = <Home agents={agents} agentId={agentById.has(homeAgent) ? homeAgent : agents[0]?.id} onAgent={setHomeAgent} models={models} onModel={selectModel} funding={funding}
      onStart={start} onNewAgent={() => setDialog({ open: true, agent: null })} onSettings={settingsPage} />;
  }
  const showPane = route.view === "chat" && pane !== "closed" && opened && chatAgent;
  return (
    <div className="tw-window" data-sidebar={sidebar} data-pane={showPane ? pane : undefined} style={{ "--sidebar-width": width + "px" }}>
      <header className="tw-topbar">
        <button type="button" title={sidebar === "hidden" ? "Show sidebar" : "Hide sidebar"} aria-label={sidebar === "hidden" ? "Show sidebar" : "Hide sidebar"} onClick={() => setSidebar(sidebar === "hidden" ? "shown" : "hidden")}><PanelLeft size={18} strokeWidth={1.6} /></button>
        <button type="button" title="Go back" aria-label="Go back" disabled={!history.back} onClick={() => window.history.back()}><ChevronLeft size={18} strokeWidth={1.6} /></button>
        <button type="button" title="Go forward" aria-label="Go forward" disabled={!history.forward} onClick={() => window.history.forward()}><ChevronRight size={18} strokeWidth={1.6} /></button>
      </header>
      <div className="tw-body">
        <Sidebar account={account} agents={agents} conversations={chatConversations} selectedId={route.id} view={route.view}
          homeAgentId={agentById.has(homeAgent) ? homeAgent : agents[0]?.id}
          usage={<UsageCard funding={funding} chatgpt={chatgpt} onOpen={() => settingsPage("billing")} />}
          onNewTask={() => newTask()} onOpenConversation={conversation => go("#/conversation/" + conversation.id)} onNewChat={newTask}
          onNewAgent={() => setDialog({ open: true, agent: null })} onEditAgent={agent => setDialog({ open: true, agent })}
          onArchiveAgent={archiveAgent} onConversationsChanged={() => void loadConversations()}
          onArchiveConversation={archiveConversation} onReorder={reorder} onSettings={settingsPage} onProfile={() => setProfileOpen(true)}
          onSignOut={() => call("account.signOut").catch(error => toast(error, "error"))} />
        <div className="tw-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" onPointerDown={startResize} onDoubleClick={() => { setWidth(288); write("tw.sidebarWidth", 288); }} />
        <div className="tw-stage">
          <section className="tw-main" aria-label={route.view === "chat" ? opened?.title || "Conversation" : route.view === "settings" ? "Settings" : "Home"}>{main}</section>
          {showPane ? <Pane key={"pane-" + opened.id} conversation={opened} agent={chatAgent} expanded={pane === "full"} onExpand={() => setPane(pane === "full" ? "open" : "full")}
            onClose={() => setPane("closed")} onEditAgent={agent => setDialog({ open: true, agent })} onAgentChanged={loadAgents} onSettings={settingsPage} onStart={start} onArchiveAgent={archiveAgent} /> : null}
        </div>
      </div>
      <AgentDialog open={dialog.open} agent={dialog.agent} onClose={() => setDialog({ open: false, agent: null })}
        onSaved={agent => { const created = !dialog.agent; setDialog({ open: false, agent: null }); void loadAgents().then(() => { if (created) newTask(agent.id); }); }} />
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} account={account} onAccount={setAccount}
        onSignOut={() => { setProfileOpen(false); call("account.signOut").catch(error => toast(error, "error")); }} />
    </div>
  );
}

// First-run setup, drawn by Timewarp's onboarding screen (screens/onboarding.js).
function Onboarding() {
  const host = useRef(null);
  useEffect(() => { if (host.current) window.timewarpMountOnboarding?.(host.current); }, []);
  return <main ref={host} className="timewarp-onboarding-root" />;
}

export function App() {
  const [state, setState] = useState({ loading: true, signedIn: false });
  const [account, setAccount] = useState(null);
  const [settings, setSettings] = useState(null);

  const load = useCallback(async () => {
    const value = await call("settings.get").catch(() => null);
    if (value) { setSettings(value); applyAppearance(value.appearance); }
    const status = await request("state").catch(() => ({ user: null }));
    if (!status.user || status.passwordRecovery) { setAccount(null); setState({ loading: false, signedIn: false }); return; }
    setAccount(await call("account.get").catch(() => ({ user: status.user })));
    const setup = await call("onboarding.status").catch(() => ({ done: true }));
    setState({ loading: false, signedIn: true, onboarding: !setup.done });
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEvent("account.changed", () => { void load().then(() => { if (location.hash === "#/") window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = "#/"; }); });

  if (state.loading) return <div className="tw-splash"><img src="./timewarp-logo.svg" alt="Timewarp" /></div>;
  if (!state.signedIn) return <main id="timewarp-auth-view" className="relative flex h-full w-full items-center justify-center bg-background px-6 py-12 text-foreground" />;
  if (state.onboarding) return <Onboarding />;
  return <ToastProvider><Shell account={account} setAccount={setAccount} settings={settings || {}} setSettings={setSettings} /></ToastProvider>;
}
