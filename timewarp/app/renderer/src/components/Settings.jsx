import React, { useEffect, useRef, useState } from "react";
import { Blocks, BookMarked, Brain, Building2, CalendarClock, ChevronDown, CreditCard, Ellipsis, Globe, KeyRound, LayoutGrid, Monitor, Moon, Pencil, Plus, Search, Settings2, Sun, Trash2, TriangleAlert, UserPlus, UserRound, X } from "lucide-react";
import { presets, hexToAccent } from "../../../../shared/appearance.cjs";
import { call, initials, relativeTime, request, useEvent } from "../api.js";
import { Avatar, Dialog, Menu, PageHead, Row, SearchField, Select, Switch, useToast } from "./common.jsx";
import { AppIcon, ModelPicker, useApps } from "./Composer.jsx";
import { Memories, Skills } from "./Knowledge.jsx";
import { Automations } from "./Automations.jsx";
import { McpServers } from "./Mcp.jsx";
import { Vault } from "./Vault.jsx";

export const GROUPS = [
  { label: "Preferences", items: [{ id: "general", label: "General", icon: Settings2 }] },
  { label: "Capabilities", items: [
    { id: "tools", label: "Tools", icon: Blocks }, { id: "browser", label: "Browser", icon: Globe }, { id: "vault", label: "Vault", icon: KeyRound },
    { id: "memories", label: "Memories", icon: Brain }, { id: "skills", label: "Skills", icon: BookMarked }, { id: "automations", label: "Automations", icon: CalendarClock, hidden: true },
  ] },
  { label: "Workspace", items: [{ id: "organization", label: "Organization", icon: Building2 }, { id: "billing", label: "Billing", icon: CreditCard }] },
];
export const SECTIONS = GROUPS.flatMap(group => group.items);
// Section addresses from earlier versions.
// General lives at #/customize/settings, as in the previous app.
export const sectionHref = id => "#/customize/" + (!id || id === "general" ? "settings" : id);
export const ALIASES = { settings: "general", colors: "general", models: "general", about: "general", agents: "general", memory: "memories", apps: "tools" };

const sameAccent = (a, b) => a && b && Math.abs(a.hue - b.hue) < 0.5 && Math.abs(a.saturation - b.saturation) < 0.01 && Math.abs(a.lightness - b.lightness) < 0.01;
const accentCss = accent => accent && Number.isFinite(accent.hue) ? `hsl(${accent.hue} ${Math.round((accent.saturation ?? 1) * 100)}% ${Math.round((accent.lightness ?? 0.9) * 100)}%)` : "var(--theme-accent)";

function ChatGptRow() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => request("chatgptDetails").then(setState).catch(() => setState(null));
  useEffect(() => { void load(); }, []);
  useEvent("funding.changed", () => void load());
  const connected = state && state.status !== "disconnected";
  const allowed = state?.funding?.subscriptionAllowed !== false;
  const description = !state ? "…" : !allowed ? "Your plan uses Timewarp AI credits. A ChatGPT plan can power AI usage on the Free plan."
    : state.status === "available" ? `Connected${state.account?.email ? " as " + state.account.email : ""}${state.account?.planType ? ` (${state.account.planType})` : ""}` : state.status === "reauth_required" ? "Sign in again to keep using your ChatGPT plan" : "Not connected";
  const run = action => { setBusy(true); request(action).then(() => { if (action === "connectChatgpt") toast("Finish connecting ChatGPT in your browser."); return load(); }).catch(error => toast(error, "error")).finally(() => setBusy(false)); };
  return (
    <Row title="ChatGPT" description={description}>
      {allowed ? (connected && state.status === "available"
        ? <button type="button" className="tw-btn" disabled={busy} onClick={() => { if (window.confirm("Disconnect your ChatGPT plan from Timewarp?")) run("disconnectChatgpt"); }}>Disconnect</button>
        : <button type="button" className="tw-btn" disabled={busy || !state} onClick={() => run("connectChatgpt")}>{state?.status === "reauth_required" ? "Reconnect" : "Connect"}</button>) : null}
    </Row>
  );
}

