import React, { useEffect, useRef, useState } from "react";
import { Blocks, BookMarked, Brain, Building2, CalendarClock, ChevronDown, CreditCard, Ellipsis, Globe, KeyRound, LayoutGrid, Monitor, Moon, Pencil, Plus, Search, Settings2, Sun, Trash2, TriangleAlert, UserPlus, UserRound } from "lucide-react";
import { presets, hexToAccent } from "../../../../shared/appearance.cjs";
import { call, initials, relativeTime, request, useEvent } from "../api.js";
import { applyAppearance } from "../theme.js";
import { splitEmails } from "../shell.mjs";
import { Avatar, Dialog, Menu, PageHead, Row, SearchField, Select, Switch, useConfirm, useToast } from "./common.jsx";
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
  const confirm = useConfirm();
  const load = () => request("chatgptDetails").then(setState).catch(() => setState(null));
  useEffect(() => { void load(); }, []);
  useEvent("funding.changed", () => void load());
  const connected = state && state.status !== "disconnected";
  // Connecting is offered only once the plan is known to be Free; paid plans use Timewarp credits.
  const allowed = state?.funding?.subscriptionAllowed === true;
  const description = !state ? "…" : !allowed ? "Your plan uses Timewarp AI credits. A ChatGPT plan can power AI usage on the Free plan."
    : state.status === "available" ? `Connected${state.account?.email ? " as " + state.account.email : ""}${state.account?.planType ? ` (${state.account.planType})` : ""}` : state.status === "reauth_required" ? "Sign in again to keep using your ChatGPT plan" : "Not connected";
  const run = action => { setBusy(true); request(action).then(() => { if (action === "connectChatgpt") toast("Finish connecting ChatGPT in your browser."); return load(); }).catch(error => toast(error, "error")).finally(() => setBusy(false)); };
  return (
    <Row title="ChatGPT" description={description}>
      {allowed ? (connected && state.status === "available"
        ? <button type="button" className="tw-btn" disabled={busy} onClick={async () => { if (await confirm({ title: "Disconnect ChatGPT?", body: "Your ChatGPT plan stops powering AI usage in Timewarp. You can connect it again later.", action: "Disconnect", danger: true })) run("disconnectChatgpt"); }}>Disconnect</button>
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

// The memory setting; the previous app saved "read-only" and "write-only".
const memoryMode = mode => ({ disabled: "none", none: "none", read: "read", "read-only": "read", write: "write", "write-only": "write" })[mode] || "enabled";
// Each mode, described as before.
const MEMORY_MODES = [
  { value: "enabled", label: "Enabled", description: "Allow memory reads and writes for all agents" },
  { value: "read", label: "Read only", description: "Read memory into prompts, no writes" },
  { value: "write", label: "Write only", description: "Write memory without prompt injection" },
  { value: "none", label: "None", description: "No memory reads or writes" },
];

// The color field, as before: around the circle is the hue, out from the
// centre the color gets stronger. The handle moves with the arrow keys too.
function ColorField({ accent, onPreview, onCommit }) {
  const field = useRef(null);
  const [dragging, setDragging] = useState(false);
  const hue = Number.isFinite(accent?.hue) ? accent.hue : 270, strength = Math.min(1, Math.max(0, accent?.saturation ?? 0.6)), lightness = accent?.lightness ?? 0.88;
  const at = { x: 50 + Math.cos(hue * Math.PI / 180) * strength * 50, y: 50 + Math.sin(hue * Math.PI / 180) * strength * 50 };
  const toAccent = (x, y, size) => {
    const radius = size / 2, dx = x - radius, dy = y - radius, distance = Math.hypot(dx, dy);
    return { ...(accent || {}), hue: distance < 0.5 ? hue : (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, saturation: Math.min(1, distance / radius), lightness, tint: accent?.tint ?? 0.3 };
  };
  const fromPointer = event => { const box = field.current.getBoundingClientRect(); return toAccent(event.clientX - box.left, event.clientY - box.top, box.width); };
  const keys = event => {
    const step = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] }[event.key];
    if (!step) return;
    event.preventDefault();
    const size = field.current.getBoundingClientRect().width;
    onCommit(toAccent(at.x / 100 * size + step[0], at.y / 100 * size + step[1], size));
  };
  const background = `radial-gradient(circle closest-side, hsl(0 0% ${Math.round(lightness * 100)}%), transparent), conic-gradient(from 90deg, ${[0, 60, 120, 180, 240, 300, 360].map(value => `hsl(${value} 100% ${Math.round(lightness * 100)}%)`).join(", ")})`;
  return (
    <div ref={field} className="tw-hue-field" data-dragging={dragging || undefined} style={{ background }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); onPreview(fromPointer(event)); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onPreview(fromPointer(event)); }}
      onPointerUp={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); onCommit(fromPointer(event)); }}
      onPointerCancel={() => setDragging(false)}>
      <button type="button" className="tw-hue-handle" style={{ left: at.x + "%", top: at.y + "%", background: accentCss(accent) }}
        aria-label={`Theme color. Use the arrow keys to adjust.`} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" onKeyDown={keys} />
    </div>
  );
}

