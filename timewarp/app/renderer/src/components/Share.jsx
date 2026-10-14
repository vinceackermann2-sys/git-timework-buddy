// Share invites between members of an organization. Everything in Timewarp
// stays personal (agents, chats, connected apps, the vault, memory, credits);
// a member can send someone in their organization a copy of a chat, an agent
// or an automation, which that person accepts or declines.
import React, { useCallback, useEffect, useState } from "react";
import { Bot, CalendarClock, MessageSquare, Search } from "lucide-react";
import { call, initials } from "../api.js";
import { Dialog, Switch, useToast } from "./common.jsx";
import { describeSchedule } from "./Automations.jsx";

const NOUN = { chat: "conversation", agent: "agent", automation: "automation" };
const ARTICLE = { chat: "a conversation", agent: "an agent", automation: "an automation" };
const ICON = { chat: MessageSquare, agent: Bot, automation: CalendarClock };
// What a copy carries, said where it is sent and where it is accepted.
const INCLUDED = {
  chat: "They get a copy of its messages. Files, attachments and your connected apps stay with you.",
  agent: "They get a copy of its name, picture, instructions and workflows. It works with their own connected apps and vault; its chats, files and memory stay with you.",
  automation: "They get a copy of its name, instructions and schedule, and choose which of their agents runs it with their own connected apps.",
};
const RECEIVED = {
  chat: "You get your own copy of its messages, under one of your agents. Nothing you add is shared back.",
  agent: "You get your own copy. It uses your connected apps and vault, never theirs, and nothing you change is shared back.",
  automation: "You get your own copy, run by one of your agents with your connected apps. Check the instructions before it runs.",
};
const personName = person => person?.name || person?.email || "Someone";
const when = value => { const at = new Date(value || ""); return Number.isFinite(at.getTime()) ? at.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""; };
const day = value => { const at = new Date(value || ""); return Number.isFinite(at.getTime()) ? at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; };

// Opens the share dialog from anywhere: a chat's menu, an agent's menu, the
// agent page or an automation. Shell.jsx shows the dialog.
export const shareItem = (kind, id, title) => window.dispatchEvent(new CustomEvent("tw:share", { detail: { kind, id, title } }));

