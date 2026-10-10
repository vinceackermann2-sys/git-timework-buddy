import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ArrowUpRight, Check, ChevronDown, Clipboard, CreditCard, Gauge, LoaderCircle, Mic, Plus, Reply, RotateCcw, Search, Sparkles, Square, TriangleAlert, UserRound, X } from "lucide-react";
import { call, initials, request, useEvent } from "../api.js";
import { Avatar, Dialog, Menu, useToast } from "./common.jsx";
import { useDictation } from "../dictation.js";
import { FileIcon } from "../widgets.jsx";
import { addMention, clipboardLabel, composeMessage, insertMention, largePaste, mentionGroups, mentionQuery, mentionToken, presentMentions, removeMention } from "../mentions.mjs";

import { EFFORT_LABELS, ModelPicker, modelName } from "./ModelPicker.jsx";

const MAX_ATTACHMENT = 100 * 1024 * 1024, MAX_FILES = 10;
// The model and thinking picker lives in ModelPicker.jsx.
export { EFFORT_LABELS, ModelPicker, modelName };

// Prompts sent from a composer, newest first, recalled with the arrow keys
// as before (50 per chat, kept on this device).
const PROMPTS = 50;
const promptsKey = key => "tw.prompts." + key;
function readPrompts(key) { try { const list = JSON.parse(localStorage.getItem(promptsKey(key)) || "[]"); return Array.isArray(list) ? list.filter(item => typeof item === "string") : []; } catch { return []; } }
export function rememberPrompt(key, text) {
  if (!key || !String(text || "").trim()) return;
  const list = readPrompts(key);
  if (list[0] === text) return;
  try { localStorage.setItem(promptsKey(key), JSON.stringify([text, ...list].slice(0, PROMPTS))); } catch {}
}

// What was typed and not sent, kept per chat (and for the home screen) on
// this device, as before: its text, files, references and pasted text.
const draftKey = key => "tw.draft." + key;
const EMPTY_DRAFT = { text: "", attachments: [], mentions: [], clips: [] };
function readDraft(key) {
  if (!key) return EMPTY_DRAFT;
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(key)) || "null");
    if (!value || typeof value !== "object") return EMPTY_DRAFT;
    const list = (items, valid) => Array.isArray(items) ? items.filter(valid) : [];
    return {
      text: typeof value.text === "string" ? value.text : "",
      attachments: list(value.attachments, file => typeof file?.path === "string").slice(0, MAX_FILES),
      mentions: list(value.mentions, reference => ["file", "skill", "person"].includes(reference?.type) && typeof reference.name === "string"),
      clips: list(value.clips, clip => typeof clip?.id === "string" && typeof clip.text === "string"),
    };
  } catch { return EMPTY_DRAFT; }
}
function writeDraft(key, draft) {
  if (!key) return;
  try {
    if (draft.text.trim() || draft.attachments.length || draft.clips.length) localStorage.setItem(draftKey(key), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(key));
  } catch {}
}

// What the @ and $ menu offers: installed skills, the organization's people
// and the agent's workspace files. Skills and people are read once a minute
// at most; files are searched as the query changes.
const sources = { skills: null, people: null };
function cached(name, load) {
  const entry = sources[name];
  if (entry && Date.now() - entry.at < 60 * 1000) return entry.promise;
  const promise = load();
  sources[name] = { at: Date.now(), promise };
  promise.catch(() => { if (sources[name]?.promise === promise) sources[name] = null; });
  return promise;
}
function useMentionSources(agentId, menu) {
  const [skills, setSkills] = useState({ items: [], loading: false, error: false });
  const [people, setPeople] = useState([]);
  const [files, setFiles] = useState({ query: "", items: [], loading: false, error: false });
  const open = !!menu, at = menu?.trigger === "@", query = at ? menu.query.trim() : "";
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setSkills(current => ({ ...current, loading: !current.items.length }));
    cached("skills", () => call("skills.list").then(value => (value?.skills || []).filter(skill => skill.enabled !== false)))
      .then(items => { if (live) setSkills({ items, loading: false, error: false }); })
      .catch(() => { if (live) setSkills({ items: [], loading: false, error: true }); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    if (!at) return undefined;
    let live = true;
    cached("people", () => Promise.all([call("organizations.members"), call("account.get").catch(() => null)])
      .then(([members, account]) => (Array.isArray(members) ? members : []).filter(member => member?.userId && member.userId !== account?.user?.id)))
      .then(items => { if (live) setPeople(items); }).catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [at]);
  useEffect(() => {
    if (!query || !agentId) { setFiles({ query, items: [], loading: false, error: false }); return undefined; }
    let live = true;
    setFiles(current => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      call("files.search", { agentId, query }).then(items => { if (live) setFiles({ query, items: Array.isArray(items) ? items : [], loading: false, error: false }); })
        .catch(() => { if (live) setFiles({ query, items: [], loading: false, error: true }); });
    }, 120);
    return () => { live = false; clearTimeout(timer); };
  }, [query, agentId]);
  return { skills, people, files };
}

