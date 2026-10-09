"use strict";
// Profiles in the other browsers on this computer, offered in Settings →
// Browser and during setup. Only each browser's profile list (its "Local
// State" file: profile names and signed-in accounts) is read. Importing makes
// a Timewarp browser profile with the same name; the other browser's cookies
// and saved passwords are not read. Saved passwords come in from a CSV export
// (Vault), and sites are signed in to once in Timewarp's browser.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BROWSERS = {
  win32: [
    { id: "edge", name: "Edge", base: "LOCALAPPDATA", dir: "Microsoft/Edge/User Data" },
    { id: "chrome", name: "Chrome", base: "LOCALAPPDATA", dir: "Google/Chrome/User Data" },
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
      profiles.push({
        label: email ? `${name} (${email})` : name, name, email: email || null,
        accountName: text(info?.gaia_name) || null,
        picture: email ? picture(path.join(root, directory)) : null,
        browser: browser.name,
        source: { browserId: browser.id, profilePath: directory },
      });
    }
  }
  return { profiles, errors };
}

function createBrowserImport({ store, detect = detectProfiles } = {}) {
  const sameSource = (profile, source) => profile.source?.type === source.browserId && profile.source?.profilePath === source.profilePath;
  return {
    profileManager: { detect: async () => detect() },
    // Importable profiles that aren't in Timewarp yet.
    importable() {
      const existing = store.browserProfiles.list();
      return detect().profiles.filter(profile => !existing.some(item => sameSource(item, profile.source)));
    },
    async importProfiles({ selections = [] } = {}) {
      const found = detect().profiles, created = [];
      for (const selection of selections) {
        const profile = found.find(item => item.source.browserId === selection.browserId && item.source.profilePath === selection.profilePath);
        if (!profile) throw Object.assign(new Error("That browser profile is no longer on this computer."), { status: 404 });
        const existing = store.browserProfiles.list().find(item => sameSource(item, profile.source));
        created.push(existing || store.browserProfiles.create({
          label: profile.label.slice(0, 120),
          source: { type: profile.source.browserId, profilePath: profile.source.profilePath, browser: profile.browser, email: profile.email },
        }));
      }
      return { profiles: created, summary: { created: created.length, failedDecryption: 0, failedWrite: 0 }, passwords: { outcome: "skipped" } };
    },
  };
}

module.exports = { createBrowserImport, detectProfiles, BROWSERS };
