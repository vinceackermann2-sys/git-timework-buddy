import React, { useEffect, useState } from "react";
import { call, useEvent } from "../api.js";
import { Segmented, Switch, useToast } from "./common.jsx";

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

function AddServer({ onAdded, onCancel }) {
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
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="tw-btn primary" disabled={busy}>{busy ? "Adding…" : "Add server"}</button>
        <button type="button" className="tw-btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function McpServers() {
  const [servers, setServers] = useState(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const load = () => call("mcp.list").then(setServers).catch(error => { setServers([]); toast(error, "error"); });
  useEffect(() => { void load(); }, []);
  useEvent("mcp.changed", event => { if (event?.success === false) toast(event.error || "Sign-in didn't finish.", "error"); void load(); });
  const run = (method, input) => call(method, input).then(value => { if (Array.isArray(value)) setServers(value); }).catch(error => toast(error, "error"));
  return (
    <div className="tw-card">
      <h3>MCP servers</h3>
      <span className="tw-hint">Add Model Context Protocol servers to give every agent more tools. New chats pick up changes.</span>
      {servers === null ? <span className="tw-hint">Loading servers…</span> : servers.length ? (
        <div className="tw-rows">
          {servers.map(server => (
            <div key={server.name} className="tw-rows-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{server.name}</strong>
                <span className="tw-hint tw-ellipsis">{server.transport === "http" ? server.url : [server.command, ...server.args].join(" ")}</span>
                <span className="tw-hint">{server.error ? server.error : server.tools !== null ? `${server.tools} tool${server.tools === 1 ? "" : "s"}` : ""}{AUTH[server.authStatus] ? (server.error || server.tools !== null ? " · " : "") + AUTH[server.authStatus] : ""}</span>
              </div>
              {server.authStatus === "notLoggedIn" ? <button type="button" className="tw-btn" onClick={() => run("mcp.signIn", { name: server.name }).then(() => toast("Finish signing in in your browser."))}>Sign in</button> : null}
              <button type="button" className="tw-btn danger" onClick={() => { if (window.confirm(`Remove the ${server.name} server?`)) void run("mcp.remove", { name: server.name }); }}>Remove</button>
              <Switch label={"Use " + server.name} checked={server.enabled} onChange={value => void run("mcp.setEnabled", { name: server.name, enabled: value })} />
            </div>
          ))}
        </div>
      ) : null}
      {adding ? <AddServer onCancel={() => setAdding(false)} onAdded={value => { setServers(value); setAdding(false); }} /> : <div><button type="button" className="tw-btn" onClick={() => setAdding(true)}>Add server</button></div>}
    </div>
  );
}

export function SharedInstructions() {
  const [saved, setSaved] = useState(null);
  const [text, setText] = useState("");
  const toast = useToast();
  useEffect(() => { call("instructions.get").then(value => { setSaved(value.text); setText(value.text); }).catch(error => toast(error, "error")); }, []);
  return (
    <div className="tw-card">
      <h3>Instructions for every agent</h3>
      <textarea className="tw-input tw-notes" style={{ minHeight: 120 }} value={text} maxLength={20000} disabled={saved === null} onChange={event => setText(event.target.value)} aria-label="Instructions for every agent" placeholder="For example: Answer in British English. Ask before sending email on my behalf." />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="tw-btn primary" disabled={saved === null || text === saved} onClick={() => call("instructions.save", { text }).then(value => { setSaved(value.text); setText(value.text); toast("Instructions saved."); }).catch(error => toast(error, "error"))}>Save</button>
        {saved ? <button type="button" className="tw-btn" onClick={() => { if (window.confirm("Clear the instructions for every agent?")) call("instructions.save", { text: "" }).then(value => { setSaved(value.text); setText(value.text); toast("Instructions cleared."); }).catch(error => toast(error, "error")); }}>Clear</button> : null}
        <span className="tw-hint">Each agent's own instructions apply on top. New chats use the latest version.</span>
      </div>
    </div>
  );
}
