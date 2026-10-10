// Chat cards: the interactive cards, chips and links in an agent's messages,
// drawn from the tags cards.mjs takes out of the Markdown. Each card reads and
// acts through the engine API; nothing an agent writes becomes HTML.
import React, { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert, CircleSlash, ExternalLink, Eye, EyeOff, File, FileArchive, FileAudio, FileCode, FileImage,
  FileSpreadsheet, FileText, FileVideo, FolderOpen, Globe, KeyRound, Link2, LoaderCircle, Mail, MessageSquare, Mic, Plus, Presentation, Puzzle, RefreshCw,
  Send, Server, Sparkles, Square, UserRound, X,
} from "lucide-react";
import { avatarSrc, call, errorText, initials } from "./api.js";
import { Dialog, Menu, useToast } from "./components/common.jsx";
import { AppIcon } from "./components/Composer.jsx";
import { useDictation } from "./dictation.js";
import { baseName, draftMessage, extensionOf, fileKind, resolveLink, selectAnswer, splitAddresses } from "./cards.mjs";

const PdfPreview = lazy(() => import("./previews.jsx").then(module => ({ default: module.PdfPreview })));
const SpreadsheetPreview = lazy(() => import("./previews.jsx").then(module => ({ default: module.SpreadsheetPreview })));
const CsvPreview = lazy(() => import("./previews.jsx").then(module => ({ default: module.CsvPreview })));
const DocumentPreview = lazy(() => import("./previews.jsx").then(module => ({ default: module.DocumentPreview })));

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return String(url || ""); } };
const httpsUrl = value => { try { const url = new URL(String(value || "")); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; } };
const webUrl = value => { try { const url = new URL(String(value || "")); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
const REVEAL = window.tw?.platform === "darwin" ? "Reveal in Finder" : window.tw?.platform === "win32" ? "Show in File Explorer" : "Show in folder";
const size = bytes => bytes == null ? "" : bytes < 1024 ? bytes + " B" : bytes < 1048576 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1048576).toFixed(1) + " MB";

// ── The chat a card belongs to ─────────────────────────────────────────────
// The open conversation (from the address), its agent, whether a reply is
// running, the cards' saved state and its browser tabs. One shared entry per
// conversation, kept current by engine events.
const routeConversation = () => { const match = /^#\/(?:conversation|c)\/([^/?#]+)/.exec(location.hash); return match ? decodeURIComponent(match[1]) : null; };
export function useRouteConversation() {
  const [id, setId] = useState(routeConversation);
  useEffect(() => { const change = () => setId(routeConversation()); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  return id;
}

// One engine subscription per event, shared by every card.
const subscribers = new Map();
function onEngine(name, handler) {
  if (!subscribers.has(name)) {
    subscribers.set(name, new Set());
    window.tw?.on?.(name, payload => { for (const listener of [...subscribers.get(name)]) listener(payload); });
  }
  subscribers.get(name).add(handler);
  return () => subscribers.get(name).delete(handler);
}
function useEngineEvent(name, handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => onEngine(name, payload => latest.current(payload)), [name]);
}

const chats = new Map();
let listening = false;
function changed(entry, patch) { Object.assign(entry, patch); for (const listener of [...entry.listeners]) listener(); }
const isBrowserTool = item => (item.type === "mcpToolCall" && /browser/i.test(item.server || "")) || /timewarp_browser/.test(JSON.stringify(item).slice(0, 4000));
function workerEvent(entry, method, params) {
  const worker = entry.workers.get(params.threadId || params.thread?.id);
  if (!worker) return;
  let patch = null;
  if (method === "thread/started") patch = { name: params.thread?.agentNickname || params.thread?.name || worker.name };
  if (method === "turn/started") patch = { status: "running" };
  if (method === "turn/completed") patch = { status: params.turn?.status === "completed" ? "complete" : "stopped", browsing: false };
  if (method === "item/started" && params.item && params.item.type !== "agentMessage" && params.item.type !== "reasoning") patch = { browsing: isBrowserTool(params.item) };
  if (patch) { Object.assign(worker, patch); changed(entry, {}); }
}
function listen() {
  if (listening || !window.tw?.on) return;
  listening = true;
  onEngine("conversation.event", ({ conversationId, method, params } = {}) => {
    const entry = chats.get(conversationId);
    if (!entry) return;
    if (params?.subAgent) { workerEvent(entry, method, params); return; }
    if (method === "turn/started") changed(entry, { running: true });
    if (method === "turn/completed" || method === "turn/aborted") changed(entry, { running: false });
  });
  onEngine("browser.state", value => { const entry = chats.get(value?.conversationId); if (entry) changed(entry, { tabs: value.tabs || [] }); });
}
function chatEntry(id) {
  let entry = chats.get(id);
  if (entry) return entry;
  entry = { id, listeners: new Set(), conversation: null, agent: null, running: false, states: null, tabs: null, workers: new Map(), error: null };
  chats.set(id, entry);
  listen();
  Promise.all([call("conversations.get", { id }), call("conversations.status", { id }).catch(() => ({})), call("cards.state", { conversationId: id }).catch(() => ({})), call("agents.list").catch(() => [])])
    .then(([conversation, status, states, agents]) => changed(entry, { conversation, agent: agents.find(agent => agent.id === conversation.agentId) || null, running: entry.running || !!status.running, states: { ...states, ...entry.states } }))
    .catch(error => changed(entry, { error: errorText(error), states: entry.states || {} }));
  return entry;
}
export function useChat(id) {
  const [, force] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!id) return undefined;
    const entry = chatEntry(id);
    entry.listeners.add(force);
    return () => entry.listeners.delete(force);
  }, [id]);
  return id ? chatEntry(id) : null;
}

// Sends a message in the chat as the user. A chat view can take it over (to
// show it at once) by handling "tw:chat-send"; otherwise it goes straight to
// the engine and shows up when the reply starts.
export async function sendPrompt(conversationId, text) {
  const detail = { conversationId, text, result: null };
  const event = new CustomEvent("tw:chat-send", { detail, cancelable: true });
  window.dispatchEvent(event);
  const entry = chats.get(conversationId);
  if (entry) changed(entry, { running: true });
  try {
    if (event.defaultPrevented) return await detail.result;
    return await call("conversations.send", { id: conversationId, text, clientId: crypto.randomUUID() });
  } catch (error) {
    if (entry) changed(entry, { running: false });
    throw error;
  }
}

// What a Markdown block gives its cards: the chat, a key for the message's
// card state, whether it's still streaming, and nested Markdown for tabs.
export const CardScope = createContext(null);

function useCard(card, part = "") {
  const scope = useContext(CardScope);
  const chat = useChat(scope?.cards ? scope.conversationId : null);
  const key = scope ? `${scope.messageKey}:${card.tag}:${card.ordinal}${part ? ":" + part : ""}` : null;
  const ready = !!chat?.conversation && chat.states !== null;
  const saved = ready && key ? chat.states[key] : undefined;
  const canSend = ready && !chat.running && !scope?.streaming;
  const save = useCallback(async value => {
    if (!chat || !key) return;
    changed(chat, { states: { ...chat.states, [key]: value } });
    await call("cards.saveState", { conversationId: chat.id, key, value }).catch(() => {});
  }, [chat, key]);
  const send = useCallback(text => sendPrompt(chat.id, text), [chat]);
  return { scope, chat, key, ready, saved, canSend, save, send };
}

