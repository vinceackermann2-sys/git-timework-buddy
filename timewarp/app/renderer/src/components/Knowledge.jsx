import React, { useEffect, useState } from "react";
import { BookMarked, Download, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { call } from "../api.js";
import { Dialog, PageHead, SearchField, Switch, useToast } from "./common.jsx";
import { Markdown } from "../markdown.jsx";

const SOURCES = { "codex-chatgpt": "ChatGPT / Codex", "claude-code": "Claude", cursor: "Cursor" };
const KINDS = { skills: "Skills", memory: "Memory files", mcp: "MCP servers" };

// Memory files and skills found from other assistants on this computer,
// optionally from one source or of one kind.
export function ImportKnowledge({ category, source, onImported }) {
  const [found, setFound] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const detect = () => call("knowledge.detect").then(value => {
    const items = value.items.filter(item => (!category || item.category === category) && (!source || item.source === source));
    setFound({ items, errors: value.errors || [] });
    setSelected(Object.fromEntries(items.map(item => [item.id, new Set(item.names)])));
  }).catch(error => toast(error, "error"));
  useEffect(() => { void detect(); }, [category, source]);
  const toggle = (id, name) => setSelected(current => {
    const names = new Set(current[id]);
    if (names.has(name)) names.delete(name); else names.add(name);
    return { ...current, [id]: names };
  });
  async function run() {
    const items = Object.entries(selected).filter(([, names]) => names.size).map(([id, names]) => ({ id, names: [...names] }));
    if (!items.length) { toast("Select something to import.", "error"); return; }
    setBusy(true);
    try {
      const { imported, skipped = [] } = await call("knowledge.import", { items });
      const count = (value, word) => value ? `${value} ${word}${value === 1 ? "" : "s"}` : "";
      const parts = [count(imported.skills, "skill"), count(imported.memoryFiles, "memory file"), count(imported.mcpServers, "MCP server")].filter(Boolean);
      toast((parts.length ? "Imported " + parts.join(", ") + "." : "Nothing new to import.") + (skipped.length ? " Skipped " + skipped.join("; ") + "." : ""));
      onImported?.();
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  // Cursor keeps rules in each project; the user can point at one.
  const chooseCursor = () => call("knowledge.chooseCursorFolder").then(value => { if (!value.cancelled) void detect(); }).catch(error => toast(error, "error"));
  const cursorButton = !source || source === "cursor" ? <button type="button" className="tw-btn" onClick={chooseCursor}>Choose a Cursor folder…</button> : null;
  if (!found) return <p className="tw-hint">Looking for other assistants on this computer…</p>;
  if (!found.items.length) return (
    <div className="tw-import">
      <p className="tw-hint">{category === "mcp" ? "No MCP servers were found" : "Nothing to import was found"} in {source ? SOURCES[source] : "ChatGPT / Codex, Claude or Cursor"} on this computer.{cursorButton ? " Cursor keeps rules and servers in each project; choose a project or its .cursor folder to look there." : ""}</p>
      {cursorButton ? <div className="tw-dialog-actions">{cursorButton}</div> : null}
    </div>
  );
  return (
    <div className="tw-import">
      {found.items.map(item => (
        <fieldset key={item.id} className="tw-import-group">
          <legend>{source ? KINDS[item.category] || item.category : `${SOURCES[item.source] || item.source} · ${(KINDS[item.category] || item.category).toLowerCase()}`}</legend>
          {item.names.slice(0, 200).map(name => (
            <label key={name} className="tw-check"><input type="checkbox" checked={!!selected[item.id]?.has(name)} onChange={() => toggle(item.id, name)} /><span>{name}</span></label>
          ))}
          {item.names.length > 200 ? <span className="tw-hint">…and {item.names.length - 200} more</span> : null}
        </fieldset>
      ))}
      {found.errors.length ? <div className="tw-alert">{found.errors.map(error => error.message || error).join(" ")}</div> : null}
      {found.items.some(item => item.category === "mcp") ? <span className="tw-hint">MCP servers keep their commands and settings, including environment values, and become available to every agent. Only import servers you trust.</span> : null}
      <div className="tw-dialog-actions">
        {cursorButton}
        <span className="grow" />
        <button type="button" className="tw-btn" disabled={busy} onClick={detect}>Look again</button>
        <button type="button" className="tw-btn primary" disabled={busy} onClick={run}>{busy ? "Importing…" : "Import selected"}</button>
      </div>
    </div>
  );
}

// Notes as plain text, without markdown headings or comments.
const notesPreview = notes => String(notes || "").replace(/<!--[\s\S]*?-->/g, " ").replace(/^#+\s.*$/gm, " ").replace(/[*_`>]+/g, "").replace(/\s+/g, " ").trim();

export function Memories() {
  const [memory, setMemory] = useState(null);
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(null);
  const toast = useToast();
  const load = () => call("memory.get").then(value => { setMemory(value); setNotes(value.notes); }).catch(error => toast(error, "error"));
  useEffect(() => { void load(); }, []);
  const files = (memory?.files || []).filter(file => !query.trim() || file.path.toLowerCase().includes(query.trim().toLowerCase()));
  const noteMatch = !query.trim() || (memory?.notes || "").toLowerCase().includes(query.trim().toLowerCase()) || "user".includes(query.trim().toLowerCase());
  return (
    <div className="tw-page">
      <PageHead title="Memories" />
      <SearchField value={query} onChange={setQuery} placeholder="Search memories" shortcut />
      {memory && !memory.files.length && !memory.notes?.trim() || (!files.length && !noteMatch) ? <div className="tw-empty-box dashed">No memories found.</div> : (
      <div className="tw-memory-cards">
        {files.length ? (
          <button type="button" className="tw-memory-card" onClick={() => setDialog("imports")}>
            <div><strong>Imports</strong><span>{memory ? memory.files.length : "…"}</span></div>
            <span>{memory?.files.length ? "Memory files imported from other assistants." : "Nothing imported yet."}</span>
          </button>
        ) : null}
        {noteMatch ? (
          <button type="button" className="tw-memory-card" onClick={() => setDialog("notes")}>
            <div><strong>User</strong></div>
            <span className="tw-clamp">{notesPreview(memory?.notes) || "No long-term memory has been saved yet."}</span>
          </button>
        ) : null}
      </div>
      )}
      <Dialog open={dialog === "notes"} onClose={() => { setDialog(null); setNotes(memory?.notes || ""); }} title="User" description="Agents read these notes and add lasting preferences you share. Memory stays on this device.">
        <textarea className="tw-textarea tw-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={100000} disabled={!memory} aria-label="Memory notes" placeholder="Preferences, context about your work, how you like replies…" />
        <div className="tw-dialog-actions">
          <button type="button" className="tw-btn" onClick={() => call("memory.openFolder").catch(error => toast(error, "error"))}><FolderOpen size={15} />Open folder</button>
          <span className="grow" />
          <button type="button" className="tw-btn primary" disabled={!memory || notes === memory.notes} onClick={() => call("memory.save", { notes }).then(value => { setMemory(current => ({ ...current, notes: value.notes })); setNotes(value.notes); toast("Memory saved."); setDialog(null); }).catch(error => toast(error, "error"))}>Save</button>
        </div>
      </Dialog>
      <Dialog open={dialog === "imports"} onClose={() => setDialog(null)} title="Imports" description="Agents read these files when they would help.">
        {memory?.files.length ? (
          <div className="tw-list-panel tw-scroll-list">
            {memory.files.map(file => (
              <div key={file.path} className="tw-list-row compact">
                <div className="grow"><strong>{file.path.split("/").slice(1).join("/")}</strong><span className="desc">{SOURCES[file.source] || file.source}</span></div>
                <button type="button" className="tw-icon-button" title="Remove" aria-label={"Remove " + file.path} onClick={() => call("memory.removeImport", { path: file.path }).then(value => setMemory(current => ({ ...current, files: value.files }))).catch(error => toast(error, "error"))}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        ) : <p className="tw-hint">Nothing imported yet.</p>}
        <div className="tw-dialog-actions"><button type="button" className="tw-btn" onClick={() => setDialog("import")}><Download size={15} />Import from other assistants</button></div>
      </Dialog>
      <Dialog open={dialog === "import"} onClose={() => setDialog(null)} title="Import memory" description="Timewarp copies what you select into this profile. The other apps' files aren't changed.">
        {dialog === "import" ? <ImportKnowledge category="memory" onImported={() => { setDialog(null); void load(); }} /> : null}
      </Dialog>
    </div>
  );
}

function CreateSkill({ onCreated, onCancel }) {
  const [draft, setDraft] = useState({ name: "", description: "", instructions: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  return (
    <form className="tw-import" onSubmit={event => {
      event.preventDefault();
      setBusy(true);
      call("skills.create", draft).then(() => { toast("Skill created."); onCreated(); }).catch(error => toast(error, "error")).finally(() => setBusy(false));
    }}>
      <label className="tw-field"><span>Name</span><input className="tw-input" required maxLength={64} value={draft.name} placeholder="weekly-report" onChange={event => set({ name: event.target.value })} /></label>
      <label className="tw-field"><span>When to use it</span><input className="tw-input" required maxLength={300} value={draft.description} placeholder="Writing the weekly status report for the team" onChange={event => set({ description: event.target.value })} /></label>
      <label className="tw-field"><span>Instructions</span><textarea className="tw-textarea" required value={draft.instructions} placeholder="Steps, tone, templates and anything the agent should know." onChange={event => set({ instructions: event.target.value })} /></label>
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="tw-btn primary" disabled={busy}>{busy ? "Creating…" : "Create skill"}</button>
      </div>
    </form>
  );
}

// Tabs as in the previous app; Codex scopes: user, repo (workspace), admin and system.
const SKILL_TABS = [
  ["yours", "Your skills", skill => skill.scope === "user" && !skill.fromApp],
  ["all", "All", () => true],
  ["apps", "From Apps", skill => skill.fromApp],
  ["workspace", "Workspace", skill => skill.scope === "repo"],
  ["managed", "Managed", skill => skill.scope === "admin" || skill.scope === "system"],
];

function SkillDialog({ viewing, onClose, onEnabled, onRemoved }) {
  const skill = viewing?.skill;
  return (
    <Dialog open={!!viewing} onClose={onClose} label={skill?.title} className="tw-skill-dialog">
      {skill ? (
        <>
          <div className="tw-skill-head">
            <span className="tw-tile-icon"><BookMarked size={20} strokeWidth={1.6} /></span>
            <div><h2>{skill.title}</h2>{skill.description ? <p>{skill.description}</p> : null}</div>
            <button type="button" className="tw-icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="tw-skill-scroll">
            <dl className="tw-skill-facts">
              <dt>Name</dt><dd>{skill.name}</dd>
              {skill.details ? <><dt>Description</dt><dd><Markdown text={skill.details} /></dd></> : null}
            </dl>
            {viewing.text === null ? <p className="tw-hint">Loading skill details...</p> : <div className="tw-skill-text"><Markdown text={viewing.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")} /></div>}
          </div>
          <div className="tw-dialog-actions">
            <label className="tw-check"><Switch label={"Use " + skill.title} checked={skill.enabled} onChange={value => onEnabled(skill, value)} /><span>Use this skill</span></label>
            <span className="grow" />
            {skill.removable ? <button type="button" className="tw-btn danger" onClick={() => onRemoved(skill)}><Trash2 size={15} />Remove</button> : null}
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

export function Skills() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("yours");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const toast = useToast();
  const load = (reload = false) => call("skills.list", { reload }).then(setState).catch(error => toast(error, "error"));
  useEffect(() => { void load(); }, []);
  const setEnabled = (skill, enabled) => {
    setState(current => ({ ...current, skills: current.skills.map(item => item.path === skill.path ? { ...item, enabled } : item) }));
    setViewing(current => current && current.skill.path === skill.path ? { ...current, skill: { ...current.skill, enabled } } : current);
    call("skills.setEnabled", { path: skill.path, enabled }).catch(error => { toast(error, "error"); void load(); });
  };
  const view = skill => {
    setViewing({ skill, text: null });
    call("skills.read", { path: skill.path }).then(value => setViewing(current => current?.skill.path === skill.path ? { skill, text: value.text } : current)).catch(error => { setViewing(null); toast(error, "error"); });
  };
  const remove = skill => {
    if (!window.confirm(`Remove the ${skill.title} skill from Timewarp?`)) return;
    call("skills.remove", { name: skill.name }).then(() => { setViewing(null); void load(true); }).catch(error => toast(error, "error"));
  };
  const all = state?.skills || [];
  const filter = (SKILL_TABS.find(item => item[0] === tab) || SKILL_TABS[1])[2];
  const needle = query.trim().toLowerCase();
  const shown = all.filter(filter).filter(skill => !needle || skill.title.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle));
  return (
    <div className="tw-page">
      <PageHead title="Skills" subtitle="Reusable instructions and workflows for your tasks.">
        <button type="button" className="tw-btn accent" onClick={() => setCreating(true)}><Plus size={16} />Create skill</button>
      </PageHead>
      <SearchField value={query} onChange={setQuery} placeholder="Search skills..." shortcut />
      <div className="tw-tabs" role="group" aria-label="Skills">
        {SKILL_TABS.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {state?.errors.length ? <div className="tw-alert">{state.errors.join(" ")}</div> : null}
      {state === null ? <p className="tw-loading">Loading skills...</p> : shown.length ? (
        <div className="tw-grid tw-scroll-grid">
          {shown.map(skill => (
            <div key={skill.path} className={"tw-tile clickable" + (skill.enabled ? "" : " off")} role="button" tabIndex={0} onClick={() => view(skill)} onKeyDown={event => { if (event.key === "Enter") view(skill); }}>
              <span className="tw-tile-icon"><BookMarked size={20} strokeWidth={1.6} /></span>
              <div><strong>{skill.title}</strong><span className="desc">{skill.description}</span></div>
            </div>
          ))}
        </div>
      ) : <p className="tw-loading">{needle || all.length ? "No skills match your filters." : "No skills yet."}</p>}
      <SkillDialog viewing={viewing} onClose={() => setViewing(null)} onEnabled={setEnabled} onRemoved={remove} />
      <Dialog open={creating} onClose={() => setCreating(false)} title="Create skill" description="Saved as a skill folder in this profile. Agents use it when a request matches.">
        {creating ? <CreateSkill onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); setTab("yours"); void load(true); }} /> : null}
      </Dialog>
    </div>
  );
}