// The Colors popover: the color field, the named presets and radiance.
function ColorEditor({ appearance, onChange }) {
  const [draft, setDraft] = useState(null);
  const shown = draft || appearance;
  const preview = patch => { const next = { ...appearance, ...(draft || {}), ...patch }; setDraft(next); applyAppearance(next); };
  const commit = patch => { setDraft(null); onChange(patch); };
  return (
    <div className="tw-color-editor">
      <ColorField accent={shown.accent} onPreview={accent => preview({ accent })} onCommit={accent => commit({ accent })} />
      <div className="tw-swatches" role="group" aria-label="Timewarp color themes">
        {presets.map(preset => {
          const accent = hexToAccent(preset.hex);
          return <button key={preset.hex} type="button" className="tw-swatch" title={`${preset.name} · ${preset.hex}`} aria-label={`Use ${preset.name} theme`} aria-pressed={!!sameAccent(accent, shown.accent)} onClick={() => commit({ accent })}><i style={{ background: preset.hex }} /><span>{preset.name}</span></button>;
        })}
      </div>
      <label className="tw-field"><span>Radiance</span><input className="tw-range" type="range" min="0" max="1" step="0.01" aria-label="Theme radiance" value={Number(shown.radiance ?? 0.5)}
        onChange={event => preview({ radiance: Number(event.target.value) })} onPointerUp={() => draft && commit({ radiance: draft.radiance })} onKeyUp={() => draft && commit({ radiance: draft.radiance })} onBlur={() => draft && commit({ radiance: draft.radiance })} /></label>
    </div>
  );
}

// Settings → General → Diagnostics: the app's log folder, and a diagnostics
// file for support (versions, states and recent log lines; no chats or account details).
function DiagnosticsRow() {
  const toast = useToast();
  return (
    <Row title="Diagnostics" description="Open the app's log folder, or save a diagnostics file to send to support. It has no chats, files or account details.">
      <span className="tw-row-buttons">
        <button type="button" className="tw-btn" onClick={() => call("app.openLogs").catch(error => toast(error, "error"))}>Open logs</button>
        <button type="button" className="tw-btn" onClick={() => call("diagnostics.export").then(result => { if (result?.saved) toast("Diagnostics saved."); }).catch(error => toast(error, "error"))}>Export</button>
      </span>
    </Row>
  );
}

