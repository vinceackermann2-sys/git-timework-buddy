import React, { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, BadgeCheck, CalendarClock, Check, ChevronLeft, Copy, CreditCard, EllipsisVertical, ExternalLink, FileText, Globe, IdCard, KeyRound, LoaderCircle, Mail, Monitor, Paperclip, Pencil, Phone, Play, Plug, Plus, Reply, Share, ShieldAlert, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { accountText, call, relativeTime, useEvent } from "../api.js";
import { Markdown } from "../markdown.jsx";
import { Avatar, Dialog, Menu, Segmented, Switch, useConfirm, useToast } from "./common.jsx";
import { AppIcon, useApps } from "./Composer.jsx";
import { AutomationDialog, describeSchedule } from "./Automations.jsx";
import { shareItem } from "./Share.jsx";

// The agent's page in its pane, one page with everything down the left: who
// it is at the top (its name and picture, and its Agent ID: the ID, owner,
// model and the apps it's used in), then its instructions, what its Agent ID
// gives it (mail, phone, wallet, card, computer, vault), the apps its owner
// connected for it, the automations that run it and its activity.
// Agent ID is Timewarp's own (the agent-id cloud function, agent-id.cjs):
// the app calls it directly, other harnesses use its CLI and people its
// website. Money goes in and out on the website, where the payment
// providers' own pages run; everything else is here. The owner's pages (the
// website, its terms, the identity check) open in the Agent ID window, which
// no agent reaches (agent-id-window.cjs), signed in. Its key stays in the
// main process, encrypted.
export const AGENT_PAGES = { instructions: "Instructions", mail: "Mail", phone: "Phone", wallet: "Wallet", card: "Card", vm: "Computer", vault: "Vault", connectors: "Connectors", automations: "Automations", activity: "Activity" };
export const AGENT_SECTIONS = Object.keys(AGENT_PAGES);
const ICONS = { instructions: FileText, mail: Mail, phone: Phone, wallet: Wallet, card: CreditCard, vm: Monitor, vault: KeyRound, connectors: Plug, automations: CalendarClock, activity: Activity };
const ORDER = ["mail", "wallet", "card", "vm", "phone"];
// The sections that come with an Agent ID; the others work without one.
const NEEDS_ID = new Set([...ORDER, "vault", "activity"]);
// "What to add" asked in the agent's chat, as the agent page asks it.
const AUTOMATION_PROMPT = "Help me set up an automation for this agent. Work out with me whether it should run on a schedule or when something happens.";
const MACHINE = { running: "Running", stopped: "Stopped", suspended: "Stopped", idle: "Idle", starting: "Starting", stopping: "Stopping", provisioning: "Setting up" };

// The last Agent ID seen for each agent, so its pages show at once.
const seen = new Map();
const usd = money => money && Number.isFinite(money.amount) ? new Intl.NumberFormat(undefined, { style: "currency", currency: money.currency || "USD" }).format(money.amount / 100) : null;
const short = value => { const text = String(value || ""); return /^0x[0-9a-f]{40}$/i.test(text) ? `${text.slice(0, 6)}…${text.slice(-4)}` : text; };
const agentCall = (agent, op, input) => call("agentId.call", { agentId: agent.id, op, input });
// A model's id as people say it: "claude-opus-5-5" → "Claude Opus 5.5" (as the website does).
function modelLabel(model) {
  const parts = [];
  for (const part of String(model || "").replace(/^.*\//, "").split(/[-_\s]+/).filter(Boolean)) {
    const last = parts[parts.length - 1];
    if (/^\d{1,2}$/.test(part) && last && /^\d{1,2}$/.test(last)) parts[parts.length - 1] = `${last}.${part}`; else parts.push(part);
  }
  return parts.map(part => part.toLowerCase() === "gpt" ? "GPT" : /^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)).join(" ").replace(/^GPT (\d)/, "GPT-$1");
}
const modelText = model => { if (!model) return null; const made = [model.provider, model.name].filter(Boolean).join(" "); return model.kind === "agent" && !made ? null : made ? `${model.label || "AI"} · ${made}` : model.label; };
// What waits for the owner's yes, in words.
function approvalText(approval) {
  const request = approval.request || {}, summary = request.summary || {};
  const to = Array.isArray(summary.to) ? summary.to.join(", ") : summary.to;
  if (approval.kind === "wallet_transfer") return `Send ${usd({ amount: Number(request.amount), currency: request.currency || "USD" }) || "money"} to ${short(request.to)}`;
  if (request.kind === "mail") return `Send mail to ${to || "someone"}${summary.subject ? `: ${summary.subject}` : ""}`;
  if (request.kind === "sms") return `Text ${to || "someone"}`;
  if (request.kind === "call") return `Call ${to || "someone"}`;
  if (request.kind === "contacts") return "Change its contacts";
  if (request.kind === "vault") return "Save to its vault";
  return "Something that waits for your yes";
}

// Sealing a vault item on this page before it goes anywhere, as the website
// does (src/lib/agent-id/vault.ts): an AES-256-GCM key encrypts the item, and
// the agent's computer's public key (RSA-OAEP, SHA-256) wraps that key. Only
// the computer's vault can open it.
const base64 = bytes => { let text = ""; for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte); return btoa(text); };
async function sealForVault(publicKeyPem, secret) {
  const subtle = crypto.subtle;
  const spki = Uint8Array.from(atob(publicKeyPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), c => c.charCodeAt(0));
  const computer = await subtle.importKey("spki", spki, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aes = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(secret)));
  const key = await subtle.encrypt({ name: "RSA-OAEP" }, computer, await subtle.exportKey("raw", aes));
  return { v: 1, key: base64(key), iv: base64(iv), data: base64(data) };
}
// "api.github.com, *.example.com" → the hosts a key may be sent to, or null.
function parseHosts(input) {
  const hosts = String(input).split(/[\s,]+/).map(host => host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
  const valid = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  return hosts.length && hosts.length <= 20 && hosts.every(host => valid.test(host)) ? [...new Set(hosts)] : null;
}
const siteOrigin = input => { try { const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); return url.protocol === "https:" && url.hostname.includes(".") ? url.origin : null; } catch { return null; } };

// Loads the agent's Agent ID (shown from the last time first); null when it
// can't be reached and nothing was seen before.
function useAgentId(agent) {
  const [identity, setIdentity] = useState(() => seen.get(agent.id));
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const load = useCallback(() => call("agentId.get", { agentId: agent.id })
    .then(value => { seen.set(agent.id, value); if (live.current) setIdentity(value); return value; })
    .catch(() => { if (live.current) setIdentity(current => current ?? null); return null; }), [agent.id]);
  useEffect(() => { setIdentity(seen.get(agent.id)); void load(); }, [agent.id]);
  // Back from the Agent ID window, where money moves and the identity check runs.
  useEvent("agentId.changed", () => void load());
  // While the owner's identity is being checked: how it's going, every few
  // seconds for a few minutes (the provider's answer comes by webhook).
  useEffect(() => {
    if (identity?.owner?.status !== "pending") return;
    const again = () => void load(), started = Date.now();
    const timer = setInterval(() => { if (Date.now() - started > 180000) clearInterval(timer); else again(); }, 5000);
    window.addEventListener("focus", again);
    return () => { clearInterval(timer); window.removeEventListener("focus", again); };
  }, [identity?.owner?.status, load]);
  return [identity, load, setIdentity];
}