// "Share conversation": choose members of the active organization and send.
export function ShareDialog({ request, account, onClose, onInvite }) {
  const organization = account?.activeOrganization;
  const [members, setMembers] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  useEffect(() => {
    if (!request) return;
    setChosen(new Set()); setQuery(""); setError(""); setBusy(false); setMembers(null);
    call("organizations.members").then(list => setMembers((Array.isArray(list) ? list : []).filter(member => member.userId && member.userId !== account?.user?.id)))
      .catch(failure => { setMembers([]); setError(failure?.message || String(failure)); });
  }, [request]);
  const needle = query.trim().toLowerCase();
  const shown = (members || []).filter(member => !needle || [member.name, member.email].some(value => String(value || "").toLowerCase().includes(needle)));
  const toggle = userId => setChosen(current => { const next = new Set(current); if (next.has(userId)) next.delete(userId); else next.add(userId); return next; });
  const manager = (organization?.roles || []).some(role => ["owner", "admin"].includes(role));
  const send = async event => {
    event.preventDefault();
    if (!chosen.size || busy) return;
    setBusy(true); setError("");
    try {
      await call("shares.send", { kind: request.kind, id: request.id, organizationId: organization?.id, recipientUserIds: [...chosen] });
      const names = (members || []).filter(member => chosen.has(member.userId)).map(personName);
      toast(names.length === 1 ? `Shared with ${names[0]}.` : `Shared with ${names.length} people.`);
      onClose();
    } catch (failure) { setError(failure?.message || String(failure)); setBusy(false); }
  };
  const kind = request?.kind || "chat";
  return (
    <Dialog open={!!request} onClose={() => { if (!busy) onClose(); }} title={`Share ${NOUN[kind]}`} className="tw-share-dialog"
      description={request ? <>Send a copy of <strong>{request.title || NOUN[kind]}</strong> to people in {organization?.name || "your organization"}. They choose whether to accept it.</> : null}>
      {request ? (
        <form className="tw-import" onSubmit={send}>
          {members === null ? <p className="tw-hint">Loading members…</p> : !members.length ? (
            <div className="tw-empty-box tw-share-empty">
              <span>No one else is in {organization?.name || "your organization"} yet.</span>
              {manager ? <button type="button" className="tw-btn" onClick={() => { onClose(); onInvite?.(); }}>Invite members</button> : null}
            </div>
          ) : (
            <>
              {members.length > 6 ? (
                <label className="tw-search-field"><Search size={16} /><input className="tw-input" type="search" autoFocus value={query} placeholder="Search members" aria-label="Search members" onChange={event => setQuery(event.target.value)} /></label>
              ) : null}
              <div className="tw-rows-card tw-share-people" role="group" aria-label="Members">
                {shown.map(member => (
                  <label key={member.userId} className="tw-share-person">
                    <input type="checkbox" checked={chosen.has(member.userId)} disabled={busy} onChange={() => toggle(member.userId)} />
                    <span className="tw-face small">{initials(member.name || member.email).slice(0, 1)}</span>
                    <span className="grow"><strong>{member.name || member.email}</strong>{member.name && member.email ? <small>{member.email}</small> : null}</span>
                  </label>
                ))}
                {!shown.length ? <p className="tw-hint tw-share-none">No members match your search.</p> : null}
              </div>
            </>
          )}
          <p className="tw-hint">{INCLUDED[kind]}</p>
          {error ? <p className="tw-alert" role="alert">{error}</p> : null}
          <div className="tw-dialog-actions">
            <button type="button" className="tw-btn" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className="tw-btn primary" disabled={busy || !chosen.size}>{busy ? "Sharing…" : chosen.size > 1 ? `Share with ${chosen.size}` : "Share"}</button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

const readList = key => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
const writeList = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value.slice(-200))); } catch {} };

// Shares waiting for an answer, checked every minute and after any change.
export function useShares() {
  const [shares, setShares] = useState({ incoming: [], outgoing: [], loaded: false });
  const load = useCallback(() => call("shares.list").then(value => setShares({ incoming: value?.incoming || [], outgoing: value?.outgoing || [], loaded: true })).catch(() => setShares(current => ({ ...current, loaded: true }))), []);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 60 * 1000);
    window.addEventListener("tw:shares", load);
    return () => { clearInterval(timer); window.removeEventListener("tw:shares", load); };
  }, [load]);
  return shares;
}
const sharesChanged = () => window.dispatchEvent(new Event("tw:shares"));

