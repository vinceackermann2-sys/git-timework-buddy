"use strict";
// Profiles in the other browsers on this computer, offered in Settings →
// Browser and during setup, which share this importer. A source profile's
// cookies (browser-cookies.cjs) go into the signed-in account's one Timewarp
// browser profile, so its sites stay signed in; importing never creates a
// profile, and a source can be imported again to refresh its sign-ins. Saved
// passwords come in from a CSV export (Vault).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readBrowserCookies, cookieDetails } = require("./browser-cookies.cjs");

const BROWSERS = {
  win32: [
    { id: "chrome", name: "Chrome", base: "LOCALAPPDATA", dir: "Google/Chrome/User Data" },
    { id: "edge", name: "Edge", base: "LOCALAPPDATA", dir: "Microsoft/Edge/User Data" },
    { id: "brave", name: "Brave", base: "LOCALAPPDATA", dir: "BraveSoftware/Brave-Browser/User Data" },
    { id: "vivaldi", name: "Vivaldi", base: "LOCALAPPDATA", dir: "Vivaldi/User Data" },
  ],
  darwin: [
    { id: "chrome", name: "Chrome", base: "HOME", dir: "Library/Application Support/Google/Chrome" },
    { id: "edge", name: "Edge", base: "HOME", dir: "Library/Application Support/Microsoft Edge" },
    { id: "brave", name: "Brave", base: "HOME", dir: "Library/Application Support/BraveSoftware/Brave-Browser" },
    { id: "arc", name: "Arc", base: "HOME", dir: "Library/Application Support/Arc/User Data" },
    { id: "vivaldi", name: "Vivaldi", base: "HOME", dir: "Library/Application Support/Vivaldi" },
  ],
  linux: [
    { id: "chrome", name: "Chrome", base: "HOME", dir: ".config/google-chrome" },
    { id: "edge", name: "Edge", base: "HOME", dir: ".config/microsoft-edge" },
    { id: "brave", name: "Brave", base: "HOME", dir: ".config/BraveSoftware/Brave-Browser" },
    { id: "chromium", name: "Chromium", base: "HOME", dir: ".config/chromium" },
  ],
};
const MAX_STATE = 8 * 1024 * 1024;
const MAX_PICTURE = 512 * 1024;
// The account picture the browser shows for a signed-in profile.
function picture(directory) {
  for (const name of ["Google Profile Picture.png", "Edge Profile Picture.png"]) {
    try {
      const file = path.join(directory, name), stat = fs.statSync(file);
      if (stat.isFile() && stat.size <= MAX_PICTURE) return "data:image/png;base64," + fs.readFileSync(file).toString("base64");
    } catch {}
  }
  return null;
}
const text = (value, limit = 120) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "";

// Installed browsers' profiles: [{ label, name, email, browser, source: { browserId, profilePath } }].
function detectProfiles({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const profiles = [], errors = [];
  for (const browser of BROWSERS[platform] || []) {
    const base = browser.base === "HOME" ? home : env[browser.base];
    if (!base) continue;
    const root = path.join(base, browser.dir);
    const file = path.join(root, "Local State");
    let state;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_STATE) continue;
      state = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    } catch (error) {
      if (error.code !== "ENOENT") errors.push({ browserId: browser.id, message: `${browser.name}'s profile list couldn't be read.` });
      continue;
    }
    const cache = state?.profile?.info_cache;
    if (!cache || typeof cache !== "object") continue;
    for (const [directory, info] of Object.entries(cache)) {
      // Profile folders are plain names inside the browser's own folder.
      if (!/^[\w .-]{1,80}$/.test(directory) || directory.startsWith(".") || !fs.existsSync(path.join(root, directory))) continue;
      const name = text(info?.name) || directory, email = text(info?.user_name, 200);
      const active = Number(info?.active_time);
      profiles.push({
        label: email ? `${name} (${email})` : name, name, email: email || null,
        lastActiveMs: Number.isFinite(active) && active > 0 ? Math.round(active * 1000) : null,
        accountName: text(info?.gaia_name) || null,
        picture: email ? picture(path.join(root, directory)) : null,
        browser: browser.name,
        source: { browserId: browser.id, profilePath: directory },
      });
    }
  }
  // Most recently used first, then by name, as the previous app listed them.
  profiles.sort((a, b) => a.lastActiveMs !== null && b.lastActiveMs !== null ? b.lastActiveMs - a.lastActiveMs
    : a.lastActiveMs !== null ? -1 : b.lastActiveMs !== null ? 1 : (a.name || a.label).localeCompare(b.name || b.label));
  return { profiles, errors };
}

function sourceDirectory(source, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const browser = (BROWSERS[platform] || []).find(item => item.id === source.browserId);
  if (!browser || !/^[\w .-]{1,80}$/.test(source.profilePath) || source.profilePath.startsWith(".")) throw new Error("This browser profile is unavailable.");
  const base = browser.base === "HOME" ? home : env[browser.base];
  if (!base) throw new Error("This browser profile is unavailable.");
  const root = fs.realpathSync(path.join(base, browser.dir)), directory = fs.realpathSync(path.join(root, source.profilePath));
  if (path.dirname(directory) !== root) throw new Error("This browser profile is outside its browser's data folder.");
  return { root, directory, browserId: browser.id, platform };
}