// The menu over the composer: groups of suggestions, or why there are none.
function MentionMenu({ groups, selected, empty, onPick }) {
  const list = useRef(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [selected]);
  let index = -1;
  return (
    <div className="tw-mention-menu" role="listbox" aria-label="Composer suggestions" ref={list} onMouseDown={event => event.preventDefault()}>
      {groups.some(group => group.items.length) ? groups.map(group => (
        <div key={group.id} role="group" aria-label={group.label}>
          <div className="tw-mention-label">{group.label}</div>
          {group.items.length ? group.items.map(item => {
            index += 1;
            const at = index;
            return (
              <button key={item.key} type="button" role="option" aria-selected={at === selected} className="tw-mention-item" onClick={() => onPick(item)}>
                <MentionIcon reference={item.reference} />
                <span className="tw-mention-text"><strong>{item.title}</strong>{item.subtitle ? <small>{item.subtitle}</small> : null}</span>
              </button>
            );
          }) : <div className="tw-mention-note">Type to search for files</div>}
        </div>
      )) : <div className="tw-mention-note">{empty}</div>}
    </div>
  );
}
function MentionIcon({ reference }) {
  if (reference.type === "file") return <FileIcon name={reference.name} size={14} />;
  if (reference.type === "skill") return <Sparkles size={14} className="tw-mention-glyph" aria-hidden="true" />;
  return reference.imageUrl && /^https:/.test(reference.imageUrl) ? <img className="tw-mention-face" src={reference.imageUrl} alt="" /> : <UserRound size={14} className="tw-mention-glyph" aria-hidden="true" />;
}

// Files dragged over the window or pasted carry "Files".
const hasFiles = transfer => !!transfer && Array.from(transfer.types || []).includes("Files");
function transferFiles(transfer) {
  const seen = new Set();
  return [...Array.from(transfer?.files || []), ...Array.from(transfer?.items || []).filter(item => item.kind === "file").map(item => item.getAsFile()).filter(Boolean)]
    .filter(file => { const key = `${file.name}:${file.type}:${file.size}`; return seen.has(key) ? false : (seen.add(key), true); });
}

// Connected apps, shared by the tools picker and Settings → Tools.
let appsCache = null;
export function useApps() {
  const [state, setState] = useState(appsCache || { items: null, error: "" });
  // Accounts that need signing in again are kept apart: they show as reconnect prompts, not as connected.
  const load = () => call("integrations.list", {}).then(value => {
    const items = (value.items || []).map(app => ({ ...app, accounts: (app.accounts || []).filter(account => account.authStatus !== "reauthorization_required"), pendingAccounts: (app.accounts || []).filter(account => account.authStatus === "reauthorization_required") }));
    appsCache = { items, error: "" }; setState(appsCache);
  })
    .catch(error => setState(current => ({ items: current.items || [], error: error.message })));
  useEffect(() => { void load(); }, []);
  useEvent("integrations.changed", () => void load());
  return { ...state, reload: load };
}

export function AppIcon({ app, size = 16 }) {
  const [failed, setFailed] = useState(false);
  if (app?.iconUrl && !failed) return <img src={app.iconUrl} alt="" width={size} height={size} style={{ borderRadius: 3, flex: "none" }} onError={() => setFailed(true)} />;
  return <span className="tw-app-letter" style={{ width: size, height: size, fontSize: size * 0.6 }}>{initials(app?.displayName).slice(0, 1)}</span>;
}