// "<Name> shared an agent with you": a share that arrived, offered once with
// Not now, Decline and Accept. Not now leaves it in Settings → Organization.
// onAccepted(result) opens the copy: { kind, conversationId?, agentId?, automationId? }.
export function IncomingShares({ agents, onAccepted }) {
  const { incoming } = useShares();
  const [dismissed, setDismissed] = useState(() => readList("tw.dismissedShares"));
  const [reviewing, setReviewing] = useState(null);
  const [agentId, setAgentId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [content, setContent] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const toast = useToast();
  // A share opened from Settings → Organization shows even when put off before.
  useEffect(() => {
    const review = ({ detail }) => { if (detail?.id) setReviewing(detail.id); };
    window.addEventListener("tw:review-share", review);
    return () => window.removeEventListener("tw:review-share", review);
  }, []);
  // One at a time, and not over another dialog. After an answer the next one
  // waits for a later check, so the copy just added shows first.
  const [restUntil, setRestUntil] = useState(0);
  const offered = Date.now() < restUntil || document.querySelector("dialog[open]") ? null : incoming.find(item => !dismissed.includes(item.id));
  const waiting = incoming.find(item => item.id === reviewing) || offered || null;
  const [share, setShare] = useState(null);
  useEffect(() => { if (!share && waiting) setShare(waiting); }, [waiting?.id]);
  const usable = agents.filter(agent => !agent.archivedAt);
  // The agent chosen, or the first one while none is.
  const agentChoice = usable.some(agent => agent.id === agentId) ? agentId : usable[0]?.id || "";
  useEffect(() => {
    if (!share) return;
    setError(""); setEnabled(true); setContent(null);
    // An automation shows its whole instructions before it can run.
    if (share.kind === "automation") call("shares.open", { shareId: share.id }).then(value => setContent(value?.payload || null)).catch(failure => setError(failure?.message || String(failure)));
  }, [share?.id]);
  const close = () => { setShare(null); setReviewing(null); setBusy(null); setRestUntil(Date.now() + 45 * 1000); };
  const later = () => { if (busy || !share) return; const next = [...dismissed, share.id]; setDismissed(next); writeList("tw.dismissedShares", next); close(); };
  const answer = async accept => {
    if (busy || !share) return;
    setBusy(accept ? "accept" : "decline"); setError("");
    try {
      if (accept) {
        const result = await call("shares.accept", { shareId: share.id, agentId: share.kind === "agent" ? undefined : agentChoice, enabled });
        toast(share.kind === "chat" ? "Conversation added." : share.kind === "agent" ? "Agent added." : enabled ? "Automation added and turned on." : "Automation added. It's off until you turn it on.");
        close(); sharesChanged(); onAccepted?.(result);
      } else {
        await call("shares.decline", { shareId: share.id });
        close(); sharesChanged();
      }
    } catch (failure) {
      setError(failure?.message || String(failure)); setBusy(null);
      if (failure?.status === 404) sharesChanged();
    }
  };
  const kind = share?.kind || "chat";
  const Icon = ICON[kind];
  const summary = share?.summary || {};
  const needsAgent = kind !== "agent";
  return (
    <Dialog open={!!share} onClose={later} label={share ? `${personName(share.sender)} shared ${ARTICLE[kind]} with you` : "Shared with you"} className="tw-share-dialog">
      {share ? (
        <>
          <div className="tw-dialog-head">
            <div>
              <h2>{personName(share.sender)} shared {ARTICLE[kind]} with you</h2>
              <p>{share.sender?.name && share.sender?.email ? share.sender.email + " · " : ""}{share.organizationName ? share.organizationName + " · " : ""}{when(share.createdAt)}</p>
            </div>
          </div>
          <div className="tw-rows-card tw-share-item">
            <span className="tw-share-icon">{kind === "agent" && summary.mascot ? <img src={`./mascots/${String(summary.mascot).toLowerCase()}.png`} alt="" /> : <Icon size={18} strokeWidth={1.7} />}</span>
            <span className="grow">
              <strong>{share.title}</strong>
              {kind === "chat" ? <small>{summary.messages ? `${summary.messages} message${summary.messages === 1 ? "" : "s"}` : "Conversation"}{summary.agentName ? ` with ${summary.agentName}` : ""}{summary.omitted ? ` · the latest ${summary.messages} of ${summary.messages + summary.omitted}` : ""}</small> : null}
              {kind === "agent" ? <small>{summary.workflows?.length ? `Workflows: ${summary.workflows.join(", ")}` : "No workflows"}</small> : null}
              {kind === "automation" ? <small>{describeSchedule((content ? content.schedule : summary.schedule) || {})}{summary.agentName ? ` · run by ${summary.agentName}` : ""}</small> : null}
              {kind !== "automation" && (summary.preview || summary.description) ? <span className="tw-share-preview">{summary.preview || summary.description}</span> : null}
            </span>
          </div>
          {kind === "automation" ? (
            <div className="tw-field"><span>Instructions</span><div className="tw-share-instructions">{content ? (typeof content.instructions === "string" ? content.instructions : "") : error ? "" : "Loading…"}</div></div>
          ) : null}
          {needsAgent ? (
            usable.length ? (
              <label className="tw-field"><span>{kind === "chat" ? "Add to" : "Run with"}</span>
                <select className="tw-dropdown" value={agentChoice} disabled={!!busy} onChange={event => setAgentId(event.target.value)}>
                  {usable.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
            ) : <p className="tw-alert">Add an agent first, then accept this.</p>
          ) : null}
          {kind === "automation" ? <div className="tw-automation-enabled"><span>Turn on now</span><Switch label="Turn on now" checked={enabled} disabled={!!busy} onChange={setEnabled} /></div> : null}
          <p className="tw-hint">{RECEIVED[kind]}</p>
          {error ? <p className="tw-alert" role="alert">{error}</p> : null}
          <div className="tw-dialog-actions">
            <button type="button" className="tw-btn tw-push-left" disabled={!!busy} onClick={later}>Not now</button>
            <button type="button" className="tw-btn ghost danger" disabled={!!busy} onClick={() => void answer(false)}>{busy === "decline" ? "Declining…" : "Decline"}</button>
            <button type="button" className="tw-btn primary" disabled={!!busy || (needsAgent && !agentChoice) || (kind === "automation" && !content)} onClick={() => void answer(true)}>{busy === "accept" ? "Adding…" : "Accept"}</button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

// Settings → Organization: shares waiting for you (Review) and those you sent (Cancel).
export function SharesSection() {
  const { incoming, outgoing } = useShares();
  const [canceling, setCanceling] = useState(null);
  const toast = useToast();
  const cancel = share => {
    setCanceling(share.id);
    call("shares.cancel", { shareId: share.id }).then(() => { toast("Share canceled."); sharesChanged(); }).catch(error => toast(error, "error")).finally(() => setCanceling(null));
  };
  const row = (share, person, action) => {
    const Icon = ICON[share.kind] || MessageSquare;
    return (
      <tr key={share.id}>
        <td><span className="tw-member"><Icon size={16} strokeWidth={1.7} /><span className="tw-ellipsis">{share.title}</span></span></td>
        <td>{personName(person)}</td>
        <td>{day(share.createdAt)}</td>
        <td className="end">{action}</td>
      </tr>
    );
  };
  return (
    <>
      {incoming.length ? (
        <>
          <div className="tw-section-head"><h3 className="tw-muted-head">Shared with you</h3><span className="tw-hint">{incoming.length} waiting</span></div>
          <div className="tw-rows-card tw-members-card">
            <table className="tw-members tw-share-table">
              <thead><tr><th>Shared</th><th>From</th><th>Sent</th><th className="end">Action</th></tr></thead>
              <tbody>{incoming.map(share => row(share, share.sender, <button type="button" className="tw-btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("tw:review-share", { detail: { id: share.id } }))}>Review</button>))}</tbody>
            </table>
          </div>
        </>
      ) : null}
      {outgoing.length ? (
        <>
          <div className="tw-section-head"><h3 className="tw-muted-head">Shared by you</h3><span className="tw-hint">{outgoing.length} waiting for an answer</span></div>
          <div className="tw-rows-card tw-members-card">
            <table className="tw-members tw-share-table">
              <thead><tr><th>Shared</th><th>With</th><th>Sent</th><th className="end">Action</th></tr></thead>
              <tbody>{outgoing.map(share => row(share, share.recipient, <button type="button" className="tw-btn ghost" disabled={!!canceling} onClick={() => cancel(share)}>{canceling === share.id ? "Canceling…" : "Cancel"}</button>))}</tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

// A shared chat's first line: who shared it, and when.
export function useSharedChat(conversationId) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let live = true;
    setInfo(null);
    call("shares.chatInfo", { conversationId }).then(value => { if (live) setInfo(value || null); }).catch(() => {});
    return () => { live = false; };
  }, [conversationId]);
  return info;
}
export const sharedBy = info => info ? `${personName(info.from)} shared this conversation${info.sharedAt ? " on " + day(info.sharedAt) : ""}` : null;
