import { useEffect, useRef } from "react";

export const call = (method, input) => window.tw.call(method, input);
export const request = (action, input) => window.timewarp.request(action, input);

// What the interface keeps on this computer for the signed-in account (drafts,
// prompt history, the home screen's agent, collapsed groups…) is kept under
// that account's id, so another account signed in here doesn't see it. The
// window reloads when the account changes (App.jsx), so it is set once.
// adopt: the account owns what this computer kept before (accounts.cjs).
let storageAccount = "", storageAdopts = false;
export function setStorageAccount(id, { adopt = false } = {}) { storageAccount = id ? String(id) : ""; storageAdopts = !!adopt; }
export const scopedKey = key => storageAccount ? `tw@${storageAccount}:${key}` : key;
// A value kept before values were per account goes to the account that owns the computer's earlier data.
export function readScoped(key) {
  try {
    const scoped = scopedKey(key);
    let value = localStorage.getItem(scoped);
    if (value === null && scoped !== key && storageAdopts && (value = localStorage.getItem(key)) !== null) { localStorage.setItem(scoped, value); localStorage.removeItem(key); }
    return value;
  } catch { return null; }
}
export function writeScoped(key, value) {
  try { if (value === null) localStorage.removeItem(scopedKey(key)); else localStorage.setItem(scopedKey(key), value); } catch {}
}

export function useEvent(name, handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => window.tw.on(name, (payload, event) => latest.current(payload, event)), [name]);
}

// Built-in mascots are bundled with the interface; stored avatar addresses
// from earlier versions point at the device bridge.
const MASCOT = /\/mascots\/(orbit|nova|cosmo)\.png$/;
export function avatarSrc(agent) {
  const url = agent?.avatarUrl || "";
  const match = MASCOT.exec(url);
  if (match) return `./mascots/${match[1]}.png`;
  if (/^data:image\/(?:png|jpeg|webp);base64,/.test(url) || /^https:\/\//.test(url)) return url;
  return "./mascots/orbit.png";
}

export const MASCOTS = ["Orbit", "Nova", "Cosmo"];

export function initials(name) {
  return String(name || "T").trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "T";
}

// A connected app account as one line: its name and the email it signs in
// with ("Vince Ackermann · vince@example.com"), or whichever of them is known.
export function accountText(account) {
  const name = account?.name || account?.displayName || "";
  return account?.email && account.email !== name ? (name ? `${name} · ${account.email}` : account.email) : name;
}

export function relativeTime(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d";
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function errorText(error) {
  return String(error?.message || error || "Something went wrong.").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