function General({ settings, onSetting, models, onModel, agents }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState(null);
  const appearance = settings.appearance || {};
  const setAppearance = patch => onSetting("appearance", { ...appearance, ...patch });
  const privateMode = settings.privacy?.mode === "private";
  const memory = MEMORY_MODES.find(item => item.value === memoryMode(settings.memory?.mode)) || MEMORY_MODES[0];
  const runSetup = async () => {
    if (!await confirm({ title: "Run setup again?", body: "You'll go through the first-run screens again. Your agents, chats and settings stay as they are.", action: "Run setup again" })) return;
    call("onboarding.restart").then(() => window.dispatchEvent(new Event("tw:setup"))).catch(error => toast(error, "error"));
  };
  return (
    <div className="tw-page">
      <PageHead title="General" subtitle="Configure preferences" />
      <div className="tw-rows-card">
        <Row title="Theme" description="Match your system settings or use a fixed theme">
          <Select label="Theme" value={appearance.scheme || "system"} onChange={scheme => setAppearance({ scheme })} width={170}
            options={[{ value: "system", label: "System", icon: <Monitor size={16} /> }, { value: "light", label: "Light", icon: <Sun size={16} /> }, { value: "dark", label: "Dark", icon: <Moon size={16} /> }]} />
        </Row>
        <Row title="Colors" description="Pick a color and radiance">
          <Menu align="right" width={304} className="tw-color-popover" onOpenChange={open => { if (!open) applyAppearance(settings.appearance || {}); }} trigger={({ toggle, open }) => (
            <button type="button" className="tw-color-trigger" aria-expanded={open} aria-label="Customize colors" onClick={toggle}><i style={{ background: accentCss(appearance.accent) }} /><ChevronDown size={16} /></button>
          )}>
            <ColorEditor appearance={appearance} onChange={setAppearance} />
          </Menu>
        </Row>
        <Row title="Model" description="LLM used for new conversations. Existing conversations keep their original model."><ModelPicker models={models} onSelect={onModel} up={false} /></Row>
        <ChatGptRow />
        <Row title="Privacy Mode" description="Pauses cloud chat-history synchronization. Your model requests still use the cloud. Files, memory, browser profiles, cookies and the vault stay on this device.">
          <Switch label="Privacy Mode" checked={privateMode} onChange={value => onSetting("privacy", { ...settings.privacy, mode: value ? "private" : "standard" })} />
        </Row>
        <Row title="Archived conversations" description="View and unarchive conversations removed from the sidebar"><button type="button" className="tw-btn" onClick={() => setDialog("archived")}>Manage</button></Row>
        <Row title="Memory" description={memory.description}>
          <Select label="Memory" value={memory.value} width={160} onChange={mode => onSetting("memory", { ...settings.memory, mode })}
            options={MEMORY_MODES.map(({ value, label }) => ({ value, label }))} />
        </Row>
        <DiagnosticsRow />
        <Row title="Setup" description="Go through the first-run screens again: your name, what to bring in from other apps, and your theme.">
          <button type="button" className="tw-btn" onClick={() => void runSetup()}>Run setup again</button>
        </Row>
      </div>
      <Archived open={dialog === "archived"} onClose={() => setDialog(null)} agents={agents} />
    </div>
  );
}