// ── Shared pieces ──────────────────────────────────────────────────────────
export function SiteIcon({ url, size: pixels = 16, fallback = "globe" }) {
  const [failed, setFailed] = useState(false);
  let origin = null;
  try { origin = new URL(url).origin; } catch {}
  if (failed || !origin || !/^https?:/.test(origin)) {
    const glyph = pixels >= 24 ? Math.round(pixels * 0.6) : pixels;
    return fallback === "server" ? <Server size={glyph} strokeWidth={1.7} className="tw-site-fallback" /> : <Globe size={glyph} strokeWidth={1.7} className="tw-site-fallback" />;
  }
  return <img className="tw-site-icon" src={origin + "/favicon.ico"} alt="" width={pixels} height={pixels} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

const FILE_TYPES = [
  [/^(png|jpe?g|gif|webp|bmp|ico|svg|heic|avif|tiff?)$/, FileImage, "image"],
  [/^(xlsx?|xlsm|ods|csv|tsv|numbers)$/, FileSpreadsheet, "sheet"],
  [/^(pptx?|pptm|odp|key)$/, Presentation, "slides"],
  [/^(pdf)$/, FileText, "pdf"],
  [/^(docx?|docm|odt|rtf|pages|md|markdown|txt)$/, FileText, "doc"],
  [/^(aac|aiff?|flac|m4a|mp3|ogg|opus|wav|weba)$/, FileAudio, "audio"],
  [/^(avi|m4v|mkv|mov|mp4|mpe?g|ogv|webm)$/, FileVideo, "video"],
  [/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/, FileArchive, "archive"],
  [/^(js|cjs|mjs|jsx|ts|tsx|json|py|rb|go|rs|java|cs|c|h|cpp|css|scss|html|xml|yml|yaml|toml|ini|sh|ps1|sql|php|swift|kt)$/, FileCode, "code"],
];
export function FileIcon({ name, size: pixels = 16, box = false }) {
  const extension = extensionOf(name);
  const [, Icon, kind] = FILE_TYPES.find(([pattern]) => pattern.test(extension)) || [null, File, "file"];
  if (!box) return <Icon className="tw-file-glyph" data-kind={kind} size={pixels} strokeWidth={1.7} aria-hidden="true" />;
  return <span className="tw-file-icon" data-kind={kind} aria-hidden="true"><Icon size={Math.round(pixels * 0.6)} strokeWidth={1.7} /></span>;
}

// A file named by the agent, resolved in its workspace. Planned files are
// checked every second until they exist.
function useResolvedFile(conversationId, file, { poll = false } = {}) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!conversationId || !file) { setState(null); return undefined; }
    let cancelled = false, timer = null;
    const until = Date.now() + 30 * 60 * 1000;
    const check = () => call("cards.resolve", { conversationId, path: file })
      .then(value => { if (cancelled) return; setState(value); if (poll && !value.exists && Date.now() < until) timer = setTimeout(check, 1000); })
      .catch(error => { if (!cancelled) setState({ error: errorText(error) }); });
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [conversationId, file, poll]);
  return state;
}

// ── File preview ───────────────────────────────────────────────────────────
// A chat view or the side pane can show the file itself by handling
// "tw:open-file"; otherwise it opens in a dialog here.
function Preview({ file }) {
  if (file.kind === "image") return <div className="tw-preview-scroll tw-image-view"><img src={file.dataUrl} alt={file.name} /></div>;
  if (file.kind === "markdown" || file.kind === "text") return <div className="tw-preview-scroll"><pre className="tw-code-view">{file.text}</pre></div>;
  if (file.kind === "pdf") return <PdfPreview base64={file.base64} />;
  if (file.kind === "spreadsheet") return <SpreadsheetPreview base64={file.base64} />;
  if (file.kind === "csv") return <CsvPreview text={file.text} delimiter={file.delimiter} />;
  if (file.kind === "document") return <DocumentPreview base64={file.base64} />;
  return <div className="tw-blank" style={{ marginTop: 60 }}><p>{file.kind === "large" ? "This file is too large to preview." : "There's no preview for this kind of file."}</p></div>;
}

function FilePreviewDialog({ target, onClose }) {
  const scope = useContext(CardScope);
  const [file, setFile] = useState(null);
  const toast = useToast();
  // Focus starts on Close (after the dialog opens), not on "Open file".
  const closeButton = useRef(null);
  useEffect(() => { if (target) closeButton.current?.focus(); }, [target]);
  useEffect(() => {
    if (!target) return;
    setFile(null);
    call("files.read", { agentId: target.agentId, path: target.relative }).then(setFile).catch(error => setFile({ error: errorText(error) }));
  }, [target?.agentId, target?.relative]);
  const external = method => call(method, { conversationId: target.conversationId, path: target.path }).catch(error => toast(error, "error"));
  const markdown = file?.kind === "markdown" && scope?.renderMarkdown;
  return createPortal(
    <Dialog open={!!target} onClose={onClose} wide label={target ? "Preview " + target.name : "Preview"} className="tw-card-preview">
      {target ? (
        <div className="tw-files">
          <div className="tw-files-bar">
            <FileIcon name={target.name} size={16} />
            <strong className="tw-files-title" title={target.path}>{target.name}</strong>
            <span className="tw-hint">{size(file?.size)}</span>
            <button type="button" className="tw-icon-button" title="Open file" aria-label="Open file" onClick={() => external("cards.openFile")}><ExternalLink size={15} /></button>
            <button type="button" className="tw-icon-button" title={REVEAL} aria-label={REVEAL} onClick={() => external("cards.revealFile")}><FolderOpen size={15} /></button>
            <button type="button" className="tw-icon-button" title="Close" aria-label="Close preview" ref={closeButton} onClick={onClose}><X size={16} /></button>
          </div>
          {!file ? <p className="tw-hint" style={{ padding: 16 }}>Opening…</p>
            : file.error ? <p className="tw-alert" style={{ padding: 16 }}>{file.error}</p>
              : markdown ? <div className="tw-preview-scroll"><article className="tw-docx">{scope.renderMarkdown(file.text, { cards: false })}</article></div>
                : <Suspense fallback={<p className="tw-hint" style={{ padding: 16 }}>Loading preview…</p>}><Preview file={file} /></Suspense>}
        </div>
      ) : null}
    </Dialog>,
    document.body,
  );
}

