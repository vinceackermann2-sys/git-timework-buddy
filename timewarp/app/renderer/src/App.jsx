import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, request, useEvent } from "./api.js";
import { applyAppearance } from "./theme.js";
import { Avatar, ToastProvider, useToast } from "./components/common.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Chat } from "./components/Chat.jsx";
import { Customize, SECTIONS } from "./components/Customize.jsx";
import { AgentDialog } from "./components/AgentDialog.jsx";

function parseRoute() {
  const [, view, id] = (location.hash.replace(/^#\/?/, "") || "").match(/^([a-z]*)\/?(.*)$/) || [];
  if (view === "c" && id) return { view: "chat", id };
  if (view === "customize") return { view: "customize", section: SECTIONS.some(item => item.id === id) ? id : "general" };
  return { view: "home" };
}
const go = hash => { if (location.hash !== hash) location.hash = hash; };

function Home({ agents, onNewChat }) {
  return (
    <section className="tw-main">
      <div className="tw-blank" style={{ marginTop: "16vh" }}>
        <img src="./timewarp-logo.svg" alt="" style={{ width: 54, height: 54 }} />
        <h2>What should we work on?</h2>
        <p>Pick an agent to start a chat. Agents work on this computer, in the browser and across your connected apps.</p>
        <div className="tw-mascots" style={{ justifyContent: "center", marginTop: 8 }}>
          {agents.map(agent => <button key={agent.id} type="button" className="tw-mascot" onClick={() => onNewChat(agent.id)}><Avatar agent={agent} size="large" />{agent.name}</button>)}
        </div>
      </div>
    </section>
  );
}

function Shell({ account, setAccount, settings, setSettings }) {
  const toast = useToast();
  const [route, setRoute] = useState(parseRoute);
  const [agents, setAgents] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [models, setModels] = useState(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState({ open: false, agent: null });
  const refreshTimer = useRef(null);

  const loadAgents = useCallback(() => call("agents.list").then(setAgents).catch(error => toast(error, "error")), [toast]);
  const loadConversations = useCallback(() => call("conversations.list", { search: search.trim() || undefined }).then(setConversations).catch(() => {}), [search]);
  const loadModels = useCallback(() => call("models.list").then(setModels).catch(() => {}), []);
  const refreshSoon = useCallback(() => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => { void loadConversations(); }, 250); }, [loadConversations]);

  useEffect(() => { void loadAgents(); void loadModels(); }, [loadAgents, loadModels]);
  useEffect(() => { const timer = setTimeout(() => void loadConversations(), search ? 200 : 0); return () => clearTimeout(timer); }, [loadConversations, search]);
  useEffect(() => { const change = () => setRoute(parseRoute()); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);

  const agentById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const current = route.view === "chat" ? conversations.find(item => item.id === route.id) : null;
  const [opened, setOpened] = useState(null);
  useEffect(() => {
    if (route.view !== "chat") { setOpened(null); return; }
    if (current) { setOpened(current); return; }
    call("conversations.get", { id: route.id }).then(setOpened).catch(() => go("#/"));
  }, [route.view, route.id, current]);

  useEvent("conversation.event", ({ conversationId, method, params }) => {
    if (["turn/started", "turn/completed", "thread/name/updated", "turn/aborted"].includes(method)) refreshSoon();
    if (method === "turn/completed" && !params.subAgent && !document.hasFocus() && settings?.notifications?.replies !== false && "Notification" in window) {
      const conversation = conversations.find(item => item.id === conversationId);
      const agent = agentById.get(conversation?.agentId);
      const notice = new Notification(agent?.name || "Timewarp", { body: (conversation?.title ? conversation.title + ": " : "") + (params.turn?.status === "completed" ? "Reply ready." : "The reply stopped."), silent: false });
      notice.onclick = () => { window.focus(); go("#/c/" + conversationId); };
    }
  });
  useEvent("history.status", state => { if (state.state === "synced") { void loadAgents(); void loadConversations(); } });
  useEvent("funding.changed", () => void loadModels());

  async function newChat(agentId) {
    const agent = agentId || current?.agentId || opened?.agentId || agents[0]?.id;
    if (!agent) { setDialog({ open: true, agent: null }); return; }
    try {
      const conversation = await call("conversations.create", { agentId: agent });
      setConversations(list => [conversation, ...list]);
      go("#/c/" + conversation.id);
    } catch (error) { toast(error, "error"); }
  }
  function openAgent(agent) {
    const latest = conversations.find(item => item.agentId === agent.id);
    if (latest) go("#/c/" + latest.id); else void newChat(agent.id);
  }
  async function archiveConversation(conversation) {
    try {
      await call("conversations.archive", { id: conversation.id });
      setConversations(list => list.filter(item => item.id !== conversation.id));
      if (route.view === "chat" && route.id === conversation.id) go("#/");
    } catch (error) { toast(error, "error"); }
  }
  async function archiveAgent(agent) {
    if (!window.confirm(`Remove ${agent.name}? Its workspace folder and chats stay on this computer.`)) return;
    try { await call("agents.archive", { id: agent.id }); await loadAgents(); await loadConversations(); }
    catch (error) { toast(error, "error"); }
  }
  async function setSetting(key, value) {
    setSettings(current => ({ ...current, [key]: value }));
    if (key === "appearance") applyAppearance(value);
    try { await call("settings.set", { key, value }); } catch (error) { toast(error, "error"); }
  }
  async function selectModel(choice) {
    try { const selected = await call("models.select", choice); setModels(current => ({ ...current, selected })); }
    catch (error) { toast(error, "error"); }
  }

  const chatConversations = conversations.filter(item => agentById.has(item.agentId));
  let main;
  if (route.view === "customize") {
    main = <Customize section={route.section} onSection={section => go("#/customize/" + section)} account={account} onAccount={setAccount} settings={settings} onSetting={setSetting}
      models={models} onModel={selectModel} agents={agents} onNewAgent={() => setDialog({ open: true, agent: null })} onEditAgent={agent => setDialog({ open: true, agent })} onArchiveAgent={archiveAgent} />;
  } else if (route.view === "chat" && opened && agentById.get(opened.agentId)) {
    main = <Chat key={opened.id} conversation={opened} agent={agentById.get(opened.agentId)} account={account} models={models} onModel={selectModel}
      onChanged={info => { if (info?.archived) { go("#/"); } void loadConversations(); }} />;
  } else {
    main = <Home agents={agents} onNewChat={newChat} />;
  }

  return (
    <div className="tw-app">
      <Sidebar account={account} agents={agents} conversations={chatConversations} selectedId={route.id} view={route.view}
        search={search} onSearch={setSearch}
        onOpenConversation={conversation => go("#/c/" + conversation.id)} onNewChat={newChat} onOpenAgent={openAgent}
        onNewAgent={() => setDialog({ open: true, agent: null })} onEditAgent={agent => setDialog({ open: true, agent })}
        onStarAgent={agent => call("agents.update", { id: agent.id, starred: !agent.starredAt }).then(loadAgents).catch(error => toast(error, "error"))}
        onArchiveAgent={archiveAgent} onOpenWorkspace={agent => call("agents.openWorkspace", { id: agent.id }).catch(error => toast(error, "error"))}
        onArchiveConversation={archiveConversation} onCustomize={section => go("#/customize/" + (section || "general"))}
        onSignOut={() => call("account.signOut").catch(error => toast(error, "error"))} />
      {main}
      <AgentDialog open={dialog.open} agent={dialog.agent} onClose={() => setDialog({ open: false, agent: null })}
        onSaved={agent => { setDialog({ open: false, agent: null }); void loadAgents().then(() => { if (!dialog.agent) void newChat(agent.id); }); }} />
    </div>
  );
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
    setState({ loading: false, signedIn: true });
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEvent("account.changed", () => { void load().then(() => { if (location.hash === "#/") window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = "#/"; }); });

  if (state.loading) return <div className="tw-splash"><img src="./timewarp-logo.svg" alt="Timewarp" /></div>;
  if (!state.signedIn) return <main id="timewarp-auth-view" className="relative flex h-full w-full items-center justify-center bg-background px-6 py-12 text-foreground" />;
  return <ToastProvider><Shell account={account} setAccount={setAccount} settings={settings || {}} setSettings={setSettings} /></ToastProvider>;
}