// The owner's pages on the Agent ID website (the agent's page at one of its
// tabs, the terms) open in the Agent ID window, signed in.
function useOpenAgentId(agent) {
  const toast = useToast();
  return (page, tab) => call("agentId.open", { agentId: agent?.id, page, tab }).catch(error => toast(error, "error"));
}

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copy = () => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => toast(`Unable to copy the ${label}.`, "error"));
  return <button type="button" className="tw-icon-button" title={copied ? "Copied" : "Copy"} aria-label={copied ? `Copied ${label}` : `Copy ${label}`} onClick={copy}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>;
}

// The owner's identity check, once for all their agents. Bridge or Stripe
// check an ID document and a selfie on their own page, in the Agent ID
// window; without either, Agent ID reviews a name and a country (form is
// that question, for the caller to show).
const CHECKERS = { bridge: "Bridge, a Stripe company,", stripe_identity: "Stripe" };
const onProviderPage = identity => !["test", "manual"].includes(identity?.owner?.check);
function useVerify(identity, onStarted) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const confirm = useConfirm(), toast = useToast();
  const start = details => {
    setBusy(true);
    return call("agentId.verify", details || {}).then(result => {
      toast(result.status === "verified" ? "You're verified." : result.opened ? "Finish the check in the Agent ID window." : "Your identity is being checked.");
      setAsking(false);
      onStarted?.();
    }).catch(error => toast(error, "error")).finally(() => setBusy(false));
  };
  const verify = async () => {
    if (!onProviderPage(identity)) { setAsking(true); return; }
    // A check already started continues where it was.
    if (identity?.owner?.status !== "pending" && !await confirm({
      title: "Verify your identity?", action: "Continue",
      body: `${CHECKERS[identity?.owner?.check] || "Agent ID's partner"} checks a picture of your ID document and a selfie, in a window of its own. It takes about two minutes, and you do it once for all your agents. Agent ID records that you agreed to this check.`,
    })) return;
    await start();
  };
  const form = <VerifyForm open={asking} busy={busy} onClose={() => setAsking(false)} onSubmit={start} />;
  return [verify, busy, form];
}

// A check without a provider: the owner's legal name and country, reviewed by Agent ID.
function VerifyForm({ open, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ legalName: "", country: "", consent: false });
  const ready = form.legalName.trim() && /^[A-Za-z]{2}$/.test(form.country.trim()) && form.consent;
  const set = key => event => setForm(current => ({ ...current, [key]: key === "consent" ? event.target.checked : event.target.value }));
  const submit = event => { event.preventDefault(); if (ready && !busy) void onSubmit({ legalName: form.legalName.trim(), country: form.country.trim().toUpperCase() }); };
  return (
    <Dialog open={open} onClose={onClose} title="Verify your identity" description="Once for all your agents, so Agent ID can trace them to you.">
      <form className="tw-aid-form" onSubmit={submit}>
        <label className="tw-field"><span>Legal name</span><input className="tw-input" autoFocus autoComplete="name" maxLength={200} value={form.legalName} onChange={set("legalName")} /></label>
        <label className="tw-field"><span>Country</span><input className="tw-input" autoComplete="country" maxLength={2} placeholder="US" value={form.country} onChange={set("country")} /></label>
        <div className="tw-aid-checks"><label><input type="checkbox" checked={form.consent} onChange={set("consent")} />I confirm these are my real details.</label></div>
        <div className="tw-dialog-actions">
          <button type="button" className="tw-btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="tw-btn primary" disabled={!ready || busy}>{busy ? "Sending…" : "Verify"}</button>
        </div>
      </form>
    </Dialog>
  );
}

// A resource's state in the agent page's left side, at a glance.
function summary(kind, identity, glance) {
  if (kind === "vault") return !identity.resources?.vm ? "Not set up" : !glance.vault ? "" : !glance.vault.ready ? "Not set up" : glance.vault.count ? `${glance.vault.count} item${glance.vault.count === 1 ? "" : "s"}` : "Empty";
  const has = identity.resources?.[kind], offer = identity.available?.[kind];
  if (has) {
    if (kind === "mail") return has.address + (glance.mail?.unread ? ` · ${glance.mail.unread} unread` : "");
    if (kind === "wallet") return glance.wallet ? usd(glance.wallet.balance) || "Balance unavailable" : short(has.address);
    if (kind === "card") return has.last4 ? `${has.brand || "Card"} •••• ${has.last4}` : has.label || "Card";
    if (kind === "vm") return MACHINE[glance.vm?.state] || MACHINE[has.status] || "Computer";
    return has.address || "Number";
  }
  if (offer?.waitlist) return glance[kind]?.applied ? "Applied" : "Join the waitlist";
  if (offer && !offer.live) return "Not available yet";
  // As the website says it: the computer is set up the first time the agent uses it.
  return kind === "vm" ? "Starts on first use" : "Not set up";
}

// Getting the agent an Agent ID, once the person accepts its terms. onMade
// gets the new Agent ID.
function useGetAgentId(agent, onMade) {
  const [creating, setCreating] = useState(false);
  const toast = useToast(), confirm = useConfirm(), open = useOpenAgentId(agent);
  // The terms open in the Agent ID window, over the question.
  const create = async () => {
    const terms = <>{agent.name} gets its own identity in Timewarp Agent ID. Its key is kept encrypted on this computer. By continuing you accept the <button type="button" className="tw-link" onClick={() => void open("terms")}>Agent ID Terms</button>.</>;
    if (!await confirm({ title: `Get an Agent ID for ${agent.name}?`, body: terms, action: "Get Agent ID" })) return;
    setCreating(true);
    call("agentId.create", { agentId: agent.id }).then(value => { seen.set(agent.id, value); onMade(value); }).catch(error => toast(error, "error")).finally(() => setCreating(false));
  };
  return [create, creating];
}

// ---- A resource's page --------------------------------------------------

// A page of items, newer ones first, with "Load more".
function usePages(load, deps) {
  const [state, setState] = useState({ items: null, more: false, error: null });
  const latest = useRef(0);
  const fetch = before => {
    const run = ++latest.current;
    return load(before).then(({ items, more }) => { if (run === latest.current) setState(current => ({ items: before ? [...(current.items || []), ...items] : items, more, error: null })); })
      .catch(error => { if (run === latest.current) setState(current => ({ ...current, items: current.items || [], error })); });
  };
  useEffect(() => { setState({ items: null, more: false, error: null }); void fetch(); }, deps);
  return { ...state, reload: () => fetch(), loadMore: () => fetch(state.items?.at(-1)?.at) };
}

function List({ pages, empty, children }) {
  if (pages.items === null) return <p className="tw-hint tw-agent-note">Loading…</p>;
  if (pages.error && !pages.items.length) return <p className="tw-hint tw-agent-note">{pages.error.message || "Agent ID can't be reached right now."}</p>;
  if (!pages.items.length) return <p className="tw-hint tw-agent-note">{empty}</p>;
  return <>{pages.items.map(children)}{pages.more ? <button type="button" className="tw-agent-action inner" onClick={() => void pages.loadMore()}>Load more</button> : null}</>;
}

const Section = ({ title, action, children }) => (
  <>
    {title ? <div className="tw-agent-page-row">{<h3>{title}</h3>}{action || null}</div> : null}
    <div className="tw-agent-card">{children}</div>
  </>
);