// Which connected apps the chosen agent can use, and featured apps to connect.
export function ToolsPicker({ agentId, onBrowse }) {
  const { items } = useApps();
  const [access, setAccess] = useState(undefined);
  const [query, setQuery] = useState("");
  const toast = useToast();
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    call("integrations.getAccess", { agentId }).then(value => { if (!cancelled) setAccess(value.items ?? null); }).catch(() => { if (!cancelled) setAccess(null); });
    return () => { cancelled = true; };
  }, [agentId, items]);
  const connected = (items || []).filter(app => app.accounts?.length);
  const accounts = connected.flatMap(app => app.accounts.map(account => ({ app, account })));
  const allowed = app => access == null || access.some(item => item.integrationId === app.id);
  const enabled = connected.filter(allowed);
  async function toggle(app) {
    const on = allowed(app);
    const current = accounts.filter(entry => access == null || access.some(item => item.integrationId === entry.app.id && item.accountId === entry.account.id));
    const next = on ? current.filter(entry => entry.app.id !== app.id) : [...current, ...app.accounts.map(account => ({ app, account }))];
    const value = next.length === accounts.length ? null : next.map(entry => ({ kind: "integration", owner: "user", integrationId: entry.app.id, accountId: entry.account.id }));
    const previous = access;
    setAccess(value);
    try { await call("integrations.setAccess", { agentId, items: value }); } catch (error) { setAccess(previous); toast(error, "error"); }
  }
  const match = app => !query.trim() || app.displayName.toLowerCase().includes(query.trim().toLowerCase());
  // Connected apps include those waiting to reconnect, as before; those show a warning and reconnect.
  const linked = (items || []).filter(app => app.accounts?.length || app.pendingAccounts?.length);
  const featured = (items || []).filter(app => !linked.includes(app) && (query.trim() ? true : app.featured)).filter(match).slice(0, query.trim() ? 12 : 5);
  // Connecting names the agent the app is for.
  // An app waiting to reconnect names the account that signs in again.
  const reconnect = app => call("integrations.beginConnect", { integrationId: app.id, agentId, ...(app.pendingAccounts?.[0]?.id && !app.accounts?.length ? { reconnectAccountId: app.pendingAccounts[0].id } : {}) })
    .then(() => toast("Finish connecting in your browser.")).catch(error => toast(error, "error"));
  const shown = [...linked, ...(items || []).filter(app => !linked.includes(app) && app.featured)].slice(0, 3);
  return (
    <Menu up align="left" width={240} className="tw-tools-menu" trigger={({ toggle, open }) => (
      <button type="button" className="tw-pill" aria-expanded={open} onClick={toggle} aria-label="Tools">
        {shown.length ? <span className="tw-pill-icons">{shown.map(app => <AppIcon key={app.id} app={app} />)}</span> : null}
        <span>Tools</span><ChevronDown size={16} />
      </button>
    )}>
      <label className="tw-menu-search"><Search size={16} /><input autoFocus value={query} placeholder="Search tools..." aria-label="Search tools" onChange={event => setQuery(event.target.value)} /></label>
      {items === null ? <div className="tw-menu-label">Loading…</div> : null}
      {linked.filter(match).length ? <div className="tw-menu-label">Connected</div> : null}
      {linked.filter(match).map(app => app.accounts?.length ? (
        <button key={app.id} type="button" className={"tw-menu-item" + (allowed(app) ? " selected" : "")} aria-pressed={allowed(app)} onClick={() => void toggle(app)}>
          <AppIcon app={app} /><span className="grow">{app.displayName}</span>{allowed(app) ? <Check size={15} /> : null}
        </button>
      ) : (
        <button key={app.id} type="button" className="tw-menu-item" data-close title="Reconnect" onClick={() => void reconnect(app)}>
          <AppIcon app={app} /><span className="grow">{app.displayName}</span><TriangleAlert size={15} />
        </button>
      ))}
      {featured.length ? <div className={"tw-menu-label" + (linked.filter(match).length ? " spaced" : "")}>{query.trim() ? "Available" : "Featured"}</div> : null}
      {featured.map(app => (
        <button key={app.id} type="button" className="tw-menu-item" data-close onClick={() => void reconnect(app)}>
          <AppIcon app={app} /><span className="grow">{app.displayName}</span><Plus size={16} />
        </button>
      ))}
      <div className="tw-menu-sep" />
      <button type="button" className="tw-menu-item" data-close onClick={onBrowse}><span className="grow">Browse all tools</span><ArrowUpRight size={16} /></button>
    </Menu>
  );
}