function createBrowserImport({ store, detect = detectProfiles, sessionFor, readCookies = readBrowserCookies, resolveSource = sourceDirectory, assist = null, userId = () => null } = {}) {
  let importing = false;
  return {
    profileManager: { detect: async () => detect() },
    // Keep sources available so the user can refresh expired sessions.
    importable: () => detect().profiles,
    async importProfiles({ selections = [] } = {}) {
      if (importing) throw Object.assign(new Error("A browser import is already running."), { status: 409 });
      if (!Array.isArray(selections) || selections.length > 20) throw new Error("Choose up to 20 source profiles.");
      if (!sessionFor) throw new Error("The Timewarp browser session is unavailable.");
      importing = true;
      const owner = userId();
      const check = () => { if (userId() !== owner) throw new Error("Your account changed. Retry the browser import."); };
      try {
        const found = detect().profiles, profiles = [], warnings = [];
        const summary = { created: 0, imported: 0, skipped: 0, failedDecryption: 0, failedWrite: 0 };
        for (const selection of selections) {
          const profile = found.find(item => item.source.browserId === selection.browserId && item.source.profilePath === selection.profilePath);
          if (!profile) throw Object.assign(new Error("That browser profile is no longer on this computer."), { status: 404 });
          const location = resolveSource(profile.source);
          let result;
          try { result = await readCookies(location); }
          catch (error) { if (!assist) throw error; result = { cookies: [], failedDecryption: 1 }; }
          check();
          if (result.failedDecryption && assist) {
            const cookies = await assist(profile);
            check();
            if (cookies === null) return { outcome: "cancelled", profiles, summary, warnings };
            result = { cookies, failedDecryption: 0 };
          }
          const target = store.browserProfiles.ensureDefault(), session = sessionFor(target.id);
          summary.failedDecryption += result.failedDecryption || 0;
          summary.skipped += result.skipped || 0;
          for (const cookie of result.cookies) {
            let details;
            try { details = cookieDetails(cookie); } catch { details = null; }
            if (!details) { summary.skipped++; continue; }
            check();
            try { await session.cookies.set(details); summary.imported++; } catch { summary.failedWrite++; }
          }
          check();
          // A flush failure must not be reported as a successful import.
          try { await session.cookies.flushStore(); } catch { throw new Error("Imported cookies could not be saved. Retry the browser import."); }
          check();
          if (summary.imported) store.browserProfiles.markImported(target.id);
          if (!profiles.length) profiles.push(store.browserProfiles.get(target.id) || target);
        }
        if (summary.failedDecryption) warnings.push(`${summary.failedDecryption} protected cookies could not be imported. Sign in to those sites in Timewarp.`);
        if (summary.failedWrite) warnings.push(`${summary.failedWrite} cookies could not be saved. Retry importing or sign in to those sites in Timewarp.`);
        if (summary.skipped) warnings.push(`${summary.skipped} expired, partitioned or unsupported cookies were skipped.`);
        return { outcome: summary.failedDecryption || summary.failedWrite ? "partial" : "imported", profiles, summary, warnings, passwords: { outcome: "skipped" } };
      } finally { importing = false; }
    },
  };
}

// The signed-in account's other browser profiles (made before there was one
// per account) fold into its default one: their cookies are copied over where
// the default has none of the same name, domain and path. sessionFor reaches
// each profile's own storage.
async function consolidateBrowserProfiles({ store, sessionFor, log = null }) {
  const target = store.browserProfiles.consolidate();
  const pending = store.browserProfiles.pendingMerges(target.id);
  if (!pending.length) return;
  const destination = sessionFor(target.id), left = [];
  const identity = cookie => [cookie.domain, cookie.path, cookie.name].join("\n");
  let existing;
  try { existing = new Set((await destination.cookies.get({})).map(identity)); }
  catch { log?.warn("browser", "Previous browser sign-ins will be merged at the next start; their storage was kept."); return; }
  for (const id of pending) {
    try {
      const cookies = await sessionFor(id).cookies.get({});
      for (const cookie of cookies) {
        if (existing.has(identity(cookie))) continue;
        const details = cookieDetails(cookie);
        if (!details) continue;
        await destination.cookies.set(details);
        existing.add(identity(cookie));
      }
      await destination.cookies.flushStore();
    } catch { left.push(id); }
  }
  store.browserProfiles.setPendingMerges(target.id, left);
  if (left.length) log?.warn("browser", "Some previous browser sign-ins could not be merged; their storage was kept for retry at the next start.");
}

module.exports = { createBrowserImport, detectProfiles, sourceDirectory, consolidateBrowserProfiles, BROWSERS };
