import React, { useEffect, useRef, useState } from "react";
import { BookMarked, Brain, Building2, CalendarClock, ChevronDown, CreditCard, Globe, KeyRound, LayoutGrid, Monitor, Moon, Plus, Search, SlidersHorizontal, Sun, UserPlus, UserRound } from "lucide-react";
import { presets, hexToAccent } from "../../../../shared/appearance.cjs";
import { call, initials, request, useEvent } from "../api.js";
import { Avatar, Dialog, PageHead, Row, SearchField, Select, Switch, useToast } from "./common.jsx";
import { AppIcon, ModelPicker, useApps } from "./Composer.jsx";
import { Memories, Skills } from "./Knowledge.jsx";
import { Automations } from "./Automations.jsx";
import { McpServers, SharedInstructions } from "./Mcp.jsx";
import { Vault } from "./Vault.jsx";
import { FeedbackDialog } from "./Chat.jsx";

export const GROUPS = [
  { label: "Preferences", items: [{ id: "general", label: "General", icon: SlidersHorizontal }] },
  { label: "Capabilities", items: [
    { id: "tools", label: "Tools", icon: LayoutGrid }, { id: "browser", label: "Browser", icon: Globe }, { id: "vault", label: "Vault", icon: KeyRound },
    { id: "memories", label: "Memories", icon: Brain }, { id: "skills", label: "Skills", icon: BookMarked }, { id: "automations", label: "Automations", icon: CalendarClock },
  ] },
  { label: "Workspace", items: [{ id: "organization", label: "Organization", icon: Building2 }, { id: "billing", label: "Billing", icon: CreditCard }] },
];
export const SECTIONS = GROUPS.flatMap(group => group.items);
// Section addresses from earlier versions.
export const ALIASES = { colors: "general", models: "general", about: "general", agents: "general", memory: "memories", apps: "tools" };

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
    : state.status === "available" ? `Connected${state.account?.email ? " as " + state.account.email : ""}` : state.status === "reauth_required" ? "Sign in again to keep using your ChatGPT plan" : "Not connected";
  const run = action => { setBusy(true); request(action).then(() => { if (action === "connectChatgpt") toast("Finish connecting ChatGPT in your browser."); return load(); }).catch(error => toast(error, "error")).finally(() => setBusy(false)); };
  return (
    <Row title="ChatGPT" description={description}>
      {allowed ? (connected && state.status === "available"
        ? <button type="button" className="tw-btn" disabled={busy} onClick={() => { if (window.confirm("Disconnect your ChatGPT plan from Timewarp?")) run("disconnectChatgpt"); }}>Disconnect</button>
        : <button type="button" className="tw-btn" disabled={busy || !state} onClick={() => run("connectChatgpt")}>{state?.status === "reauth_required" ? "Reconnect" : "Connect"}</button>) : null}
    </Row>
  );
}