function Archived({ open, onClose }) {
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState("");
  const toast = useToast();
  useEffect(() => { if (open) { setQuery(""); call("conversations.list", { archived: true }).then(setItems).catch(error => toast(error, "error")); } }, [open]);
  const needle = query.trim().toLowerCase();
  const shown = (items || []).filter(conversation => !needle || (conversation.title || "New conversation").toLowerCase().includes(needle));
  return (
    <Dialog open={open} onClose={onClose} className="tw-archived-dialog" title="Archived conversations" description="Unarchive a conversation to return it to the sidebar.">
      <label className="tw-dialog-search"><Search size={16} /><input className="tw-input" value={query} placeholder="Search archived conversations..." aria-label="Search archived conversations" onChange={event => setQuery(event.target.value)} /></label>
      {items === null ? <p className="tw-hint">Loading…</p> : shown.length ? (
        <div className="tw-archived-list">
          {shown.map(conversation => (
            <div key={conversation.id} className="tw-archived-row">
              <div><p>{conversation.title || "New conversation"}</p><p className="when">Last active {relativeTime(conversation.lastActivityAt)}</p></div>
              <button type="button" className="tw-btn" onClick={() => call("conversations.archive", { id: conversation.id, archived: false }).then(() => { setItems(list => list.filter(item => item.id !== conversation.id)); window.dispatchEvent(new Event("tw:conversations")); }).catch(error => toast(error, "error"))}>Unarchive</button>
            </div>
          ))}
        </div>
      ) : <p className="tw-hint">{needle ? "No archived conversations match your search." : "No archived conversations."}</p>}
    </Dialog>
  );
}

function General({ settings, onSetting, models, onModel, agents }) {
  const toast = useToast();
  const [colors, setColors] = useState(false);
  const [dialog, setDialog] = useState(null);
  const appearance = settings.appearance || {};
  const setAppearance = patch => onSetting("appearance", { ...appearance, ...patch });
  const privateMode = settings.privacy?.mode === "private";
  return (
    <div className="tw-page">
      <PageHead title="General" subtitle="Configure preferences" />
      <div className="tw-rows-card">
        <Row title="Theme" description="Match your system settings or use a fixed theme">
          <Select label="Theme" value={appearance.scheme || "system"} onChange={scheme => setAppearance({ scheme })} width={170}
            options={[{ value: "system", label: "System", icon: <Monitor size={16} /> }, { value: "light", label: "Light", icon: <Sun size={16} /> }, { value: "dark", label: "Dark", icon: <Moon size={16} /> }]} />
        </Row>
        <Row title="Colors" description="Pick a color and radiance">
          <button type="button" className="tw-color-trigger" aria-expanded={colors} aria-label="Colors" onClick={() => setColors(value => !value)}><i style={{ background: accentCss(appearance.accent) }} /><ChevronDown size={16} /></button>
        </Row>
        {colors ? (
          <div className="tw-color-editor">
            <div className="tw-swatches">
              {presets.map(preset => {
                const accent = hexToAccent(preset.hex);
                return <button key={preset.hex} type="button" className="tw-swatch" aria-pressed={!!sameAccent(accent, appearance.accent)} onClick={() => setAppearance({ accent })}><i style={{ background: preset.hex }} /><span>{preset.name}</span></button>;
              })}
            </div>
            <label className="tw-field"><span>Radiance</span><input className="tw-range" type="range" min="0" max="1" step="0.05" value={Number(appearance.radiance ?? 0.5)} onChange={event => setAppearance({ radiance: Number(event.target.value) })} /></label>
            <label className="tw-check"><input type="checkbox" checked={appearance.texture?.type === "dots" && appearance.texture.step > 0} onChange={event => setAppearance({ texture: { type: "dots", step: event.target.checked ? 16 : 0 } })} /><span>Dotted texture</span></label>
          </div>
        ) : null}
        <Row title="Model" description="LLM used for new conversations. Existing conversations keep their original model."><ModelPicker models={models} onSelect={onModel} up={false} /></Row>
        <ChatGptRow />
        <Row title="Privacy Mode" description="Pauses cloud chat-history synchronization. Your model requests still use the cloud. Files, memory, browser profiles, cookies and the vault stay on this device.">
          <Switch label="Privacy Mode" checked={privateMode} onChange={value => onSetting("privacy", { ...settings.privacy, mode: value ? "private" : "standard" })} />
        </Row>
        <Row title="Archived conversations" description="View and unarchive conversations removed from the sidebar"><button type="button" className="tw-btn" onClick={() => setDialog("archived")}>Manage</button></Row>
        <Row title="Memory" description="Allow memory reads and writes for all agents">
          <Select label="Memory" value={({ disabled: "none", read: "read", write: "write", none: "none" })[settings.memory?.mode] || "enabled"} width={160} onChange={mode => onSetting("memory", { ...settings.memory, mode })}
            options={[{ value: "enabled", label: "Enabled" }, { value: "read", label: "Read only" }, { value: "write", label: "Write only" }, { value: "none", label: "None" }]} />
        </Row>
      </div>
      <Archived open={dialog === "archived"} onClose={() => setDialog(null)} agents={agents} />
    </div>
  );
}

