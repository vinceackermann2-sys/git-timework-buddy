import React, { useEffect, useRef, useState } from "react";
import { Bot, Brain, Building2, CalendarClock, CreditCard, Info, Palette, Plug, SlidersHorizontal, Sparkles, WandSparkles } from "lucide-react";
import { presets, hexToAccent } from "../../../../shared/appearance.cjs";
import { call, initials } from "../api.js";
import { Avatar, Segmented, Switch, useToast } from "./common.jsx";
import { ModelPicker } from "./Composer.jsx";
import { Memory, Skills } from "./Knowledge.jsx";
import { Automations } from "./Automations.jsx";

export const SECTIONS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "models", label: "Models", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "skills", label: "Skills", icon: WandSparkles },
  { id: "automations", label: "Automations", icon: CalendarClock },
  { id: "apps", label: "Connected apps", icon: Plug },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "about", label: "About", icon: Info },
];

const sameAccent = (a, b) => a && b && Math.abs(a.hue - b.hue) < 0.5 && Math.abs(a.saturation - b.saturation) < 0.01 && Math.abs(a.lightness - b.lightness) < 0.01;

function General({ account, settings, onSetting, onAccount }) {
  const toast = useToast();
  const [name, setName] = useState(account?.user?.name || "");
  const [history, setHistory] = useState(null);
  useEffect(() => { call("history.status").then(setHistory).catch(() => {}); }, []);
  const privateMode = settings.privacy?.mode === "private";
  return (
    <section>
      <h2>General</h2>
      <div className="tw-card">
        <h3>Your profile</h3>
        <form style={{ display: "flex", gap: 8 }} onSubmit={event => { event.preventDefault(); call("profile.update", { name }).then(value => { onAccount(value); toast("Name saved."); }).catch(error => toast(error, "error")); }}>
          <input className="tw-input" value={name} maxLength={100} onChange={event => setName(event.target.value)} aria-label="Preferred name" />
          <button type="submit" className="tw-btn" disabled={!name.trim() || name.trim() === account?.user?.name}>Save</button>
        </form>
        <span className="tw-hint">{account?.user?.email}</span>
      </div>
      <div className="tw-card">
        <div className="tw-setting">
          <div><strong>Reply notifications</strong><span className="tw-hint">Notify me when an agent finishes while Timewarp is in the background.</span></div>
          <Switch label="Reply notifications" checked={settings.notifications?.replies !== false} onChange={value => onSetting("notifications", { ...settings.notifications, replies: value })} />
        </div>
        <div className="tw-setting">
          <div><strong>Privacy Mode</strong><span className="tw-hint">Pauses cloud chat-history sync. Model requests still use the cloud. Files, memory, browser profiles, cookies and the vault always stay on this device.</span></div>
          <Switch label="Privacy Mode" checked={privateMode} onChange={value => onSetting("privacy", { ...settings.privacy, mode: value ? "private" : "standard" })} />
        </div>
        <span className="tw-hint">Chat history: {history?.state === "synced" ? "synced " + new Date(history.lastSyncedAt).toLocaleTimeString() : history?.state === "paused" ? "paused by Privacy Mode" : history?.state === "error" ? "pending (" + history.message + ")" : history?.state || "…"}</span>
      </div>
      {window.tw.platform === "win32" ? <Sandbox /> : null}
    </section>
  );
}

// Windows needs a one-time setup before agents can run commands in a sandbox
// without asking each time. Windows asks the user to approve it.
function Sandbox() {
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
    <div className="tw-card">
      <div className="tw-setting">
        <div>
          <strong>Command sandbox</strong>
          <span className="tw-hint">{ready ? "Agents run commands inside their workspace without asking each time." : "Without it, agents ask before every command. Setup creates restricted Windows accounts for agent commands; Windows asks you to approve it once."}</span>
        </div>
        {ready ? <span className="tw-pill ok">Ready</span> : (
          <button type="button" className="tw-btn" disabled={busy || status === null} onClick={() => { setBusy(true); call("sandbox.setup", { mode: "elevated" }).catch(error => { setBusy(false); toast(error, "error"); }); }}>
            {busy ? "Setting up…" : status === "updateRequired" ? "Update" : "Set up"}
          </button>
        )}
      </div>
    </div>
  );
}

