import React, { useEffect, useState } from "react";
import { call, useEvent } from "../api.js";
import { Download, Plug, Plus, Trash2 } from "lucide-react";
import { Dialog, Segmented, Switch, useConfirm, useToast } from "./common.jsx";
import { ImportKnowledge } from "./Knowledge.jsx";

const AUTH = { notLoggedIn: "Sign-in needed", oAuth: "Signed in", bearerToken: "Token", unsupported: "", unknown: "" };

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.indexOf("=");
    if (at < 1) throw new Error(`Write environment variables as NAME=value ("${line.trim()}").`);
    env[line.slice(0, at).trim()] = line.slice(at + 1);
  }
  return env;
}

function AddServer({ onAdded, onCancel, onImport }) {
  const [draft, setDraft] = useState({ name: "", transport: "http", url: "", command: "", args: "", env: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  async function add(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const input = draft.transport === "http"
        ? { name: draft.name.trim(), transport: "http", url: draft.url.trim() }
        : { name: draft.name.trim(), transport: "stdio", command: draft.command.trim(), args: draft.args.split(/\r?\n/).map(item => item.trim()).filter(Boolean), env: parseEnv(draft.env) };
      onAdded(await call("mcp.add", input));
      toast("Server added.");
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  return (
    <form className="tw-import" onSubmit={add}>
      <label className="tw-field"><span>Name</span><input className="tw-input" value={draft.name} required maxLength={40} pattern="[a-z0-9][a-z0-9_\-]*" title="Lowercase letters, numbers, - and _" placeholder="docs" onChange={event => set({ name: event.target.value.toLowerCase() })} /></label>
      <Segmented label="Connection" value={draft.transport} onChange={transport => set({ transport })} options={[{ value: "http", label: "Remote URL" }, { value: "stdio", label: "Command on this computer" }]} />
      {draft.transport === "http" ? (
        <label className="tw-field"><span>Server URL</span><input className="tw-input" type="url" required value={draft.url} placeholder="https://example.com/mcp" onChange={event => set({ url: event.target.value })} /></label>
      ) : (
        <>
          <label className="tw-field"><span>Command</span><input className="tw-input" required value={draft.command} placeholder="npx" onChange={event => set({ command: event.target.value })} /></label>
          <label className="tw-field"><span>Arguments (one per line)</span><textarea className="tw-input" rows={3} value={draft.args} placeholder={"-y\n@modelcontextprotocol/server-filesystem"} onChange={event => set({ args: event.target.value })} /></label>
          <label className="tw-field"><span>Environment variables (NAME=value, one per line)</span><textarea className="tw-input" rows={2} value={draft.env} onChange={event => set({ env: event.target.value })} /></label>
          <span className="tw-hint">The command runs on this computer with your permissions whenever an agent uses the server. Only add servers you trust.</span>
        </>
      )}
      <div className="tw-dialog-actions">
        {onImport ? <button type="button" className="tw-btn ghost tw-push-left" disabled={busy} onClick={onImport}><Download size={15} />Import from other apps</button> : null}
        <button type="button" className="tw-btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="tw-btn primary" disabled={busy}>{busy ? "Adding…" : "Add server"}</button>
      </div>
    </form>
  );
}

// Timewarp's own servers read as names ("timewarp_composio" is "Timewarp Composio").
const serverTitle = server => server.builtIn ? server.name.split(/[_-]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(" ") : server.name;
const serverTarget = server => server.transport === "http" ? server.url : [server.command, ...server.args].join(" ");

// One server: what it offers, sign-in, on or off, remove.
function ServerDetails({ server, onRun, onClose }) {
  const toast = useToast();
  const confirm = useConfirm();
  const remove = async () => {
    if (!await confirm({ title: `Remove ${serverTitle(server)}?`, body: "Agents can no longer use this server. New chats pick up the change.", action: "Remove", danger: true })) return;
    if (await onRun("mcp.remove", { name: server.name })) onClose();
  };
  // A sign-in that ran out (mcp.cjs reauthenticationRequired) asks to sign in again.
  const expired = !!server.reauthenticationRequired;
  const status = [expired ? "Its sign-in has expired." : server.error ? server.error : server.tools !== null ? `${server.tools} tool${server.tools === 1 ? "" : "s"}` : "", expired ? "" : AUTH[server.authStatus] || ""].filter(Boolean).join(" · ");
  if (server.builtIn) return <p className="tw-plugin-text">Built into Timewarp: your connected apps reach agents through this server.{status ? " " + status + "." : ""}</p>;
  return (
    <>
      {status ? <p className={"tw-plugin-text" + (expired ? " tw-alert" : "")}>{status}</p> : null}
      <div className="tw-list-panel">
        <div className="tw-list-row compact">
          <div className="grow"><strong>Use this server</strong><span className="desc">New chats pick up changes.</span></div>
          <Switch label={"Use " + server.name} checked={server.enabled} onChange={value => void onRun("mcp.setEnabled", { name: server.name, enabled: value })} />
        </div>
      </div>
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn danger" onClick={() => void remove()}><Trash2 size={15} />Remove</button>
        {expired || server.authStatus === "notLoggedIn" ? <button type="button" className="tw-btn primary" onClick={() => onRun("mcp.signIn", { name: server.name }).then(ok => { if (ok) toast("Finish signing in in your browser."); })}>{expired ? "Sign in again" : "Sign in"}</button> : null}
      </div>
    </>
  );
}

export function McpServers({ query = "", onCount }) {
  const [servers, setServers] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState(null);
  const toast = useToast();
  // The configured servers show at once; their tools and sign-in state follow.
  const load = () => call("mcp.list", { builtIn: true, status: false }).then(quick => { setServers(current => current || quick); return call("mcp.list", { builtIn: true }); })
    .then(setServers).catch(error => { setServers(current => current || []); toast(error, "error"); });
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (servers) onCount?.(servers.length); }, [servers]);
  useEvent("mcp.changed", event => { if (event?.success === false) toast(event.error || "Sign-in didn't finish.", "error"); void load(); });
  // Changes return the user's servers; the list reloads to keep Timewarp's own.
  // Resolves whether the change worked; a failure shows as a toast.
  const run = (method, input) => call(method, input).then(() => load()).then(() => true, error => { toast(error, "error"); return false; });
  const needle = query.trim().toLowerCase();
  const shown = (servers || []).filter(server => !needle || serverTitle(server).toLowerCase().includes(needle) || String(serverTarget(server)).toLowerCase().includes(needle));
  const detail = open && (servers || []).find(server => server.name === open);
  return (
    <>
      {servers === null ? <p className="tw-loading">Loading servers…</p> : (
        <div className="tw-grid tw-mcp-grid">
          {shown.map(server => (
            <button key={server.name} type="button" className={"tw-tile clickable" + (server.enabled ? "" : " off")} onClick={() => setOpen(server.name)}>
              <span className="tw-mcp-icon"><Plug size={24} strokeWidth={1.75} /></span>
              <div><strong>{serverTitle(server)}</strong><span className="desc">{serverTarget(server)}</span></div>
              {server.reauthenticationRequired ? <span className="tw-tile-reconnect">Sign in again</span> : null}
            </button>
          ))}
          {needle ? null : <button type="button" className="tw-add-tile" onClick={() => setAdding(true)}><Plus size={24} strokeWidth={1.75} />Add MCP server</button>}
        </div>
      )}
      <Dialog open={!!detail} onClose={() => setOpen(null)} title={detail ? serverTitle(detail) : ""} description={detail ? serverTarget(detail) : ""}>
        {detail ? <ServerDetails server={detail} onRun={run} onClose={() => setOpen(null)} /> : null}
      </Dialog>
      <Dialog open={importing} onClose={() => setImporting(false)} title="Import MCP servers" description="Servers set up in ChatGPT / Codex, Claude or Cursor on this computer.">
        {importing ? <ImportKnowledge category="mcp" onImported={() => { setImporting(false); void load(); }} /> : null}
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add MCP server">
        {adding ? <AddServer onCancel={() => setAdding(false)} onImport={() => { setAdding(false); setImporting(true); }} onAdded={() => { setAdding(false); void load(); }} /> : null}
      </Dialog>
    </>
  );
}

export function SharedInstructions({ onDone }) {
  const [saved, setSaved] = useState(null);
  const [text, setText] = useState("");
  const toast = useToast();
  const confirm = useConfirm();
  const clear = async () => {
    if (!await confirm({ title: "Clear instructions?", body: "The instructions for every agent are removed. New chats use the change.", action: "Clear", danger: true })) return;
    call("instructions.save", { text: "" }).then(value => { setSaved(value.text); setText(value.text); toast("Instructions cleared."); }).catch(error => toast(error, "error"));
  };
  useEffect(() => { call("instructions.get").then(value => { setSaved(value.text); setText(value.text); }).catch(error => toast(error, "error")); }, []);
  return (
    <>
      <textarea className="tw-textarea tw-notes" value={text} maxLength={20000} disabled={saved === null} onChange={event => setText(event.target.value)} aria-label="Instructions for every agent" placeholder="For example: Answer in British English. Ask before sending email on my behalf." />
      <span className="tw-hint">Each agent's own instructions apply on top. New chats use the latest version.</span>
      <div className="tw-dialog-actions">
        {saved ? <button type="button" className="tw-btn" onClick={() => void clear()}>Clear</button> : null}
        <button type="button" className="tw-btn primary" disabled={saved === null || text === saved} onClick={() => call("instructions.save", { text }).then(value => { setSaved(value.text); setText(value.text); toast("Instructions saved."); onDone?.(); }).catch(error => toast(error, "error"))}>Save</button>
      </div>
    </>
  );
}