// One app: its connected accounts and which agents can use them.
function AppDetails({ app, agents, onClose }) {
  const [access, setAccess] = useState({});
  const toast = useToast();
  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    Promise.all(agents.map(agent => call("integrations.getAccess", { agentId: agent.id }).then(value => [agent.id, value.items ?? null]).catch(() => [agent.id, null])))
      .then(entries => { if (!cancelled) setAccess(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [app?.id, app?.accounts?.length]);
  if (!app) return null;
  const allowed = (agentId, account) => access[agentId] == null || access[agentId].some(item => item.integrationId === app.id && item.accountId === account.id);
  async function toggle(agentId, account, value) {
    // Accounts of every app this agent may use now.
    const all = (await call("integrations.list", {})).items.flatMap(item => (item.accounts || []).map(entry => ({ integrationId: item.id, accountId: entry.id })));
    const current = access[agentId] == null ? all : access[agentId].map(item => ({ integrationId: item.integrationId, accountId: item.accountId }));
    const next = value ? [...current, { integrationId: app.id, accountId: account.id }] : current.filter(item => item.integrationId !== app.id || item.accountId !== account.id);
    const items = next.length >= all.length && all.every(entry => next.some(item => item.integrationId === entry.integrationId && item.accountId === entry.accountId)) ? null
      : next.map(item => ({ kind: "integration", owner: "user", ...item }));
    const previous = access[agentId];
    setAccess(state => ({ ...state, [agentId]: items }));
    try { await call("integrations.setAccess", { agentId, items }); } catch (error) { setAccess(state => ({ ...state, [agentId]: previous })); toast(error, "error"); }
  }
  return (
    <>
      <div className="tw-list-panel">
        {app.accounts.map(account => (
          <div key={account.id} className="tw-list-row compact">
            <span className="tw-face">{initials(account.displayName).slice(0, 1)}</span>
            <div className="grow"><strong>{account.displayName}</strong><span className="desc">{agents.filter(agent => allowed(agent.id, account)).map(agent => agent.name).join(", ") || "No agents"}</span></div>
            <button type="button" className="tw-btn" onClick={() => { if (window.confirm(`Disconnect ${account.displayName}?`)) call("integrations.disconnect", { integrationId: app.id, accountId: account.id }).then(onClose).catch(error => toast(error, "error")); }}>Disconnect</button>
          </div>
        ))}
        {(app.pendingAccounts || []).map(account => (
          <div key={account.id} className="tw-list-row compact">
            <span className="tw-face">{initials(account.displayName).slice(0, 1)}</span>
            <div className="grow"><strong>{account.displayName}</strong><span className="desc">Needs signing in again</span></div>
            <button type="button" className="tw-btn" onClick={() => { if (window.confirm(`Remove ${account.displayName}?`)) call("integrations.disconnect", { integrationId: app.id, accountId: account.id }).then(onClose).catch(error => toast(error, "error")); }}>Remove</button>
          </div>
        ))}
      </div>
      {agents.length ? (
        <>
          <h3 className="tw-dialog-section">Agents that can use {app.displayName}</h3>
          <div className="tw-list-panel">
            {agents.map(agent => (
              <div key={agent.id} className="tw-list-row compact" style={{ alignItems: "flex-start" }}>
                <Avatar agent={agent} />
                <div className="grow" style={{ gap: 6 }}>
                  <strong>{agent.name}</strong>
                  {app.accounts.map(account => (
                    <label key={account.id} className="tw-check"><input type="checkbox" checked={allowed(agent.id, account)} onChange={event => void toggle(agent.id, account, event.target.checked)} /><span>{account.displayName}</span></label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn" onClick={() => call("integrations.beginConnect", { integrationId: app.id }).then(() => toast("Finish connecting in your browser.")).catch(error => toast(error, "error"))}><Plus size={15} />Add account</button>
      </div>
    </>
  );
}

// A Codex plugin: what it does and a way to connect it.
function PluginDetails({ plugin, onClose, onInstalled }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!plugin) return null;
  const install = () => {
    setBusy(true);
    call("plugins.install", { marketplacePath: plugin.marketplacePath, pluginName: plugin.name })
      .then(result => { toast(result.needsSignIn.length ? `Finish signing in to ${result.needsSignIn.join(", ")} in your browser.` : `${plugin.title} is connected.`); onInstalled(); onClose(); })
      .catch(error => toast(error, "error")).finally(() => setBusy(false));
  };
  return (
    <>
      <div className="tw-plugin-head">
        {plugin.icon ? <img src={plugin.icon} alt="" width="36" height="36" /> : <span className="tw-app-letter" style={{ width: 36, height: 36, fontSize: 18 }}>{initials(plugin.title).slice(0, 1)}</span>}
        <div><h2>{plugin.title}</h2>{plugin.description ? <p>{plugin.description}</p> : null}</div>
        <button type="button" className="tw-icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {plugin.details ? <p className="tw-plugin-text">{plugin.details}</p> : null}
      <button type="button" className="tw-btn accent tw-wide" disabled={busy || plugin.installed} onClick={install}>{plugin.installed ? "Connected" : busy ? "Connecting…" : "Connect " + plugin.title}</button>
    </>
  );
}

function Tools({ agents }) {
  const { items, error } = useApps();
  const [plugins, setPlugins] = useState([]);
  const [tab, setTab] = useState("featured");
  const [query, setQuery] = useState("");
  const [mcpCount, setMcpCount] = useState(0);
  const [open, setOpen] = useState(null);
  const [plugin, setPlugin] = useState(null);
  const toast = useToast();
  const loadPlugins = () => call("plugins.list").then(setPlugins).catch(() => setPlugins([]));
  useEffect(() => { call("mcp.list", { builtIn: true, status: false }).then(list => setMcpCount(list.length)).catch(() => {}); void loadPlugins(); }, []);
  // Connected apps and plugins share one list, apps first for the same name.
  // Accounts that need signing in again still count as connected and offer Reconnect, as before.
  const apps = (items || []).map(app => ({ key: "app:" + app.id, kind: "app", app, title: app.displayName, description: app.shortDescription || "Connect " + app.displayName + " through Composio", featured: !!app.featured, connected: !!(app.accounts?.length || app.pendingAccounts?.length), pending: !!app.pendingAccounts?.length }));
  const extras = plugins.map(item => ({ key: "plugin:" + item.id, kind: "plugin", plugin: item, title: item.title, description: item.description, featured: item.featured, connected: item.installed }));
  const byName = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || (a.kind === "app" ? -1 : 1);
  // Connected apps first, then plugins, each by name.
  const all = [...[...apps].sort(byName), ...[...extras].sort(byName)];
  const tabs = { featured: [...apps.filter(entry => entry.featured), ...extras.filter(entry => entry.featured).sort(byName)], all, connected: all.filter(entry => entry.connected) };
  const needle = query.trim().toLowerCase();
  const list = (needle ? all : tabs[tab] || []).filter(entry => !needle || entry.title.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle));
  const detail = open && (items || []).find(app => app.id === open);
  const choose = entry => entry.kind === "plugin" ? setPlugin(entry.plugin) : entry.connected ? setOpen(entry.app.id) : connect(entry.app);
  const connect = app => call("integrations.beginConnect", { integrationId: app.id }).then(() => toast("Finish connecting in your browser.")).catch(failure => toast(failure, "error"));
  return (
    <div className="tw-page">
      <PageHead title="Tools" subtitle="Connect apps and manage connected accounts available to Timewarp." />
      <SearchField value={query} onChange={setQuery} placeholder="Search tools..." shortcut />
      {needle ? null : (
        <div className="tw-tabs" role="group" aria-label="Tools">
          {[["featured", "Featured", tabs.featured.length], ["all", "All", all.length], ["connected", "Connected", tabs.connected.length], ["mcp", "MCP", mcpCount]].map(([id, label, count]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label} <em>{count}</em></button>
          ))}
        </div>
      )}
      {error ? <div className="tw-alert">{error}</div> : null}
      {tab === "mcp" && !needle ? <McpServers query={query} onCount={setMcpCount} /> : items === null ? <p className="tw-loading">Loading tools...</p> : list.length ? (
        <div className="tw-grid tw-scroll-grid tw-tool-grid">
          {list.slice(0, 300).map(entry => (
            <div key={entry.key} className="tw-tile clickable" role="button" tabIndex={0} onClick={() => choose(entry)} onKeyDown={event => { if (event.key === "Enter") choose(entry); }}>
              {entry.kind === "app" ? <AppIcon app={entry.app} size={36} /> : entry.plugin.icon ? <img src={entry.plugin.icon} alt="" width="36" height="36" className="tw-tool-icon" /> : <span className="tw-app-letter" style={{ width: 36, height: 36, fontSize: 18 }}>{initials(entry.title).slice(0, 1)}</span>}
              <div><strong>{entry.title}</strong><span className="desc">{entry.description}</span></div>
              {entry.kind === "app" && entry.app.accounts?.length ? <span className="tw-faces">{entry.app.accounts.slice(0, 3).map(account => <span key={account.id} title={account.displayName}>{initials(account.displayName).slice(0, 1)}</span>)}</span> : null}
              {entry.pending ? (
                <button type="button" className="tw-tile-reconnect" aria-label={"Reconnect " + entry.title} onClick={event => { event.stopPropagation(); connect(entry.app); }}><TriangleAlert size={16} />Reconnect</button>
              ) : entry.kind === "plugin" && entry.connected ? null : (
                <button type="button" className="tw-round tw-add-round" title={"Connect " + entry.title} aria-label={"Connect " + entry.title}
                  onClick={event => { event.stopPropagation(); entry.kind === "plugin" ? setPlugin(entry.plugin) : connect(entry.app); }}><Plus size={16} /></button>
              )}
            </div>
          ))}
        </div>
      ) : <p className="tw-loading">{needle ? "No tools match your search." : tab === "connected" ? "No connected apps yet." : "No tools here."}</p>}
      <Dialog open={!!detail} onClose={() => setOpen(null)} title={detail?.displayName} description={detail?.shortDescription}>
        <AppDetails app={detail} agents={agents} onClose={() => setOpen(null)} />
      </Dialog>
      <Dialog open={!!plugin} onClose={() => setPlugin(null)} label={plugin?.title} className="tw-plugin-dialog">
        <PluginDetails plugin={plugin} onClose={() => setPlugin(null)} onInstalled={loadPlugins} />
      </Dialog>
    </div>
  );
}

const BROWSER_NAMES = { timewarp: "Timewarp", chrome: "Chrome", edge: "Edge", brave: "Brave", vivaldi: "Vivaldi", arc: "Arc", chromium: "Chromium" };
const browserBadge = type => !type || type === "timewarp" ? "./timewarp-logo.svg" : `./onboarding-icons/${type === "chrome" || type === "edge" ? type + "-color" : type}.svg`;
const LETTER_COLORS = ["#e8710a", "#1a73e8", "#188038", "#a142f4", "#d93025", "#12b5cb"];
const letterColor = text => LETTER_COLORS[[...String(text || "")].reduce((sum, character) => sum + character.charCodeAt(0), 0) % LETTER_COLORS.length];

// A person, or the account's initial, with the browser it comes from.
function ProfileAvatar({ type, account, picture }) {
  return (
    <span className="tw-face tw-profile-avatar" style={account && !picture ? { background: letterColor(account), color: "#fff" } : null}>
      {picture ? <img className="photo" src={picture} alt="" /> : account ? <b>{account[0].toUpperCase()}</b> : <UserRound size={18} strokeWidth={1.8} />}
      <img className="tw-face-badge" src={browserBadge(type)} alt="" />
    </span>
  );
}

function Browser() {
  const [profiles, setProfiles] = useState([]);
  const [importable, setImportable] = useState([]);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const load = () => {
    call("browser.profiles").then(setProfiles).catch(error => toast(error, "error"));
    call("browser.importable").then(setImportable).catch(() => setImportable([]));
  };
  useEffect(() => { load(); }, []);
  const rename = event => {
    event.preventDefault();
    call("browser.renameProfile", { id: editing.id, label: name }).then(() => { setEditing(null); load(); }).catch(error => toast(error, "error"));
  };
  const remove = profile => {
    if (!window.confirm(`Remove the ${profile.label} profile? Its sign-ins and cookies are deleted from this device, and chats using it switch to the default profile.`)) return;
    call("browser.removeProfile", { id: profile.id }).then(load).catch(error => toast(error, "error"));
  };
  const add = profile => {
    setBusy(profile.label);
    call("browser.importProfile", profile.source).then(created => {
      toast({ title: `${created.label} added`, body: "Choose it from the profile button in a chat's browser. Sign in to your sites there once; saved passwords can come in from Vault → Import." });
      load();
    }).catch(error => toast(error, "error")).finally(() => setBusy(null));
  };
  return (
    <div className="tw-page">
      <PageHead title="Browser" subtitle="Manage which accounts Timewarp can use when browsing." />
      <p className="tw-lead">Browser profiles, cookies, passwords and browser actions stay on this device. The local harness uses the cloud model.</p>
      <h3 className="tw-sub">Your browser profiles</h3>
      <div className="tw-list-panel">
        {profiles.map(profile => (
          <div key={profile.id} className="tw-list-row tw-profile-row">
            <ProfileAvatar type={profile.source?.type} />
            <div><strong>{profile.label}</strong><span className="desc">{profile.source?.browser || BROWSER_NAMES[profile.source?.type] || "Timewarp"}</span></div>
            <span className="tw-row-actions">
              <Menu align="right" width={180} trigger={({ toggle }) => <button type="button" className="tw-icon-button" aria-label={"Options for " + profile.label} onClick={toggle}><Ellipsis size={16} /></button>}>
                <button type="button" className="tw-menu-item" data-close onClick={() => { setName(profile.label); setEditing(profile); }}><Pencil size={15} /><span className="grow">Rename</span></button>
                {profile.isDefault ? null : <button type="button" className="tw-menu-item" data-close onClick={() => remove(profile)}><Trash2 size={15} /><span className="grow">Remove</span></button>}
              </Menu>
            </span>
          </div>
        ))}
      </div>
      {importable.length ? (
        <>
          <h3 className="tw-sub">Importable browser profiles</h3>
          <div className="tw-list-panel">
            {importable.map(profile => (
              <div key={profile.source.browserId + "/" + profile.source.profilePath} className="tw-list-row tw-profile-row">
                <ProfileAvatar type={profile.source.browserId} picture={profile.picture} account={profile.source.browserId === "chrome" ? profile.accountName : null} />
                <div><strong>{profile.label}</strong><span className="desc">{profile.browser}</span></div>
                <button type="button" className="tw-btn soft" disabled={!!busy} onClick={() => add(profile)}>{busy === profile.label ? "Importing…" : "Import"}</button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Rename profile">
        <form className="tw-import" onSubmit={rename}>
          <label className="tw-field"><span>Name</span><input className="tw-input" autoFocus required maxLength={60} value={name} placeholder="Work" onChange={event => setName(event.target.value)} /></label>
          <div className="tw-dialog-actions"><button type="button" className="tw-btn" onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="tw-btn primary" disabled={!name.trim()}>Save</button></div>
        </form>
      </Dialog>
    </div>
  );
}

function Billing() {
  const host = useRef(null);
  useEffect(() => { if (host.current) window.timewarpMountBilling?.(host.current); }, []);
  return <div className="tw-page tw-billing-page"><div ref={host} className="tw-billing-host" /></div>;
}

async function uploadPicture(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP picture smaller than 5 MB.");
  const target = await call("images.beginUpload");
  const sent = await fetch(target.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!sent.ok) throw new Error("The picture could not be uploaded.");
  return target.imageId;
}

function Organization({ account, onAccount }) {
  const toast = useToast();
  const organization = account?.activeOrganization;
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [query, setQuery] = useState(null);
  // "Add organization" in the account menu opens the create dialog here.
  useEffect(() => { const create = () => setDialog("create"); window.addEventListener("tw:new-organization", create); return () => window.removeEventListener("tw:new-organization", create); }, []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [name, setName] = useState(organization?.name || "");
  const [newName, setNewName] = useState("");
  const picture = useRef(null);
  const load = () => Promise.all([call("organizations.members"), call("organizations.invitations")]).then(([m, i]) => { setMembers(m || []); setInvites(i || []); }).catch(error => { setMembers(current => current || []); toast(error, "error"); });
  useEffect(() => { setName(organization?.name || ""); void load(); }, [organization?.id]);
  const me = (members || []).find(member => member.userId === account?.user?.id);
  // The account knows the role at once; the member list takes a moment.
  const manager = [...(organization?.roles || []), ...(me?.roles || [])].some(value => ["owner", "admin"].includes(value));
  const refresh = value => { onAccount(value); void load(); };
  const needle = (query || "").trim().toLowerCase();
  const shown = (members || []).filter(member => !needle || [member.name, member.email].some(value => String(value || "").toLowerCase().includes(needle)));
  const pictureUrl = organization?.logo || organization?.image;
  const role0 = member => { const value = member.roles?.[0] || "member"; return value[0].toUpperCase() + value.slice(1); };
  return (
    <div className="tw-page tw-org-page">
      <PageHead title="Organization" subtitle={organization ? `Inviting people to ${organization.name} adds them to this organization. Chats and AI credits stay personal.${members ? ` You have ${members.length} member${members.length === 1 ? "" : "s"} in this organization.` : ""}` : "Create or join an organization."} />
      {organization ? (
        <div className="tw-rows-card tw-org-card">
          <div className="tw-list-row">
            <span className="tw-org-picture large">{pictureUrl ? <img className="photo" src={pictureUrl} alt="" /> : <img src="./timewarp-logo.svg" alt="" />}</span>
            <div><strong>{organization.name}</strong><span className="desc">Organization</span></div>
            {account?.organizations?.length > 1 ? (
              <Select label="Switch organization" value={organization.id} width={240} onChange={id => call("organizations.setActive", { organizationId: id }).then(refresh).catch(error => toast(error, "error"))}
                options={account.organizations.map(item => ({ value: item.id, label: item.name }))} />
            ) : null}
            {manager ? <button type="button" className="tw-btn ghost" onClick={() => setDialog("edit")}>Edit</button> : null}
          </div>
        </div>
      ) : null}
      <div className="tw-section-head">
        <h3 className="tw-muted-head">Members</h3>
        {query === null ? <button type="button" className="tw-icon-button" aria-label="Search members" onClick={() => setQuery("")}><Search size={17} /></button>
          : <input className="tw-input tw-inline-search" autoFocus value={query} placeholder="Search members" aria-label="Search members" onChange={event => setQuery(event.target.value)} onBlur={() => { if (!query) setQuery(null); }} />}
        {manager ? <button type="button" className="tw-btn" onClick={() => setDialog("invite")}><UserPlus size={16} />Invite</button> : null}
      </div>
      <div className="tw-rows-card tw-members-card">
        <table className="tw-members">
          <thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {members === null ? <tr><td colSpan={3}>Loading members...</td></tr> : null}
            {shown.map(member => (
              <tr key={member.id}>
                <td><span className="tw-member"><span className="tw-face small">{initials(member.name || member.email).slice(0, 1)}</span>{member.name || member.email}</span></td>
                <td>{role0(member)}</td>
                <td>{member.createdAt ? new Date(member.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""}</td>
              </tr>
            ))}
            {invites.map(invite => (
              <tr key={invite.id}>
                <td><span className="tw-member"><span className="tw-face small">{initials(invite.email).slice(0, 1)}</span>{invite.email}</span></td>
                <td>Invited</td>
                <td>{manager ? <button type="button" className="tw-btn ghost" onClick={() => call("organizations.revokeInvite", { invitationId: invite.id }).then(load).catch(error => toast(error, "error"))}>Revoke</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {members ? <p className="tw-hint tw-inset">Showing {shown.length} of {members.length}</p> : null}
      {organization ? null : <div><button type="button" className="tw-btn ghost" onClick={() => setDialog("create")}><Plus size={15} />New organization</button></div>}
      <Dialog open={dialog === "edit"} onClose={() => setDialog(null)} title="Edit organization">
        <form className="tw-import" onSubmit={event => { event.preventDefault(); call("organizations.update", { name }).then(() => call("account.get")).then(refresh).then(() => { toast("Organization saved."); setDialog(null); }).catch(error => toast(error, "error")); }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="tw-org-picture large">{pictureUrl ? <img className="photo" src={pictureUrl} alt="" /> : <img src="./timewarp-logo.svg" alt="" />}</span>
            <button type="button" className="tw-btn" onClick={() => picture.current?.click()}>Change picture</button>
            <input ref={picture} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) uploadPicture(file).then(logo => call("organizations.update", { name: organization.name, logo })).then(() => call("account.get")).then(refresh).catch(error => toast(error, "error")); }} />
          </div>
          <label className="tw-field"><span>Name</span><input className="tw-input" value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
          <div className="tw-dialog-actions"><button type="button" className="tw-btn" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="tw-btn primary" disabled={!name.trim() || name === organization?.name}>Save</button></div>
        </form>
      </Dialog>
      <Dialog open={dialog === "invite"} onClose={() => setDialog(null)} title="Invite members" description="They get an email with a link to join.">
        <form className="tw-import" onSubmit={event => { event.preventDefault(); call("organizations.invite", { email, role }).then(() => { setEmail(""); toast("Invitation sent."); setDialog(null); void load(); }).catch(error => toast(error, "error")); }}>
          <label className="tw-field"><span>Email</span><input className="tw-input" type="email" required autoFocus placeholder="name@company.com" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="tw-field"><span>Role</span><select className="tw-dropdown" value={role} onChange={event => setRole(event.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <div className="tw-dialog-actions"><button type="button" className="tw-btn" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="tw-btn primary">Send invite</button></div>
        </form>
      </Dialog>
      <Dialog open={dialog === "create"} onClose={() => setDialog(null)} title="New organization" description="You'll switch to it after it's created. Chats stay personal.">
        <form className="tw-import" onSubmit={event => { event.preventDefault(); call("organizations.create", { name: newName }).then(value => { setNewName(""); refresh(value); toast("Organization created."); setDialog(null); }).catch(error => toast(error, "error")); }}>
          <label className="tw-field"><span>Name</span><input className="tw-input" required autoFocus maxLength={120} value={newName} onChange={event => setNewName(event.target.value)} /></label>
          <div className="tw-dialog-actions"><button type="button" className="tw-btn" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="tw-btn primary" disabled={!newName.trim()}>Create</button></div>
        </form>
      </Dialog>
    </div>
  );
}

export function Settings({ section, onSection, ...props }) {
  const pages = {
    general: () => <General {...props} />, tools: () => <Tools {...props} />, browser: () => <Browser />, vault: () => <Vault {...props} />,
    memories: () => <Memories />, skills: () => <Skills />, automations: () => <Automations {...props} />, organization: () => <Organization {...props} />, billing: () => <Billing />,
  };
  const page = (pages[section] || pages.general)();
  return (
    <div className="tw-settings">
      <div className="tw-settings-inner">
        <nav aria-label="Settings">
          {GROUPS.map(group => (
            <React.Fragment key={group.label}>
              <h4>{group.label}</h4>
              {group.items.filter(item => !item.hidden).map(item => <a key={item.id} href={sectionHref(item.id)} aria-current={section === item.id ? "page" : undefined}><item.icon size={16} strokeWidth={1.7} /><span>{item.label}</span></a>)}
            </React.Fragment>
          ))}
        </nav>
        <div key={section}>{page}</div>
      </div>
    </div>
  );
}
