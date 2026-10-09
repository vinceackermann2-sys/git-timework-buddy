import React, { useEffect, useState } from "react";
import { BookMarked, Download, FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { call } from "../api.js";
import { Dialog, PageHead, SearchField, Switch, useToast } from "./common.jsx";
import { Markdown } from "../markdown.jsx";

const SOURCES = { "codex-chatgpt": "ChatGPT / Codex", "claude-code": "Claude", cursor: "Cursor" };

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
      const { imported } = await call("knowledge.import", { items });
      const parts = [imported.skills ? `${imported.skills} skill${imported.skills === 1 ? "" : "s"}` : "", imported.memoryFiles ? `${imported.memoryFiles} memory file${imported.memoryFiles === 1 ? "" : "s"}` : ""].filter(Boolean);
      toast(parts.length ? "Imported " + parts.join(" and ") + "." : "Nothing new to import.");
      onImported?.();
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  if (!found) return <p className="tw-hint">Looking for other assistants on this computer…</p>;
  if (!found.items.length) return <p className="tw-hint">Nothing to import from {source ? SOURCES[source] : "ChatGPT / Codex, Claude or Cursor"} was found on this computer.</p>;
  return (
    <div className="tw-import">
      {found.items.map(item => (
        <fieldset key={item.id} className="tw-import-group">
          <legend>{source ? (item.category === "skills" ? "Skills" : "Memory files") : `${SOURCES[item.source] || item.source} · ${item.category === "skills" ? "skills" : "memory"}`}</legend>
          {item.names.slice(0, 200).map(name => (
            <label key={name} className="tw-check"><input type="checkbox" checked={!!selected[item.id]?.has(name)} onChange={() => toggle(item.id, name)} /><span>{name}</span></label>
          ))}
          {item.names.length > 200 ? <span className="tw-hint">…and {item.names.length - 200} more</span> : null}
        </fieldset>
      ))}
      {found.errors.length ? <div className="tw-alert">{found.errors.map(error => error.message || error).join(" ")}</div> : null}
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn" disabled={busy} onClick={detect}>Look again</button>
        <button type="button" className="tw-btn primary" disabled={busy} onClick={run}>{busy ? "Importing…" : "Import selected"}</button>
      </div>
    </div>
  );
}

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
      <PageHead title="Memories" subtitle="What your agents remember about you and the knowledge you imported.">
        <button type="button" className="tw-btn" onClick={() => setDialog("import")}><Download size={15} />Import</button>
      </PageHead>
      <SearchField value={query} onChange={setQuery} placeholder="Search memories..." shortcut />
      <div className="tw-memory-cards">
        {files.length || !query.trim() ? (
          <button type="button" className="tw-memory-card" onClick={() => setDialog("imports")}>
            <div><strong>Imports</strong><span>{memory ? memory.files.length : "…"}</span></div>
            <span>{memory?.files.length ? "Memory files imported from other assistants." : "Nothing imported yet."}</span>
          </button>
        ) : null}
        {noteMatch ? (
          <button type="button" className="tw-memory-card" onClick={() => setDialog("notes")}>
            <div><strong>User</strong></div>
            <span className="tw-clamp">{memory?.notes?.trim() ? memory.notes.trim() : "No long-term memory has been saved yet."}</span>
          </button>
        ) : null}
      </div>
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

