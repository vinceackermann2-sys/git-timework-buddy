import React, { useEffect, useRef, useState } from "react";
import { ImageUp, X } from "lucide-react";
import { MASCOTS, avatarSrc, call } from "../api.js";
import { Dialog, useToast } from "./common.jsx";

const MAX_PICTURE = 2 * 1024 * 1024;

// New and edit agent, laid out as in the previous app: the picture, a choice
// of mascots or an uploaded picture, a name and the agent's responsibilities
// (its AGENTS.md).
export function AgentDialog({ open, agent, onClose, onSaved }) {
  const editing = !!agent;
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mascot, setMascot] = useState("Orbit");
  const [picture, setPicture] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setError(""); setBusy(false); setPicture(null);
    setName(agent?.name || "");
    const current = /\/mascots\/(orbit|nova|cosmo)\.png$/.exec(agent?.avatarUrl || "");
    setMascot(current ? current[1][0].toUpperCase() + current[1].slice(1) : agent ? null : "Orbit");
    setInstructions("");
    if (agent) call("agents.instructions", { id: agent.id }).then(value => setInstructions(value.instructions || "")).catch(() => {});
  }, [open, agent?.id]);

  function choosePicture(event) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type) || selected.size > MAX_PICTURE) { setError("Choose a PNG, JPEG or WebP picture smaller than 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { setPicture(String(reader.result)); setMascot(null); setError(""); };
    reader.readAsDataURL(selected);
  }

  async function save(event) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the agent a name."); return; }
    setBusy(true); setError("");
    const avatar = picture ? { imageUrl: picture } : mascot ? { mascot } : undefined;
    try {
      const saved = editing
        ? await call("agents.update", { id: agent.id, name, instructions, ...(avatar ? { avatar } : {}) })
        : await call("agents.create", { name, instructions, avatar });
      toast(editing ? "Agent saved." : `${saved.name} is ready.`);
      onSaved(saved);
    } catch (failure) { setError(failure.message); setBusy(false); }
  }

  const preview = picture || (mascot ? `./mascots/${mascot.toLowerCase()}.png` : avatarSrc(agent));
  const title = editing ? "Edit Agent" : "New Agent";
  return (
    <Dialog open={open} onClose={onClose} label={title} className="tw-agent-dialog">
      <form onSubmit={save} className="tw-agent-form">
        <h2>{title}</h2>
        <button type="button" className="tw-icon-button tw-dialog-close" aria-label="Close" onClick={onClose}><X size={16} /></button>
        <img className="tw-agent-preview" src={preview} alt="" />
        <span className="tw-agent-form-label">Choose mascot</span>
        <div className="tw-mascots" role="group" aria-label="Choose mascot">
          {MASCOTS.map(choice => (
            <button key={choice} type="button" className="tw-mascot" aria-label={"Choose " + choice} aria-pressed={mascot === choice && !picture} onClick={() => { setMascot(choice); setPicture(null); }}>
              <img src={`./mascots/${choice.toLowerCase()}.png`} alt="" /><span>{choice}</span>
            </button>
          ))}
        </div>
        <button type="button" className="tw-btn tw-upload" onClick={() => file.current?.click()}><ImageUp size={16} />Upload picture</button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={choosePicture} />
        <label className="tw-agent-field"><span>Name</span><input className="tw-input" value={name} maxLength={60} autoFocus onChange={event => setName(event.target.value)} placeholder="Agent name" /></label>
        <label className="tw-agent-field"><span>Agent responsibilities (optional)</span>
          <textarea className="tw-textarea" rows={3} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="e.g. Manage email, coordinate calendars, and organize shared files." maxLength={20000} />
        </label>
        {error ? <div className="tw-alert" role="alert">{error}</div> : null}
        <button type="submit" className="tw-btn accent tw-wide" disabled={busy || !name.trim()}>{busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save" : "Create"}</button>
      </form>
    </Dialog>
  );
}