function Archived({ open, onClose, agents }) {
  const [items, setItems] = useState(null);
  const toast = useToast();
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  useEffect(() => { if (open) call("conversations.list", { archived: true }).then(setItems).catch(error => toast(error, "error")); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Archived conversations" description="Unarchive a conversation to show it in the sidebar again.">
      {items === null ? <p className="tw-hint">Loading…</p> : items.length ? (
        <div className="tw-list-panel tw-scroll-list">
          {items.map(conversation => (
            <div key={conversation.id} className="tw-list-row compact">
              <Avatar agent={agentById.get(conversation.agentId)} />
              <div className="grow"><strong>{conversation.title || "New conversation"}</strong><span className="desc">{agentById.get(conversation.agentId)?.name || "Removed agent"} · {new Date(conversation.lastActivityAt).toLocaleDateString()}</span></div>
              <button type="button" className="tw-btn" onClick={() => call("conversations.archive", { id: conversation.id, archived: false }).then(() => { setItems(list => list.filter(item => item.id !== conversation.id)); window.dispatchEvent(new Event("tw:conversations")); }).catch(error => toast(error, "error"))}>Unarchive</button>
            </div>
          ))}
        </div>
      ) : <p className="tw-hint">No archived conversations.</p>}
    </Dialog>
  );
}

// Windows needs a one-time setup before agents can run commands in a sandbox
// without asking each time. Windows asks the user to approve it.
function SandboxRow() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => call("sandbox.status").then(value => setStatus(value.status)).catch(() => setStatus("unknown"));
  useEffect(() => {
    void load();
    return window.tw.on("sandbox.changed", result => { setBusy(false); if (!result.success) toast(result.error || "The sandbox setup didn't finish.", "error"); void load(); });
  }, []);
  const ready = status === "ready";
  return (
    <Row title="Command sandbox" description={ready ? "Agents run commands inside their workspace without asking each time." : "Without it, agents ask before every command. Windows asks you to approve the setup once."}>
      {ready ? <span className="tw-tag ok">Ready</span> : (
        <button type="button" className="tw-btn" disabled={busy || status === null} onClick={() => { setBusy(true); call("sandbox.setup", { mode: "elevated" }).catch(error => { setBusy(false); toast(error, "error"); }); }}>
          {busy ? "Setting up…" : status === "updateRequired" ? "Update" : "Set up"}
        </button>
      )}
    </Row>
  );
}

