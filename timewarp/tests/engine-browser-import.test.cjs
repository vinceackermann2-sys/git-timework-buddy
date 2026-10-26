"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createBrowserImport, detectProfiles, sourceDirectory, consolidateBrowserProfiles } = require("../app/main/browser-import.cjs");

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

function importingFixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-import-test-"));
  const store = openStore(path.join(root, "store.sqlite")), written = [];
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const source = { browserId: "chrome", profilePath: "Default" };
  const imports = createBrowserImport({ store,
    detect: () => ({ profiles: [{ browser: "Chrome", label: "Work", source }] }), resolveSource: () => ({}),
    sessionFor: () => ({ cookies: { set: async value => written.push(value), flushStore: async () => {} } }),
    ...options,
  });
  return { store, written, imports, selection: { selections: [source] } };
}

test("protected cookies use the browser helper, and cancellation never claims success", async t => {
  let cancelled = true, attempts = 0;
  const f = importingFixture(t, { readCookies: async () => ({ cookies: [], failedDecryption: 3 }), assist: async () => { attempts++; return cancelled ? null : [{ domain: ".example.com", name: "protected", value: "fixture", secure: true }]; } });
  assert.equal((await f.imports.importProfiles(f.selection)).outcome, "cancelled");
  assert.equal(f.written.length, 0);
  cancelled = false;
  const result = await f.imports.importProfiles(f.selection);
  assert.equal(result.summary.imported, 1);
  assert.equal(result.summary.failedDecryption, 0);
  assert.equal(attempts, 2);
  assert.equal(f.store.browserProfiles.list().length, 1);
  assert.ok(!JSON.stringify(result).includes("fixture"), "cookie values never reach the renderer");
});

test("cookie writes report partial failure, and persistence failures reject the import", async t => {
  const f = importingFixture(t, { readCookies: async () => ({ cookies: [{ domain: "example.com", name: "session", value: "fixture" }], failedDecryption: 2 }),
    sessionFor: () => ({ cookies: { set: async () => { throw Error("fixture"); }, flushStore: async () => {} } }),
  });
  const result = await f.imports.importProfiles(f.selection);
  assert.equal(result.outcome, "partial");
  assert.equal(result.summary.failedWrite, 1);
  assert.equal(result.warnings.length, 2);
  const g = importingFixture(t, { readCookies: async () => ({ cookies: [], failedDecryption: 0 }), sessionFor: () => ({ cookies: { flushStore: async () => { throw Error("disk full"); } } }) });
  await assert.rejects(g.imports.importProfiles(g.selection), /could not be saved/);
});

test("an import cannot overlap another import or write cookies after an account change", async t => {
  let release, owner = "a";
  const f = importingFixture(t, { userId: () => owner, readCookies: () => new Promise(resolve => { release = resolve; }) });
  const first = f.imports.importProfiles(f.selection);
  await assert.rejects(f.imports.importProfiles(f.selection), /already running/);
  owner = "b";
  release({ cookies: [{ domain: "example.com", name: "session", value: "fixture" }], failedDecryption: 0 });
  await assert.rejects(first, /account changed/);
  assert.equal(f.written.length, 0);
});

test("existing profiles collapse into one, keep sign-ins and tab history, and retry interrupted merges", async t => {
  const f = importingFixture(t), { store } = f;
  const target = store.browserProfiles.ensureDefault();
  const old = store.browserProfiles.create({ label: "Work", source: { type: "chrome", partition: "browser-profile:v1:" + "a".repeat(64) } });
  const agent = store.agents.create({ ownerId: "u", name: "Orbit", workspace: "/fixture" });
  const chat = store.conversations.create({ ownerId: "u", agentId: agent.id, browserProfileId: old.id });
  store.settings.set("browserTabs", { [chat.id]: { tabs: [{ id: "saved", profileId: old.id, url: "https://example.com", history: { index: 0 } }] } });
  store.recentSites.record(old.id, chat.id, "https://example.com", "Fixture");
  const cookie = (name, value) => ({ domain: ".example.com", name, value, path: "/", secure: true });
  const destination = [cookie("keep", "default")]; let locked = true;
  const sessionFor = id => ({ cookies: {
    get: async () => { if (id !== target.id && locked) throw Error("locked"); return id === target.id ? destination : [cookie("keep", "old"), cookie("import", "old")]; },
    set: async cookie => destination.push(cookie), flushStore: async () => {},
  } });
  await consolidateBrowserProfiles({ store, sessionFor });
  assert.deepEqual(store.browserProfiles.list().map(profile => profile.id), [target.id]);
  assert.deepEqual(store.browserProfiles.pendingMerges(target.id), [old.id]);
  assert.equal(store.conversations.get(chat.id).browserProfileId, target.id);
  assert.equal(store.settings.get("browserTabs")[chat.id].tabs[0].profileId, target.id);
  assert.equal(store.settings.get("browserTabs")[chat.id].tabs[0].history.index, 0);
  assert.equal(store.recentSites.list(target.id, chat.id).length, 1);
  assert.equal(store.browserProfiles.get(old.id).source.partition, old.source.partition, "old storage remains recoverable");
  locked = false;
  await consolidateBrowserProfiles({ store, sessionFor });
  assert.deepEqual(store.browserProfiles.pendingMerges(target.id), []);
  assert.deepEqual(destination.map(cookie => [cookie.name, cookie.value]), [["keep", "default"], ["import", "old"]]);
});