function useFilePreview() {
  const [target, setTarget] = useState(null);
  const open = useCallback((conversationId, info, file) => {
    const detail = { conversationId, agentId: info.agentId, path: info.relative, absolute: file };
    const event = new CustomEvent("tw:open-file", { detail, cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) setTarget({ conversationId, agentId: info.agentId, relative: info.relative, path: file, name: info.name || baseName(file) });
  }, []);
  return { open, element: <FilePreviewDialog target={target} onClose={() => setTarget(null)} /> };
}

// ── <file> ─────────────────────────────────────────────────────────────────
const BADGES = { created: ["New", "green"], updated: ["Updated", "blue"], deleted: ["Deleted", "red"] };
function FileActions({ conversationId, file, info, onPreview }) {
  const toast = useToast();
  const run = method => call(method, { conversationId, path: file }).catch(error => toast(error, "error"));
  if (!info?.inside) return <button type="button" className="tw-card-pill outline small" onClick={() => run("cards.revealFile")}>{REVEAL}</button>;
  return (
    <span className="tw-split">
      <button type="button" className="tw-card-pill outline small" onClick={() => onPreview ? onPreview() : run("cards.openFile")}>Open</button>
      <Menu align="right" width={220} trigger={({ toggle, open }) => <button type="button" className="tw-card-pill outline small chevron" aria-label="More file open options" aria-expanded={open} onClick={toggle}><ChevronDown size={12} /></button>}>
        <button type="button" className="tw-menu-item" data-close onClick={() => run("cards.openFile")}><ExternalLink size={15} /><span className="grow">Open file</span></button>
        <button type="button" className="tw-menu-item" data-close onClick={() => run("cards.revealFile")}><FolderOpen size={15} /><span className="grow">{REVEAL}</span></button>
      </Menu>
    </span>
  );
}

function FileCard({ card }) {
  const scope = useContext(CardScope);
  const { path: file = "", action, label } = card.attrs;
  const planned = action === "planned";
  const conversationId = scope?.conversationId;
  const info = useResolvedFile(conversationId, file, { poll: planned });
  const preview = useFilePreview();
  if (!file.trim()) return null;
  const name = baseName(file);
  const title = label?.trim() || name;
  const deleted = action === "deleted";
  const exists = !!info?.exists && info.isFile;
  const badge = BADGES[planned ? (exists ? "created" : "") : action];
  const canPreview = !deleted && exists && info.inside;
  const open = canPreview ? () => preview.open(conversationId, info, file) : null;
  return (
    <>
    <div className={"tw-chat-card tw-row-card" + (open ? " clickable" : "")} data-card="file" role={open ? "button" : undefined} tabIndex={open ? 0 : undefined}
      aria-label={open ? `Open ${title} in preview` : undefined} title={file}
      onClick={open || undefined} onKeyDown={event => { if (open && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(); } }}>
      <FileIcon name={name} size={32} box />
      <span className="tw-card-text">
        <strong>{title}</strong>
        <small>
          <span>{fileKind(name)}</span>
          {planned && !exists ? <em className="tw-card-badge"><LoaderCircle size={10} className="tw-spin" />Creating</em> : badge ? <em className="tw-card-badge" data-tone={badge[1]}>{badge[0]}</em> : null}
        </small>
      </span>
      {!deleted && exists ? <span className="tw-card-action" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><FileActions conversationId={conversationId} file={file} info={info} onPreview={open} /></span> : null}
    </div>
    {preview.element}
    </>
  );
}

// ── <connect-plugin> ───────────────────────────────────────────────────────
const appKey = value => String(value || "").toLowerCase().replace(/^composio-/, "").replace(/[^a-z0-9]/g, "");
function ConnectCard({ card }) {
  const { chat, canSend, save, send } = useCard(card);
  const agentId = chat?.conversation?.agentId;
  const pluginId = card.attrs["plugin-id"] || "";
  const [apps, setApps] = useState(null);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const waiting = useRef(null);
  const toast = useToast();
  const load = useCallback(() => agentId ? call("integrations.list", { agentId }).then(value => { setApps(value.items || []); setError(""); }).catch(failure => setError(errorText(failure))) : undefined, [agentId]);
  useEffect(() => { void load(); }, [load]);
  useEngineEvent("integrations.changed", () => void load());
  const app = apps?.find(item => appKey(item.id) === appKey(pluginId) || appKey(item.displayName) === appKey(pluginId));
  const ready = (app?.accounts || []).filter(account => account.authStatus !== "reauthorization_required");
  const pending = (app?.accounts || []).filter(account => account.authStatus === "reauthorization_required");
  // Connected from this card: the agent hears about it, as before.
  useEffect(() => {
    if (!app || !waiting.current || !ready.some(account => !waiting.current.includes(account.id))) return;
    waiting.current = null;
    setConnecting(false);
    void save({ connected: true });
    if (canSend) void send(`${app.displayName} connected`).catch(failure => toast(failure, "error"));
  }, [app, ready.length]);
  useEffect(() => { if (!connecting) return undefined; const timer = setTimeout(() => setConnecting(false), 3 * 60 * 1000); return () => clearTimeout(timer); }, [connecting]);
  if (!app) return error ? <p className="tw-card-error" role="alert">{error}</p> : null;
  const name = app.displayName;
  const connect = () => {
    waiting.current = ready.map(account => account.id);
    setConnecting(true);
    call("integrations.beginConnect", { integrationId: app.id, agentId }).then(() => toast("Finish connecting in your browser.")).catch(failure => { waiting.current = null; setConnecting(false); setError(errorText(failure)); });
  };
  const busy = connecting || !agentId;
  const action = ready.length ? (
    <span className="tw-accounts" aria-label={`${ready.length} ${name} accounts`}>
      {ready.slice(0, 4).map(account => account.avatarUrl ? <img key={account.id} src={account.avatarUrl} alt="" title={account.displayName} /> : <span key={account.id} className="tw-account-face" title={account.displayName}>{initials(account.displayName).slice(0, 1)}</span>)}
      <button type="button" className="tw-round-add" aria-label={connecting ? `Connecting ${name}` : `Connect another ${name} account`} title={`Connect another ${name} account`} disabled={busy} onClick={connect}>
        {connecting ? <LoaderCircle size={14} className="tw-spin" /> : <Plus size={14} />}
      </button>
    </span>
  ) : pending.length ? (
    <button type="button" className="tw-card-pill secondary" aria-label={connecting ? `Connecting ${name}` : `Update ${name} connection`} disabled={busy} onClick={connect}>{connecting ? <LoaderCircle size={14} className="tw-spin" /> : <><RefreshCw size={13} />Reconnect</>}</button>
  ) : (
    <button type="button" className="tw-card-pill secondary" aria-label={connecting ? `Connecting ${name}` : undefined} disabled={busy} onClick={connect}>{connecting ? <LoaderCircle size={14} className="tw-spin" /> : "Connect"}</button>
  );
  return (
    <div className="tw-card-wrap" data-card="connect-plugin">
      <div className="tw-chat-card tw-row-card">
        <span className="tw-card-icon"><AppIcon app={app} size={32} /></span>
        <span className="tw-card-text"><strong>{ready.length ? name : `Connect ${name}`}</strong>{app.shortDescription ? <small><span>{app.shortDescription}</span></small> : null}</span>
        <span className="tw-card-action">{action}</span>
      </div>
      {error ? <p className="tw-card-error" role="alert">{error}</p> : null}
    </div>
  );
}

// ── <widget-mcp-connection> ────────────────────────────────────────────────
const sameUrl = (a, b) => { try { return new URL(a).href.replace(/\/$/, "") === new URL(b).href.replace(/\/$/, ""); } catch { return false; } };
function serverName(url, taken) {
  const parts = host(url).toLowerCase().split(".").filter(Boolean);
  let base = parts.length > 2 && /^(mcp|api|app|server|www)$/.test(parts[0]) ? parts[1] : parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "server";
  base = base.replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 34) || "server";
  if (/^timewarp/.test(base)) base = "mcp-" + base;
  let name = base, count = 2;
  while (taken.has(name)) name = `${base}-${count++}`;
  return name;
}
function McpCard({ card }) {
  const { chat, canSend, save, send } = useCard(card);
  const url = httpsUrl(card.attrs.url);
  const [servers, setServers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const waiting = useRef(null);
  const toast = useToast();
  const load = useCallback(() => call("mcp.list", {}).then(setServers).catch(failure => setError(errorText(failure))), []);
  useEffect(() => { if (url) void load(); }, [url, load]);
  const server = servers?.find(item => item.url && sameUrl(item.url, url));
  const name = server?.name || host(url);
  const status = !server ? "available" : server.authStatus === "notLoggedIn" ? "signin" : "ready";
  const connected = label => {
    waiting.current = null;
    void save({ connected: true });
    if (canSend) void send(`${label} connected`).catch(failure => toast(failure, "error"));
  };
  useEngineEvent("mcp.changed", event => {
    void load();
    if (waiting.current && event?.name === waiting.current) {
      if (event.success === false) { waiting.current = null; setError(event.error || "Could not connect this MCP server."); }
      else if (event.success) connected(event.name);
    }
  });
  if (!url) return null;
  async function connect() {
    if (!servers || server) return;
    setBusy(true); setError("");
    try {
      const added = serverName(url, new Set(servers.map(item => item.name)));
      const list = await call("mcp.add", { name: added, transport: "http", url });
      setServers(list);
      const entry = list.find(item => item.name === added);
      if (entry?.authStatus === "notLoggedIn") {
        waiting.current = added;
        await call("mcp.signIn", { name: added });
        toast("Finish signing in in your browser.");
      } else connected(added);
    } catch (failure) { setError(errorText(failure) || "Could not connect this MCP server."); }
    finally { setBusy(false); }
  }
  const action = status === "ready" ? <button type="button" className="tw-card-pill secondary" disabled><Check size={14} /> Connected</button>
    : status === "signin" ? <button type="button" className="tw-card-pill secondary" onClick={() => { location.hash = "#/customize/tools"; }}>Manage</button>
      : <button type="button" className="tw-card-pill secondary" disabled={busy || !servers || !chat?.conversation} onClick={() => void connect()}>{busy ? <LoaderCircle size={14} className="tw-spin" /> : "Connect"}</button>;
  return (
    <div className="tw-card-wrap" data-card="widget-mcp-connection">
      <div className="tw-chat-card tw-row-card">
        <span className="tw-card-icon"><SiteIcon url={url} size={32} fallback="server" /></span>
        <span className="tw-card-text"><strong>{status === "available" ? `Connect ${name}` : name}</strong><small><span>{url}</span></small></span>
        <span className="tw-card-action">{action}</span>
      </div>
      {error ? <p className="tw-card-error" role="alert">{error}</p> : null}
    </div>
  );
}

// ── <select> ───────────────────────────────────────────────────────────────
function SelectCard({ card }) {
  const { saved, canSend, save, send } = useCard(card);
  const multiple = card.attrs.multiple !== undefined && card.attrs.multiple !== "false";
  const options = card.options || [];
  const [draft, setDraft] = useState({ selections: [], customAnswer: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dictation = useDictation({
    onText: spoken => setDraft(current => ({ selections: multiple ? current.selections : [], customAnswer: [current.customAnswer.trim(), spoken].filter(Boolean).join(" ").slice(0, 200) })),
    onError: failure => setError(errorText(failure)),
  });
  if (!options.length) return null;
  const answered = !!saved;
  const selections = answered ? (saved.selections || []).filter(value => options.some(option => option.value === value)) : draft.selections;
  const custom = answered ? saved.customAnswer || "" : draft.customAnswer;
  const recording = dictation.status === "recording", transcribing = dictation.status === "transcribing";
  const locked = busy || answered || !canSend || recording || transcribing;
  const ready = !locked && (selections.length > 0 || !!custom.trim());
  async function submit(answer) {
    if (busy || answered || !canSend) return;
    setBusy(true); setError("");
    try { await send(selectAnswer(options, answer)); await save(answer); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  const choose = option => {
    if (locked) return;
    if (!multiple) { setDraft({ selections: [option.value], customAnswer: "" }); void submit({ selections: [option.value] }); return; }
    setDraft(current => ({ ...current, selections: current.selections.includes(option.value) ? current.selections.filter(value => value !== option.value) : [...current.selections, option.value] }));
  };
  const finish = () => { if (ready) void submit({ selections, ...(custom.trim() ? { customAnswer: custom.trim() } : {}) }); };
  const mark = (selected, index) => multiple
    ? <span className={"tw-option-check" + (selected ? " on" : "")} aria-hidden="true">{selected ? <Check size={11} strokeWidth={3} /> : null}</span>
    : <span className={"tw-number" + (selected ? " on" : "")} aria-hidden="true">{index + 1}</span>;
  return (
    <div className="tw-chat-card tw-select-card" data-card="select" data-submitted={answered ? "true" : "false"}>
      {options.map((option, index) => {
        const selected = selections.includes(option.value);
        return (
          <button key={option.value} type="button" role={multiple ? "checkbox" : "radio"} aria-checked={selected} disabled={locked} className={"tw-option" + (answered && !selected ? " faded" : "")} onClick={() => choose(option)}>
            {mark(selected, index)}<span>{option.label}</span>
          </button>
        );
      })}
      {!answered || custom.trim() ? (
        <div className="tw-option custom">
          {mark(!!custom.trim(), options.length)}
          <textarea rows={1} aria-label="Custom answer" placeholder="Type your own answer..." value={custom} maxLength={200} disabled={locked}
            onChange={event => { const value = event.target.value; setDraft(current => ({ selections: !multiple && value.trim() ? [] : current.selections, customAnswer: value })); }}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); finish(); } }} />
          {!answered ? (
            <>
              <button type="button" className="tw-icon-button small" aria-label={recording ? "Stop dictation" : "Dictate answer"} title={recording ? "Stop dictation" : "Dictate answer"} disabled={busy || !canSend || transcribing}
                onClick={() => recording ? dictation.stop() : void dictation.start()}>{transcribing ? <LoaderCircle size={15} className="tw-spin" /> : recording ? <Square size={12} fill="currentColor" /> : <Mic size={15} />}</button>
              <button type="button" className="tw-card-pill outline small" disabled={locked} onClick={() => void submit({ skipped: true })}>Skip</button>
              <button type="button" className="tw-card-pill small" disabled={!ready} onClick={finish}>{busy ? <LoaderCircle size={13} className="tw-spin" /> : "Submit"}</button>
            </>
          ) : null}
        </div>
      ) : null}
      {answered && saved.skipped ? <div className="tw-select-note">Skipped</div> : null}
      {!answered && error ? <p className="tw-card-error" role="alert">{error}</p> : null}
    </div>
  );
}

// ── <button> ───────────────────────────────────────────────────────────────
function PromptButton({ card }) {
  const { saved, canSend, save, send } = useCard(card);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { label, prompt, variant } = card.attrs;
  const sent = !!saved;
  return (
    <button type="button" className={"tw-card-pill" + (variant === "outline" ? " outline" : "")} data-card="button" disabled={busy || sent || !canSend}
      onClick={() => { setBusy(true); send(prompt).then(() => save({ sent: true })).catch(failure => toast(failure, "error")).finally(() => setBusy(false)); }}>
      {sent ? <Check size={14} /> : busy ? <LoaderCircle size={14} className="tw-spin" /> : null}{label}
    </button>
  );
}
function ButtonCard({ card }) {
  const { label, href, prompt, variant } = card.attrs;
  if (!label?.trim() || (!href && !prompt)) return null;
  if (!href) return <PromptButton card={card} />;
  return <MarkdownLink href={href} pill={variant === "outline" ? "outline" : "default"}>{label}</MarkdownLink>;
}

// ── <conversation>, <message>, <message-input> ─────────────────────────────
function ChatMessage({ item }) {
  const { sender, date } = item.attrs;
  const side = item.attrs.side === "right" ? "right" : "left";
  return (
    <div className="tw-chat-line" data-side={side}>
      {sender || date ? <span className="tw-chat-meta">{sender}{sender && date ? " · " : ""}{date ? <time>{date}</time> : null}</span> : null}
      <div className="tw-chat-bubble">{item.body}</div>
    </div>
  );
}
function EmailMessage({ item }) {
  const [open, setOpen] = useState(false);
  const details = item.attrs;
  const sender = details.sender || details.from || "Unknown sender";
  const first = ["to", "cc", "bcc", "from"].find(field => details[field]);
  return (
    <article className="tw-email">
      <span className="tw-email-face" aria-hidden="true">{sender.slice(0, 1).toUpperCase()}</span>
      <div className="tw-email-main">
        <div className="tw-email-head"><strong>{sender}</strong>{details.date ? <time>{details.date}</time> : null}</div>
        {first ? <button type="button" className="tw-email-to" aria-expanded={open} onClick={() => setOpen(value => !value)}><span>{first} {details[first]}</span><ChevronDown size={12} /></button> : null}
        {open ? <dl className="tw-email-fields">{["from", "to", "cc", "bcc"].filter(field => details[field]).map(field => <div key={field}><dt>{field}</dt><dd>{details[field]}</dd></div>)}</dl> : null}
        <div className="tw-email-body">{item.body}</div>
      </div>
    </article>
  );
}

function Recipients({ label, value, editable, onChange, actions }) {
  const [input, setInput] = useState("");
  const list = splitAddresses(value);
  const add = text => { const more = splitAddresses(text); if (more.length) { onChange([...new Set([...list, ...more])].join(", ")); setInput(""); } };
  if (!editable && !list.length) return <div className="tw-draft-row"><span className="tw-draft-label">{label}</span></div>;
  return (
    <div className="tw-draft-row">
      <span className="tw-draft-label">{label}</span>
      <span className="tw-draft-chips">
        {list.map(address => <span key={address} className="tw-address-chip">{address}{editable ? <button type="button" aria-label={`Remove ${address}`} onClick={() => onChange(list.filter(item => item !== address).join(", "))}><X size={11} /></button> : null}</span>)}
        {editable ? <input aria-label={label} value={input} placeholder={list.length ? "" : "Recipients"} onChange={event => setInput(event.target.value)} onBlur={() => add(input)}
          onKeyDown={event => { if ((event.key === "Enter" || event.key === "," || event.key === ";" || event.key === "Tab") && input.trim()) { event.preventDefault(); add(input); } else if (event.key === "Backspace" && !input && list.length) onChange(list.slice(0, -1).join(", ")); }} /> : null}
      </span>
      {actions}
    </div>
  );
}

function MessageInput({ card, part, item, mode, title = "", url = "" }) {
  const { saved, canSend, save, send } = useCard(card, part);
  const [values, setValues] = useState(() => ({ body: item.body || "", from: item.attrs.from || "", to: item.attrs.to || "", cc: item.attrs.cc || "", bcc: item.attrs.bcc || "" }));
  const [extra, setExtra] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const sent = !!saved;
  const current = sent ? { ...values, ...saved.values } : values;
  const editable = canSend && !sent;
  const valid = !!current.body.trim() && (mode !== "email" || splitAddresses(current.to).length > 0);
  const set = (field, value) => setValues(state => ({ ...state, [field]: value }));
  async function submit(event) {
    event.preventDefault();
    if (!valid || sent || busy || !canSend) return;
    setBusy(true);
    try { await send(draftMessage({ mode, title, url, ...current })); await save({ sent: true, values: current }); }
    catch (failure) { toast(failure, "error"); }
    finally { setBusy(false); }
  }
  if (mode === "email") {
    const hidden = ["cc", "bcc"].filter(field => !extra.includes(field) && !current[field]);
    return (
      <form className="tw-draft email" onSubmit={submit}>
        <div className="tw-draft-row"><span className="tw-draft-label">From</span>{editable ? <input aria-label="From" value={current.from} onChange={event => set("from", event.target.value)} /> : <span className="tw-draft-value">{current.from}</span>}</div>
        <Recipients label="To" value={current.to} editable={editable} onChange={value => set("to", value)}
          actions={editable && hidden.length ? <span className="tw-draft-more">{hidden.map(field => <button key={field} type="button" onMouseDown={event => event.preventDefault()} onClick={() => setExtra(list => [...list, field])}>{field === "cc" ? "Cc" : "Bcc"}</button>)}</span> : null} />
        {["cc", "bcc"].filter(field => !hidden.includes(field)).map(field => <Recipients key={field} label={field === "cc" ? "Cc" : "Bcc"} value={current[field]} editable={editable} onChange={value => set(field, value)} />)}
        {editable ? <textarea className="tw-draft-body" aria-label="Email body" placeholder="Write the email body..." value={current.body} onChange={event => set("body", event.target.value)} /> : <div className="tw-draft-body read">{current.body}</div>}
        <div className="tw-draft-actions">
          <button type="submit" className="tw-card-pill" disabled={!valid || sent || busy || !canSend}>{sent ? <><Check size={14} /> Sent</> : <><Send size={14} /> {busy ? "Sending..." : "Send"}</>}</button>
        </div>
      </form>
    );
  }
  return (
    <div className="tw-chat-line" data-side="right">
      <form className="tw-draft chat" onSubmit={submit}>
        <textarea aria-label="Message" placeholder="Message" rows={1} value={current.body} disabled={!editable} onChange={event => set("body", event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <button type="submit" className="tw-draft-send" aria-label={sent ? "Sent" : "Send message"} title={sent ? "Sent" : "Send"} disabled={!valid || sent || busy || !canSend}>
          {sent ? <Check size={15} /> : busy ? <LoaderCircle size={15} className="tw-spin" /> : <ArrowUp size={15} />}
        </button>
      </form>
    </div>
  );
}

function ConversationCard({ card }) {
  const [open, setOpen] = useState(true);
  const mode = card.attrs.mode === "email" ? "email" : "chat";
  const url = webUrl(card.attrs.url);
  const title = card.attrs.title?.trim() || "";
  let inputs = 0;
  return (
    <div className="tw-chat-card tw-convo-card" data-card="conversation" data-mode={mode}>
      <button type="button" className="tw-convo-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {url ? <SiteIcon url={url} size={16} /> : mode === "email" ? <Mail size={16} /> : <MessageSquare size={16} />}
        <span>{title || (mode === "email" ? "Email" : "Chat")}</span>
        <ChevronDown size={16} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="tw-convo-body">
          {card.items.map((item, index) => item.tag === "message-input"
            ? <MessageInput key={index} card={card} part={"input" + inputs++} item={item} mode={mode} title={title} url={url || ""} />
            : mode === "email" ? <EmailMessage key={index} item={item} /> : <ChatMessage key={index} item={item} />)}
        </div>
      ) : null}
    </div>
  );
}

// ── <tabs> ─────────────────────────────────────────────────────────────────
function TabsCard({ card }) {
  const scope = useContext(CardScope);
  const [active, setActive] = useState(0);
  if (!card.tabs?.length) return null;
  return (
    <div className="tw-card-tabs" data-card="tabs">
      <div className="tw-tab-strip" role="tablist" aria-label="Options">
        {card.tabs.map((tab, index) => (
          <button key={index} type="button" role="tab" aria-selected={index === active} onClick={() => setActive(index)}>
            <span className="tw-tab-letter">{"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] ?? index + 1}</span>{tab.label}
          </button>
        ))}
      </div>
      {card.tabs.map((tab, index) => <div key={index} role="tabpanel" hidden={index !== active} className="tw-tab-panel">{scope?.renderMarkdown(tab.body, { part: `tabs${card.ordinal}.${index}` })}</div>)}
    </div>
  );
}

// ── <widget-secret> ────────────────────────────────────────────────────────
const siteOrigin = value => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try { const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw); return /^https?:$/.test(url.protocol) && (url.hostname.includes(".") || url.hostname === "localhost") ? url.origin : null; } catch { return null; }
};
function SecretCard({ card }) {
  const { chat, saved, canSend, ready, save, send } = useCard(card);
  const attrs = card.attrs;
  const kind = attrs.kind === "password" || attrs.kind === "credit-card" ? attrs.kind : "secret";
  const label = String(attrs.label || "").trim().slice(0, 200);
  const origin = siteOrigin(attrs.origin);
  const identity = kind !== "credit-card" && (attrs["username-field"] === "email" || attrs["username-field"] === "username") ? attrs["username-field"] : null;
  const form = useRef(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [granting, setGranting] = useState(false);
  const toast = useToast();
  if (!label || (kind === "password" && !origin)) return <div className="tw-chat-card tw-secure-card" role="alert" data-card="widget-secret"><p className="tw-hint">This secure input could not be shown. Ask the assistant to request the value again.</p></div>;
  const status = saved?.status;
  const locked = busy || !canSend || !ready;
  const notify = async state => {
    const text = state.status === "cancelled" ? `Cancelled the secure input for "${label}".` : `Saved "${label}" in the vault: ${state.description}, vault item ${state.id}.`;
    await send(text);
    await save({ ...state, notified: true });
  };
  async function submit(cancel) {
    if (locked) return;
    setBusy(true); setError("");
    let state = status ? saved : null;
    try {
      if (!state) {
        if (cancel) state = { status: "cancelled" };
        else {
          const data = Object.fromEntries(new FormData(form.current).entries());
          let item;
          if (kind === "credit-card") {
            const expiry = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(data.expiry || "");
            if (!expiry) throw new Error("Enter the expiry as MM/YY.");
            item = await call("vault.create", { kind: "card", label, cardholder: data.cardholder || "", number: data.number || "", expMonth: Number(expiry[1]), expYear: Number(expiry[2].length === 2 ? "20" + expiry[2] : expiry[2]) });
          } else if (kind === "password") item = await call("vault.create", { kind: "password", label, site: origin, username: identity ? data.username || "" : attrs.username || "", password: data.secret || "" });
          else item = await call("vault.create", { kind: "secret", label, value: data.secret || "" });
          state = { status: "submitted", id: item.id, description: kind === "credit-card" ? `a ${item.brand || "payment"} card ending ${item.last4}` : kind === "password" ? `a sign-in for ${item.origin}` : "a secret" };
        }
        form.current?.reset();
        await save({ ...state, notified: false });
      }
      await notify(state);
    } catch (failure) {
      setError(state?.status === "submitted" ? "Saved, but the task could not continue. Try again." : state ? "The task could not continue. Try again." : errorText(failure) || "Could not save. Please try again.");
    } finally { form.current?.reset(); setBusy(false); }
  }
  const grant = () => {
    setGranting(true);
    call("agents.update", { id: chat.agent.id, vaultAccess: true }).then(agent => changed(chat, { agent: { ...chat.agent, ...agent, vaultAccess: true } })).catch(failure => toast(failure, "error")).finally(() => setGranting(false));
  };
  const needsAccess = status === "submitted" && chat?.agent && !chat.agent.vaultAccess;
  return (
    <div className="tw-card-wrap tw-secure" data-card="widget-secret">
      {!status && attrs.reason ? <p className="tw-secure-reason">{attrs.reason}</p> : null}
      <div className="tw-chat-card tw-secure-card">
        <div className="tw-secure-head">
          <span className="tw-card-icon small">{origin ? <SiteIcon url={origin} size={20} /> : <KeyRound size={16} />}</span>
          <strong>{label}</strong>
          {!status && kind === "password" ? <span className="tw-secure-origin" title={origin}>{origin}</span> : null}
          {status ? <span className="tw-secure-status" role="status">{status === "submitted" ? <><Check size={15} />Saved</> : "Cancelled"}</span> : null}
        </div>
        {!status ? (
          <form ref={form} className="tw-secure-form" autoComplete="off" onSubmit={event => { event.preventDefault(); void submit(false); }}>
            {kind === "password" && !identity && attrs.username ? <div className="tw-secure-user">{attrs.username}</div> : null}
            {identity ? <label className="tw-secure-field"><span>{identity === "email" ? "Email" : "Username"}</span><input className="tw-input" name="username" type={identity === "email" ? "email" : "text"} placeholder={identity === "email" ? "Enter email" : undefined} defaultValue={attrs.username || ""} autoComplete="username" required maxLength={320} disabled={locked} /></label> : null}
            {kind === "credit-card" ? (
              <>
                <label className="tw-secure-field"><span>Name on card</span><input className="tw-input" name="cardholder" autoComplete="off" maxLength={120} disabled={locked} /></label>
                <label className="tw-secure-field"><span>Card number</span><input className="tw-input" name="number" inputMode="numeric" autoComplete="off" required maxLength={23} placeholder="1234 1234 1234 1234" disabled={locked} /></label>
                <label className="tw-secure-field"><span>Expiry</span><input className="tw-input" name="expiry" inputMode="numeric" autoComplete="off" required maxLength={7} placeholder="MM/YY" disabled={locked} /></label>
              </>
            ) : (
              <label className="tw-secure-field">
                <span className={identity ? undefined : "tw-sr-only"}>{kind === "password" ? "Password" : "Secret value"}</span>
                <span className="tw-secure-input">
                  <input className="tw-input" name="secret" aria-label={kind === "password" ? "Password" : "Secret value"} placeholder={kind === "password" ? "Enter password" : "Enter secret value"} type={shown ? "text" : "password"} autoComplete="off" required maxLength={10000} disabled={locked} />
                  <button type="button" className="tw-icon-button small" aria-label={shown ? "Hide secret value" : "Show secret value"} aria-pressed={shown} disabled={locked} onClick={() => setShown(value => !value)}>{shown ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                </span>
              </label>
            )}
            <div className="tw-secure-actions">
              <button type="button" className="tw-btn ghost small" disabled={locked} onClick={() => void submit(true)}>Cancel</button>
              <button type="submit" className="tw-btn primary small" disabled={locked}>{busy ? <><LoaderCircle size={14} className="tw-spin" />Saving…</> : "Save"}</button>
            </div>
          </form>
        ) : null}
        {needsAccess ? (
          <div className="tw-secure-access">
            <span>{chat.agent.name} needs vault access to use it.</span>
            <button type="button" className="tw-btn small" disabled={granting} onClick={grant}>Allow vault access</button>
          </div>
        ) : null}
      </div>
      {status && saved.notified === false && !busy ? <button type="button" className="tw-btn small" disabled={!canSend} onClick={() => void submit(false)}>Continue task</button> : null}
      {error ? <p className="tw-card-error" role="alert">{error}</p> : null}
    </div>
  );
}

// ── <citation>, <ref>, <widget-interaction> (inline) ───────────────────────
const openUrl = url => window.dispatchEvent(new CustomEvent("tw:open-url", { detail: { url } }));
function CitationPill({ card }) {
  const sources = card.sources || [];
  if (!sources.length) return null;
  const label = sources.length === 1 ? "Source" : `${sources.length} sources`;
  if (sources.length === 1) return <button type="button" className="tw-citation" data-card="citation" title={sources[0]} onClick={() => openUrl(sources[0])}><Link2 size={12} />{label}</button>;
  return (
    <Menu width={288} trigger={({ toggle, open }) => <button type="button" className="tw-citation" data-card="citation" aria-expanded={open} onClick={toggle}><Link2 size={12} />{label}</button>}>
      {sources.map((url, index) => <button key={url} type="button" className="tw-menu-item" data-close title={url} onClick={() => openUrl(url)}><span className="grow">{index + 1}. {host(url)}</span><ExternalLink size={14} /></button>)}
    </Menu>
  );
}

const imageCache = new Map();
// An image in the agent's workspace, or with `outside`, an image the user
// attached from elsewhere on this computer (attachments.preview).
function useWorkspaceImage(conversationId, file, { outside = false } = {}) {
  const [state, setState] = useState(() => imageCache.get(conversationId + "\n" + file) || null);
  useEffect(() => {
    const key = conversationId + "\n" + file;
    if (!conversationId || !file) { setState({ failed: true }); return undefined; }
    if (imageCache.has(key)) { setState(imageCache.get(key)); return undefined; }
    let cancelled = false;
    call("cards.resolve", { conversationId, path: file })
      .then(info => info.inside && info.isFile ? call("files.read", { agentId: info.agentId, path: info.relative }).then(read => ({ info, read }))
        : outside && info.exists && info.isFile ? call("attachments.preview", { conversationId, path: file }).then(read => ({ info, read: { kind: "image", ...read } })) : { info })
      .then(result => {
        const value = result?.read?.kind === "image" && result.read.dataUrl ? { src: result.read.dataUrl, info: result.info } : { failed: true, info: result?.info };
        if (value.src) { imageCache.set(key, value); if (imageCache.size > 40) imageCache.delete(imageCache.keys().next().value); }
        if (!cancelled) setState(value);
      })
      .catch(() => { if (!cancelled) setState({ failed: true }); });
    return () => { cancelled = true; };
  }, [conversationId, file, outside]);
  return state;
}

// An image at full size, over the window.
export function ImageDialog({ src, name, onClose }) {
  return createPortal(
    <Dialog open={!!src} onClose={onClose} wide label={name ? "Preview " + name : "Image"} className="tw-card-preview tw-image-dialog">
      {src ? (
        <div className="tw-files">
          <div className="tw-files-bar">
            <FileImage size={16} strokeWidth={1.7} aria-hidden="true" />
            <strong className="tw-files-title">{name || "Image"}</strong>
            <button type="button" className="tw-icon-button" title="Close" aria-label="Close preview" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="tw-preview-scroll tw-image-view"><img src={src} alt={name || ""} /></div>
        </div>
      ) : null}
    </Dialog>,
    document.body,
  );
}

// An image the user sent, as a thumbnail that opens it: in the preview (or
// the pane) when it's in the agent's workspace, larger here otherwise.
export function AttachmentImage({ conversationId, file }) {
  const picture = useWorkspaceImage(conversationId, file, { outside: true });
  const preview = useFilePreview();
  const [large, setLarge] = useState(false);
  const name = baseName(file);
  const open = () => picture?.info?.inside ? preview.open(conversationId, picture.info, file) : setLarge(true);
  return (
    <>
      <button type="button" className="tw-attachment-image" title={file} aria-label={`Preview ${name}`} disabled={!picture?.src} onClick={open}>
        {picture?.src ? <img src={picture.src} alt="" /> : <FileImage size={18} strokeWidth={1.6} aria-hidden="true" />}
      </button>
      {picture?.info?.inside ? preview.element : large && picture?.src ? <ImageDialog src={picture.src} name={name} onClose={() => setLarge(false)} /> : null}
    </>
  );
}

// A file named in a message: opens in the preview (or the pane) when it's in
// the agent's workspace, shows in its folder otherwise.
export function FileChip({ name, file, image, conversationId: given = null }) {
  const scope = useContext(CardScope);
  const conversationId = given || scope?.conversationId;
  const preview = useFilePreview();
  const picture = useWorkspaceImage(image ? conversationId : null, image ? file : null);
  const toast = useToast();
  const open = () => call("cards.resolve", { conversationId, path: file })
    .then(info => !info.exists ? toast("That file no longer exists.", "error")
      : info.inside && info.isFile ? preview.open(conversationId, info, file) : call("cards.revealFile", { conversationId, path: file }))
    .catch(error => toast(error, "error"));
  if (!conversationId) return <span className="tw-ref" data-ref="file" title={file}><FileIcon name={name} size={14} /><span>{name}</span></span>;
  return (
    <>
      <button type="button" className="tw-ref clickable" data-ref="file" title={file} aria-label={image ? `Preview ${name}` : undefined} onClick={open}>
        {image && picture?.src ? <img src={picture.src} alt="" aria-hidden="true" /> : <FileIcon name={name} size={14} />}<span>{name}</span>
      </button>
      {preview.element}
    </>
  );
}

function RefChip({ card }) {
  const attrs = card.attrs;
  const clean = value => typeof value === "string" && value.startsWith("user-content-") ? value.slice(13) : value;
  const name = clean(attrs.name);
  if (attrs.type === "file" && name && attrs.path) return <FileChip name={name} file={attrs.path} image={/^image\//.test(attrs["content-type"] || "") || /^(png|jpe?g|gif|webp|bmp)$/.test(extensionOf(name))} />;
  const icon = httpsUrl(attrs["icon-url"]);
  if (attrs.type === "skill" && name) return <span className="tw-ref" data-ref="skill" title={attrs.path}>{icon ? <img src={icon} alt="" /> : <Sparkles size={12} />}<span>{name.includes(":") ? name.slice(name.indexOf(":") + 1) : name}</span></span>;
  if (attrs.type === "plugin" && attrs.title) return <span className="tw-ref" data-ref="plugin">{icon ? <img src={icon} alt="" /> : <Puzzle size={12} />}<span>{attrs.title}</span></span>;
  if (attrs.type === "person" && name && attrs.email) {
    const picture = httpsUrl(attrs["image-url"]);
    return <span className="tw-ref" data-ref="person" title={attrs.email}>{picture ? <img className="round" src={picture} alt="" /> : <UserRound size={12} />}<span>{name}</span></span>;
  }
  return null;
}

// ── <suggested-tasks>, <assistants> (chats from the previous app) ──────────
function SuggestedTasksCard({ card }) {
  const { saved, canSend, save, send } = useCard(card);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const started = new Set(saved?.started || []);
  if (!card.tasks?.length) return null;
  const start = (task, index) => {
    setBusy(index);
    send(task.description).then(() => save({ started: [...started, index] })).catch(failure => toast(failure, "error")).finally(() => setBusy(null));
  };
  return (
    <div className="tw-chat-card tw-card-list" data-card="suggested-tasks">
      {card.tasks.map((task, index) => (
        <button key={index} type="button" className="tw-card-row" aria-pressed={started.has(index)} disabled={started.has(index) || busy !== null || !canSend} onClick={() => start(task, index)}>
          <span className="tw-site-stack">{task.websites.length ? task.websites.map(site => <SiteIcon key={site} url={site} size={16} />) : <Sparkles size={16} />}</span>
          <span className="grow">{task.title}</span>
          {started.has(index) ? <Check size={16} aria-label="Started" /> : busy === index ? <LoaderCircle size={16} className="tw-spin" /> : <span className="tw-start">Start</span>}
        </button>
      ))}
    </div>
  );
}

function AssistantsCard({ card }) {
  const [agents, setAgents] = useState(null);
  const toast = useToast();
  useEffect(() => { call("agents.list").then(setAgents).catch(() => setAgents([])); }, []);
  const ids = [...new Set(String(card.attrs["agent-ids"] || "").split(",").map(id => id.trim()).filter(Boolean))].slice(0, 10);
  const list = (agents || []).filter(agent => ids.includes(agent.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (!list.length) return null;
  // Opens the agent's latest chat, or a new one.
  const open = async agent => {
    try {
      const [latest] = await call("conversations.list", { agentId: agent.id });
      const target = latest || await call("conversations.create", { agentId: agent.id });
      if (!latest) window.dispatchEvent(new Event("tw:conversations"));
      location.hash = "#/conversation/" + target.id;
    } catch (failure) { toast(failure, "error"); }
  };
  return (
    <div className="tw-chat-card tw-card-list" data-card="assistants">
      {list.map(agent => (
        <button key={agent.id} type="button" className="tw-card-row" onClick={() => void open(agent)}>
          <img className="tw-avatar" src={avatarSrc(agent)} alt="" /><span className="grow"><strong>{agent.name}</strong></span><ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}

// ── Links ──────────────────────────────────────────────────────────────────
// A web page opens in the chat's browser pane; hovering offers the default
// browser. Files open in the preview, tabs in the pane, workers in their
// transcript, and app links go to that page.
function useWorker(conversationId, threadId) {
  const chat = useChat(conversationId);
  const worker = chat && threadId ? chat.workers.get(threadId) : null;
  useEffect(() => {
    if (!chat || !threadId || chat.workers.has(threadId)) return;
    chat.workers.set(threadId, { status: "loading", name: null, browsing: false });
    call("conversations.worker", { id: conversationId, threadId }).then(value => {
      const last = (value.turns || []).at(-1);
      const status = !last ? "running" : last.status === "inProgress" ? "running" : last.status === "completed" ? "complete" : "stopped";
      Object.assign(chat.workers.get(threadId), { status, name: value.name || null });
      changed(chat, {});
    }).catch(() => { Object.assign(chat.workers.get(threadId), { status: "unavailable" }); changed(chat, {}); });
  }, [chat, conversationId, threadId]);
  return worker || { status: conversationId ? "loading" : "unavailable" };
}
function WorkerIcon({ status }) {
  if (status === "loading" || status === "running") return <LoaderCircle size={14} className="tw-link-glyph tw-spin slow" data-worker-status={status} aria-hidden="true" />;
  if (status === "complete") return <Check size={14} className="tw-link-glyph" data-worker-status={status} aria-hidden="true" />;
  if (status === "stopped") return <CircleAlert size={14} className="tw-link-glyph" data-worker-status={status} aria-hidden="true" />;
  return <CircleSlash size={14} className="tw-link-glyph" data-worker-status="unavailable" aria-hidden="true" />;
}

// A worker the agent started: its live status, and its transcript (the chat
// view opens it on "tw:open-thread", from the link as the sheet's origin).
function SubagentLink({ conversationId, threadId, href, title, children }) {
  const worker = useWorker(conversationId, threadId);
  const [note, setNote] = useState(false);
  const follow = event => {
    event.preventDefault();
    if (!conversationId || worker.status === "unavailable") { setNote(value => !value); return; }
    window.dispatchEvent(new CustomEvent("tw:open-thread", { detail: { conversationId, threadId, source: event.currentTarget } }));
  };
  return (
    <span className="tw-link-wrap" onMouseLeave={() => setNote(false)}>
      <a href={href} title={title} className="tw-md-link" onClick={follow}><WorkerIcon status={worker.status} />{children}{worker.browsing && worker.status === "running" ? <span className="tw-card-badge tw-browsing">Browsing</span> : null}</a>
      {note ? <span className="tw-link-pop note" role="note"><strong>Subagent unavailable</strong><span>Subagent details can only be shown in a conversation.</span></span> : null}
    </span>
  );
}

function TabIcon({ conversationId, tabId }) {
  const chat = useChat(conversationId);
  useEffect(() => {
    if (!chat || chat.tabs || chat.loadingTabs) return;
    chat.loadingTabs = true;
    call("browser.state", { conversationId }).then(state => changed(chat, { tabs: state.tabs || [] })).catch(() => changed(chat, { tabs: [] }));
  }, [chat, conversationId]);
  const tab = chat?.tabs?.find(item => item.id === tabId);
  const [failed, setFailed] = useState(false);
  if (tab?.favicon && !failed) return <img className="tw-link-glyph" src={tab.favicon} alt="" width="14" height="14" onError={() => setFailed(true)} />;
  return tab?.url ? <SiteIcon url={tab.url} size={14} /> : <Globe size={14} strokeWidth={1.8} className="tw-link-glyph" />;
}

function UrlLink({ url, href, title, className, children }) {
  const [menu, setMenu] = useState(false);
  const timer = useRef(null);
  const external = /^https:/i.test(url);
  const hover = on => { clearTimeout(timer.current); timer.current = setTimeout(() => setMenu(on), on ? 450 : 150); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const toast = useToast();
  return (
    <span className="tw-link-wrap" onMouseEnter={external ? () => hover(true) : undefined} onMouseLeave={external ? () => hover(false) : undefined}>
      <a href={href} title={title} className={className} rel="noreferrer" onClick={event => { event.preventDefault(); openUrl(url); }}><SiteIcon url={url} size={14} />{children}</a>
      {menu ? (
        <span className="tw-link-pop" role="menu">
          <button type="button" role="menuitem" className="tw-menu-item" onClick={() => { setMenu(false); call("links.open", { url }).catch(error => toast(error, "error")); }}><ExternalLink size={14} /><span className="grow">Open in external browser</span></button>
        </span>
      ) : null}
    </span>
  );
}

function FileLink({ conversationId, file, href, title, className, children }) {
  const preview = useFilePreview();
  const toast = useToast();
  const open = event => {
    event.preventDefault();
    if (!conversationId) return;
    call("cards.resolve", { conversationId, path: file }).then(info => {
      if (!info.exists) toast("That file no longer exists.", "error");
      else if (info.inside && info.isFile) preview.open(conversationId, info, file);
      else call("cards.revealFile", { conversationId, path: file }).catch(error => toast(error, "error"));
    }).catch(error => toast(error, "error"));
  };
  return <><a href={href} title={title || file} className={className} onClick={open}><FileIcon name={baseName(file)} size={14} />{children}</a>{preview.element}</>;
}

export function MarkdownLink({ href = "", title, children, pill = null }) {
  const scope = useContext(CardScope);
  const target = useMemo(() => resolveLink(href), [href]);
  const conversationId = scope?.conversationId || null;
  const className = pill ? "tw-card-pill link" + (pill === "outline" ? " outline" : "") : "tw-md-link";
  const block = event => event.preventDefault();
  if (target.type === "url") return <UrlLink url={target.url} href={href} title={title} className={className}>{children}</UrlLink>;
  if (target.type === "file") return <FileLink conversationId={conversationId} file={target.path} href={href} title={title} className={className}>{children}</FileLink>;
  if (target.type === "subagent") return <SubagentLink conversationId={conversationId} threadId={target.threadId} href={href} title={title}>{children}</SubagentLink>;
  if (target.type === "tab") {
    return <a href={href} title={title} className={className} onClick={event => { event.preventDefault(); window.dispatchEvent(new CustomEvent("tw:open-tab", { detail: { conversationId: target.conversationId, tabId: target.tabId } })); }}><TabIcon conversationId={target.conversationId} tabId={target.tabId} />{children}</a>;
  }
  if (target.type === "conversation" || target.type === "app") {
    const route = target.type === "conversation" ? "/conversation/" + target.conversationId : target.route;
    return <a href={"#" + route} title={title} className={className} onClick={event => { event.preventDefault(); location.hash = "#" + route; }}>{children}</a>;
  }
  return <a href={href || undefined} title={title} className={className} onClick={block} onAuxClick={block}>{children}</a>;
}

// ── Images ─────────────────────────────────────────────────────────────────
// Workspace images, https images and images written into the message
// (data: addresses) show; anything else shows its description.
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
export function MarkdownImage({ src, alt = "", title, width, height }) {
  const scope = useContext(CardScope);
  const target = useMemo(() => resolveLink(src), [src]);
  const local = target.type === "file" ? target.path : null;
  const picture = useWorkspaceImage(local ? scope?.conversationId : null, local);
  const sized = { width, height };
  if (DATA_IMAGE.test(String(src || "").trim())) return <img className="tw-md-image" src={String(src).trim()} alt={alt} title={title} {...sized} />;
  if (target.type === "url" && /^https:/i.test(target.url)) return <img className="tw-md-image" src={target.url} alt={alt} title={title} loading="lazy" referrerPolicy="no-referrer" {...sized} />;
  if (local && picture?.src) return <img className="tw-md-image" src={picture.src} alt={alt} title={title} {...sized} />;
  if (local && !picture) return <span className="tw-image-blocked" title={title}>{alt}</span>;
  return <span className="tw-image-blocked" data-blocked="true" title={title || (target.type === "url" ? "Only secure (https) images are shown" : undefined)}>{alt || "Image"}</span>;
}

// ── Registry ───────────────────────────────────────────────────────────────
function InteractionSummary({ card }) { return card.attrs.summary ? <em className="tw-interaction">{card.attrs.summary}</em> : null; }

const CARDS = {
  file: FileCard, "connect-plugin": ConnectCard, "widget-mcp-connection": McpCard, select: SelectCard, button: ButtonCard,
  conversation: ConversationCard, tabs: TabsCard, "widget-secret": SecretCard, citation: CitationPill, ref: RefChip,
  "suggested-tasks": SuggestedTasksCard, assistants: AssistantsCard, "widget-interaction": InteractionSummary,
  message: ({ card }) => <div className="tw-chat-card tw-convo-card bare" data-card="message"><ChatMessage item={{ attrs: card.attrs, body: card.text }} /></div>,
  "message-input": ({ card }) => <div className="tw-convo-card bare" data-card="message-input"><MessageInput card={card} item={{ attrs: card.attrs, body: card.text }} mode="chat" /></div>,
};

// A card in a message. Cards outside a chat (or in a message still being
// written) show but can't act.
export function ChatCard({ card }) {
  const Component = CARDS[card.tag];
  return Component ? <Component card={card} /> : null;
}