// What the page shows before the agent has the resource: setting it up, or
// applying for it, or verifying first.
function Missing({ agent, identity, kind, onAdded }) {
  const offer = identity.available?.[kind] || {};
  const [busy, setBusy] = useState(false);
  const toast = useToast(), confirm = useConfirm();
  const [verify, verifying, verifyForm] = useVerify(identity, onAdded);
  if (offer.waitlist) return kind === "card" ? <CardApplication agent={agent} /> : <PhoneApplication agent={agent} />;
  if (!offer.live) return <Section><p className="tw-hint tw-agent-note">Agent ID doesn't offer this yet.</p></Section>;
  if (offer.verificationRequired && identity.owner?.status !== "verified") {
    const status = identity.owner?.status;
    // A check on the provider's page can be continued; one Agent ID reviews can't.
    const waiting = status === "pending" && !onProviderPage(identity);
    return (
      <Section>
        <button type="button" className="tw-agent-action" disabled={verifying || waiting} onClick={() => void verify()}>
          <ShieldAlert size={16} />{status === "pending" ? (waiting ? "Your identity is being checked" : "Continue verifying your identity") : `Verify your identity to get a ${AGENT_PAGES[kind].toLowerCase()}`}
        </button>
        {status === "rejected" && identity.owner?.error ? <p className="tw-hint tw-agent-note">The last check didn't pass: {identity.owner.error}</p> : null}
        {verifyForm}
      </Section>
    );
  }
  const add = async () => {
    if (kind === "vm" && !await confirm({ title: `Set up a computer for ${agent.name}?`, body: "It runs in the cloud and uses credits while it runs. It stops by itself when it's not used.", action: "Set up" })) return;
    setBusy(true);
    agentCall(agent, "resource.add", { kind }).then(() => onAdded()).catch(error => toast(error, "error")).finally(() => setBusy(false));
  };
  const Icon = ICONS[kind];
  return (
    <Section>
      {kind === "vm" ? <p className="tw-hint tw-agent-note">{agent.name}'s computer starts the first time it's used.</p> : null}
      <button type="button" className={"tw-agent-action" + (kind === "vm" ? " inner" : "")} disabled={busy} onClick={() => void add()}>{busy ? <LoaderCircle size={16} className="tw-spin" /> : <Icon size={16} />}{busy ? "Setting up…" : `Set up ${kind === "vm" ? "the computer now" : kind === "mail" ? "mail" : "a wallet"}`}</button>
    </Section>
  );
}

// ---- The agent page ---------------------------------------------------------

// Who the agent is, as the top of its page on the website: its name and
// picture (choosing either edits the agent), whether its owner is verified,
// its model, the apps it's used in and its ID; or getting it an Agent ID.
// The menu holds what's done to the agent as a whole.
function AgentHeader({ agent, identity, onChanged, onMade, onEditAgent, onArchiveAgent }) {
  const [verify, busy, verifyForm] = useVerify(identity, onChanged);
  const [create, creating] = useGetAgentId(agent, onMade);
  const confirm = useConfirm(), open = useOpenAgentId(agent);
  const linked = !!identity?.linked;
  const kind = linked ? modelText(identity.model) : null, owner = linked ? identity.owner?.status : null;
  const who = linked ? [identity.owner?.legalName, identity.owner?.country].filter(Boolean).join(" · ") : "";
  const remove = async () => {
    if (await confirm({ title: `Remove ${agent.name}?`, body: "This removes the agent and its conversations from your sidebar. Its workspace folder stays on this computer.", action: "Remove", danger: true })) onArchiveAgent(agent);
  };
  return (
    <section className="tw-aid-id" aria-label={agent.name}>
      <button type="button" className="tw-aid-picture" title="Edit agent" aria-label="Edit agent picture" onClick={() => onEditAgent(agent)}><Avatar agent={agent} /></button>
      <div className="tw-aid-id-body">
        <div className="tw-aid-id-top">
          <button type="button" className="tw-aid-name" title={linked && identity.name && identity.name !== agent.name ? `${identity.name} in Agent ID` : "Edit agent"} onClick={() => onEditAgent(agent)}><strong>{agent.name}</strong><Pencil size={13} /></button>
          {owner === "verified" ? <span className="tw-badge tw-aid-verified" title={who || undefined}><BadgeCheck size={12} />Verified owner</span>
            : owner === "pending" ? (onProviderPage(identity) ? <button type="button" className="tw-badge tw-aid-verify" disabled={busy} title="Continue the identity check" onClick={() => void verify()}>Owner being checked · Continue</button> : <span className="tw-badge">Owner being checked</span>)
              : owner === "rejected" ? <button type="button" className="tw-badge tw-aid-verify" disabled={busy} title={identity.owner?.error || undefined} onClick={() => void verify()}>Owner not verified · Try again</button>
                : owner ? <button type="button" className="tw-badge tw-aid-verify" disabled={busy} onClick={() => void verify()}>Owner not verified · Verify</button> : null}
          {verifyForm}
          {linked && identity.status === "suspended" ? <span className="tw-badge">Paused</span> : null}
        </div>
        {kind ? <span className="tw-hint">{kind}</span> : null}
        {linked && identity.apps?.length ? <div className="tw-aid-apps"><span className="tw-hint">Used in</span>{identity.apps.map(app => <span key={app.app} className="tw-badge">{app.model ? `${app.label} · ${modelLabel(app.model)}` : app.label}</span>)}</div> : null}
        {linked ? (
          <div className="tw-aid-key">
            <code title={identity.handle ? `${identity.id} (${identity.handle})` : identity.id}>{identity.id}</code><CopyButton value={identity.id} label="Agent ID" />
            <span title={identity.keyStored ? "Its key is encrypted with this computer's own key store. Timewarp never shows it or gives it to the model." : undefined}><ShieldCheck size={13} className="tw-agent-secure" />{identity.keyStored ? "Key encrypted on this computer" : "Saved in your Timewarp account"}</span>
          </div>
        ) : identity === null ? <span className="tw-hint">Agent ID can't be reached right now.</span>
          : identity ? <div><button type="button" className="tw-btn small primary" disabled={creating} onClick={() => void create()}>{creating ? <LoaderCircle size={14} className="tw-spin" /> : <IdCard size={14} />}{creating ? "Getting Agent ID…" : "Get Agent ID"}</button></div> : null}
      </div>
      <Menu align="right" width={224} trigger={({ toggle, open }) => <button type="button" className="tw-icon-button" aria-label="Agent actions" aria-expanded={open} onClick={toggle}><EllipsisVertical size={16} /></button>}>
        <button type="button" className="tw-menu-item" data-close onClick={() => onEditAgent(agent)}><Pencil size={16} /><span className="grow">Edit agent</span></button>
        {linked ? <button type="button" className="tw-menu-item" data-close onClick={() => void open("agent")}><ExternalLink size={16} /><span className="grow">Open Agent ID</span></button> : null}
        <button type="button" className="tw-menu-item" data-close onClick={() => shareItem("agent", agent.id, agent.name)}><Share size={16} /><span className="grow">Share agent</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => void remove()}><Trash2 size={16} /><span className="grow">Remove agent</span></button>
      </Menu>
    </section>
  );
}