test("the public API lists one profile, rejects creation and preserves import receipts", async t => {
  const f = importingFixture(t), expected = { outcome: "partial", summary: { imported: 1, failedWrite: 1 }, warnings: ["Retry"] };
  f.store.browserProfiles.ensureDefault();
  f.store.browserProfiles.create({ label: "old" });
  const { createMethods } = require("../app/main/methods.cjs");
  const methods = createMethods({ store: f.store, services: { auth: { userId: () => "user" } }, browserImport: { importProfiles: async () => expected } });
  assert.equal(methods["browser.profiles"]().length, 1);
  assert.throws(() => methods["browser.createProfile"]({ label: "extra" }), /one shared/);
  assert.equal(await methods["browser.importProfile"]({ browserId: "chrome", profilePath: "Default" }), expected);
});

test("onboarding uses the shared cookie importer and never marks cancelled, empty or partial imports connected", async t => {
  const f = importingFixture(t, { readCookies: async () => ({ cookies: [{ domain: "example.com", name: "session", value: "fixture" }], failedDecryption: 0 }) });
  const { createOnboardingService } = require("../desktop/onboarding-service.cjs");
  let saved = null, outcome = null;
  const browserImport = { ...f.imports, importProfiles: input => outcome ? Promise.resolve(outcome) : f.imports.importProfiles(input) };
  const service = createOnboardingService({ storage: { load: () => saved, save: value => { saved = value; } }, userId: () => "user",
    native: () => ({ settings: { get: async () => ({ appearance: {} }) }, caller: () => ({ codex: { setupImport: { detect: async () => ({ items: [] }) } } }) }), browsers: () => browserImport,
  });
  const detected = await service.detect(), selection = { profiles: [detected.profiles[0].id] };
  for (const receipt of [{ outcome: "cancelled" }, { outcome: "imported", summary: { imported: 0 } }, { outcome: "partial", summary: { imported: 1, failedWrite: 1 }, warnings: ["Retry"] }]) {
    outcome = receipt;
    const result = await service.run("import", selection);
    assert.equal(result.profiles.length, 0);
    assert.ok(result.warnings.length);
    assert.equal(Object.keys((await service.read()).imports || {}).length, 0);
  }
  outcome = null;
  const result = await service.run("import", selection);
  assert.equal(result.cookies, 1);
  assert.equal(result.profiles.length, 1);
  assert.equal(f.store.browserProfiles.list().length, 1);
  assert.equal(Object.keys((await service.read()).imports).length, 1);
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

test("importing copies cookies into the single shared Timewarp profile, including on repeat", async t => {
  const options = fakeBrowsers(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-store-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.browserProfiles.ensureDefault();
  const written = [];
  let flushes = 0;
  const imports = createBrowserImport({ store, detect: () => detectProfiles(options),
    resolveSource: source => sourceDirectory(source, options),
    readCookies: async () => ({ cookies: [{ domain: ".example.com", name: "session", value: "fixture", path: "/", secure: true, httpOnly: true }], failedDecryption: 0 }),
    sessionFor: id => { assert.equal(id, "timewarp:default"); return { cookies: { set: async cookie => written.push(cookie), flushStore: async () => flushes++ } }; },
  });
  assert.equal(imports.importable().length, 2);
  const first = await imports.importProfiles({ selections: [{ browserId: "chrome", profilePath: "Default" }] });
  assert.equal(first.profiles[0].id, "timewarp:default");
  assert.equal(first.summary.imported, 1);
  assert.equal(written[0].httpOnly, true);
  assert.equal(written[0].url, "https://example.com/");
  const again = await imports.importProfiles({ selections: [{ browserId: "chrome", profilePath: "Default" }] });
  assert.equal(again.profiles[0].id, first.profiles[0].id);
  assert.equal(imports.importable().length, 2, "sources stay available to refresh sessions");
  assert.equal(written.length, 2);
  assert.equal(flushes, 2);
  assert.equal(store.browserProfiles.list().length, 1);
  await assert.rejects(imports.importProfiles({ selections: [{ browserId: "chrome", profilePath: "Gone" }] }), /no longer on this computer/);
});