// One app: its connected accounts and which agents can use them.
function AppDetails({ app, agents, onClose, onChanged }) {
  const [access, setAccess] = useState({});
  const toast = useToast();
  const confirm = useConfirm();
  // Removing an account reloads the apps everywhere (the engine also announces it).
  const disconnect = async (account, pending) => {
    if (!await confirm(pending
      ? { title: `Remove ${account.displayName}?`, body: `This ${app.displayName} account is removed from Timewarp.`, action: "Remove", danger: true }
      : { title: `Disconnect ${account.displayName}?`, body: `Agents can no longer use this ${app.displayName} account.`, action: "Disconnect", danger: true })) return;
    call("integrations.disconnect", { integrationId: app.id, accountId: account.id }).then(() => { onChanged?.(); onClose(); }).catch(error => toast(error, "error"));
  };
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
            <button type="button" className="tw-btn" onClick={() => void disconnect(account, false)}>Disconnect</button>
          </div>
        ))}
        {(app.pendingAccounts || []).map(account => (
          <div key={account.id} className="tw-list-row compact">
            <span className="tw-face">{initials(account.displayName).slice(0, 1)}</span>
            <div className="grow"><strong>{account.displayName}</strong><span className="desc">Needs signing in again</span></div>
            <button type="button" className="tw-btn" onClick={() => void disconnect(account, true)}>Remove</button>
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

function Tools({ agents }) {
  const { items, error, reload } = useApps();
  const [tab, setTab] = useState("featured");
  const [query, setQuery] = useState("");
  const [mcpCount, setMcpCount] = useState(0);
  const [open, setOpen] = useState(null);
  const toast = useToast();
  useEffect(() => { call("mcp.list", { builtIn: true, status: false }).then(list => setMcpCount(list.length)).catch(() => {}); }, []);
  // The user's connected apps, as in the previous app; agents don't use Codex's
  // plugin catalog. Accounts that need signing in again still count as
  // connected and offer Reconnect, as before.
  const apps = (items || []).map(app => ({ key: "app:" + app.id, app, title: app.displayName, description: app.shortDescription || "Connect " + app.displayName + " through Composio", featured: !!app.featured, connected: !!(app.accounts?.length || app.pendingAccounts?.length), pending: !!app.pendingAccounts?.length }));
  const byName = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  const all = [...apps].sort(byName);
  const tabs = { featured: apps.filter(entry => entry.featured), all, connected: all.filter(entry => entry.connected) };
  const needle = query.trim().toLowerCase();
  const list = (needle ? all : tabs[tab] || []).filter(entry => !needle || entry.title.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle));
  const detail = open && (items || []).find(app => app.id === open);
  const choose = entry => entry.connected ? setOpen(entry.app.id) : connect(entry.app);
  const connect = app => call("integrations.beginConnect", { integrationId: app.id }).then(() => toast("Finish connecting in your browser.")).catch(failure => toast(failure, "error"));
  return (
    <div className="tw-page">
      <PageHead title="Tools" subtitle="Connect apps and manage connected accounts available to Timewarp." />
      <SearchField value={query} onChange={setQuery} placeholder="Search tools..." shortcut />
      {needle && tab !== "mcp" ? null : (
        <div className="tw-tabs" role="group" aria-label="Tools">
          {[["featured", "Featured", tabs.featured.length], ["all", "All", all.length], ["connected", "Connected", tabs.connected.length], ["mcp", "MCP", mcpCount]].map(([id, label, count]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label} <em>{count}</em></button>
          ))}
        </div>
      )}
      {error ? <div className="tw-alert">{error}</div> : null}
      {tab === "mcp" ? <McpServers query={query} onCount={setMcpCount} /> : items === null ? <p className="tw-loading">Loading tools...</p> : list.length ? (
        <div className="tw-grid tw-scroll-grid tw-tool-grid">
          {list.slice(0, 300).map(entry => (
            <div key={entry.key} className="tw-tile clickable" role="button" tabIndex={0} onClick={() => choose(entry)} onKeyDown={event => { if (event.key === "Enter") choose(entry); }}>
              <AppIcon app={entry.app} size={36} />
              <div><strong>{entry.title}</strong><span className="desc">{entry.description}</span></div>
              {entry.app.accounts?.length ? <span className="tw-faces">{entry.app.accounts.slice(0, 3).map(account => <span key={account.id} title={account.displayName}>{initials(account.displayName).slice(0, 1)}</span>)}</span> : null}
              {entry.pending ? (
                <button type="button" className="tw-tile-reconnect" aria-label={"Reconnect " + entry.title} onClick={event => { event.stopPropagation(); connect(entry.app); }}><TriangleAlert size={16} />Reconnect</button>
              ) : (
                <button type="button" className="tw-round tw-add-round" title={"Connect " + entry.title} aria-label={"Connect " + entry.title}
                  onClick={event => { event.stopPropagation(); connect(entry.app); }}><Plus size={16} /></button>
              )}
            </div>
          ))}
        </div>
      ) : <p className="tw-loading">{needle ? "No tools match your search." : tab === "connected" ? "No connected apps yet." : "No tools here."}</p>}
      <Dialog open={!!detail} onClose={() => setOpen(null)} title={detail?.displayName} description={detail?.shortDescription}>
        <AppDetails app={detail} agents={agents} onClose={() => setOpen(null)} onChanged={reload} />
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
  const confirm = useConfirm();
  const load = () => {
    call("browser.profiles").then(setProfiles).catch(error => toast(error, "error"));
    call("browser.importable").then(setImportable).catch(() => setImportable([]));
  };
  useEffect(() => { load(); }, []);
  const rename = event => {
    event.preventDefault();
    call("browser.renameProfile", { id: editing.id, label: name }).then(() => { setEditing(null); load(); }).catch(error => toast(error, "error"));
  };
  const remove = async profile => {
    if (!await confirm({ title: `Remove ${profile.label}?`, body: "Its sign-ins and cookies are deleted from this device, and chats using it switch to the default profile.", action: "Remove", danger: true })) return;
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
                {profile.isDefault ? null : <button type="button" className="tw-menu-item" data-close onClick={() => void remove(profile)}><Trash2 size={15} /><span className="grow">Remove</span></button>}
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

export async function uploadPicture(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP picture smaller than 5 MB.");
  const target = await call("images.beginUpload");
  const sent = await fetch(target.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!sent.ok) throw new Error("The picture could not be uploaded.");
  return target.imageId;
}

// The last member list per organization, shown at once on the next visit while
// it refreshes, as the previous app's cached query did.
const membersCache = new Map();
// action: "new" or "invite" from the account menu (#/customize/organization/new or /invite)
// opens that dialog once; onActionDone drops it from the address.
function Organization({ account, onAccount, action, onActionDone }) {
  const toast = useToast();
  const organization = account?.activeOrganization;
  const cached = membersCache.get(organization?.id);
  const [members, setMembers] = useState(cached?.members ?? null);
  const [invites, setInvites] = useState(cached?.invites ?? []);
  const [dialog, setDialog] = useState(null);
  const [query, setQuery] = useState("");
  const [revoking, setRevoking] = useState(null);
  const [name, setName] = useState(organization?.name || "");
  const picture = useRef(null);
  const load = () => {
    const id = organization?.id;
    return Promise.all([call("organizations.members"), call("organizations.invitations")]).then(([m, i]) => {
      membersCache.set(id, { members: m || [], invites: i || [] });
      setMembers(m || []); setInvites(i || []);
    }).catch(error => { setMembers(current => current || []); toast(error, "error"); });
  };
  useEffect(() => {
    setName(organization?.name || "");
    const saved = membersCache.get(organization?.id);
    setMembers(saved?.members ?? null); setInvites(saved?.invites ?? []);
    void load();
  }, [organization?.id]);
  // Invitations sent from the account menu show here too.
  useEffect(() => { const reload = () => void load(); window.addEventListener("tw:members", reload); return () => window.removeEventListener("tw:members", reload); }, [organization?.id]);
  const me = (members || []).find(member => member.userId === account?.user?.id);
  // The account knows the role at once; the member list takes a moment.
  const manager = [...(organization?.roles || []), ...(me?.roles || [])].some(value => ["owner", "admin"].includes(value));
  const refresh = value => { onAccount(value); void load(); };
  useEffect(() => {
    if (!action) return;
    if (action === "new") setDialog("create");
    else if (action === "invite" && organization && manager) setDialog("invite");
    onActionDone?.();
  }, [action]);
  // Search covers names, addresses and roles, as before.
  const needle = query.trim().toLowerCase();
  const shown = (members || []).filter(member => !needle || [member.name, member.email, ...(member.roles || [])].some(value => String(value || "").toLowerCase().includes(needle)));
  const pictureUrl = organization?.logo || organization?.image;
  const capital = value => String(value || "member").charAt(0).toUpperCase() + String(value || "member").slice(1);
  // Every role, capitalised and joined, as before.
  const roles = member => (member.roles?.length ? member.roles : ["member"]).map(capital).join(", ");
  const date = value => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const revoke = invite => {
    setRevoking(invite.id);
    call("organizations.revokeInvite", { invitationId: invite.id }).then(load).catch(error => toast(error, "error")).finally(() => setRevoking(null));
  };
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
        <label className="tw-search tw-inline-search"><Search size={14} /><input className="tw-input" type="search" value={query} placeholder="Search..." aria-label="Search members" onChange={event => setQuery(event.target.value)} /></label>
        {manager ? <button type="button" className="tw-btn" onClick={() => setDialog("invite")}><UserPlus size={16} />Invite</button> : null}
      </div>
      <div className="tw-rows-card tw-members-card">
        <table className="tw-members">
          <thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {shown.map(member => (
              <tr key={member.id}>
                <td><span className="tw-member"><span className="tw-face small">{member.image ? <img src={member.image} alt="" /> : initials(member.name || member.email).slice(0, 1)}</span><span className="tw-ellipsis">{member.email || member.name}</span></span></td>
                <td>{roles(member)}</td>
                <td>{date(member.createdAt)}</td>
              </tr>
            ))}
            {members === null ? <tr className="tw-members-empty"><td colSpan={3}>Loading members...</td></tr>
              : !shown.length ? <tr className="tw-members-empty"><td colSpan={3}>{needle ? "No members match your search." : "No members found."}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {members ? <p className="tw-hint tw-inset">Showing {shown.length} of {members.length}</p> : null}
      {invites.length ? (
        <>
          <div className="tw-section-head">
            <h3 className="tw-muted-head">Invited users</h3>
            <span className="tw-hint">{invites.length} pending</span>
          </div>
          <div className="tw-rows-card tw-members-card">
            <table className="tw-members">
              <thead><tr><th>Email</th><th>Role</th><th>Invited</th>{manager ? <th className="end">Action</th> : null}</tr></thead>
              <tbody>
                {invites.map(invite => (
                  <tr key={invite.id}>
                    <td><span className="tw-ellipsis">{invite.email}</span></td>
                    <td>{capital(invite.role)}</td>
                    <td>{date(invite.createdAt)}</td>
                    {manager ? <td className="end"><button type="button" className="tw-btn ghost" disabled={!!revoking} onClick={() => revoke(invite)}>{revoking === invite.id ? "Revoking…" : "Revoke"}</button></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
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
      {organization ? <InviteDialog open={dialog === "invite"} organization={organization} onClose={() => setDialog(null)} onInvited={() => { setDialog(null); void load(); }} /> : null}
      <CreateOrganizationDialog open={dialog === "create"} current={organization} onClose={() => setDialog(null)} onCreated={value => { setDialog(null); refresh(value); }} />
    </div>
  );
}

// "Invite members to <organization>", as before: several addresses separated
// by commas or new lines, one invitation each, with one role. Opens over the
// current page from the account menu, or from the Organization page.
export function InviteDialog({ open, organization, onClose, onInvited }) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  useEffect(() => { if (open) { setEmails(""); setRole("member"); setError(""); setBusy(false); } }, [open]);
  const list = splitEmails(emails);
  const send = async event => {
    event.preventDefault();
    if (!list.length || busy) return;
    setBusy(true); setError("");
    const sent = [];
    try {
      for (const email of list) { await call("organizations.invite", { email, role }); sent.push(email); }
      toast(sent.length === 1 ? "Invitation sent." : `${sent.length} invitations sent.`);
      onInvited?.(sent);
    } catch (failure) {
      // The addresses already invited leave the box, so trying again sends the rest.
      setEmails(list.filter(email => !sent.includes(email)).join(", "));
      setError(failure?.message || String(failure));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={`Invite members to ${organization?.name || "your organization"}`} className="tw-invite-dialog">
      <form className="tw-import" onSubmit={send}>
        <label className="tw-field"><span>Email</span>
          <textarea className="tw-input tw-emails" rows={2} autoFocus value={emails} disabled={busy} placeholder="example1@example.com, example2@example.com" onChange={event => setEmails(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send(event); }} />
        </label>
        <label className="tw-field"><span>Role</span><select className="tw-dropdown" value={role} disabled={busy} onChange={event => setRole(event.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select></label>
        {error ? <p className="tw-alert" role="alert">{error}</p> : null}
        <div className="tw-dialog-actions"><button type="button" className="tw-btn" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="tw-btn primary" disabled={busy || !list.length}>{busy ? "Inviting…" : "Invite"}</button></div>
      </form>
    </Dialog>
  );
}

// "Create organization", as before. Creating one switches to it.
export function CreateOrganizationDialog({ open, current, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setName(""); setError(""); setBusy(false); } }, [open]);
  const create = event => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true); setError("");
    call("organizations.create", { name: value }).then(onCreated).catch(failure => setError(failure?.message || String(failure))).finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title="Create organization" description="Add another organization you can invite people to. Chats and AI credits stay personal.">
      <form className="tw-import" onSubmit={create}>
        <label className="tw-field"><span>Organization name</span><input className="tw-input" autoFocus maxLength={120} value={name} placeholder="Acme Research" autoComplete="organization" disabled={busy} onChange={event => setName(event.target.value)} /></label>
        {current ? <p className="tw-hint">You can switch back to {current.name} anytime.</p> : null}
        {error ? <p className="tw-alert" role="alert">{error}</p> : null}
        <div className="tw-dialog-actions"><button type="button" className="tw-btn" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="tw-btn primary" disabled={busy || !name.trim()}><Plus size={15} />Create organization</button></div>
      </form>
    </Dialog>
  );
}

export function Settings({ section, onSection, action, onActionDone, ...props }) {
  const pages = {
    general: () => <General {...props} />, tools: () => <Tools {...props} />, browser: () => <Browser />, vault: () => <Vault {...props} />,
    memories: () => <Memories />, skills: () => <Skills />, automations: () => <Automations {...props} />, organization: () => <Organization {...props} action={action} onActionDone={onActionDone} />, billing: () => <Billing />,
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