export function AgentPicker({ agents, value, onChange, onNewAgent }) {
  const agent = agents.find(item => item.id === value) || agents[0];
  if (!agent) return null;
  return (
    <Menu up={false} align="left" width={224} className="tw-agent-menu" trigger={({ toggle, open }) => (
      <button type="button" className="tw-pill agent" aria-expanded={open} onClick={toggle} aria-label={"Change agent from " + agent.name}>
        <Avatar agent={agent} size="tiny" /><span>{agent.name}</span><ChevronDown size={16} />
      </button>
    )}>
      {agents.map(item => (
        <button key={item.id} type="button" className="tw-menu-item" data-close onClick={() => onChange(item.id)}>
          <Avatar agent={item} size="tiny" /><span className="grow">{item.name}</span>{item.id === agent.id ? <Check size={15} /> : null}
        </button>
      ))}
      <div className="tw-menu-sep" />
      <button type="button" className="tw-menu-item" data-close onClick={onNewAgent}><Plus size={16} /><span className="grow">New Agent</span></button>
    </Menu>
  );
}

// Connected-app accounts that need signing in again, above the composer as in
// the previous app. Skip removes the account that needs signing in again, as
// the previous app's Skip did. Reconnecting names the chat's agent.
export function ReconnectBanner({ agentId = null }) {
  const { items, reload } = useApps();
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const rows = (items || []).flatMap(app => (app.pendingAccounts || []).map(account => ({ app, account })));
  if (!rows.length) return null;
  const skip = (app, account) => {
    setBusy(account.id);
    call("integrations.disconnect", { integrationId: app.id, accountId: account.id }).then(reload).catch(error => toast(error, "error")).finally(() => setBusy(null));
  };
  return (
    <div className="tw-reconnects">
      {rows.map(({ app, account }) => (
        <div key={account.id} className="tw-reconnect">
          <span className="tw-reconnect-face">{initials(account.displayName).slice(0, 1)}</span>
          <span className="grow">Reconnect {account.displayName} to {app.displayName}</span>
          <button type="button" className="tw-btn ghost" disabled={busy === account.id} onClick={() => skip(app, account)}>Skip</button>
          <button type="button" className="tw-btn" disabled={busy === account.id} onClick={() => call("integrations.beginConnect", { integrationId: app.id, agentId, reconnectAccountId: account.id }).then(() => toast("Finish connecting in your browser.")).catch(error => toast(error, "error"))}>Reconnect</button>
        </div>
      ))}
    </div>
  );
}

// The strip above the composer when AI usage can't be funded; "See options"
// explains why and offers ChatGPT or a paid plan.
export function FundingBanner({ funding, onOptions }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  if (!funding || funding.canFundUsage !== false) return null;
  const text = funding.subscriptionAllowed ? "Use your ChatGPT plan with Timewarp." : "Add credits or change your plan to keep going.";
  const reconnect = funding.source === "chatgpt";
  const title = reconnect ? "Reconnect ChatGPT" : funding.subscriptionAllowed ? "You're out of free credits" : "You're out of credits";
  const description = reconnect ? "Your ChatGPT plan needs you to sign in again before Timewarp can use it."
    : funding.subscriptionAllowed ? "Use your ChatGPT plan with Timewarp, or choose a paid plan." : "Add credits or change your plan to keep going.";
  const connect = () => { setOpen(false); request("connectChatgpt").then(() => toast("Finish connecting ChatGPT in your browser.")).catch(error => toast(error, "error")); };
  return (
    <>
      <button type="button" className="tw-banner" onClick={() => setOpen(true)}>
        <Gauge size={14} /><strong>Limit reached</strong><span aria-hidden="true">·</span><span className="grow">{text}</span><span className="end">See options</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} className="tw-limit">
        {reconnect ? null : (
          <div className="tw-limit-meter">
            <div><span>{funding.subscriptionAllowed ? "Free credits" : "Plan usage"}</span><span>0% left</span></div>
            <i />
          </div>
        )}
        <div className="tw-limit-actions">
          {funding.subscriptionAllowed ? <button type="button" className="tw-btn primary" onClick={connect}><img src="./onboarding-icons/chatgpt.svg" alt="" />{reconnect ? "Reconnect ChatGPT" : "Connect ChatGPT"}</button> : null}
          <button type="button" className="tw-btn" onClick={() => { setOpen(false); onOptions(); }}><CreditCard size={17} strokeWidth={1.7} />{funding.subscriptionAllowed ? "View plans" : "Add credits"}</button>
        </div>
      </Dialog>
    </>
  );
}

