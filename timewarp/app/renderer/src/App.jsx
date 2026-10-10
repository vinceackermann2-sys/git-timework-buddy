import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, PanelLeft, Pencil } from "lucide-react";
import { call, initials, request, useEvent } from "./api.js";
import { applyAppearance } from "./theme.js";
import { SIDEBAR, byActivity, shortcutFor, sidebarCollapses, sidebarWidth } from "./shell.mjs";
import { ConfirmProvider, Dialog, Tip, ToastProvider, modKey, useConfirm, useToast } from "./components/common.jsx";
import { OrgPicture, SearchDialog, Sidebar, UsageCard } from "./components/Sidebar.jsx";
import { Home } from "./components/Home.jsx";
import { Chat, FeedbackDialog } from "./components/Chat.jsx";
import { ALIASES, CreateOrganizationDialog, InviteDialog, SECTIONS, Settings, sectionHref, uploadPicture } from "./components/Settings.jsx";
import { AgentDialog } from "./components/AgentDialog.jsx";
import { Pane } from "./components/Pane.jsx";

// What a new agent is asked first, so it opens with an introduction, as before.
// The chat doesn't show the request (turns.mjs), only the agent's introduction.
const INTRODUCTION = "<agent-introduction>This is a new chat with a new agent. Introduce yourself: who you are, what you can help with, and how we should work together.</agent-introduction>";
// Below this width the sidebar slides over the page instead of sitting beside it, as before.
const NARROW = "(max-width: 767px)";
function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), change = () => setMatches(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return matches;
}

const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };
const readList = key => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };

function parseRoute() {
  const [, view, id] = (location.hash.replace(/^#\/?/, "") || "").match(/^([a-z]*)\/?(.*)$/) || [];
  // Chats are at #/conversation/<id>, as in the previous app (#/c/<id> also works).
  if ((view === "conversation" || view === "c") && id) return { view: "chat", id };
  if (view === "customize" || view === "settings") {
    // A second part opens a dialog there: organization/new and organization/invite.
    const [name, action] = id.split("/");
    const section = ALIASES[name] || name;
    // Unknown and unlisted sections show General, as in the previous app.
    return SECTIONS.some(item => item.id === section && !item.hidden) ? { view: "settings", section, action: action || null } : { view: "settings", section: "general", action: null };
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

// The profile, as before: a large picture with Change picture, the name, and
// Cancel and Save. A new picture is shown at once and saved with Save.
function ProfileDialog({ open, onClose, account, onAccount }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picture = useRef(null);
  const preview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (open) { setName(account?.user?.name || ""); setFile(null); setError(""); setBusy(false); } }, [open]);
  const choose = selected => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type)) { setFile(null); setError("Choose a JPEG, PNG, or WebP image."); return; }
    setFile(selected); setError("");
  };
  const save = async event => {
    event.preventDefault();
    const value = name.trim();
    if (!value) { setError("Enter your name."); return; }
    if (value === account?.user?.name && !file) { onClose(); return; }
    setBusy(true); setError("");
    try {
      const imageId = file ? await uploadPicture(file) : undefined;
      onAccount(await call("profile.update", { ...(value !== account?.user?.name ? { name: value } : {}), ...(imageId ? { imageId } : {}) }));
      onClose();
    } catch (failure) { setError(failure?.message || String(failure)); }
    finally { setBusy(false); }
  };
  const image = preview || account?.user?.image;
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} label="Profile" className="tw-profile-dialog">
      <form className="tw-import" onSubmit={save}>
        <div className="tw-profile-picture">
          <span className="tw-profile-face-large">{image ? <img src={image} alt="" /> : initials(name || account?.user?.email)}</span>
          <button type="button" className="tw-icon-button tw-round" aria-label="Change picture" title="Change picture" disabled={busy} onClick={() => picture.current?.click()}><Pencil size={15} /></button>
          <input ref={picture} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) choose(selected); }} />
        </div>
        <label className="tw-field"><span>Name</span><input className="tw-input" autoFocus value={name} placeholder="Your name" maxLength={100} autoComplete="name" disabled={busy} onChange={event => setName(event.target.value)} /></label>
        {error ? <p className="tw-alert" role="alert">{error}</p> : null}
        <div className="tw-dialog-actions">
          <button type="button" className="tw-btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="tw-btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}