// What waits for the owner's yes: a payment above the agent's approval amount,
// or an action they asked it to ask about first.
function Approvals({ agent }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const read = useCallback(() => agentCall(agent, "approvals.list").then(value => setItems(value.approvals || [])).catch(() => {}), [agent.id]);
  useEffect(() => { void read(); const timer = setInterval(() => void read(), 20000); return () => clearInterval(timer); }, [read]);
  const decide = (item, decision) => {
    setBusy(item.id);
    agentCall(agent, "approvals.decide", { id: item.id, decision }).then(() => toast(decision === "approve" ? "Approved." : "Denied.")).catch(error => toast(error, "error")).finally(() => { setBusy(null); void read(); });
  };
  if (!items.length) return null;
  return (
    <div className="tw-agent-card tw-aid-approvals">
      {items.map(item => (
        <div key={item.id} className="tw-agent-tool">
          <ShieldAlert size={16} strokeWidth={1.7} /><span className="desc" title={approvalText(item)}><strong>{agent.name} asks:</strong> {approvalText(item)}</span>
          <button type="button" className="tw-btn small" disabled={busy === item.id} onClick={() => decide(item, "deny")}>Deny</button>
          <button type="button" className="tw-btn small primary" disabled={busy === item.id} onClick={() => decide(item, "approve")}>Approve</button>
        </div>
      ))}
    </div>
  );
}

// Each Agent ID section's state down the left, as the website's AgentNav shows it.
function navValue(key, identity, glance) {
  if (!identity?.linked || identity.offline || !identity.resources) return "";
  if (ORDER.includes(key) || key === "vault") { const text = summary(key, identity, glance); return key === "mail" && identity.resources.mail ? (glance.mail?.unread ? `${glance.mail.unread} unread` : "") : text; }
  return "";
}

// The agent's page: who it is at the top, what waits for its owner, and its
// sections down the left (a row across the top when the pane is narrow).
// Instructions, connectors and automations work without an Agent ID.
export function AgentPage({ agent, section, onSection, onEditAgent, onAgentChanged, onSettings, onArchiveAgent, onAsk }) {
  const [identity, load, setIdentity] = useAgentId(agent);
  const [glance, setGlance] = useState({});
  // Raised after a change on a section, so the left side shows it too.
  const [changes, setChanges] = useState(0);
  const changed = () => { void load(); setChanges(value => value + 1); };
  const linked = !!identity?.linked && !identity.offline;
  const kinds = linked && identity.resources ? ORDER.filter(kind => identity.resources[kind]) : [];
  useEffect(() => {
    if (!linked) return;
    let live = true;
    call("agentId.glance", { agentId: agent.id, kinds }).then(value => { if (live) setGlance(value); }).catch(() => {});
    return () => { live = false; };
  }, [agent.id, identity?.id, linked, kinds.join(), section, changes]);
  const current = AGENT_PAGES[section] ? section : "instructions";
  const View = { mail: MailView, phone: PhoneView, wallet: WalletView, card: CardView, vm: ComputerView }[current];
  const body = current === "instructions" ? <InstructionsView agent={agent} />
    : current === "connectors" ? <ConnectorsView agent={agent} identity={identity} onSettings={onSettings} onAgentChanged={onAgentChanged} />
      : current === "automations" ? <AutomationsView agent={agent} onAsk={onAsk} />
          : identity === undefined ? <p className="tw-hint">Loading…</p>
            : identity === null || identity.offline ? <Section><p className="tw-hint tw-agent-note">Agent ID can't be reached right now.</p></Section>
              : !identity.linked ? <Section><p className="tw-hint tw-agent-note">{current === "activity" ? "What the agent does with its Agent ID shows here." : `${AGENT_PAGES[current]} comes with an Agent ID.`}</p></Section>
                : current === "vault" ? <VaultView agent={agent} onChanged={changed} />
                  : current === "activity" ? <ActivityView agent={agent} />
                    : identity.resources?.[current] ? <View agent={agent} identity={identity} resource={identity.resources[current]} />
                      : <Missing agent={agent} identity={identity} kind={current} onAdded={changed} />;
  return (
    <div className="tw-aid-root">
      <AgentHeader agent={agent} identity={identity} onChanged={() => void load()} onMade={value => { setIdentity(value); changed(); }} onEditAgent={onEditAgent} onArchiveAgent={onArchiveAgent} />
      {linked ? <Approvals agent={agent} /> : null}
      <div className="tw-aid-shell">
        <nav className="tw-aid-nav" aria-label={agent.name}>
          {AGENT_SECTIONS.map(key => {
            const Icon = ICONS[key], value = NEEDS_ID.has(key) ? navValue(key, identity, glance) : "";
            return (
              <button key={key} type="button" aria-current={key === current ? "page" : undefined} onClick={() => onSection(key)}>
                <Icon size={16} strokeWidth={1.7} /><span><strong>{AGENT_PAGES[key]}</strong>{value ? <small title={value}>{value}</small> : null}</span>
              </button>
            );
          })}
        </nav>
        <div className="tw-aid-content tw-aid-page" key={current}>{body}</div>
      </div>
    </div>
  );
}

// ---- Vault ----------------------------------------------------------------

// Sign-ins and keys kept only on the agent's computer, sealed here before
// they leave this computer; the agent uses a key without ever seeing it.
function VaultView({ agent, onChanged }) {
  const [state, setState] = useState(null);
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast(), confirm = useConfirm();
  const read = () => agentCall(agent, "vault.get").then(setState).catch(error => setState({ error }));
  useEffect(() => { void read(); }, [agent.id]);
  const setup = async () => {
    if (state?.vault?.computer === "none" && !await confirm({ title: `Set up a vault for ${agent.name}?`, body: "It lives on the agent's own computer, which runs in the cloud and uses credits while it runs.", action: "Set up" })) return;
    setBusy(true);
    agentCall(agent, "vault.setup").then(value => { setState(value); onChanged?.(); }).catch(error => toast(error, "error")).finally(() => setBusy(false));
  };
  const remove = async item => {
    if (!await confirm({ title: `Remove ${item.label}?`, body: "It's deleted from the agent's computer.", action: "Remove", danger: true })) return;
    agentCall(agent, "vault.remove", { id: item.id }).then(() => { void read(); onChanged?.(); }).catch(error => toast(error, "error"));
  };
  if (!state) return <p className="tw-hint">Loading…</p>;
  if (state.error) return <p className="tw-hint">{state.error.message}</p>;
  const { vault, items = [] } = state;
  if (vault.computer === "replace") return <Section><p className="tw-hint tw-agent-note">{agent.name}'s computer is from before vaults. Replace it on the Agent ID website to use one.</p></Section>;
  if (!vault.ready) return <Section><button type="button" className="tw-agent-action" disabled={busy} onClick={() => void setup()}>{busy ? <LoaderCircle size={16} className="tw-spin" /> : <KeyRound size={16} />}{busy ? "Setting up…" : "Set up the vault"}</button></Section>;
  if (adding) return <VaultForm agent={agent} kind={adding} publicKey={vault.publicKey} onClose={saved => { setAdding(null); if (saved) { void read(); onChanged?.(); } }} />;
  return (
    <>
      <div className="tw-agent-page-row tw-aid-tabs first">
        <span className="tw-hint">Sealed on {agent.name}'s computer; neither Timewarp nor the AI can read them.</span>
        <Menu align="right" width={180} trigger={({ toggle }) => <button type="button" className="tw-btn small primary" onClick={toggle}><Plus size={14} />Add</button>}>
          <button type="button" className="tw-menu-item" data-close onClick={() => setAdding("login")}><Globe size={15} /><span className="grow">Sign-in</span></button>
          <button type="button" className="tw-menu-item" data-close onClick={() => setAdding("key")}><KeyRound size={15} /><span className="grow">Key</span></button>
        </Menu>
      </div>
      <div className="tw-agent-card">
        {items.length ? items.map(item => (
          <div key={item.id} className="tw-agent-tool">
            {item.kind === "login" ? <Globe size={16} strokeWidth={1.7} /> : <KeyRound size={16} strokeWidth={1.7} />}
            <strong>{item.label}</strong><span className="desc">{[item.kind === "login" ? item.site : (item.hosts || []).join(", "), item.savedBy === "agent" ? "saved by the agent" : null].filter(Boolean).join(" · ")}</span>
            <button type="button" className="tw-icon-button" title="Remove" aria-label={`Remove ${item.label}`} onClick={() => void remove(item)}><Trash2 size={12} /></button>
          </div>
        )) : <p className="tw-hint tw-agent-note">Nothing in the vault yet.</p>}
      </div>
    </>
  );
}