// agentId: the agent whose workspace files "@" offers. draftKey: where an
// unsent draft is kept (the chat's id, or "home").
export function Composer({ variant = "compact", disabled, running, models, onModel, onSend, onStop, placeholder, autoFocusKey, historyKey = autoFocusKey, draftKey: draftName = historyKey, agentId = null, tools, banner, reply, onClearReply }) {
  const [draftOf, setDraftOf] = useState(draftName);
  const [initial] = useState(() => readDraft(draftName));
  const [text, setText] = useState(initial.text);
  const [attachments, setAttachments] = useState(initial.attachments);
  // References chosen from the @ and $ menu, and large pastes kept as chips.
  const [mentions, setMentions] = useState(initial.mentions);
  const [clips, setClips] = useState(initial.clips);
  const [sending, setSending] = useState(false);
  const [tall, setTall] = useState(false);
  // Files dragged over the chat or home screen, shown over it as before.
  const [dropping, setDropping] = useState(false);
  const [zone, setZone] = useState(null);
  // The @ or $ being typed, the suggestion picked with the arrows, and a menu closed with Escape.
  const [menu, setMenu] = useState(null);
  const [selected, setSelected] = useState(0);
  const dismissed = useRef(null);
  const root = useRef(null);
  const area = useRef(null);
  const latest = useRef({ text, attachments, mentions, clips, disabled });
  latest.current = { text, attachments, mentions, clips, disabled };
  // Going through earlier prompts: how far back, and what was typed before.
  const recall = useRef({ index: -1, draft: null });
  const toast = useToast();
  const large = variant === "large";
  // Another chat's composer: its own draft.
  if (draftName !== draftOf) {
    const draft = readDraft(draftName);
    setDraftOf(draftName); setText(draft.text); setAttachments(draft.attachments); setMentions(draft.mentions); setClips(draft.clips); setMenu(null);
  }
  useEffect(() => { writeDraft(draftOf, { text, attachments, mentions: presentMentions(text, mentions), clips }); }, [draftOf, text, attachments, mentions, clips]);
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(large ? 260 : 200, node.scrollHeight) + "px";
    setTall(node.scrollHeight > 44);
  }, [text, large]);
  useEffect(() => { area.current?.focus(); }, [autoFocusKey, reply]);
  const shownMentions = presentMentions(text, mentions);
  const empty = !text.trim() && !attachments.length && !clips.length;
  // While the agent works a message joins its turn; Stop shows when there's nothing to send.
  const canSend = !disabled && !sending && !empty;
  // `typed` sends other text than the box's (dictation's "Transcribe and send").
  async function send(typed = null) {
    const current = latest.current, value = typed ?? current.text;
    if (current.disabled || sending || (!value.trim() && !current.attachments.length && !current.clips.length)) return;
    const sent = { text: value, attachments: current.attachments, mentions: current.mentions, clips: current.clips };
    const { text: body, skills } = composeMessage(value, current.mentions, current.clips);
    const message = { text: body, images: sent.attachments.filter(file => file.image).map(file => file.path), files: sent.attachments.filter(file => !file.image).map(file => file.path), ...(skills.length ? { skills } : {}) };
    rememberPrompt(historyKey, value.trim());
    recall.current = { index: -1, draft: null };
    setText(""); setAttachments([]); setMentions([]); setClips([]); setMenu(null);
    setSending(true);
    try { await onSend(message); }
    catch (error) {
      toast(error, "error");
      // What was sent comes back, unless something new was typed meanwhile.
      const now = latest.current;
      if (!now.text.trim() && !now.attachments.length && !now.clips.length) { setText(sent.text); setAttachments(sent.attachments); setMentions(sent.mentions); setClips(sent.clips); }
    }
    finally { setSending(false); area.current?.focus(); }
  }
  const dictation = useDictation({
    onText: (spoken, { send: now = false } = {}) => {
      recall.current = { index: -1, draft: null };
      const current = latest.current.text;
      const next = (current.trim() ? current.replace(/\s*$/, " ") : "") + spoken;
      setText(next);
      area.current?.focus();
      if (now) void send(next);
    },
    onError: error => toast(error, "error"),
  });
  const clock = seconds => Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  // Up to 10 files of up to 100 MB each, from the file picker, a drop or a paste.
  function add(chosen) {
    if (chosen.some(file => file.size > MAX_ATTACHMENT)) toast("Files over 100 MB can't be attached.", "error");
    const current = latest.current.attachments;
    const next = [...current, ...chosen.filter(file => file.size <= MAX_ATTACHMENT && !current.some(item => item.path === file.path))];
    if (next.length > MAX_FILES) toast(`Up to ${MAX_FILES} files can be attached to a message.`, "error");
    if (next.length !== current.length) setAttachments(next.slice(0, MAX_FILES));
  }
  async function attach() {
    try { add(await call("attachments.choose")); }
    catch (error) { toast(error, "error"); }
  }
  // Dropped and pasted files attach from where they are; a pasted image that
  // isn't a file yet is saved first (attachments.savePasted).
  async function attachFiles(files) {
    if (latest.current.disabled || !files.length) return;
    try {
      if (files.some(file => file.size > MAX_ATTACHMENT)) toast("Files over 100 MB can't be attached.", "error");
      const usable = files.filter(file => file.size <= MAX_ATTACHMENT);
      const paths = usable.map(file => window.tw.getPathForFile?.(file) || "");
      const found = paths.some(Boolean) ? await call("attachments.describe", { paths: paths.filter(Boolean) }) : [];
      const room = Math.max(0, MAX_FILES - latest.current.attachments.length - found.length);
      const pasted = usable.filter((_file, index) => !paths[index]);
      const saved = [];
      for (const file of pasted.slice(0, room)) saved.push(await call("attachments.savePasted", { data: await file.arrayBuffer(), type: file.type, name: file.name }));
      if (pasted.length > room) toast(`Up to ${MAX_FILES} files can be attached to a message.`, "error");
      add([...found, ...saved]);
    } catch (error) { toast(error, "error"); }
  }
  const attachLatest = useRef(attachFiles);
  attachLatest.current = attachFiles;
  // The drop area is the chat or home screen around the composer, as before.
  useEffect(() => {
    const target = root.current?.closest(".tw-main") || root.current;
    if (!target) return;
    setZone(target);
    let depth = 0;
    const enter = event => { if (!hasFiles(event.dataTransfer)) return; event.preventDefault(); depth += 1; setDropping(true); };
    const over = event => { if (!hasFiles(event.dataTransfer)) return; event.preventDefault(); event.dataTransfer.dropEffect = latest.current.disabled ? "none" : "copy"; };
    const leave = event => { if (!hasFiles(event.dataTransfer)) return; depth = Math.max(0, depth - 1); if (!depth) setDropping(false); };
    const drop = event => { if (!hasFiles(event.dataTransfer)) return; event.preventDefault(); depth = 0; setDropping(false); void attachLatest.current(transferFiles(event.dataTransfer)); };
    // Pasted files, unless pasted into another field (a dialog's, the search's).
    const paste = event => {
      if (event.target !== area.current && event.target?.closest?.("input, textarea, [contenteditable], dialog")) return;
      const files = transferFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void attachLatest.current(files);
    };
    const events = { dragenter: enter, dragover: over, dragleave: leave, drop, paste };
    for (const [name, handler] of Object.entries(events)) target.addEventListener(name, handler);
    return () => { for (const [name, handler] of Object.entries(events)) target.removeEventListener(name, handler); };
  }, []);
  // Ctrl+Space starts or finishes voice input and Escape discards a
  // recording, wherever the focus is, as before.
  const voice = useRef(null);
  voice.current = { dictation, disabled };
  useEffect(() => {
    const keys = event => {
      const { dictation: current, disabled: off } = voice.current;
      if (event.code === "Space" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        if (off || current.status === "starting" || current.status === "transcribing" || current.status === "retrying") return;
        event.preventDefault();
        if (current.status === "recording") current.stop(); else void current.start();
      } else if (event.key === "Escape" && (current.status === "recording" || current.status === "starting" || current.status === "failed")) {
        event.preventDefault();
        current.cancel();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  // The @ or $ menu follows the caret; Escape closes it until something else is typed.
  const sourcesFor = useMentionSources(agentId, menu);
  function follow(value, caret) {
    const found = disabled ? null : mentionQuery(value, caret);
    const usable = found && !(found.trigger === "$" && /^\d/.test(found.query)) ? found : null;
    if (usable && dismissed.current && dismissed.current.from === usable.from && dismissed.current.trigger === usable.trigger) { setMenu(null); return; }
    if (!usable) { dismissed.current = null; setMenu(null); return; }
    if (!menu || menu.trigger !== usable.trigger || menu.query !== usable.query || menu.from !== usable.from) setSelected(0);
    setMenu(usable);
  }
  const groups = menu ? mentionGroups({ trigger: menu.trigger, query: menu.query, skills: sourcesFor.skills.items, files: sourcesFor.files.items, members: sourcesFor.people }) : [];
  const options = groups.flatMap(group => group.items);
  const emptyNote = menu?.trigger === "$"
    ? sourcesFor.skills.loading ? "Loading skills..." : sourcesFor.skills.error ? "Skills could not be loaded" : "No matching skills"
    : sourcesFor.files.loading ? "Loading files..." : sourcesFor.files.error ? "Files could not be loaded" : "Type to search for people, files, or skills";
  function pick(item) {
    if (!menu) return;
    const { text: next, caret } = insertMention(text, menu, item.reference);
    recall.current = { index: -1, draft: null };
    setText(next);
    setMentions(current => addMention(current, item.reference));
    setMenu(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(caret, caret); });
  }
  // A long paste becomes a "Clipboard (N lines)" chip, as before; it can be put back in the box.
  function paste(event) {
    if (transferFiles(event.clipboardData).length) return;
    const pasted = event.clipboardData?.getData("text/plain") || "";
    if (!largePaste(pasted)) return;
    event.preventDefault();
    setClips(current => [...current, { id: crypto.randomUUID(), text: pasted }]);
  }
  function expandClip(clip) {
    const node = area.current, at = node ? node.selectionStart : text.length;
    setClips(current => current.filter(item => item.id !== clip.id));
    setText(text.slice(0, at) + clip.text + text.slice(at));
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(at + clip.text.length, at + clip.text.length); });
  }
  // ArrowUp at the start of the box (or while going through them) recalls
  // this chat's earlier prompts; ArrowDown goes back toward what was typed.
  function recallPrompt(event) {
    const node = area.current, up = event.key === "ArrowUp";
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !node || node.selectionStart !== node.selectionEnd) return;
    const { index, draft } = recall.current, caret = node.selectionStart;
    const edge = up ? !text.slice(0, caret).includes("\n") && (index >= 0 || caret === 0) : index >= 0 && !text.slice(caret).includes("\n");
    if (!edge) return;
    const next = up ? index + 1 : index - 1, base = index === -1 ? text : draft;
    const value = next === -1 ? base : readPrompts(historyKey)[next];
    if (value == null) return;
    event.preventDefault();
    recall.current = { index: next, draft: base };
    setText(value);
    requestAnimationFrame(() => { const end = area.current?.value.length || 0; area.current?.setSelectionRange(end, end); });
  }
  const replying = reply ? (
    <span className="tw-reply-chip" title={reply}>
      <Reply size={13} strokeWidth={1.8} /><span>{reply.replace(/\s+/g, " ").trim()}</span>
      <button type="button" aria-label="Cancel reply" onClick={onClearReply}><X size={12} /></button>
    </span>
  ) : null;
  const removeChip = reference => { setText(current => removeMention(current, reference)); setMentions(current => current.filter(item => item !== reference)); area.current?.focus(); };
  const chips = attachments.length || shownMentions.length || clips.length ? (
    <div className="tw-attachments">
      {attachments.map(file => <span key={file.path} className="tw-chip" title={file.path}><span>{file.path.split(/[\\/]/).pop()}</span><button type="button" aria-label="Remove attachment" onClick={() => setAttachments(current => current.filter(item => item.path !== file.path))}><X size={12} /></button></span>)}
      {shownMentions.map(reference => (
        <span key={mentionToken(reference) + (reference.path || reference.userId)} className="tw-chip tw-mention-chip" data-mention={reference.type} title={reference.type === "person" ? reference.email : reference.path}>
          <MentionIcon reference={reference} /><span>{reference.name}</span>
          <button type="button" aria-label={"Remove " + reference.name} onClick={() => removeChip(reference)}><X size={12} /></button>
        </span>
      ))}
      {clips.map(clip => (
        <span key={clip.id} className="tw-chip tw-clip-chip" title={clip.text.slice(0, 500)}>
          <button type="button" className="tw-clip-expand" aria-label={"Expand " + clipboardLabel(clip.text)} onClick={() => expandClip(clip)}><Clipboard size={12} aria-hidden="true" /><span>{clipboardLabel(clip.text)}</span></button>
          <button type="button" aria-label={"Remove " + clipboardLabel(clip.text)} onClick={() => setClips(current => current.filter(item => item.id !== clip.id))}><X size={12} /></button>
        </span>
      ))}
    </div>
  ) : null;
  const input = (
    <textarea ref={area} rows={1} value={text} placeholder={placeholder} disabled={disabled} aria-label="Message"
      aria-autocomplete="list" aria-expanded={!!menu}
      onChange={event => { recall.current = { index: -1, draft: null }; setText(event.target.value); follow(event.target.value, event.target.selectionStart); }}
      onClick={event => follow(event.currentTarget.value, event.currentTarget.selectionStart)}
      onKeyUp={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") follow(event.currentTarget.value, event.currentTarget.selectionStart); }}
      onBlur={() => setMenu(null)}
      onPaste={paste}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (menu) {
          const count = Math.max(1, options.length);
          if (event.key === "ArrowDown") { event.preventDefault(); setSelected(index => (index + 1) % count); return; }
          if (event.key === "ArrowUp") { event.preventDefault(); setSelected(index => (index - 1 + count) % count); return; }
          if ((event.key === "Enter" || event.key === "Tab") && options[selected]) { event.preventDefault(); pick(options[selected]); return; }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismissed.current = { from: menu.from, trigger: menu.trigger }; setMenu(null); return; }
        }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") recallPrompt(event);
      }} />
  );
  const mac = window.tw?.platform === "darwin";
  const addButton = <button type="button" className="tw-round" title="Add photos & files" aria-label="Add context" onClick={attach} disabled={disabled || dictation.status === "recording"}><Plus size={16} strokeWidth={1.8} /></button>;
  const recording = dictation.status === "recording", transcribing = dictation.status === "transcribing" || dictation.status === "retrying";
  const end = (
    <>
      {recording ? (
        <span className="tw-dictation" role="status">
          {dictation.levels?.length ? <span className="tw-levels" aria-hidden="true">{dictation.levels.map((level, index) => <i key={index} style={{ height: Math.max(12, level * 100) + "%" }} />)}</span> : <i aria-hidden="true" />}
          <span className="tw-tabular">{clock(dictation.seconds)}</span>
          <button type="button" className="tw-round" title="Discard recording" aria-label="Discard recording" onClick={dictation.cancel}><X size={16} /></button>
          <button type="button" className="tw-round tw-transcribe" title={`Transcribe (${mac ? "⌃Space" : "Ctrl+Space"})`} aria-label="Transcribe" onClick={() => dictation.stop()}><Square size={11} fill="currentColor" /></button>
        </span>
      ) : transcribing ? (
        <span className="tw-dictation" role="status"><LoaderCircle size={14} className="tw-spin" /> Transcribing…</span>
      ) : (
        <>
          <ModelPicker models={models} onSelect={onModel} />
          {dictation.status === "failed"
            ? <button type="button" className="tw-round tw-retry" title="Retry" aria-label="Retry" onClick={dictation.retry} disabled={disabled}><RotateCcw size={15} strokeWidth={1.8} /></button>
            : <button type="button" className="tw-round" title={`Dictate (${mac ? "⌃Space" : "Ctrl+Space"})`} aria-label="Start voice input" onClick={() => void dictation.start()} disabled={disabled || dictation.status === "starting"}><Mic size={16} strokeWidth={1.8} /></button>}
        </>
      )}
      {recording ? <button type="button" className="tw-send" title="Transcribe and send" aria-label="Transcribe and send" disabled={disabled || sending} onClick={() => dictation.stop({ send: true })}><ArrowUp size={16} strokeWidth={1.8} /></button>
        : running && empty
          ? <button type="button" className="tw-send stop" title="Stop" aria-label="Stop response" onClick={onStop}><Square size={12} fill="currentColor" /></button>
          : <button type="button" className="tw-send" title="Send ↵" aria-label="Send message" disabled={!canSend} onClick={() => void send()}><ArrowUp size={16} strokeWidth={1.8} /></button>}
    </>
  );
  const suggestions = menu ? <MentionMenu groups={groups} selected={selected} empty={emptyNote} onPick={pick} /> : null;
  return (
    <div className="tw-composer" ref={root}>
      <div className="tw-composer-inner">
        {banner}
        {large ? (
          <div className="tw-composer-box large">
            {suggestions}
            {chips}
            {replying}
            {input}
            <div className="tw-composer-row">{addButton}{tools}<span className="grow" />{end}</div>
          </div>
        ) : (
          <div className={"tw-composer-box compact" + (tall || attachments.length || shownMentions.length || clips.length ? " tall" : "")}>
            {suggestions}
            {addButton}
            <div className="tw-compact-input">{chips}{replying}{input}</div>
            {end}
          </div>
        )}
      </div>
      {dropping && zone && !disabled ? createPortal(<div className="tw-drop-overlay" aria-hidden="true" />, zone) : null}
    </div>
  );
}
