import React, { useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { call } from "../api.js";
import { Switch, useToast } from "./common.jsx";

const SOURCES = { "codex-chatgpt": "ChatGPT / Codex", "claude-code": "Claude", cursor: "Cursor" };

// Memory files and skills found from other assistants on this computer.
function ImportKnowledge({ category, onImported }) {
  const [found, setFound] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const detect = () => call("knowledge.detect").then(value => {
    const items = value.items.filter(item => item.category === category);
    setFound({ items, errors: value.errors || [] });
    setSelected(Object.fromEntries(items.map(item => [item.id, new Set(item.names)])));
  }).catch(error => toast(error, "error"));
  useEffect(() => { void detect(); }, [category]);
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
      toast(category === "skills" ? `Imported ${imported.skills} skill${imported.skills === 1 ? "" : "s"}.` : `Imported ${imported.memoryFiles} file${imported.memoryFiles === 1 ? "" : "s"}.`);
      onImported?.();
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  if (!found) return <p className="tw-hint">Looking for other assistants on this computer…</p>;
  if (!found.items.length) return <p className="tw-hint">No {category === "skills" ? "skills" : "memory files"} from ChatGPT / Codex, Claude or Cursor were found on this computer.</p>;
  return (
    <div className="tw-import">
      {found.items.map(item => (
        <fieldset key={item.id} className="tw-import-group">
          <legend>{SOURCES[item.source] || item.source}</legend>
          {item.names.slice(0, 200).map(name => (
            <label key={name} className="tw-check"><input type="checkbox" checked={!!selected[item.id]?.has(name)} onChange={() => toggle(item.id, name)} /><span>{name}</span></label>
          ))}
          {item.names.length > 200 ? <span className="tw-hint">…and {item.names.length - 200} more</span> : null}
        </fieldset>
      ))}
      {found.errors.length ? <div className="tw-alert">{found.errors.map(error => error.message || error).join(" ")}</div> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="tw-btn primary" disabled={busy} onClick={run}>{busy ? "Importing…" : "Import selected"}</button>
        <button type="button" className="tw-btn" disabled={busy} onClick={detect}>Look again</button>
      </div>
      <span className="tw-hint">Timewarp copies what you select into this profile. The other apps' files aren't changed.</span>
    </div>
  );
}

export function Memory({ settings, onSetting }) {
  const [memory, setMemory] = useState(null);
  const [notes, setNotes] = useState("");
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const load = () => call("memory.get").then(value => { setMemory(value); setNotes(value.notes); }).catch(error => toast(error, "error"));
  useEffect(() => { void load(); }, []);
  const enabled = settings.memory?.mode !== "disabled";
  return (
    <section>
      <h2>Memory</h2>
      <div className="tw-card">
        <div className="tw-setting">
          <div><strong>Memory</strong><span className="tw-hint">Agents read these notes and add lasting preferences you share. Memory stays on this device.</span></div>
          <Switch label="Memory" checked={enabled} onChange={value => onSetting("memory", { ...settings.memory, mode: value ? "enabled" : "disabled" })} />
        </div>
      </div>
      <div className="tw-card">
        <h3>What your agents know about you</h3>
        <textarea className="tw-input tw-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={100000} disabled={!memory} aria-label="Memory notes" placeholder="Preferences, context about your work, how you like replies…" />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="tw-btn primary" disabled={!memory || notes === memory.notes} onClick={() => call("memory.save", { notes }).then(value => { setMemory(current => ({ ...current, notes: value.notes })); setNotes(value.notes); toast("Memory saved."); }).catch(error => toast(error, "error"))}>Save</button>
          <button type="button" className="tw-btn" onClick={() => call("memory.openFolder").catch(error => toast(error, "error"))}><FolderOpen size={14} /> Open folder</button>
        </div>
        <span className="tw-hint">New chats use the latest notes.</span>
      </div>
      <div className="tw-card">
        <h3>Imported knowledge</h3>
        {memory?.files.length ? (
          <div className="tw-rows">
            {memory.files.map(file => (
              <div key={file.path} className="tw-rows-item">
                <div style={{ flex: 1, minWidth: 0 }}><strong className="tw-ellipsis">{file.path.split("/").slice(1).join("/")}</strong><span className="tw-hint">{SOURCES[file.source] || file.source}</span></div>
                <button type="button" className="tw-btn" onClick={() => call("memory.removeImport", { path: file.path }).then(value => setMemory(current => ({ ...current, files: value.files }))).catch(error => toast(error, "error"))}>Remove</button>
              </div>
            ))}
          </div>
        ) : <span className="tw-hint">Nothing imported yet.</span>}
        {importing ? <ImportKnowledge category="memory" onImported={() => { setImporting(false); void load(); }} /> : <div><button type="button" className="tw-btn" onClick={() => setImporting(true)}>Import from other assistants</button></div>}
      </div>
    </section>
  );
}

export function Skills() {
  const [state, setState] = useState(null);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const load = (reload = false) => call("skills.list", { reload }).then(setState).catch(error => toast(error, "error"));
  useEffect(() => { void load(); }, []);
  const setEnabled = (skill, enabled) => {
    setState(current => ({ ...current, skills: current.skills.map(item => item.path === skill.path ? { ...item, enabled } : item) }));
    call("skills.setEnabled", { path: skill.path, enabled }).catch(error => { toast(error, "error"); void load(); });
  };
  const own = state?.skills.filter(skill => skill.scope !== "system") || [];
  const builtIn = state?.skills.filter(skill => skill.scope === "system") || [];
  const row = skill => (
    <div key={skill.path} className="tw-rows-item">
      <div style={{ flex: 1, minWidth: 0 }}><strong>{skill.title}</strong><span className="tw-hint tw-clamp">{skill.description}</span></div>
      {skill.removable ? <button type="button" className="tw-btn" onClick={() => { if (window.confirm(`Remove the ${skill.title} skill from Timewarp?`)) call("skills.remove", { name: skill.name }).then(() => load(true)).catch(error => toast(error, "error")); }}>Remove</button> : null}
      <Switch label={"Use " + skill.title} checked={skill.enabled} onChange={value => setEnabled(skill, value)} />
    </div>
  );
  return (
    <section>
      <h2>Skills</h2>
      <p className="tw-hint" style={{ margin: 0 }}>Skills teach agents how to do specific tasks. Agents use an enabled skill when a request calls for it.</p>
      {state?.errors.length ? <div className="tw-alert">{state.errors.join(" ")}</div> : null}
      <div className="tw-card">
        <h3>Your skills</h3>
        {state === null ? <span className="tw-hint">Loading skills…</span> : own.length ? <div className="tw-rows">{own.map(row)}</div> : <span className="tw-hint">No skills yet. Import them from other assistants or add skill folders.</span>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {importing ? null : <button type="button" className="tw-btn" onClick={() => setImporting(true)}>Import from other assistants</button>}
          <button type="button" className="tw-btn" onClick={() => call("skills.openFolder").catch(error => toast(error, "error"))}><FolderOpen size={14} /> Open skills folder</button>
          <button type="button" className="tw-btn" onClick={() => load(true)}><RefreshCw size={14} /> Reload</button>
        </div>
        {importing ? <ImportKnowledge category="skills" onImported={() => { setImporting(false); void load(true); }} /> : null}
      </div>
      {builtIn.length ? <div className="tw-card"><h3>Built in</h3><div className="tw-rows">{builtIn.map(row)}</div></div> : null}
    </section>
  );
}
