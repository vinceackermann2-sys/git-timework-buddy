import React, { useEffect, useState } from "react";
import { BookMarked, Copy, Download, ExternalLink, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { call, errorText } from "../api.js";
import { Dialog, PageHead, SearchField, Switch, useConfirm, useToast } from "./common.jsx";
import { Markdown } from "../markdown.jsx";

// Where imported memory came from; "timewarp-previous" is the previous Timewarp app's (knowledge.cjs).
const SOURCES = { "codex-chatgpt": "ChatGPT / Codex", "claude-code": "Claude", cursor: "Cursor", "timewarp-previous": "Previous Timewarp app" };
const KINDS = { skills: "Skills", memory: "Memory files", mcp: "MCP servers" };
const ASSISTANTS = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", copilot: "Copilot", cursor: "Cursor", other: "Other" };
// The local setups whose assistant can also be asked with a prompt, when nothing of theirs is here.
const ONLINE = [{ source: "codex-chatgpt", id: "chatgpt", label: "ChatGPT", site: "chatgpt.com" }, { source: "claude-code", id: "claude", label: "Claude", site: "claude.ai" }, { source: "cursor", id: "cursor", label: "Cursor", site: "Cursor's chat" }];
const count = (value, word) => `${value} ${word}${value === 1 ? "" : "s"}`;

// What an online assistant (ChatGPT, Claude, Gemini…) knows about the user:
// they send it Timewarp's prompt and paste the reply here. Memory goes into
// the notes, projects become agents and scheduled tasks automations, turned
// off (assistant-import.cjs).
export function AssistantImport({ source: initial = "chatgpt", onImported }) {
  const [source, setSource] = useState(initial);
  const [prompt, setPrompt] = useState(null);
  const [reply, setReply] = useState("");
  const [found, setFound] = useState(null); // { text, preview } or { text, error }
  const [picked, setPicked] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { call("assistantImport.prompt").then(setPrompt).catch(error => toast(error, "error")); }, []);
  // What the pasted reply holds, read again a moment after it changes.
  useEffect(() => {
    if (!reply.trim()) { setFound(null); return; }
    let current = true;
    const timer = setTimeout(() => call("assistantImport.preview", { text: reply }).then(preview => {
      if (!current) return;
      setFound({ text: reply, preview });
      setPicked({ memory: true, projects: new Set(preview.projects.filter(item => !item.exists).map(item => item.index)), tasks: new Set(preview.tasks.filter(item => !item.exists).map(item => item.index)) });
    }).catch(error => { if (current) setFound({ text: reply, error: errorText(error) }); }), 300);
    return () => { current = false; clearTimeout(timer); };
  }, [reply]);
  const name = ASSISTANTS[source], site = prompt?.sources.find(item => item.id === source)?.url;
  const preview = found?.text === reply ? found.preview : null;
  const copy = () => navigator.clipboard.writeText(prompt.text).then(() => setCopied(true));
  const open = () => copy().then(() => call("links.open", { url: site })).catch(error => toast(error, "error"));
  const toggle = (kind, index) => setPicked(current => {
    const next = new Set(current[kind]);
    if (next.has(index)) next.delete(index); else next.add(index);
    return { ...current, [kind]: next };
  });
  async function run() {
    const memory = !!(picked.memory && (preview.memory || preview.instructions)), projects = [...picked.projects], tasks = [...picked.tasks];
    if (!memory && !projects.length && !tasks.length) { toast("Choose something to bring.", "error"); return; }
    setBusy(true);
    try {
      const result = await call("assistantImport.apply", { source, text: reply, memory, projects, tasks });
      const parts = [result.notes ? "memory" : "", result.agents.length ? count(result.agents.length, "agent") : "", result.automations.length ? count(result.automations.length, "automation") : ""].filter(Boolean);
      toast((parts.length ? `Brought in ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}${source === "other" ? "" : " from " + name}.` : "Nothing new to bring.")
        + (result.automations.length ? " Automations are off until you turn them on." : "") + (result.skipped.length ? ` Already in Timewarp: ${result.skipped.join(", ")}.` : ""));
      if (result.agents.length) window.dispatchEvent(new CustomEvent("tw:agents-changed"));
      onImported?.(result);
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  const options = preview ? [
    ...(preview.memory || preview.instructions ? [{ key: "memory", label: "Memory", detail: [preview.memory ? count(preview.memory.items, "item") : "", preview.instructions ? "how you like replies" : ""].filter(Boolean).join(", "), checked: picked.memory, toggle: () => setPicked(current => ({ ...current, memory: !current.memory })) }] : []),
    ...preview.projects.filter(item => !item.exists).map(item => ({ key: "p" + item.index, label: "Agent: " + item.name, detail: "from a project", checked: picked.projects.has(item.index), toggle: () => toggle("projects", item.index) })),
    ...preview.tasks.filter(item => !item.exists).map(item => ({ key: "t" + item.index, label: "Automation: " + item.name, detail: item.schedule + (item.unclear ? " · check the time" : ""), checked: picked.tasks.has(item.index), toggle: () => toggle("tasks", item.index) })),
  ] : [];
  const taken = preview ? [...preview.projects, ...preview.tasks].filter(item => item.exists).map(item => item.name) : [];
  return (
    <div className="tw-import tw-assistant-import">
      <div className="tw-segmented" role="group" aria-label="Assistant">
        {Object.entries(ASSISTANTS).map(([id, label]) => <button key={id} type="button" aria-pressed={source === id} onClick={() => setSource(id)}>{label}</button>)}
      </div>
      <section>
        <strong>1. Ask {source === "other" ? "your assistant" : name} what it knows about you</strong>
        <p className="tw-hint">The prompt asks for your memory, instructions, projects and scheduled tasks, written so Timewarp can read them.</p>
        <div className="tw-assistant-actions">
          <button type="button" className="tw-btn" disabled={!prompt} onClick={() => copy().catch(error => toast(error, "error"))}><Copy size={15} />{copied ? "Copied" : "Copy prompt"}</button>
          {site ? <button type="button" className="tw-btn" disabled={!prompt} onClick={open}><ExternalLink size={15} />Open {name}</button> : null}
          {copied ? <span className="tw-hint">Send it in a new chat, then paste the reply below.</span> : null}
        </div>
        <details className="tw-assistant-prompt"><summary>See the prompt</summary><pre>{prompt?.text || "Loading…"}</pre></details>
      </section>
      <section>
        <strong>2. Paste its reply</strong>
        <textarea className="tw-textarea tw-assistant-reply" value={reply} onChange={event => setReply(event.target.value)} spellCheck={false} aria-label="The assistant's reply" placeholder={source === "other" ? "Paste the reply here" : `Paste ${name}'s reply here`} />
      </section>
      {found?.error && found.text === reply ? <div className="tw-alert">{found.error}</div> : null}
      {preview ? (
        <fieldset className="tw-import-group">
          <legend>3. Choose what to bring</legend>
          {options.map(option => <label key={option.key} className="tw-check"><input type="checkbox" checked={option.checked} onChange={option.toggle} /><span>{option.label}{option.detail ? <em> · {option.detail}</em> : null}</span></label>)}
          {!options.length ? <span className="tw-hint">{taken.length ? "Everything in this reply is already in Timewarp." : "Nothing to bring was found. Paste the whole code block from the reply."}</span> : null}
          {taken.length && options.length ? <span className="tw-hint">Already in Timewarp: {taken.join(", ")}.</span> : null}
        </fieldset>
      ) : null}
      {preview?.tasks.some(item => !item.exists) ? <span className="tw-hint">Automations arrive turned off so nothing runs twice. Turn them on in Automations when you're ready.</span> : null}
      <div className="tw-dialog-actions">
        <span className="grow" />
        <button type="button" className="tw-btn primary" disabled={busy || !preview || !options.length} onClick={run}>{busy ? "Importing…" : "Import"}</button>
      </div>
    </div>
  );
}

// Memory files and skills found from other assistants on this computer,
// optionally from one source or of one kind.
export function ImportKnowledge({ category, source, onImported }) {
  const [found, setFound] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);
  const [assistant, setAssistant] = useState(null);
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
      const parts = [imported.skills ? count(imported.skills, "skill") : "", imported.memoryFiles ? count(imported.memoryFiles, "memory file") : "", imported.mcpServers ? count(imported.mcpServers, "MCP server") : ""].filter(Boolean);
      toast((parts.length ? "Imported " + parts.join(", ") + "." : "Nothing new to import.") + (skipped.length ? " Skipped " + skipped.join("; ") + "." : ""));
      onImported?.();
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  // Cursor keeps rules in each project; the user can point at one.
  const chooseCursor = () => call("knowledge.chooseCursorFolder").then(value => { if (!value.cancelled) void detect(); }).catch(error => toast(error, "error"));
  const cursorButton = !source || source === "cursor" ? <button type="button" className="tw-btn" onClick={chooseCursor}>Choose a Cursor folder…</button> : null;
  if (!found) return <p className="tw-hint">Looking for other assistants on this computer…</p>;
  // Memory can also come from an assistant that keeps it online, through a
  // prompt; that's where this opens when nothing is on this computer. With
  // some found, each assistant without anything here offers its prompt.
  const shown = category === "mcp" ? "local" : mode || (found.items.length ? "local" : "online");
  const missing = category === "mcp" ? [] : ONLINE.filter(item => (!source || source === item.source) && !found.items.some(entry => entry.source === item.source));
  const bring = id => { setAssistant(id); setMode("online"); };
  const modes = category === "mcp" ? null : (
    <div className="tw-segmented" role="group" aria-label="Import from">
      <button type="button" aria-pressed={shown === "local"} onClick={() => setMode("local")}>On this computer</button>
      <button type="button" aria-pressed={shown === "online"} onClick={() => setMode("online")}>ChatGPT, Claude and others</button>
    </div>
  );
  if (shown === "online") return (
    <div className="tw-import">
      {modes}
      {!found.items.length ? <p className="tw-hint">Nothing was found on this computer. ChatGPT, Claude and Gemini keep what they know about you online: ask yours with Timewarp's prompt and paste the reply.</p> : null}
      <AssistantImport key={assistant || ""} source={assistant || ({ "claude-code": "claude", cursor: "cursor" }[source] || "chatgpt")} onImported={onImported} />
    </div>
  );
  if (!found.items.length) return (
    <div className="tw-import">
      {modes}
      <p className="tw-hint">{category === "mcp" ? "No MCP servers were found" : "Nothing to import was found"} in {source ? SOURCES[source] : "ChatGPT / Codex, Claude or Cursor"} on this computer.{cursorButton ? " Cursor keeps rules and servers in each project; choose a project or its .cursor folder to look there." : ""}</p>
      {cursorButton ? <div className="tw-dialog-actions">{cursorButton}</div> : null}
    </div>
  );
  return (
    <div className="tw-import">
      {modes}
      {found.items.map(item => (
        <fieldset key={item.id} className="tw-import-group">
          <legend>{source ? KINDS[item.category] || item.category : `${SOURCES[item.source] || item.source} · ${(KINDS[item.category] || item.category).toLowerCase()}`}</legend>
          {item.names.slice(0, 200).map(name => (
            <label key={name} className="tw-check"><input type="checkbox" checked={!!selected[item.id]?.has(name)} onChange={() => toggle(item.id, name)} /><span>{name}</span></label>
          ))}
          {item.names.length > 200 ? <span className="tw-hint">…and {item.names.length - 200} more</span> : null}
        </fieldset>
      ))}
      {missing.map(item => (
        <p key={item.id} className="tw-hint">Nothing from {item.label} on this computer. <button type="button" className="tw-link" onClick={() => bring(item.id)}>Bring it from {item.site} with a prompt</button></p>
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
      <PageHead title="Memories"><button type="button" className="tw-btn" onClick={() => setDialog("import")}><Download size={15} />Import</button></PageHead>
      <div className="tw-memory-search"><SearchField value={query} onChange={setQuery} placeholder="Search memories" shortcut /></div>
      {memory && !memory.files.length && !memory.notes?.trim() || (!files.length && !noteMatch) ? <div className="tw-empty-box dashed">No memories found.</div> : (
      <div className="tw-memory-cards">
        {files.length ? (
          <button type="button" className="tw-memory-card folder" onClick={() => setDialog("imports")}>
            <div><strong>Imports</strong><span>{memory ? memory.files.length : "…"}</span></div>
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
  // As before: All is every skill except those from apps; Codex's own system skills aren't listed.
  ["all", "All", skill => skill.scope !== "system" && !skill.fromApp],
  ["apps", "From Apps", skill => skill.fromApp],
  ["workspace", "Workspace", skill => skill.scope === "repo"],
  ["managed", "Managed", skill => skill.scope === "admin"],
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
  const [error, setError] = useState("");
  const toast = useToast();
  const confirm = useConfirm();
  // A list that couldn't load shows why, with Retry; a reload that fails keeps the list.
  const load = (reload = false) => call("skills.list", { reload }).then(value => { setState(value); setError(""); }).catch(failure => { setError(errorText(failure)); if (state) toast(failure, "error"); });
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
  const remove = async skill => {
    if (!await confirm({ title: `Remove ${skill.title}?`, body: "The skill is removed from Timewarp, and agents no longer use it.", action: "Remove", danger: true })) return;
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
      <div className="tw-tabs secondary" role="group" aria-label="Skills">
        {SKILL_TABS.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {state?.errors.length ? <div className="tw-alert">{state.errors.join(" ")}</div> : null}
      {state === null && error ? <div className="tw-error-box" role="alert"><span>{error}</span><button type="button" className="tw-btn" onClick={() => { setError(""); void load(true); }}>Retry</button></div>
        : state === null ? <p className="tw-loading">Loading skills...</p> : shown.length ? (
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