// An invitation to another organization, checked every minute, as in the
// previous app: "Join <organization>?" with Not now and Join.
function Invitation({ onAccount }) {
  const [pending, setPending] = useState([]);
  const [dismissed, setDismissed] = useState(() => readList("tw.dismissedInvitations"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => call("organizations.pending").then(list => setPending(Array.isArray(list) ? list : [])).catch(() => {}), []);
  useEffect(() => { void load(); const timer = setInterval(load, 60 * 1000); return () => clearInterval(timer); }, [load]);
  const invite = pending.find(item => item?.id && !dismissed.includes(item.id)) || null;
  const name = invite?.organization?.name || "an organization";
  const inviter = invite?.inviter?.name || invite?.inviter?.email || "Someone";
  const dismiss = () => { if (!invite || busy) return; const next = [...dismissed, invite.id]; setDismissed(next); write("tw.dismissedInvitations", JSON.stringify(next)); setError(""); };
  const join = () => {
    setBusy(true); setError("");
    call("organizations.acceptInvite", { invitationId: invite.id }).then(value => { onAccount(value); return load(); })
      .catch(failure => setError(failure?.message || String(failure))).finally(() => setBusy(false));
  };
  return (
    <Dialog open={!!invite} onClose={dismiss} label={"Join " + name + "?"}>
      {invite ? (
        <>
          <div className="tw-dialog-head">
            <div><OrgPicture organization={invite.organization} /><h2>Join {name}?</h2><p>{inviter} invited you to {name}. Joining adds you to its members. Your chats and AI credits stay personal.</p></div>
          </div>
          {error ? <p className="tw-alert" role="alert">{error}</p> : null}
          <div className="tw-dialog-actions">
            <button type="button" className="tw-btn" disabled={busy} onClick={dismiss}>Not now</button>
            <button type="button" className="tw-btn primary" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join"}</button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

function Shell({ account, setAccount, settings, setSettings }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [route, setRoute] = useState(parseRoute);
  const [agents, setAgents] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [models, setModels] = useState(null);
  const [funding, setFunding] = useState(null);
  const [chatgpt, setChatgpt] = useState(null);
  const [dialog, setDialog] = useState({ open: false, agent: null });
  const [profileOpen, setProfileOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [agentsReady, setAgentsReady] = useState(false);
  // Automations, to warn before archiving a chat one runs in.
  const [automations, setAutomations] = useState([]);
  const [homeAgent, setHomeAgentState] = useState(() => read("tw.agent", ""));
  // Each chat remembers whether its pane is open, as in the previous app; new chats start without it.
  const [pane, setPaneState] = useState(() => { const start = parseRoute(); return start.view === "chat" && read("tw.pane." + start.id, "closed") === "open" ? "open" : "closed"; });
  // How much of the stage the pane takes, dragged at the divider (half by default).
  const [split, setSplit] = useState(() => Math.min(0.8, Math.max(0.2, Number(read("tw.paneSplit", 0.5)) || 0.5)));
  const stage = useRef(null);
  const [sidebar, setSidebarState] = useState(() => read("tw.sidebar", "shown"));
  const [width, setWidth] = useState(() => sidebarWidth(read("tw.sidebarWidth", SIDEBAR.initial)));
  // Narrow windows: the sidebar slides over the page and closes on navigation.
  const narrow = useMedia(NARROW);
  const [sliding, setSliding] = useState(false);
  const [first, setFirst] = useState(null);
  // Chats with a reply in progress ("Agent is working" in the sidebar).
  const [running, setRunning] = useState(() => new Set());
  // Dialogs the account menu opens over the current page, and Send feedback (Ctrl/⌘+Alt+F).
  const [orgDialog, setOrgDialog] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // A message picked in search, shown once its chat has loaded it.
  const [reveal, setReveal] = useState(null);
  // The pane's tool to show for a chat, such as the agent page from the sidebar's Edit.
  const [paneTool, setPaneTool] = useState(null);
  // Ctrl/⌘+W asks the open pane to close its file or tab (see Pane's onRegisterClose).
  const paneClose = useRef(null);
  const refreshTimer = useRef(null);
  const history = useHistoryButtons();

  const setHomeAgent = id => { setHomeAgentState(id); write("tw.agent", id); };
  const setPane = value => { setPaneState(value); if (value !== "full" && route.view === "chat") write("tw.pane." + route.id, value === "open" ? "open" : "closed"); };
  const setSidebar = value => { setSidebarState(value); write("tw.sidebar", value); };
  const toggleSidebar = () => { if (narrow) setSliding(value => !value); else setSidebar(sidebar === "hidden" ? "shown" : "hidden"); };
  useEffect(() => { setSliding(false); }, [route.view, route.id, route.section, narrow]);
  useEffect(() => {
    if (!sliding) return;
    const escape = event => { if (event.key === "Escape" && !document.querySelector("dialog[open], .tw-menu")) setSliding(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [sliding]);
  const loadRunning = useCallback(() => call("conversations.running").then(ids => setRunning(new Set(ids))).catch(() => {}), []);
  useEffect(() => { void loadRunning(); }, [loadRunning]);
  const loadAgents = useCallback(() => call("agents.list").then(list => { setAgents(list); setAgentsReady(true); }).catch(error => toast(error, "error")), [toast]);
  const loadAutomations = useCallback(() => call("automations.list").then(setAutomations).catch(() => {}), []);
  const loadConversations = useCallback(() => call("conversations.list").then(setConversations).catch(() => {}), []);
  const loadModels = useCallback(() => call("models.list").then(setModels).catch(() => {}), []);
  const loadFunding = useCallback(() => {
    call("funding.get").then(setFunding).catch(() => {});
    request("chatgptDetails").then(setChatgpt).catch(() => {});
  }, []);
  const refreshSoon = useCallback(() => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => { void loadConversations(); }, 250); }, [loadConversations]);

  // Usage refreshes every 30 seconds and when the window comes back, as in the previous app.
  useEffect(() => {
    void loadAgents(); void loadModels(); loadFunding();
    const timer = setInterval(loadFunding, 30 * 1000);
    window.addEventListener("focus", loadFunding);
    return () => { clearInterval(timer); window.removeEventListener("focus", loadFunding); };
  }, [loadAgents, loadModels, loadFunding]);
  // After a crash or forced close, as in the previous app.
  useEffect(() => { call("app.info").then(info => { if (info.previousSessionUnclean) toast({ title: "Timewarp closed unexpectedly.", body: "Review your conversations before continuing." }, "warning"); }).catch(() => {}); }, []);
  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { void loadAutomations(); }, [loadAutomations]);
  useEvent("automations.changed", () => void loadAutomations());
  useEffect(() => { const change = () => setRoute(parseRoute()); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  useEffect(() => { if (route.view === "chat") setPaneState(read("tw.pane." + route.id, "closed") === "open" ? "open" : "closed"); }, [route.view, route.id]);
  useEffect(() => { const reload = () => void loadConversations(); window.addEventListener("tw:conversations", reload); return () => window.removeEventListener("tw:conversations", reload); }, [loadConversations]);

  const agentById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const current = route.view === "chat" ? conversations.find(item => item.id === route.id) : null;
  const [opened, setOpened] = useState(null);
  useEffect(() => {
    if (route.view !== "chat") { setOpened(null); return; }
    if (current) { setOpened(current); return; }
    call("conversations.get", { id: route.id }).then(setOpened).catch(() => go("#/"));
  }, [route.view, route.id, current]);
  // A chat whose agent was archived or removed has nothing to show: go home.
  useEffect(() => { if (route.view === "chat" && opened?.id === route.id && agentsReady && !agentById.has(opened.agentId)) go("#/"); }, [route.view, route.id, opened, agentsReady, agentById]);

  // Reply notifications are shown by the main process; it sends app.navigate
  // when one (or the macOS Settings… menu item) is clicked.
  useEvent("conversation.event", ({ conversationId, method, params }) => {
    if (["turn/started", "turn/completed", "thread/name/updated", "turn/aborted", "item/completed"].includes(method)) refreshSoon();
    if (method === "turn/completed" && !params.subAgent) loadFunding();
    if (params?.subAgent) return;
    if (method === "turn/started") setRunning(current => current.has(conversationId) ? current : new Set(current).add(conversationId));
    if (method === "turn/completed" || method === "turn/aborted") setRunning(current => { if (!current.has(conversationId)) return current; const next = new Set(current); next.delete(conversationId); return next; });
  });
  useEvent("app.navigate", ({ route: target } = {}) => { if (typeof target === "string" && target.startsWith("#/")) go(target); });
  useEvent("history.status", state => { if (state.state === "synced") { void loadAgents(); void loadConversations(); void loadRunning(); } });
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
  // A new agent opens in its first chat and introduces itself, as before.
  async function introduce(agent) {
    setHomeAgent(agent.id);
    try { await start(agent.id, { text: INTRODUCTION }); }
    catch (error) { toast(error, "error"); newTask(agent.id); }
  }
  function newTask(agentId) {
    if (agentId) setHomeAgent(agentId);
    go("#/");
    setTimeout(() => document.querySelector(".tw-home textarea")?.focus(), 50);
  }
  // The agent page in a chat's pane, as the sidebar's Edit opened it before:
  // the open chat when it's the agent's, otherwise its latest chat. An agent
  // without chats opens its dialog.
  function editAgent(agent) {
    const chat = route.view === "chat" && opened?.agentId === agent.id ? opened : [...conversations].filter(item => item.agentId === agent.id).sort(byActivity)[0];
    if (!chat) { setDialog({ open: true, agent }); return; }
    write("tw.pane." + chat.id, "open");
    setPaneTool({ conversationId: chat.id, tool: "agent", at: Date.now() });
    if (route.view === "chat" && route.id === chat.id) { if (pane === "closed") setPane("open"); }
    else go("#/conversation/" + chat.id);
  }
  // As before, a chat an automation runs in asks first; archiving it pauses its automations.
  async function archiveConversation(conversation) {
    const linked = automations.filter(item => item.conversationId === conversation.id);
    if (linked.length && !await confirm({ title: "Archive conversation?", body: "This conversation has an automation. Archiving it will stop the automation from running.", action: "Archive conversation", danger: true })) return;
    try {
      for (const item of linked.filter(entry => entry.enabled)) await call("automations.update", { id: item.id, enabled: false });
      await call("conversations.archive", { id: conversation.id });
      setConversations(list => list.filter(item => item.id !== conversation.id));
      if (route.view === "chat" && route.id === conversation.id) go("#/");
    } catch (error) { toast(error, "error"); }
  }
  // Archived at once, as before; its workspace folder and chats stay on this computer.
  async function archiveAgent(agent) {
    try {
      await call("agents.archive", { id: agent.id });
      // Its open chat goes with it.
      if (route.view === "chat" && opened?.agentId === agent.id) go("#/");
      await loadAgents(); await loadConversations();
    } catch (error) { toast(error, "error"); }
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
  const settingsPage = section => go(sectionHref(section));
  function startSplit(event) {
    event.preventDefault();
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    // The chat keeps 380px and the pane 360px, as their minimum widths say.
    const share = x => Math.min(1 - 380 / box.width, Math.max(360 / box.width, (box.right - x) / box.width));
    const move = moveEvent => setSplit(share(moveEvent.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setSplit(value => { write("tw.paneSplit", value); return value; }); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  // 220–360px; dragged below 110px the sidebar closes (and opens again when
  // dragged back), as before. Its width is kept only when it stays open.
  function startResize(event) {
    event.preventDefault();
    const before = width;
    let open = true;
    document.documentElement.dataset.resizing = "sidebar";
    const move = moveEvent => {
      const closes = sidebarCollapses(moveEvent.clientX);
      if (closes === open) { open = !closes; setSidebar(open ? "shown" : "hidden"); }
      if (open) setWidth(sidebarWidth(moveEvent.clientX));
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.resizing;
      setWidth(value => { const kept = open ? value : before; write("tw.sidebarWidth", kept); return kept; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const chatConversations = conversations.filter(item => agentById.has(item.agentId));
  const chatAgent = opened && agentById.get(opened.agentId);
  // A file card in the chat opens the file in the pane's Files, as before. The
  // request names its chat and is dropped once the pane opens it or the chat changes.
  const [paneFile, setPaneFile] = useState(null);
  useEffect(() => { setPaneFile(current => current && current.conversationId !== route.id ? null : current); }, [route.id]);
  useEffect(() => {
    const openFile = event => {
      const { detail } = event;
      if (route.view !== "chat" || route.id !== detail?.conversationId || !chatAgent || chatAgent.id !== detail.agentId || !detail.path) return;
      event.preventDefault();
      if (pane === "closed") setPane("open");
      setPaneFile({ conversationId: detail.conversationId, agentId: detail.agentId, path: detail.path, at: Date.now() });
    };
    window.addEventListener("tw:open-file", openFile);
    return () => window.removeEventListener("tw:open-file", openFile);
  }, [route.view, route.id, pane, chatAgent?.id]);

  // Keyboard shortcuts, as in the previous app (shell.mjs has the keys). They
  // wait while a dialog is open.
  const shortcut = useRef(null);
  shortcut.current = action => {
    const inChat = route.view === "chat" && opened && chatAgent;
    if (action === "search") setSearching(true);
    else if (action === "newTask") newTask();
    else if (action === "back") window.history.back();
    else if (action === "forward") window.history.forward();
    else if (action === "sidebar") toggleSidebar();
    else if (action === "settings") settingsPage("general");
    else if (action === "feedback") setFeedbackOpen(true);
    else if (action === "pane" && inChat) setPane(pane === "closed" ? "open" : "closed");
    else if (action === "address" && inChat) {
      if (pane === "closed") setPane("open");
      setTimeout(() => document.querySelector(".tw-pane .tw-address")?.focus(), pane === "closed" ? 80 : 0);
    } else return false;
    return true;
  };
  useEffect(() => {
    const mac = window.tw?.platform === "darwin";
    const keydown = event => {
      if (event.defaultPrevented || event.isComposing || document.querySelector("dialog[open]")) return;
      const action = shortcutFor(event, mac);
      if (action && shortcut.current(action)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  // Ctrl/⌘+W (sent by the main process): the open pane closes its file, the
  // agent tab or the browser tab; with nothing to close, Timewarp asks to quit.
  const closing = useRef(false);
  useEvent("app.closeShortcut", async () => {
    if (closing.current || document.querySelector("dialog[open]")) return;
    closing.current = true;
    try {
      if (showPane && paneClose.current && await paneClose.current()) return;
      if (await confirm({ title: "Quit Timewarp?", body: "Are you sure you want to quit the app?", action: "Quit" })) await call("app.quit");
    } catch (error) { toast(error, "error"); }
    finally { closing.current = false; }
  });

  // A message picked in search: the chat shows it (scrolled to and flashed)
  // once its history has loaded; Chat.jsx answers tw:show-message.
  useEffect(() => {
    if (!reveal || route.view !== "chat" || route.id !== reveal.conversationId) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const event = new CustomEvent("tw:show-message", { detail: { conversationId: reveal.conversationId, messageId: reveal.messageId }, cancelable: true });
      window.dispatchEvent(event);
      if (event.defaultPrevented || Date.now() - started > 10000) { clearInterval(timer); setReveal(null); }
    }, 200);
    return () => clearInterval(timer);
  }, [reveal, route.view, route.id]);
  const openFromSearch = (conversation, messageId) => {
    if (messageId) setReveal({ conversationId: conversation.id, messageId, at: Date.now() });
    go("#/conversation/" + conversation.id);
  };
  // The account menu: switching organization goes home, as before.
  const switchOrganization = organizationId => call("organizations.setActive", { organizationId }).then(value => { setAccount(value); go("#/"); })
    .catch(error => toast("Could not switch organization: " + (error?.message || error), "error"));
  const organization = account?.activeOrganization;

  let main;
  if (route.view === "settings") {
    main = <Settings section={route.section} action={route.action} onActionDone={() => { window.history.replaceState(window.history.state, "", sectionHref(route.section)); setRoute(parseRoute()); }} onSection={settingsPage} account={account} onAccount={setAccount} settings={settings} onSetting={setSetting}
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
      automations={automations} conversations={chatConversations} onStart={start} onNewAgent={() => setDialog({ open: true, agent: null })} onSettings={settingsPage} />;
  }
  const showPane = route.view === "chat" && pane !== "closed" && opened && chatAgent;
  const sidebarShown = narrow ? sliding : sidebar !== "hidden";
  return (
    <div className="tw-window" data-sidebar={narrow ? "overlay" : sidebar} data-sliding={narrow && sliding ? "" : undefined} data-pane={showPane ? pane : undefined} style={{ "--sidebar-width": width + "px" }}>
      <header className="tw-topbar">
        <Tip label={sidebarShown ? "Hide sidebar" : "Show sidebar"} keys={[modKey(), "B"]}><button type="button" aria-label={sidebarShown ? "Hide sidebar" : "Show sidebar"} aria-expanded={narrow ? sliding : undefined} onClick={toggleSidebar}><PanelLeft size={18} strokeWidth={1.6} /></button></Tip>
        <Tip label="Go back"><button type="button" aria-label="Go back" disabled={!history.back} onClick={() => window.history.back()}><ChevronLeft size={18} strokeWidth={1.6} /></button></Tip>
        <Tip label="Go forward"><button type="button" aria-label="Go forward" disabled={!history.forward} onClick={() => window.history.forward()}><ChevronRight size={18} strokeWidth={1.6} /></button></Tip>
      </header>
      <div className="tw-body">
        {narrow && sliding ? <div className="tw-scrim" aria-hidden="true" onMouseDown={() => setSliding(false)} /> : null}
        <Sidebar account={account} agents={agents} conversations={chatConversations} selectedId={route.id} view={route.view}
          homeAgentId={agentById.has(homeAgent) ? homeAgent : agents[0]?.id} running={running} automations={automations}
          usage={<UsageCard funding={funding} chatgpt={chatgpt} onOpen={() => settingsPage("billing")} />}
          onNewTask={() => newTask()} onNewChat={newTask}
          onNewAgent={() => setDialog({ open: true, agent: null })} onEditAgent={editAgent}
          onArchiveAgent={archiveAgent} onConversationsChanged={() => void loadConversations()}
          onArchiveConversation={archiveConversation} onReorder={reorder} onSettings={settingsPage} onProfile={() => setProfileOpen(true)} onSearch={() => setSearching(true)}
          onSwitchOrganization={switchOrganization} onCreateOrganization={() => setOrgDialog("create")} onInviteMembers={() => setOrgDialog("invite")}
          onSignOut={() => call("account.signOut").catch(error => toast(error, "error"))} />
        <div className="tw-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={SIDEBAR.min} aria-valuemax={SIDEBAR.max} aria-valuenow={width}
          onPointerDown={startResize} onDoubleClick={() => { setWidth(SIDEBAR.initial); write("tw.sidebarWidth", SIDEBAR.initial); }} />
        <div className="tw-stage" ref={stage} style={{ "--pane-share": split }}>
          <section className="tw-main" aria-label={route.view === "chat" ? opened?.title || "Conversation" : route.view === "settings" ? "Settings" : "Home"}>{main}</section>
          {showPane && pane === "open" ? <div className="tw-pane-resizer" role="separator" aria-label="Resize pane" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((1 - split) * 100)} onPointerDown={startSplit} onDoubleClick={() => { setSplit(0.5); write("tw.paneSplit", 0.5); }} /> : null}
          {showPane ? <Pane key={"pane-" + opened.id} conversation={opened} agent={chatAgent} expanded={pane === "full"} narrow={narrow} onExpand={() => setPane(pane === "full" ? "open" : "full")}
            onClose={() => setPane("closed")} onEditAgent={agent => setDialog({ open: true, agent })} onAgentChanged={loadAgents} onSettings={settingsPage} onStart={start} onArchiveAgent={archiveAgent}
            openFile={paneFile} onFileOpened={() => setPaneFile(null)} openTool={paneTool?.conversationId === opened.id ? paneTool : null} onToolOpened={() => setPaneTool(null)}
            onRegisterClose={handler => { paneClose.current = handler; }} /> : null}
        </div>
      </div>
      <AgentDialog open={dialog.open} agent={dialog.agent} onClose={() => setDialog({ open: false, agent: null })}
        onSaved={agent => { const created = !dialog.agent; setDialog({ open: false, agent: null }); void loadAgents().then(() => { if (created) void introduce(agent); }); }} />
      <SearchDialog open={searching} onClose={() => setSearching(false)} agents={agents} agentById={agentById} conversations={chatConversations} onOpenConversation={openFromSearch} onAgent={newTask} />
      <Invitation onAccount={setAccount} />
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} account={account} onAccount={setAccount} />
      {organization ? <InviteDialog open={orgDialog === "invite"} organization={organization} onClose={() => setOrgDialog(null)} onInvited={() => { setOrgDialog(null); settingsPage("organization"); window.dispatchEvent(new Event("tw:members")); }} /> : null}
      <CreateOrganizationDialog open={orgDialog === "create"} current={organization} onClose={() => setOrgDialog(null)} onCreated={value => { setAccount(value); setOrgDialog(null); settingsPage("organization"); }} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} conversationId={route.view === "chat" ? route.id : null} />
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
  // Settings → General → Run setup again shows the first-run screens.
  useEffect(() => { const again = () => void load(); window.addEventListener("tw:setup", again); return () => window.removeEventListener("tw:setup", again); }, [load]);
  useEvent("account.changed", () => { void load().then(() => { if (location.hash === "#/") window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = "#/"; }); });

  if (state.loading) return <div className="tw-splash"><img src="./timewarp-logo.svg" alt="Timewarp" /></div>;
  if (!state.signedIn) return <main id="timewarp-auth-view" className="relative flex h-full w-full items-center justify-center bg-background px-6 py-12 text-foreground" />;
  if (state.onboarding) return <Onboarding />;
  return <ToastProvider><ConfirmProvider><Shell account={account} setAccount={setAccount} settings={settings || {}} setSettings={setSettings} /></ConfirmProvider></ToastProvider>;
}