function Colors({ settings, onSetting }) {
  const appearance = settings.appearance || {};
  const set = patch => onSetting("appearance", { ...appearance, ...patch });
  return (
    <section>
      <h2>Colors</h2>
      <div className="tw-card">
        <div className="tw-setting"><div><strong>Theme</strong></div>
          <Segmented label="Theme" value={appearance.scheme || "system"} onChange={scheme => set({ scheme })} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </div>
      </div>
      <div className="tw-card">
        <h3>Accent</h3>
        <div className="tw-swatches">
          {presets.map(preset => {
            const accent = hexToAccent(preset.hex);
            return (
              <button key={preset.hex} type="button" className="tw-swatch" aria-pressed={!!sameAccent(accent, appearance.accent)} onClick={() => set({ accent })}>
                <i style={{ background: preset.hex }} />
                <span>{preset.name}</span>
                <small>{preset.hex}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="tw-card">
        <div className="tw-setting"><div><strong>Radiance</strong><span className="tw-hint">How much of the accent glows through the background.</span></div>
          <input className="tw-range" type="range" min="0" max="1" step="0.05" value={Number(appearance.radiance ?? 0.5)} onChange={event => set({ radiance: Number(event.target.value) })} aria-label="Radiance" />
        </div>
        <div className="tw-setting"><div><strong>Dotted texture</strong></div>
          <Switch label="Dotted texture" checked={appearance.texture?.type === "dots" && appearance.texture.step > 0} onChange={value => set({ texture: { type: "dots", step: value ? 16 : 0 } })} />
        </div>
      </div>
    </section>
  );
}

function Models({ models, onModel }) {
  const [funding, setFunding] = useState(null);
  useEffect(() => { call("funding.get").then(setFunding).catch(() => {}); }, []);
  return (
    <section>
      <h2>Models</h2>
      <div className="tw-card">
        <div className="tw-setting"><div><strong>Default model</strong><span className="tw-hint">New messages use this model and reasoning level.</span></div><ModelPicker models={models} onSelect={onModel} /></div>
        {funding ? <span className="tw-hint">{funding.source === "chatgpt" ? "AI usage comes from your connected ChatGPT / Codex plan." : `AI usage spends Timewarp credits on the ${String(funding.plan || "").replace(/^./, letter => letter.toUpperCase())} plan.`}</span> : null}
      </div>
    </section>
  );
}

function Agents({ agents, onNewAgent, onEditAgent, onArchiveAgent }) {
  return (
    <section>
      <h2>Agents</h2>
      <div className="tw-card">
        <div className="tw-rows">
          {agents.map(agent => (
            <div key={agent.id} className="tw-rows-item">
              <Avatar agent={agent} />
              <strong style={{ flex: 1 }}>{agent.name}</strong>
              <button type="button" className="tw-btn" onClick={() => onEditAgent(agent)}>Edit</button>
              <button type="button" className="tw-btn danger" onClick={() => onArchiveAgent(agent)}>Remove</button>
            </div>
          ))}
        </div>
        <div><button type="button" className="tw-btn primary" onClick={onNewAgent}>New agent</button></div>
      </div>
    </section>
  );
}

function Apps() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const toast = useToast();
  const load = () => call("integrations.list", {}).then(value => { setItems(value.items || []); setError(""); }).catch(failure => setError(failure.message));
  useEffect(() => { void load(); const off = window.tw.on("integrations.changed", () => void load()); return off; }, []);
  const connected = (items || []).filter(item => item.accounts?.length);
  const available = (items || []).filter(item => !item.accounts?.length).sort((a, b) => Number(b.featured) - Number(a.featured));
  const row = item => (
    <div key={item.id} className="tw-rows-item">
      {item.iconUrl ? <img className="tw-avatar" src={item.iconUrl} alt="" /> : <span className="tw-org-picture">{initials(item.displayName)}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{item.displayName}</strong>
        <div className="tw-hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.accounts?.length ? item.accounts.map(account => account.displayName).join(", ") : item.shortDescription}</div>
      </div>
      {item.accounts?.map(account => <button key={account.id} type="button" className="tw-btn" onClick={() => call("integrations.disconnect", { integrationId: item.id, accountId: account.id }).then(load).catch(failure => toast(failure, "error"))}>Disconnect</button>)}
      <button type="button" className="tw-btn" onClick={() => call("integrations.beginConnect", { integrationId: item.id }).then(() => toast("Finish connecting in your browser.")).catch(failure => toast(failure, "error"))}>{item.accounts?.length ? "Add account" : "Connect"}</button>
    </div>
  );
  return (
    <section>
      <h2>Connected apps</h2>
      <p className="tw-hint" style={{ margin: 0 }}>Agents use connected apps through Composio. Connections are authorized in your browser; tokens stay with Composio.</p>
      {error ? <div className="tw-alert">{error}</div> : null}
      {items === null && !error ? <p className="tw-hint">Loading apps…</p> : null}
      {connected.length ? <div className="tw-card"><h3>Connected</h3><div className="tw-rows">{connected.map(row)}</div></div> : null}
      {available.length ? <div className="tw-card"><h3>Available</h3><div className="tw-rows">{available.slice(0, 80).map(row)}</div></div> : null}
    </section>
  );
}

function Billing() {
  const host = useRef(null);
  useEffect(() => { if (host.current) window.timewarpMountBilling?.(host.current); }, []);
  return <section style={{ maxWidth: "none" }}><div ref={host} className="tw-billing-host" /></section>;
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
  return (
    <section>
      <h2>Organization</h2>
      {account?.organizations?.length > 1 ? (
        <div className="tw-card"><div className="tw-setting"><div><strong>Active organization</strong><span className="tw-hint">Chats stay personal when you switch.</span></div>
          <select className="tw-dropdown" style={{ width: 240 }} value={organization?.id || ""} onChange={event => call("organizations.setActive", { organizationId: event.target.value }).then(refresh).catch(error => toast(error, "error"))}>
            {account.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></div></div>
      ) : null}
      {organization ? (
        <div className="tw-card">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="tw-org-picture" style={{ width: 48, height: 48, borderRadius: 12, fontSize: 18 }}>{organization.logo || organization.image ? <img src={organization.logo || organization.image} alt="" /> : initials(organization.name)}</span>
            {manager ? (
              <form style={{ display: "flex", gap: 8, flex: 1 }} onSubmit={event => { event.preventDefault(); call("organizations.update", { name }).then(() => call("account.get")).then(refresh).then(() => toast("Organization saved.")).catch(error => toast(error, "error")); }}>
                <input className="tw-input" value={name} maxLength={120} onChange={event => setName(event.target.value)} aria-label="Organization name" />
                <button type="submit" className="tw-btn" disabled={!name.trim() || name === organization.name}>Save</button>
                <button type="button" className="tw-btn" onClick={() => picture.current?.click()}>Picture</button>
                <input ref={picture} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) uploadPicture(file).then(logo => call("organizations.update", { name: organization.name, logo })).then(() => call("account.get")).then(refresh).catch(error => toast(error, "error")); }} />
              </form>
            ) : <strong>{organization.name}</strong>}
          </div>
        </div>
      ) : null}
      <div className="tw-card">
        <h3>Members</h3>
        <div className="tw-rows">{members.map(member => <div key={member.id} className="tw-rows-item"><span className="tw-org-picture">{initials(member.name || member.email)}</span><div style={{ flex: 1 }}><strong>{member.name || member.email}</strong><div className="tw-hint">{member.email}</div></div><span className="tw-pill">{member.roles?.[0]}</span></div>)}</div>
      </div>
      {manager ? (
        <div className="tw-card">
          <h3>Invite people</h3>
          <form style={{ display: "flex", gap: 8 }} onSubmit={event => { event.preventDefault(); call("organizations.invite", { email, role }).then(() => { setEmail(""); toast("Invitation sent."); void load(); }).catch(error => toast(error, "error")); }}>
            <input className="tw-input" type="email" placeholder="name@company.com" value={email} onChange={event => setEmail(event.target.value)} aria-label="Email" required />
            <select className="tw-dropdown" style={{ width: 130 }} value={role} onChange={event => setRole(event.target.value)} aria-label="Role"><option value="member">Member</option><option value="admin">Admin</option></select>
            <button type="submit" className="tw-btn primary">Invite</button>
          </form>
          {invites.length ? <div className="tw-rows">{invites.map(invite => <div key={invite.id} className="tw-rows-item"><div style={{ flex: 1 }}>{invite.email}<div className="tw-hint">Pending</div></div><button type="button" className="tw-btn" onClick={() => call("organizations.revokeInvite", { invitationId: invite.id }).then(load).catch(error => toast(error, "error"))}>Revoke</button></div>)}</div> : null}
        </div>
      ) : null}
      <div className="tw-card">
        <h3>Create another organization</h3>
        <form style={{ display: "flex", gap: 8 }} onSubmit={event => { event.preventDefault(); call("organizations.create", { name: newName }).then(value => { setNewName(""); refresh(value); toast("Organization created."); }).catch(error => toast(error, "error")); }}>
          <input className="tw-input" value={newName} maxLength={120} placeholder="Organization name" onChange={event => setNewName(event.target.value)} aria-label="New organization name" />
          <button type="submit" className="tw-btn" disabled={!newName.trim()}>Create</button>
        </form>
      </div>
    </section>
  );
}

function About() {
  const [info, setInfo] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { call("app.info").then(setInfo).catch(() => {}); }, []);
  return (
    <section>
      <h2>About</h2>
      <div className="tw-card">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}><img src="./app-icon.svg" alt="" style={{ width: 44, height: 44 }} /><div><strong>Timewarp</strong><div className="tw-hint">Version {info?.version}</div></div></div>
        <span className="tw-hint">Timewarp runs its agents with the OpenAI Codex app server and its built-in browser on Electron. Third-party notices are included with the app.</span>
      </div>
      <div className="tw-card">
        <h3>Send feedback</h3>
        <textarea className="tw-textarea" value={text} onChange={event => setText(event.target.value)} placeholder="Tell us what happened or what could be better." />
        <span className="tw-hint">Your report, app version and platform are sent to Timewarp support.</span>
        <div><button type="button" className="tw-btn primary" disabled={busy || !text.trim()} onClick={() => { setBusy(true); call("feedback.submit", { description: text, category: "general" }).then(() => { setText(""); toast("Thanks, your feedback was sent."); }).catch(error => toast(error, "error")).finally(() => setBusy(false)); }}>Send</button></div>
      </div>
    </section>
  );
}

export function Customize({ section, onSection, ...props }) {
  const content = {
    general: <General {...props} />, colors: <Colors {...props} />, models: <Models {...props} />, agents: <Agents {...props} />, memory: <Memory {...props} />, skills: <Skills />, automations: <Automations {...props} />,
    apps: <Apps />, billing: <Billing />, organization: <Organization {...props} />, about: <About />,
  }[section] || <General {...props} />;
  return (
    <div className="tw-main">
      <div className="tw-customize">
        <nav aria-label="Customize">
          <h1>Customize</h1>
          {SECTIONS.map(item => <button key={item.id} type="button" className="tw-row" aria-current={section === item.id} onClick={() => onSection(item.id)}><item.icon size={16} /><span className="tw-row-title">{item.label}</span></button>)}
        </nav>
        <div className="tw-customize-content" key={section}>{content}</div>
      </div>
    </div>
  );
}