export function Skills() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("yours");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(null);
  const [viewing, setViewing] = useState(null);
  const toast = useToast();
  const load = (reload = false) => call("skills.list", { reload }).then(setState).catch(error => toast(error, "error"));
  useEffect(() => { void load(); }, []);
  const setEnabled = (skill, enabled) => {
    setState(current => ({ ...current, skills: current.skills.map(item => item.path === skill.path ? { ...item, enabled } : item) }));
    call("skills.setEnabled", { path: skill.path, enabled }).catch(error => { toast(error, "error"); void load(); });
  };
  const view = skill => call("skills.read", { path: skill.path }).then(value => setViewing({ skill, text: value.text })).catch(error => toast(error, "error"));
  const all = state?.skills || [];
  const groups = { yours: all.filter(skill => skill.scope !== "system"), all, builtIn: all.filter(skill => skill.scope === "system") };
  const needle = query.trim().toLowerCase();
  const shown = (groups[tab] || all).filter(skill => !needle || skill.title.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle));
  return (
    <div className="tw-page">
      <PageHead title="Skills" subtitle="Skills teach agents how to do specific tasks. Agents use an enabled skill when a request calls for it.">
        <button type="button" className="tw-btn" onClick={() => setDialog("create")}><Plus size={15} />Create skill</button>
      </PageHead>
      <SearchField value={query} onChange={setQuery} placeholder="Search skills..." shortcut />
      <div className="tw-tabs-row">
        <div className="tw-tabs" role="group" aria-label="Skills">
          {[["yours", "Your skills"], ["all", "All"], ["builtIn", "Built in"]].map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label} <em>{groups[id].length}</em></button>)}
        </div>
        <span className="grow" />
        <button type="button" className="tw-icon-button" title="Import from other assistants" aria-label="Import from other assistants" onClick={() => setDialog("import")}><Download size={16} /></button>
        <button type="button" className="tw-icon-button" title="Open skills folder" aria-label="Open skills folder" onClick={() => call("skills.openFolder").catch(error => toast(error, "error"))}><FolderOpen size={16} /></button>
        <button type="button" className="tw-icon-button" title="Reload" aria-label="Reload skills" onClick={() => load(true)}><RefreshCw size={16} /></button>
      </div>
      {state?.errors.length ? <div className="tw-alert">{state.errors.join(" ")}</div> : null}
      {state === null ? <p className="tw-hint">Loading skills…</p> : shown.length ? (
        <div className="tw-grid">
          {shown.map(skill => (
            <div key={skill.path} className="tw-tile clickable" role="button" tabIndex={0} onClick={() => view(skill)} onKeyDown={event => { if (event.key === "Enter") view(skill); }}>
              <span className="tw-tile-icon"><BookMarked size={20} strokeWidth={1.6} /></span>
              <div><strong>{skill.title}</strong><span className="desc">{skill.description}</span></div>
              <span onClick={event => event.stopPropagation()}><Switch label={"Use " + skill.title} checked={skill.enabled} onChange={value => setEnabled(skill, value)} /></span>
            </div>
          ))}
        </div>
      ) : <div className="tw-empty-box">{needle ? "No skills match your search." : tab === "yours" ? "No skills yet. Create one, or import them from other assistants." : "No skills here."}</div>}
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing?.skill.title} description={viewing?.skill.description}>
        {viewing ? <div className="tw-skill-text"><Markdown text={viewing.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")} /></div> : null}
        {viewing?.skill.removable ? (
          <div className="tw-dialog-actions">
            <button type="button" className="tw-btn danger" onClick={() => { if (window.confirm(`Remove the ${viewing.skill.title} skill from Timewarp?`)) call("skills.remove", { name: viewing.skill.name }).then(() => { setViewing(null); void load(true); }).catch(error => toast(error, "error")); }}><Trash2 size={15} />Remove</button>
          </div>
        ) : null}
      </Dialog>
      <Dialog open={dialog === "create"} onClose={() => setDialog(null)} title="Create skill" description="Saved as a skill folder in this profile. Agents use it when a request matches.">
        {dialog === "create" ? <CreateSkill onCancel={() => setDialog(null)} onCreated={() => { setDialog(null); setTab("yours"); void load(true); }} /> : null}
      </Dialog>
      <Dialog open={dialog === "import"} onClose={() => setDialog(null)} title="Import skills" description="Timewarp copies what you select into this profile. The other apps' files aren't changed.">
        {dialog === "import" ? <ImportKnowledge category="skills" onImported={() => { setDialog(null); void load(true); }} /> : null}
      </Dialog>
    </div>
  );
}