function General({ settings, onSetting, models, onModel, agents }) {
  const toast = useToast();
  const [colors, setColors] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [history, setHistory] = useState(null);
  const [info, setInfo] = useState(null);
  useEffect(() => { call("history.status").then(setHistory).catch(() => {}); call("app.info").then(setInfo).catch(() => {}); }, []);
  const appearance = settings.appearance || {};
  const setAppearance = patch => onSetting("appearance", { ...appearance, ...patch });
  const privateMode = settings.privacy?.mode === "private";
  const sync = history?.state === "synced" ? "Chat history synced " + new Date(history.lastSyncedAt).toLocaleTimeString([], { timeStyle: "short" }) + "." : history?.state === "error" ? "Chat history sync is pending." : "";
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
        <Row title="Privacy Mode" description={"Pauses cloud chat-history synchronization. Your model requests still use the cloud. Files, memory, browser profiles, cookies and the vault stay on this device." + (sync && !privateMode ? " " + sync : "")}>
          <Switch label="Privacy Mode" checked={privateMode} onChange={value => onSetting("privacy", { ...settings.privacy, mode: value ? "private" : "standard" })} />
        </Row>
        <Row title="Archived conversations" description="View and unarchive conversations removed from the sidebar"><button type="button" className="tw-btn" onClick={() => setDialog("archived")}>Manage</button></Row>
        <Row title="Memory" description="Allow memory reads and writes for all agents">
          <Select label="Memory" value={settings.memory?.mode === "disabled" ? "disabled" : "enabled"} width={160} onChange={mode => onSetting("memory", { ...settings.memory, mode })}
            options={[{ value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }]} />
        </Row>
      </div>
      <div className="tw-rows-card">
        <Row title="Reply notifications" description="Notify me when an agent finishes while Timewarp is in the background">
          <Switch label="Reply notifications" checked={settings.notifications?.replies !== false} onChange={value => onSetting("notifications", { ...settings.notifications, replies: value })} />
        </Row>
        <Row title="Instructions for every agent" description="Guidance all agents follow, on top of their own instructions"><button type="button" className="tw-btn" onClick={() => setDialog("instructions")}>Edit</button></Row>
        {window.tw.platform === "win32" ? <SandboxRow /> : null}
        <Row title="Setup" description="Go through the welcome steps again. Your agents, chats and settings stay as they are.">
          <button type="button" className="tw-btn" onClick={() => { if (window.confirm("Run setup again? Your agents, chats and settings stay as they are.")) call("onboarding.restart").then(() => { location.hash = "#/"; location.reload(); }).catch(error => toast(error, "error")); }}>Run setup again</button>
        </Row>
        <Row title="Feedback" description="Tell us what happened or what could be better"><button type="button" className="tw-btn" onClick={() => setDialog("feedback")}>Send feedback</button></Row>
        <Row title="Diagnostics" description="Save versions and recent app messages for support. No chats, files or account details.">
          <button type="button" className="tw-btn" onClick={() => call("diagnostics.export").then(result => { if (result.saved) toast("Diagnostics saved."); }).catch(error => toast(error, "error"))}>Save…</button>
        </Row>
        <Row title="Version" description="Timewarp runs its agents with the OpenAI Codex app server. Third-party notices are included with the app."><span className="tw-hint">{info?.version || ""}</span></Row>
      </div>
      <Archived open={dialog === "archived"} onClose={() => setDialog(null)} agents={agents} />
      <Dialog open={dialog === "instructions"} onClose={() => setDialog(null)} title="Instructions for every agent">
        {dialog === "instructions" ? <SharedInstructions onDone={() => setDialog(null)} /> : null}
      </Dialog>
      <FeedbackDialog open={dialog === "feedback"} onClose={() => setDialog(null)} />
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
  const { items, error } = useApps();
  const [tab, setTab] = useState("featured");
  const [query, setQuery] = useState("");
  const [mcpCount, setMcpCount] = useState(0);
  const [open, setOpen] = useState(null);
  const toast = useToast();
  useEffect(() => { call("mcp.list").then(list => setMcpCount(list.length)).catch(() => {}); }, []);
  const all = items || [];
  const tabs = { featured: all.filter(app => app.featured), all, connected: all.filter(app => app.accounts?.length) };
  const needle = query.trim().toLowerCase();
  const list = (needle ? all : tabs[tab] || []).filter(app => !needle || app.displayName.toLowerCase().includes(needle) || (app.shortDescription || "").toLowerCase().includes(needle));
  const detail = open && all.find(app => app.id === open);
  return (
    <div className="tw-page">
      <PageHead title="Tools" subtitle="Connect apps and manage connected accounts available to Timewarp." />
      <SearchField value={query} onChange={setQuery} placeholder="Search tools..." shortcut />
      <div className="tw-tabs" role="group" aria-label="Tools">
        {[["featured", "Featured", tabs.featured.length], ["all", "All", all.length], ["connected", "Connected", tabs.connected.length], ["mcp", "MCP", mcpCount]].map(([id, label, count]) => (
          <button key={id} type="button" aria-pressed={needle && tab !== "mcp" ? id === "all" : tab === id} onClick={() => setTab(id)}>{label} <em>{count}</em></button>
        ))}
      </div>
      {error ? <div className="tw-alert">{error}</div> : null}
      {tab === "mcp" ? <McpServers query={query} onCount={setMcpCount} /> : items === null ? <p className="tw-hint">Loading tools…</p> : list.length ? (
        <div className="tw-grid">
          {list.slice(0, 200).map(app => {
            const connected = app.accounts?.length;
            return (
              <div key={app.id} className={"tw-tile" + (connected ? " clickable" : "")} role={connected ? "button" : undefined} tabIndex={connected ? 0 : undefined}
                onClick={connected ? () => setOpen(app.id) : undefined} onKeyDown={connected ? event => { if (event.key === "Enter") setOpen(app.id); } : undefined}>
                <AppIcon app={app} size={40} />
                <div><strong>{app.displayName}</strong><span className="desc">{app.shortDescription || "Connect " + app.displayName}</span></div>
                {connected ? <span className="tw-faces">{app.accounts.slice(0, 3).map(account => <span key={account.id} title={account.displayName}>{initials(account.displayName).slice(0, 1)}</span>)}</span> : null}
                <button type="button" className="tw-round" title={"Connect " + app.displayName} aria-label={"Connect " + app.displayName}
                  onClick={event => { event.stopPropagation(); call("integrations.beginConnect", { integrationId: app.id }).then(() => toast("Finish connecting in your browser.")).catch(failure => toast(failure, "error")); }}><Plus size={18} /></button>
              </div>
            );
          })}
        </div>
      ) : <div className="tw-empty-box">{needle ? "No tools match your search." : tab === "connected" ? "No connected apps yet." : "No tools here."}</div>}
      <p className="tw-hint">Agents use connected apps through Composio. Connections are authorized in your browser; tokens stay with Composio.</p>
      <Dialog open={!!detail} onClose={() => setOpen(null)} title={detail?.displayName} description={detail?.shortDescription}>
        <AppDetails app={detail} agents={agents} onClose={() => setOpen(null)} />
      </Dialog>
    </div>
  );
}

