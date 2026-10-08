import React, { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { MASCOTS, avatarSrc, call } from "../api.js";
import { Dialog, useToast } from "./common.jsx";

const MAX_PICTURE = 2 * 1024 * 1024;

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
  return (
    <Dialog open={open} onClose={onClose} label={editing ? "Edit agent" : "New agent"}>
      <form onSubmit={save} style={{ display: "grid", gap: 16 }}>
        <h2>{editing ? "Edit agent" : "New agent"}</h2>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <img className="tw-avatar large" src={preview} alt="" />
          <div className="tw-mascots" role="group" aria-label="Choose a mascot">
            {MASCOTS.map(choice => (
              <button key={choice} type="button" className="tw-mascot" aria-pressed={mascot === choice && !picture} onClick={() => { setMascot(choice); setPicture(null); }}>
                <img src={`./mascots/${choice.toLowerCase()}.png`} alt="" />{choice}
              </button>
            ))}
            <button type="button" className="tw-mascot" aria-pressed={!!picture} onClick={() => file.current?.click()}>
              <span style={{ width: 60, height: 60, display: "grid", placeItems: "center" }}><ImagePlus size={24} /></span>Picture
            </button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={choosePicture} />
          </div>
        </div>
        <label className="tw-field"><span>Name</span><input className="tw-input" value={name} maxLength={60} autoFocus onChange={event => setName(event.target.value)} placeholder="Orbit" /></label>
        <label className="tw-field"><span>Instructions</span>
          <textarea className="tw-textarea" value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="What should this agent focus on? How should it work and respond?" maxLength={20000} />
          <span className="tw-hint">Saved as AGENTS.md in the agent's workspace folder.</span>
        </label>
        {error ? <div className="tw-alert" role="alert">{error}</div> : null}
        <div className="tw-dialog-actions">
          <button type="button" className="tw-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="tw-btn primary" disabled={busy}>{editing ? "Save" : "Create agent"}</button>
        </div>
      </form>
    </Dialog>
  );
}
