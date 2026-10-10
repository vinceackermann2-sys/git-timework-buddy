import { useEffect, useRef } from "react";

export const call = (method, input) => window.tw.call(method, input);
export const request = (action, input) => window.timewarp.request(action, input);

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
