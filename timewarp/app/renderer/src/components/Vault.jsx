import React, { useEffect, useState } from "react";
import { Copy, CreditCard, Eye, EyeOff, KeyRound, LockKeyhole, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { call } from "../api.js";
import { Avatar, Dialog, PageHead, Switch, useToast } from "./common.jsx";

const KINDS = [{ value: "password", label: "Sign-in" }, { value: "card", label: "Card" }, { value: "secret", label: "Secret" }];
const icon = kind => kind === "card" ? <CreditCard size={20} strokeWidth={1.6} /> : kind === "secret" ? <LockKeyhole size={20} strokeWidth={1.6} /> : <KeyRound size={20} strokeWidth={1.6} />;

function Hidden({ id, field, label }) {
  const [value, setValue] = useState(null);
  const toast = useToast();
  return (
    <span className="tw-secret">
      <code>{value ?? "••••••••"}</code>
      <button type="button" className="tw-icon-button" title={value ? "Hide " + label : "Show " + label} aria-label={value ? "Hide " + label : "Show " + label} onClick={() => value ? setValue(null) : call("vault.reveal", { id, field }).then(result => setValue(result.value)).catch(error => toast(error, "error"))}>{value ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      <button type="button" className="tw-icon-button" title={"Copy " + label} aria-label={"Copy " + label} onClick={() => call("vault.copy", { id, field }).then(() => toast(`${label[0].toUpperCase() + label.slice(1)} copied. The clipboard clears in a minute.`)).catch(error => toast(error, "error"))}><Copy size={15} /></button>
    </span>
  );
}

function Editor({ item, kind: initialKind, onSaved, onCancel }) {
  const kind = item?.kind || initialKind || "password";
  const [draft, setDraft] = useState({
    label: item?.label || "", site: item?.origin || "", username: item?.username || "", password: "", notes: item?.notes || "",
    number: "", expiry: item?.expMonth ? `${String(item.expMonth).padStart(2, "0")}/${String(item.expYear).slice(-2)}` : "", cardholder: item?.cardholder || "", value: "",
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const field = (label, key, props = {}) => <label className="tw-field"><span>{label}</span><input className="tw-input" value={draft[key]} onChange={event => set({ [key]: event.target.value })} {...props} /></label>;
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      let input = { kind, label: draft.label, notes: draft.notes };
      if (kind === "password") input = { ...input, site: draft.site, username: draft.username, ...(draft.password ? { password: draft.password } : {}) };
      if (kind === "card") {
        const [month, year] = draft.expiry.split("/").map(part => part.trim());
        input = { ...input, cardholder: draft.cardholder, expMonth: Number(month), expYear: Number(year?.length === 2 ? "20" + year : year), ...(draft.number ? { number: draft.number } : {}) };
      }
      if (kind === "secret" && draft.value) input.value = draft.value;
      await (item ? call("vault.update", { id: item.id, ...input }) : call("vault.create", input));
      toast(item ? "Saved." : "Added to the vault.");
      onSaved();
    } catch (error) { toast(error, "error"); }
    finally { setBusy(false); }
  }
  return (
    <form className="tw-import" onSubmit={save} autoComplete="off">
      {kind === "password" ? <>
        {field("Website", "site", { required: true, placeholder: "example.com" })}
        {field("Username or email", "username", { autoComplete: "off" })}
        {field(item ? "New password (leave empty to keep it)" : "Password", "password", { type: "password", required: !item, autoComplete: "new-password" })}
      </> : null}
      {kind === "card" ? <>
        {field(item ? "New card number (leave empty to keep it)" : "Card number", "number", { inputMode: "numeric", required: !item, autoComplete: "off" })}
        {field("Expiry (MM/YY)", "expiry", { required: true, placeholder: "08/29", pattern: "\\d{1,2}\\s*/\\s*\\d{2,4}" })}
        <span className="tw-hint">Security codes are never stored. You type the code when you pay.</span>
        {field("Name on card", "cardholder")}
      </> : null}
      {kind === "secret" ? field(item ? "New value (leave empty to keep it)" : "Value", "value", { type: "password", required: !item, autoComplete: "off" }) : null}
      {field(kind === "secret" ? "Name" : "Name (optional)", "label", { required: kind === "secret", maxLength: 120 })}
      <div className="tw-dialog-actions">
        <button type="button" className="tw-btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="tw-btn primary" disabled={busy}>{busy ? "Saving…" : item ? "Save" : "Add"}</button>
      </div>
    </form>
  );
}

const SECTIONS = [
  { kind: "password", title: "Passwords", empty: "No saved passwords yet.", add: "Add" },
  { kind: "card", title: "Credit cards", empty: "No saved cards yet.", add: "Add card" },
  { kind: "secret", title: "Secrets and passkeys", empty: "No saved secrets yet.", add: "Add secret" },
];

export function Vault({ agents }) {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(null);
  const [access, setAccess] = useState({});
  const toast = useToast();
  const load = () => call("vault.list").then(setState).catch(error => toast(error, "error"));
  useEffect(() => { void load(); }, []);
  useEffect(() => { call("agents.list").then(list => setAccess(Object.fromEntries(list.map(agent => [agent.id, !!agent.vaultAccess])))).catch(() => {}); }, [agents]);
  const toggle = (agent, value) => {
    setAccess(current => ({ ...current, [agent.id]: value }));
    call("agents.update", { id: agent.id, vaultAccess: value }).catch(error => { toast(error, "error"); setAccess(current => ({ ...current, [agent.id]: !value })); });
  };
  const unavailable = state && !state.available;
  const items = state?.items || [];
  const importPasswords = () => call("vault.importPasswords").then(result => {
    if (result.cancelled) return;
    toast(`Imported ${result.imported} sign-in${result.imported === 1 ? "" : "s"}${result.duplicates ? `, ${result.duplicates} already saved` : ""}${result.skipped ? `, ${result.skipped} skipped` : ""}. Delete the exported file now; it isn't encrypted.`);
    void load();
  }).catch(error => toast(error, "error"));
  return (
    <div className="tw-page">
      <PageHead title="Vault" subtitle="Passwords, cards and secrets stay encrypted on this device. Agents with access fill them in without seeing them." />
      {unavailable ? <div className="tw-alert">This computer's secure storage is unavailable, so new items can't be saved.</div> : null}
      {SECTIONS.map(section => {
        const list = items.filter(item => item.kind === section.kind);
        return (
          <React.Fragment key={section.kind}>
            <div className="tw-section-head">
              <h3>{section.title}</h3>
              {section.kind === "password" ? <button type="button" className="tw-btn" disabled={unavailable} title="Import a passwords file (CSV) exported from your browser or password manager" onClick={importPasswords}><Upload size={15} />Import</button> : null}
              <button type="button" className="tw-btn" disabled={unavailable} onClick={() => setEditing({ kind: section.kind })}><Plus size={15} />{section.add}</button>
            </div>
            {state === null ? <div className="tw-empty-box">Opening the vault…</div> : list.length ? (
              <div className="tw-list-panel">
                {list.map(item => (
                  <div key={item.id} className="tw-list-row">
                    <span className="tw-face">{icon(item.kind)}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <span className="desc">
                        {item.kind === "password" ? [item.origin.replace(/^https:\/\//, ""), item.username].filter(Boolean).join(" · ")
                          : item.kind === "card" ? `${item.brand} ending ${item.last4} · expires ${String(item.expMonth).padStart(2, "0")}/${String(item.expYear).slice(-2)}${item.cardholder ? " · " + item.cardholder : ""}` : "Secret"}
                        {item.createdByAgent ? " · saved by an agent" : ""}
                      </span>
                    </div>
                    <Hidden id={item.id} field={item.kind === "password" ? "password" : item.kind === "card" ? "number" : "value"} label={item.kind === "card" ? "card number" : item.kind === "secret" ? "secret" : "password"} />
                    <button type="button" className="tw-icon-button" title="Edit" aria-label={"Edit " + item.label} onClick={() => setEditing({ item })}><Pencil size={15} /></button>
                    <button type="button" className="tw-icon-button" title="Delete" aria-label={"Delete " + item.label} onClick={() => { if (window.confirm(`Delete ${item.label} from the vault? This can't be undone.`)) call("vault.remove", { id: item.id }).then(load).catch(error => toast(error, "error")); }}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            ) : <div className="tw-empty-box">{section.empty}</div>}
          </React.Fragment>
        );
      })}
      <div className="tw-section-head"><div><h3>Agent access</h3><p>Agents without access can't list or use vault items. Timewarp asks before an agent uses a card or secret.</p></div></div>
      <div className="tw-rows-card">
        {agents.map(agent => (
          <div key={agent.id} className="tw-set-row">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar agent={agent} /><strong>{agent.name}</strong></div>
            <Switch label={`${agent.name} can use the vault`} checked={!!access[agent.id]} onChange={value => toggle(agent, value)} />
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.item ? "Edit " + editing.item.label : "Add " + (KINDS.find(kind => kind.value === editing?.kind)?.label.toLowerCase() || "item")}>
        {editing ? <Editor item={editing.item} kind={editing.kind} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
      </Dialog>
    </div>
  );
}