function Browser({ onSection }) {
  const [profiles, setProfiles] = useState([]);
  useEffect(() => { call("browser.profiles").then(setProfiles).catch(() => {}); }, []);
  return (
    <div className="tw-page">
      <PageHead title="Browser" subtitle="Manage which accounts Timewarp can use when browsing." />
      <p className="tw-lead">Browser profiles, cookies, passwords and browser actions stay on this device. The local harness uses the cloud model.</p>
      <h3 className="tw-sub">Your browser profiles</h3>
      <div className="tw-list-panel">
        {profiles.map(profile => (
          <div key={profile.id} className="tw-list-row">
            <span className="tw-face"><UserRound size={20} strokeWidth={1.6} /><img className="tw-face-badge" src="./timewarp-logo.svg" alt="" /></span>
            <div><strong>{profile.label}</strong><span className="desc">{profile.isDefault ? "Timewarp · default" : "Timewarp"}</span></div>
          </div>
        ))}
      </div>
      <h3 className="tw-sub">Passwords from another browser</h3>
      <div className="tw-list-panel">
        <div className="tw-list-row">
          <span className="tw-face"><KeyRound size={20} strokeWidth={1.6} /></span>
          <div><strong>Import saved passwords</strong><span className="desc">Export passwords from Chrome, Edge, Safari or a password manager as a CSV file, then import it into the Vault.</span></div>
          <button type="button" className="tw-btn" onClick={() => onSection("vault")}>Open Vault</button>
        </div>
      </div>
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
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [query, setQuery] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [name, setName] = useState(organization?.name || "");
  const [newName, setNewName] = useState("");
  const picture = useRef(null);
  const load = () => Promise.all([call("organizations.members"), call("organizations.invitations")]).then(([m, i]) => { setMembers(m || []); setInvites(i || []); }).catch(() => {});
  useEffect(() => { setName(organization?.name || ""); void load(); }, [organization?.id]);
  const me = members.find(member => member.userId === account?.user?.id);
  const manager = me?.roles?.some(value => ["owner", "admin"].includes(value));
  const refresh = value => { onAccount(value); void load(); };
  const needle = (query || "").trim().toLowerCase();
  const shown = members.filter(member => !needle || [member.name, member.email].some(value => String(value || "").toLowerCase().includes(needle)));
  const pictureUrl = organization?.logo || organization?.image;
  const role0 = member => { const value = member.roles?.[0] || "member"; return value[0].toUpperCase() + value.slice(1); };
  return (
    <div className="tw-page">
      <PageHead title="Organization" subtitle={organization ? `Inviting people to ${organization.name} adds them to this organization. Chats and AI credits stay personal. You have ${members.length} member${members.length === 1 ? "" : "s"} in this organization.` : "Create or join an organization."} />
      {organization ? (
        <div className="tw-rows-card">
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
      <div className="tw-rows-card">
        <table className="tw-members">
          <thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
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
      <p className="tw-hint tw-inset">Showing {shown.length} of {members.length}</p>
      <div><button type="button" className="tw-btn ghost" onClick={() => setDialog("create")}><Plus size={15} />New organization</button></div>
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
    general: () => <General {...props} />, tools: () => <Tools {...props} />, browser: () => <Browser onSection={onSection} />, vault: () => <Vault {...props} />,
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
              {group.items.map(item => <button key={item.id} type="button" aria-current={section === item.id} onClick={() => onSection(item.id)}><item.icon size={17} strokeWidth={1.6} /><span>{item.label}</span></button>)}
            </React.Fragment>
          ))}
        </nav>
        <div key={section}>{page}</div>
      </div>
    </div>
  );
}
