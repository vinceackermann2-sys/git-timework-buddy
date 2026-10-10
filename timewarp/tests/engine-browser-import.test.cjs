"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createBrowserImport, detectProfiles } = require("../app/main/browser-import.cjs");

function fakeBrowsers(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-browsers-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const chrome = path.join(root, "Google/Chrome/User Data");
  fs.mkdirSync(path.join(chrome, "Default"), { recursive: true });
  fs.mkdirSync(path.join(chrome, "Profile 2"), { recursive: true });
  fs.writeFileSync(path.join(chrome, "Local State"), "﻿" + JSON.stringify({ profile: { info_cache: {
    Default: { name: "Person 1", user_name: "ada@example.com", gaia_name: "Ada" },
    "Profile 2": { name: "Work" },
    "Gone": { name: "Deleted profile" },
    "../escape": { name: "Outside" },
  } } }));
  const edge = path.join(root, "Microsoft/Edge/User Data");
  fs.mkdirSync(edge, { recursive: true });
  fs.writeFileSync(path.join(edge, "Local State"), "not json");
  return { platform: "win32", env: { LOCALAPPDATA: root }, home: root };
}

test("other browsers' profiles are found from their profile lists only", t => {
  const options = fakeBrowsers(t);
  const { profiles, errors } = detectProfiles(options);
  assert.deepEqual(profiles.map(profile => [profile.browser, profile.source.profilePath, profile.label]), [
    ["Chrome", "Default", "Person 1 (ada@example.com)"],
    ["Chrome", "Profile 2", "Work"],
  ]);
  assert.deepEqual(errors.map(error => error.browserId), ["edge"]);
  assert.deepEqual(detectProfiles({ ...options, platform: "sunos" }), { profiles: [], errors: [] });
});

test("profiles used most recently come first, then by name", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-browsers-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (dir, cache) => { fs.mkdirSync(path.join(root, dir), { recursive: true }); for (const name of Object.keys(cache)) fs.mkdirSync(path.join(root, dir, name), { recursive: true }); fs.writeFileSync(path.join(root, dir, "Local State"), JSON.stringify({ profile: { info_cache: cache } })); };
  write("Google/Chrome/User Data", { Default: { name: "Person 1", active_time: 1791567914.8 }, "Profile 3": { name: "Beta" } });
  write("Microsoft/Edge/User Data", { Default: { name: "Profil 1", active_time: 1791569397.9 }, "Profile 2": { name: "Alpha" } });
  const { profiles } = detectProfiles({ platform: "win32", env: { LOCALAPPDATA: root }, home: root });
  assert.deepEqual(profiles.map(profile => profile.browser + " " + profile.name), ["Edge Profil 1", "Chrome Person 1", "Edge Alpha", "Chrome Beta"]);
});

test("importing makes one Timewarp profile per browser profile", async t => {
  const options = fakeBrowsers(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-store-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.browserProfiles.ensureDefault();
  const imports = createBrowserImport({ store, detect: () => detectProfiles(options) });
  assert.equal(imports.importable().length, 2);
  const first = await imports.importProfiles({ selections: [{ browserId: "chrome", profilePath: "Default" }] });
  assert.equal(first.profiles[0].label, "Person 1 (ada@example.com)");
  assert.deepEqual(first.profiles[0].source, { type: "chrome", profilePath: "Default", browser: "Chrome", email: "ada@example.com" });
  const again = await imports.importProfiles({ selections: [{ browserId: "chrome", profilePath: "Default" }] });
  assert.equal(again.profiles[0].id, first.profiles[0].id);
  assert.deepEqual(imports.importable().map(profile => profile.label), ["Work"]);
  assert.equal(store.browserProfiles.list().length, 2);
  await assert.rejects(imports.importProfiles({ selections: [{ browserId: "chrome", profilePath: "Gone" }] }), /no longer on this computer/);
});