const SEND_AS = [{ value: "bearer", label: "Bearer token" }, { value: "header", label: "Header" }, { value: "query", label: "Query parameter" }, { value: "basic", label: "Password" }];
function VaultForm({ agent, kind, publicKey, onClose }) {
  const [form, setForm] = useState({ label: "", site: "", username: "", password: "", value: "", hosts: "", as: "bearer", name: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const origin = kind === "login" ? siteOrigin(form.site) : null, hosts = kind === "key" ? parseHosts(form.hosts) : null;
  const ready = kind === "login" ? !!origin && !!form.password : !!hosts && !!form.value && (["bearer"].includes(form.as) || !!form.name.trim());
  const save = async event => {
    event.preventDefault();
    setBusy(true);
    try {
      const secret = kind === "login"
        ? { kind: "login", site: origin, username: form.username.trim(), password: form.password }
        : { kind: "key", value: form.value, hosts, send: form.as === "bearer" ? { as: "bearer" } : form.as === "basic" ? { as: "basic", username: form.name.trim() } : { as: form.as, name: form.name.trim() } };
      const envelope = await sealForVault(publicKey, secret);
      await agentCall(agent, "vault.add", { label: form.label.trim() || (kind === "login" ? origin.replace(/^https:\/\//, "") : hosts[0]), envelope });
      toast("Saved to the vault.");
      onClose(true);
    } catch (error) { toast(error, "error"); setBusy(false); }
  };
  return (
    <form className="tw-aid-form" onSubmit={save} autoComplete="off">
      <button type="button" className="tw-agent-add tw-aid-back" onClick={() => onClose(false)}><ChevronLeft size={12} />Vault</button>
      {kind === "login" ? (
        <>
          <label className="tw-field"><span>Website</span><input className="tw-input" value={form.site} autoFocus onChange={set("site")} placeholder="github.com" /></label>
          <label className="tw-field"><span>Username</span><input className="tw-input" value={form.username} onChange={set("username")} /></label>
          <label className="tw-field"><span>Password</span><input className="tw-input" type="password" value={form.password} onChange={set("password")} /></label>
        </>
      ) : (
        <>
          <label className="tw-field"><span>Key</span><input className="tw-input" type="password" value={form.value} autoFocus onChange={set("value")} /></label>
          <label className="tw-field"><span>Sites it may be sent to</span><input className="tw-input" value={form.hosts} onChange={set("hosts")} placeholder="api.example.com" /></label>
          <div className="tw-field"><span>Sent as</span><Segmented label="Sent as" value={form.as} onChange={value => setForm(current => ({ ...current, as: value }))} options={SEND_AS} /></div>
          {form.as !== "bearer" ? <label className="tw-field"><span>{form.as === "basic" ? "Username" : form.as === "header" ? "Header name" : "Parameter name"}</span><input className="tw-input" value={form.name} onChange={set("name")} placeholder={form.as === "header" ? "X-API-Key" : form.as === "query" ? "api_key" : ""} /></label> : null}
        </>
      )}
      <label className="tw-field"><span>Name</span><input className="tw-input" value={form.label} maxLength={100} onChange={set("label")} placeholder="Optional" /></label>
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn" disabled={busy} onClick={() => onClose(false)}>Cancel</button>
        <button type="submit" className="tw-btn primary" disabled={!ready || busy}>{busy ? "Sealing…" : "Save"}</button>
      </div>
    </form>
  );
}

// ---- Instructions -------------------------------------------------------------

// Its workspace AGENTS.md, as the previous app showed it, edited here as Markdown.
function InstructionsView({ agent }) {
  const [instructions, setInstructions] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => { call("agents.workspaceInstructions", { id: agent.id }).then(value => setInstructions(value.instructions || "")).catch(() => setInstructions("")); }, [agent.id, agent.name, agent.updatedAt]);
  const save = () => {
    setSaving(true);
    call("agents.saveWorkspaceInstructions", { id: agent.id, instructions: draft }).then(value => { setInstructions(value.instructions || ""); setDraft(null); })
      .catch(error => toast(error, "error")).finally(() => setSaving(false));
  };
  if (draft !== null) return (
    <div className="tw-agent-editor">
      <textarea className="tw-textarea" autoFocus value={draft} maxLength={50000} aria-label="Instructions (Markdown)" disabled={saving} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setDraft(null); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) save(); }} />
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn" disabled={saving} onClick={() => setDraft(null)}>Cancel</button>
        <button type="button" className="tw-btn primary" disabled={saving || draft === instructions} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
  return (
    <>
      <div className="tw-agent-page-row tw-aid-tabs first">
        <span className="tw-hint">What {agent.name} follows in every chat.</span>
        {instructions !== null ? <button type="button" className="tw-btn small" onClick={() => setDraft(instructions)}><Pencil size={14} />Edit</button> : null}
      </div>
      <div className="tw-agent-card tw-agent-instructions">
        {instructions === null ? <p className="tw-hint">…</p> : instructions ? <Markdown text={instructions} /> : <p className="tw-hint">No instructions yet.</p>}
      </div>
    </>
  );
}

// ---- Connectors ------------------------------------------------------------

// The apps the owner connected that this agent may use, which its Agent ID
// uses wherever the agent runs, and whether it may use the vault without asking.
function ConnectorsView({ agent, identity, onSettings, onAgentChanged }) {
  const { items } = useApps();
  const [access, setAccess] = useState(undefined);
  const toast = useToast();
  useEffect(() => { call("integrations.getAccess", { agentId: agent.id }).then(value => setAccess(value.items ?? null)).catch(() => setAccess(null)); }, [agent.id, items]);
  const accounts = (items || []).filter(app => app.accounts?.length).flatMap(app => app.accounts.map(account => ({ app, account })));
  const allowed = entry => access == null || access.some(item => item.integrationId === entry.app.id && item.accountId === entry.account.id);
  const save = async next => {
    const value = next.length === accounts.length ? null : next.map(entry => ({ kind: "integration", owner: "user", integrationId: entry.app.id, accountId: entry.account.id }));
    const previous = access;
    setAccess(value);
    try { await call("integrations.setAccess", { agentId: agent.id, items: value }); } catch (error) { setAccess(previous); toast(error, "error"); }
  };
  const toggle = (entry, on) => void save(on ? [...accounts.filter(allowed), entry] : accounts.filter(item => allowed(item) && item !== entry));
  // Accounts waiting to reconnect are listed too, as before; choosing one reconnects it for this agent.
  const waiting = (items || []).filter(app => app.pendingAccounts?.length).flatMap(app => app.pendingAccounts.map(account => ({ app, account })));
  const reconnect = entry => call("integrations.beginConnect", { integrationId: entry.app.id, agentId: agent.id, reconnectAccountId: entry.account.id }).then(() => toast("Finish connecting in the window that opened.")).catch(error => toast(error, "error"));
  const setVault = value => call("agents.update", { id: agent.id, vaultAccess: value }).then(() => onAgentChanged?.()).catch(error => toast(error, "error"));
  const everywhere = identity?.linked && identity.connectorsAvailable !== false;
  return (
    <>
      <p className="tw-hint tw-aid-lead">{everywhere ? `${agent.name} can use these wherever it runs, through its Agent ID.` : `${agent.name} uses these in Timewarp.`}</p>
      <div className="tw-agent-card">
        {items === undefined || access === undefined ? <p className="tw-hint tw-agent-note">Loading…</p> : accounts.map(entry => (
          <div key={entry.app.id + entry.account.id} className="tw-agent-tool">
            <AppIcon app={entry.app} /><strong>{entry.app.displayName}</strong><span className="desc" title={accountText(entry.account)}>{accountText(entry.account)}</span>
            <Switch label={`${agent.name} can use ${entry.app.displayName} ${accountText(entry.account)}`} checked={allowed(entry)} onChange={on => toggle(entry, on)} />
          </div>
        ))}
        {waiting.map(entry => (
          <button key={entry.app.id + entry.account.id} type="button" className="tw-agent-tool tw-agent-tool-button" title="Reconnect" onClick={() => void reconnect(entry)}>
            <AppIcon app={entry.app} /><strong>{entry.app.displayName}</strong><span className="desc" title={accountText(entry.account)}>{accountText(entry.account)} (Authentication expired — reconnect required)</span>
          </button>
        ))}
        <button type="button" className={"tw-agent-action" + (accounts.length || waiting.length ? " inner" : "")} onClick={() => onSettings?.("tools")}><Plus size={16} />Connect an app</button>
      </div>
      <div className="tw-agent-card">
        <div className="tw-agent-tool">
          <KeyRound size={16} strokeWidth={1.7} /><strong>Vault access</strong><span className="desc">Use all vault credentials and create passkeys without asking again</span>
          <Switch label={`${agent.name} can use the vault`} checked={!!agent.vaultAccess} onChange={setVault} />
        </div>
      </div>
    </>
  );
}

// ---- Automations -------------------------------------------------------------

// What runs the agent on a schedule. They run here, in Timewarp, and show on its
// Agent ID, where pausing, resuming or running one comes back here.
function AutomationsView({ agent, onAsk }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const toast = useToast();
  const read = useCallback(() => call("automations.list").then(all => setList(all.filter(item => item.agentId === agent.id))).catch(() => setList([])), [agent.id]);
  useEffect(() => { void read(); }, [read]);
  useEvent("automations.changed", () => void read());
  const setEnabled = (item, enabled) => call("automations.update", { id: item.id, enabled }).catch(error => toast(error, "error"));
  const run = item => call("automations.run", { id: item.id }).then(() => toast("Running now.")).catch(error => toast(error, "error"));
  return (
    <>
      <div className="tw-agent-card">
        {list === null ? <p className="tw-hint tw-agent-note">Loading…</p> : list.map(item => (
          <div key={item.id} className="tw-agent-tool">
            <CalendarClock size={16} strokeWidth={1.7} />
            <button type="button" className="tw-aid-link" onClick={() => setOpen(item.id)}><strong>{item.name}</strong><span className="desc">{item.enabled ? describeSchedule(item.schedule) : "Paused"}{item.lastRun ? ` · last ${relativeTime(item.lastRun.finishedAt || item.lastRun.startedAt)}` : ""}</span></button>
            <button type="button" className="tw-icon-button tw-aid-run" title="Run now" aria-label={`Run ${item.name} now`} onClick={() => void run(item)}><Play size={12} /></button>
            <Switch label={`${item.name} runs`} checked={!!item.enabled} onChange={on => void setEnabled(item, on)} />
          </div>
        ))}
        <button type="button" className={"tw-agent-action" + (list?.length ? " inner" : "")} onClick={() => onAsk?.(AUTOMATION_PROMPT)}><Plus size={16} />Add automation</button>
      </div>
      <AutomationDialog automation={list?.find(item => item.id === open) || null} onClose={() => setOpen(null)} onRan={ranIn => { if (ranIn) location.hash = "#/conversation/" + ranIn; }} />
    </>
  );
}

// ---- Activity -----------------------------------------------------------------

const EVENT_KINDS = { mail: ["Mail", Mail], sms: ["Text", Phone], call: ["Call", Phone], wallet: ["Wallet", Wallet], card: ["Card", CreditCard], vm: ["Computer", Monitor] };
function ActivityView({ agent }) {
  const pages = usePages(before => agentCall(agent, "activity", { before }).then(value => ({ items: value.events || [], more: !!value.more })), [agent.id]);
  return (
    <div className="tw-agent-card">
      <List pages={pages} empty="Nothing yet.">
        {item => {
          const [label, Icon] = EVENT_KINDS[item.kind] || [item.kind, Activity];
          return (
            <div key={item.id} className="tw-agent-tool">
              <Icon size={16} strokeWidth={1.7} />
              <span className="desc tw-aid-tx"><span className="tw-ellipsis">{item.subject || short(item.counterparty) || label}</span><small>{[label, item.direction === "in" ? "in" : item.direction === "out" ? "out" : null, relativeTime(item.at)].filter(Boolean).join(" · ")}</small></span>
              {item.amount ? <strong className={item.direction === "in" ? "tw-aid-in" : ""}>{usd(item.amount)}</strong> : null}
            </div>
          );
        }}
      </List>
    </div>
  );
}

// ---- Mail ----------------------------------------------------------------

function MailView({ agent, resource }) {
  const [folder, setFolder] = useState("inbox");
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const pages = usePages(before => agentCall(agent, "mail.list", { folder, before }).then(value => ({ items: value.messages || [], more: !!value.more })), [agent.id, folder]);
  if (draft) return <Compose agent={agent} draft={draft} onClose={sent => { setDraft(null); if (sent) { setOpenId(null); if (folder === "sent") void pages.reload(); else setFolder("sent"); } }} />;
  if (openId) return <MailMessage agent={agent} id={openId} folder={folder} onBack={() => setOpenId(null)} onReply={message => setDraft({ replyTo: message.id, to: message.counterparty || "", subject: /^re:/i.test(message.subject || "") ? message.subject : `Re: ${message.subject || ""}`.trim(), text: "" })} />;
  return (
    <>
      <div className="tw-agent-card">
        <div className="tw-agent-tool"><Mail size={16} strokeWidth={1.7} /><code className="desc tw-agent-id" title={resource.address}>{resource.address}</code><CopyButton value={resource.address} label="address" /></div>
      </div>
      <div className="tw-agent-page-row tw-aid-tabs">
        <Segmented label="Mailbox" value={folder} onChange={setFolder} options={[{ value: "inbox", label: "Inbox" }, { value: "sent", label: "Sent" }]} />
        <button type="button" className="tw-btn small primary" onClick={() => setDraft({ to: "", subject: "", text: "" })}><Plus size={14} />New mail</button>
      </div>
      <div className="tw-agent-card">
        <List pages={pages} empty={folder === "inbox" ? "No mail yet." : "Nothing sent yet."}>
          {message => (
            <button key={message.id} type="button" className={"tw-aid-row" + (!message.read && message.direction === "in" ? " unread" : "")} onClick={() => setOpenId(message.id)}>
              <span className="tw-aid-row-top"><strong className="tw-ellipsis">{message.counterparty || "Unknown"}</strong>{message.attachments?.length ? <Paperclip size={12} /> : null}<time>{relativeTime(message.at)}</time></span>
              <span className="tw-ellipsis">{message.subject || "(no subject)"}</span>
              {message.preview ? <span className="tw-aid-preview">{message.preview}</span> : null}
            </button>
          )}
        </List>
      </div>
    </>
  );
}

function MailMessage({ agent, id, folder, onBack, onReply }) {
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { agentCall(agent, "mail.read", { id }).then(value => setMessage(value.message)).catch(setError); }, [id]);
  return (
    <>
      <button type="button" className="tw-agent-add tw-aid-back" onClick={onBack}><ChevronLeft size={12} />{folder === "sent" ? "Sent" : "Inbox"}</button>
      <div className="tw-agent-card tw-aid-message">
        {error ? <p className="tw-hint">{error.message}</p> : !message ? <p className="tw-hint">Loading…</p> : (
          <>
            <h2>{message.subject || "(no subject)"}</h2>
            <p className="tw-hint">{message.direction === "in" ? "From" : "To"} {message.counterparty || "Unknown"} · {new Date(message.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
            <div className="tw-aid-body">{message.text || ""}</div>
            {message.attachments?.length ? <p className="tw-hint tw-aid-files"><Paperclip size={12} />{message.attachments.map(file => file.filename).join(", ")}</p> : null}
            {message.direction === "in" ? <div className="tw-dialog-actions"><button type="button" className="tw-btn small" onClick={() => onReply(message)}><Reply size={14} />Reply</button></div> : null}
          </>
        )}
      </div>
    </>
  );
}

function Compose({ agent, draft, onClose }) {
  const [value, setValue] = useState(draft);
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const set = key => event => setValue(current => ({ ...current, [key]: event.target.value }));
  const send = event => {
    event.preventDefault();
    setSending(true);
    agentCall(agent, "mail.send", value).then(result => { toast(result.note || "Sent."); onClose(true); }).catch(error => toast(error, "error")).finally(() => setSending(false));
  };
  return (
    <form className="tw-aid-form" onSubmit={send}>
      <button type="button" className="tw-agent-add tw-aid-back" onClick={() => onClose(false)}><ChevronLeft size={12} />Mail</button>
      <label className="tw-field"><span>To</span><input className="tw-input" value={value.to} required autoFocus={!value.to} onChange={set("to")} placeholder="name@example.com" /></label>
      <label className="tw-field"><span>Subject</span><input className="tw-input" value={value.subject} required onChange={set("subject")} /></label>
      <label className="tw-field"><span>Message</span><textarea className="tw-textarea" value={value.text} required autoFocus={!!value.to} onChange={set("text")} /></label>
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn" disabled={sending} onClick={() => onClose(false)}>Cancel</button>
        <button type="submit" className="tw-btn primary" disabled={sending}>{sending ? "Sending…" : `Send as ${agent.name}`}</button>
      </div>
    </form>
  );
}

// ---- Wallet --------------------------------------------------------------

function Transaction({ item }) {
  const incoming = item.direction === "in";
  return (
    <div className="tw-agent-tool">
      {incoming ? <ArrowDownLeft size={16} strokeWidth={1.7} /> : <ArrowUpRight size={16} strokeWidth={1.7} />}
      <span className="desc tw-aid-tx"><span className="tw-ellipsis">{item.subject || short(item.counterparty) || (incoming ? "Received" : "Sent")}</span><small>{item.status === "completed" || item.status === "approved" ? relativeTime(item.at) : `${item.status} · ${relativeTime(item.at)}`}</small></span>
      <strong className={incoming ? "tw-aid-in" : ""}>{item.amount ? (incoming ? "+" : "−") + usd(item.amount) : ""}</strong>
    </div>
  );
}

function WalletView({ agent }) {
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { agentCall(agent, "wallet.get").then(value => setWallet(value.wallet)).catch(setError); }, [agent.id]);
  const pages = usePages(before => agentCall(agent, "wallet.transactions", { before }).then(value => ({ items: value.transactions || [], more: !!value.more })), [agent.id]);
  // Money moves on the providers' own pages, on the website's wallet tab.
  const open = useOpenAgentId(agent);
  const site = () => void open("agent", "wallet");
  const network = wallet?.network === "test" ? "Test money" : wallet?.network === "base" ? "USDC and USDT on Base" : wallet?.network ? `USDC and USDT on ${wallet.network}` : "";
  return (
    <>
      <div className="tw-agent-card tw-aid-balance">
        {error ? <p className="tw-hint">{error.message}</p> : !wallet ? <p className="tw-hint">Loading…</p> : (
          <>
            <span className="tw-hint">Balance</span>
            <strong>{wallet.balanceError ? "Unavailable" : usd(wallet.balance) || usd({ amount: 0, currency: "USD" })}</strong>
            <span className="tw-hint">{network}</span>
            {wallet.address ? <span className="tw-aid-address"><code title={wallet.address}>{short(wallet.address)}</code><CopyButton value={wallet.address} label="wallet address" /></span> : null}
            <div className="tw-aid-actions">
              <button type="button" className="tw-btn small primary" onClick={site}>Add money<ExternalLink size={12} /></button>
              <button type="button" className="tw-btn small" onClick={site}>Withdraw<ExternalLink size={12} /></button>
            </div>
            {wallet.sent?.last30Days?.amount ? <span className="tw-hint">Sent in the last 30 days: {usd(wallet.sent.last30Days)}</span> : null}
          </>
        )}
      </div>
      <Section title="Transactions">
        <List pages={pages} empty="No transactions yet.">{item => <Transaction key={item.id} item={item} />}</List>
      </Section>
    </>
  );
}

// ---- Card ----------------------------------------------------------------

function CardView({ agent, resource }) {
  const [card, setCard] = useState(null);
  useEffect(() => { agentCall(agent, "card.get").then(value => setCard(value.card)).catch(() => setCard({})); }, [agent.id]);
  const pages = usePages(before => agentCall(agent, "card.transactions", { before }).then(value => ({ items: value.transactions || [], more: !!value.more })), [agent.id]);
  const details = card || resource;
  const limit = card?.limits?.monthly;
  return (
    <>
      <div className="tw-agent-card tw-aid-balance">
        <span className="tw-hint">{details.brand || "Card"}</span>
        <strong>•••• {details.last4 || "····"}</strong>
        <span className="tw-hint">{[card?.expMonth && card?.expYear ? `Expires ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` : null, card?.status === "active" ? "Active" : card?.status ? "Paused" : null].filter(Boolean).join(" · ")}</span>
        {card?.spent?.last30Days ? <span className="tw-hint">Spent in the last 30 days: {usd(card.spent.last30Days)}{limit ? ` of ${usd({ amount: limit, currency: card.currency || "USD" })}` : ""}</span> : null}
      </div>
      <Section title="Payments">
        <List pages={pages} empty="No payments yet.">{item => <Transaction key={item.id} item={{ ...item, direction: item.direction === "in" ? "in" : "out" }} />}</List>
      </Section>
    </>
  );
}

// Early access, until cards and numbers are open to everyone.
function useApplication(agent, kind) {
  const [application, setApplication] = useState(undefined);
  useEffect(() => { agentCall(agent, `${kind}.application`).then(value => setApplication(value.application || null)).catch(() => setApplication(null)); }, [agent.id, kind]);
  return [application, setApplication];
}

function Applied({ application, lines }) {
  return (
    <Section>
      <div className="tw-agent-tool"><Check size={16} strokeWidth={1.7} className="tw-agent-secure" /><strong>Applied</strong><span className="desc">{relativeTime(application.createdAt)}</span></div>
      <p className="tw-hint tw-agent-note">{lines.filter(Boolean).join(" · ")}</p>
    </Section>
  );
}

function CardApplication({ agent }) {
  const [application, setApplication] = useApplication(agent, "card");
  const [form, setForm] = useState({ useCase: "", monthly: "", country: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (application === undefined) return <p className="tw-hint">Loading…</p>;
  if (application) return <Applied application={application} lines={[application.useCase, application.monthlySpend ? `${usd(application.monthlySpend)} a month` : null, application.country]} />;
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const cents = Math.round(Number(form.monthly) * 100);
  const ready = form.useCase.trim() && cents > 0 && /^[A-Za-z]{2}$/.test(form.country.trim());
  const apply = event => {
    event.preventDefault();
    setBusy(true);
    agentCall(agent, "card.apply", { useCase: form.useCase.trim(), monthlySpend: cents, country: form.country.trim().toUpperCase() }).then(value => setApplication(value.application)).catch(error => toast(error, "error")).finally(() => setBusy(false));
  };
  return (
    <form className="tw-aid-form" onSubmit={apply}>
      <p className="tw-hint">Virtual cards are in early access. Apply for one for {agent.name}.</p>
      <label className="tw-field"><span>What it pays for</span><textarea className="tw-textarea" value={form.useCase} maxLength={500} onChange={set("useCase")} placeholder="Software subscriptions and API usage" /></label>
      <label className="tw-field"><span>Monthly spend (USD)</span><input className="tw-input" inputMode="decimal" value={form.monthly} onChange={set("monthly")} placeholder="200" /></label>
      <label className="tw-field"><span>Country</span><input className="tw-input" value={form.country} maxLength={2} onChange={set("country")} placeholder="US" /></label>
      <div className="tw-dialog-actions"><button type="submit" className="tw-btn primary" disabled={!ready || busy}>{busy ? "Applying…" : "Apply"}</button></div>
    </form>
  );
}

// ---- Computer ------------------------------------------------------------

function ComputerView({ agent }) {
  const [machine, setMachine] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const read = () => agentCall(agent, "computer.get").then(value => setMachine(value.machine)).catch(error => setMachine({ error }));
  useEffect(() => { void read(); }, [agent.id]);
  const pages = usePages(before => agentCall(agent, "computer.commands", { before }).then(value => ({ items: value.commands || [], more: !!value.more })), [agent.id]);
  const running = machine?.state === "running" || machine?.state === "idle";
  const power = () => {
    setBusy(true);
    agentCall(agent, running ? "computer.stop" : "computer.start").then(value => { setMachine(current => ({ ...current, state: value.machine?.state || current.state })); if (value.machine?.note) toast(value.machine.note); })
      .catch(error => toast(error, "error")).finally(() => setBusy(false));
  };
  return (
    <>
      <div className="tw-agent-card">
        {!machine ? <p className="tw-hint tw-agent-note">Loading…</p> : machine.error ? <p className="tw-hint tw-agent-note">{machine.error.message}</p> : (
          <div className="tw-agent-tool">
            <Monitor size={16} strokeWidth={1.7} /><strong>{MACHINE[machine.state] || "Computer"}</strong><span className="desc">{[machine.size ? machine.size[0].toUpperCase() + machine.size.slice(1) : null, machine.note].filter(Boolean).join(" · ")}</span>
            <button type="button" className={"tw-btn small" + (running ? "" : " primary")} disabled={busy || ["starting", "stopping", "provisioning"].includes(machine.state)} onClick={power}>{busy ? <LoaderCircle size={14} className="tw-spin" /> : null}{running ? "Stop" : "Start"}</button>
          </div>
        )}
      </div>
      <Section title="Recent commands">
        <List pages={pages} empty="It hasn't run anything yet.">
          {item => (
            <div key={item.id} className="tw-agent-tool">
              <code className="desc tw-agent-id" title={item.subject || ""}>{item.subject || ""}</code>
              <span className={"tw-badge" + (item.status === "completed" ? "" : " tw-aid-failed")}>{item.status === "completed" ? "Done" : `Exit ${item.data?.exitCode ?? "?"}`}</span>
              <time className="tw-hint">{relativeTime(item.at)}</time>
            </div>
          )}
        </List>
      </Section>
    </>
  );
}

// ---- Phone ---------------------------------------------------------------

function PhoneView({ agent, resource }) {
  const [tab, setTab] = useState("texts");
  const pages = usePages(before => agentCall(agent, tab === "texts" ? "phone.texts" : "phone.calls", { before }).then(value => ({ items: value.messages || value.calls || [], more: !!value.more })), [agent.id, tab]);
  return (
    <>
      <div className="tw-agent-card">
        <div className="tw-agent-tool"><Phone size={16} strokeWidth={1.7} /><code className="desc tw-agent-id">{resource.address}</code><CopyButton value={resource.address} label="number" /></div>
      </div>
      <div className="tw-agent-page-row tw-aid-tabs"><Segmented label="Phone" value={tab} onChange={setTab} options={[{ value: "texts", label: "Texts" }, { value: "calls", label: "Calls" }]} /></div>
      <div className="tw-agent-card">
        <List pages={pages} empty={tab === "texts" ? "No texts yet." : "No calls yet."}>
          {item => (
            <div key={item.id} className="tw-aid-row static">
              <span className="tw-aid-row-top">{item.direction === "in" ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}<strong className="tw-ellipsis">{item.counterparty || "Unknown"}</strong><time>{relativeTime(item.at)}</time></span>
              {item.text ? <span className="tw-aid-preview">{item.text}</span> : null}
            </div>
          )}
        </List>
      </div>
    </>
  );
}

function PhoneApplication({ agent }) {
  const [application, setApplication] = useApplication(agent, "phone");
  const [form, setForm] = useState({ useCase: "", country: "", uses: ["sms", "calls"] });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (application === undefined) return <p className="tw-hint">Loading…</p>;
  if (application) return <Applied application={application} lines={[application.useCase, (application.uses || []).map(use => use === "sms" ? "texts" : "calls").join(" and "), application.country]} />;
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const toggle = use => setForm(current => ({ ...current, uses: current.uses.includes(use) ? current.uses.filter(item => item !== use) : [...current.uses, use] }));
  const ready = form.useCase.trim() && form.uses.length && /^[A-Za-z]{2}$/.test(form.country.trim());
  const apply = event => {
    event.preventDefault();
    setBusy(true);
    agentCall(agent, "phone.apply", { useCase: form.useCase.trim(), uses: form.uses, country: form.country.trim().toUpperCase() }).then(value => setApplication(value.application)).catch(error => toast(error, "error")).finally(() => setBusy(false));
  };
  return (
    <form className="tw-aid-form" onSubmit={apply}>
      <p className="tw-hint">Phone numbers are in early access. Apply for one for {agent.name}.</p>
      <label className="tw-field"><span>What it's for</span><textarea className="tw-textarea" value={form.useCase} maxLength={1000} onChange={set("useCase")} placeholder="Booking appointments and confirming deliveries" /></label>
      <div className="tw-field"><span>Uses</span>
        <div className="tw-aid-checks">{[["sms", "Texts"], ["calls", "Calls"]].map(([use, label]) => <label key={use}><input type="checkbox" checked={form.uses.includes(use)} onChange={() => toggle(use)} />{label}</label>)}</div>
      </div>
      <label className="tw-field"><span>Country</span><input className="tw-input" value={form.country} maxLength={2} onChange={set("country")} placeholder="US" /></label>
      <div className="tw-dialog-actions"><button type="submit" className="tw-btn primary" disabled={!ready || busy}>{busy ? "Applying…" : "Apply"}</button></div>
    </form>
  );
}
