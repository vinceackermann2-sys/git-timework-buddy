"use strict";
// Updates: the state machine behind Settings → General → Updates and the
// sidebar's Update button, the Mac update files and their packaging.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const yaml = require("js-yaml");
const { configureUpdates, STORE_PAGE } = require("../desktop/updates.cjs");
const { mergeMacUpdateInfo, mergeFiles } = require("../scripts/merge-mac-update-info.cjs");
const { builderOptions, updateFileName } = require("../scripts/package-engine-mac.cjs");
const { checkMacFeed } = require("../scripts/release-config.cjs");
const shell = import("../app/renderer/src/shell.mjs");

const MAC_FEED = "https://github.com/vinceackermann2-sys/timewarp-releases/releases/latest/download/";
const windows = { enabled: true, version: "1.3.0", updateUrl: "https://updates.timewarp.example/windows/", publisherNames: ["Timewarp AB"] };
const mac = { enabled: true, version: "1.3.0", updateUrl: MAC_FEED };
const windowsFeed = { provider: "generic", url: windows.updateUrl, channel: "latest", publisherName: windows.publisherNames };
const macFeed = { provider: "generic", url: MAC_FEED, updaterCacheDirName: "timewarp-desktop-updater" };
const tick = () => new Promise(resolve => setImmediate(resolve));

// A fake app and electron-updater; the updater is created only when asked for.
function setup({ platform = "win32", packaged = true, version = "1.3.0", release = windows, macUpdates, feed = platform === "darwin" ? macFeed : windowsFeed, windowsStore = false, confirm } = {}) {
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: packaged, getVersion: () => version, whenReady: async () => {} });
  const updater = new EventEmitter();
  const counts = { created: 0, checks: 0, installs: 0, notified: 0, errors: 0, opened: [] };
  updater.checkForUpdates = async () => { counts.checks++; return "checked"; };
  updater.quitAndInstall = () => { counts.installs++; };
  const changes = [];
  let start, every = null;
  const started = new Promise(resolve => { start = resolve; });
  const result = configureUpdates({
    app, autoUpdater: () => { counts.created++; return updater; }, release, macUpdates: macUpdates ?? (platform === "darwin" ? mac : undefined), platform, windowsStore,
    readUpdateConfig: () => { if (feed instanceof Error) throw feed; return feed; },
    notify: () => { counts.notified++; }, ...(confirm ? { confirm } : {}),
    openExternal: async url => { counts.opened.push(url); }, onChange: state => changes.push(state),
    logger: { error() { counts.errors++; } }, interval: callback => { every = callback; return { unref() {} }; }, clear() {}, ready: () => started,
  });
  return { app, updater, result, counts, changes, start, every: () => every() };
}

test("a signed Windows release checks its feed once the account is ready, with Authenticode", async () => {
  const f = setup();
  assert.equal(f.result.enabled, true);
  assert.deepEqual(f.result.state(), { kind: "auto", status: "idle", version: "1.3.0", available: null, progress: 0 });
  await tick();
  assert.equal(f.counts.created, 0, "electron-updater waits for the first check");
  f.start(); await tick(); await tick();
  assert.equal(f.counts.created, 1); assert.equal(f.counts.checks, 1);
  assert.equal(f.updater.autoDownload, true); assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false); assert.equal(f.updater.allowPrerelease, false);
  assert.equal(typeof f.updater.verifyUpdateCodeSignature, "function");
  assert.equal(f.updater.disableDifferentialDownload, undefined);
  // Checks every 6 hours share one in-flight check.
  await Promise.all([f.every(), f.result.check(), f.result.check()]);
  assert.equal(f.counts.checks, 2);
});

test("updater events become the states the interface shows, and a ready update stays ready", async () => {
  const asked = [];
  const f = setup({ confirm: async install => { asked.push(true); install(); return true; } });
  f.start(); await tick(); await tick();
  f.updater.emit("checking-for-update");
  assert.equal(f.result.state().status, "checking");
  f.updater.emit("update-available", { version: "1.4.0" });
  assert.deepEqual(f.result.state(), { kind: "auto", status: "downloading", version: "1.3.0", available: "1.4.0", progress: 0 });
  f.updater.emit("download-progress", { percent: 41.7 });
  f.updater.emit("download-progress", { percent: 41.9 });
  assert.equal(f.result.state().progress, 41);
  f.updater.emit("download-progress", { percent: 100 });
  assert.equal(f.result.state().progress, 99, "100% only once it's downloaded and verified");
  assert.equal(await f.result.install(), false, "Nothing to install before the download finishes");
  f.updater.emit("update-downloaded", { version: "1.4.0" });
  assert.deepEqual(f.result.state(), { kind: "auto", status: "ready", version: "1.3.0", available: "1.4.0", progress: 100 });
  assert.equal(f.counts.notified, 1);
  // Later background checks don't hide the ready update.
  f.updater.emit("checking-for-update"); f.updater.emit("update-not-available"); f.updater.emit("error", new Error("offline"));
  assert.equal(f.result.state().status, "ready");
  const checks = f.counts.checks;
  assert.equal((await f.result.check()).status, "ready");
  assert.equal(f.counts.checks, checks, "Check for updates doesn't check again once one is ready");
  assert.equal(await f.result.install(), true);
  assert.deepEqual(asked, [true]); assert.equal(f.counts.installs, 1);
  // Squirrel.Mac can refuse the update when installing; the button goes away.
  f.updater.emit("error", new Error("Code signature did not match"));
  assert.equal(f.result.state().status, "error");
  assert.deepEqual(f.changes.map(state => state.status + (state.status === "downloading" ? " " + state.progress : "")),
    ["checking", "downloading 0", "downloading 41", "downloading 99", "ready", "error"], "Each change is broadcast once");
});

test("up to date, failed checks and a declined restart", async () => {
  const f = setup({ confirm: async () => false });
  f.start(); await tick(); await tick();
  f.updater.emit("checking-for-update"); f.updater.emit("update-not-available", { version: "1.3.0" });
  assert.equal(f.result.state().status, "upToDate");
  f.updater.emit("checking-for-update"); f.updater.emit("error", new Error("404"));
  assert.equal(f.result.state().status, "error"); assert.equal(f.counts.errors, 1);
  f.updater.emit("update-downloaded", { version: "1.4.0" });
  assert.equal(await f.result.install(), false, "Later keeps the update");
  assert.equal(f.counts.installs, 0); assert.equal(f.result.state().status, "ready");
});

test("a signed Mac build updates from GitHub's latest release, without block maps", async () => {
  const f = setup({ platform: "darwin", release: { enabled: false }, feed: { ...macFeed, url: MAC_FEED.replace(/\/$/, "") } });
  assert.equal(f.result.enabled, true); assert.equal(f.result.state().kind, "auto");
  f.start(); await tick(); await tick();
  assert.equal(f.counts.checks, 1);
  assert.equal(f.updater.autoDownload, true); assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false); assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.disableDifferentialDownload, true);
  assert.equal(f.updater.verifyUpdateCodeSignature, undefined, "Squirrel.Mac checks the Developer ID itself");
  // A Windows release configuration doesn't turn on Mac updates.
  assert.equal(setup({ platform: "darwin", macUpdates: { enabled: false } }).result.state().kind, "none");
});

test("a packaged app-update.yml that doesn't match the build turns updates off", async () => {
  const cases = [
    ["mac, other url", { platform: "darwin", feed: { ...macFeed, url: "https://github.com/someone/else/releases/latest/download/" } }],
    ["mac, other provider", { platform: "darwin", feed: { ...macFeed, provider: "github" } }],
    ["mac, other version", { platform: "darwin", version: "1.2.9" }],
    ["mac, no app-update.yml", { platform: "darwin", feed: new Error("ENOENT") }],
    ["mac, unsafe feed", { platform: "darwin", macUpdates: { ...mac, updateUrl: "http://example.com/" } }],
    ["windows, other publisher", { feed: { ...windowsFeed, publisherName: ["Someone"] } }],
    ["windows, other channel", { feed: { ...windowsFeed, channel: "beta" } }],
    ["windows, other version", { version: "1.2.9" }],
  ];
  for (const [name, options] of cases) {
    const f = setup(options);
    f.start(); await tick(); await tick();
    assert.equal(f.result.enabled, false, name);
    assert.equal(f.result.state().kind, "none", name);
    assert.equal(f.counts.errors, 1, name + " is logged");
    assert.equal(f.counts.created, 0, name + " never loads electron-updater");
    assert.equal(await f.result.install(), false, name);
  }
});

test("the Microsoft Store app never updates itself; Check for updates opens its Store page", async () => {
  const f = setup({ windowsStore: true, release: { enabled: false } });
  assert.deepEqual(f.result.state(), { kind: "store", status: "idle", version: "1.3.0", available: null, progress: 0 });
  assert.equal((await f.result.check()).kind, "store");
  assert.deepEqual(f.counts.opened, [STORE_PAGE]);
  assert.equal(await f.result.install(), false);
  f.start(); await tick();
  assert.equal(f.counts.created, 0);
  // Even a Store package that somehow carried a release feed.
  assert.equal(setup({ windowsStore: true }).result.state().kind, "store");
  const store = JSON.parse(fs.readFileSync(path.join(__dirname, "../store.json"), "utf8"));
  assert.equal(STORE_PAGE, "ms-windows-store://pdp/?ProductId=" + store.storeId);
});

test("development, preview and unsigned builds have no updates", async () => {
  for (const options of [{ packaged: false }, { packaged: false, windowsStore: true }, { release: { enabled: false } }, { platform: "darwin", packaged: false }, { platform: "linux" }]) {
    const f = setup(options);
    assert.equal(f.result.state().kind, "none", JSON.stringify(options));
    assert.equal((await f.result.check()).status, "idle");
    f.start(); await tick();
    assert.equal(f.counts.created, 0); assert.deepEqual(f.counts.opened, []); assert.equal(f.counts.errors, 0);
  }
});

test("Settings shows each update state in plain words", async () => {
  const { updateRow } = await shell;
  const auto = status => ({ kind: "auto", status, version: "1.3.0", available: "1.4.0", progress: 37 });
  assert.deepEqual(updateRow(auto("checking")), { line: "Checking…", button: "Check for updates", disabled: true });
  assert.deepEqual(updateRow(auto("downloading")), { line: "Downloading 37%", button: "Check for updates", disabled: true });
  assert.deepEqual(updateRow(auto("ready")), { line: "Version 1.4.0 is ready to install", button: "Restart to update", disabled: false });
  assert.deepEqual(updateRow(auto("upToDate")), { line: "Timewarp is up to date", button: "Check for updates", disabled: false });
  assert.deepEqual(updateRow(auto("error")), { line: "Couldn't check for updates", button: "Check for updates", disabled: false });
  assert.deepEqual(updateRow(auto("idle")), { line: "", button: "Check for updates", disabled: false });
  assert.deepEqual(updateRow({ kind: "store", status: "idle" }), { line: "Updates are installed by the Microsoft Store.", button: "Check for updates", disabled: false });
  assert.deepEqual(updateRow({ kind: "none", status: "idle" }), { line: "Updates are off in this build.", button: "Check for updates", disabled: true });
  assert.equal(updateRow(null).disabled, true);
});

const zip = (arch, version = "1.3.0") => ({ url: `Timewarp-${version}-${arch}-mac.zip`, sha512: arch + "-sha512==", size: arch === "arm64" ? 210 : 220, blockMapSize: 9 });
const info = (arch, version = "1.3.0") => ({ version, files: [zip(arch, version)], path: zip(arch, version).url, sha512: zip(arch, version).sha512, releaseDate: "2026-10-11T08:00:00.000Z" });

test("the two Mac update files merge into one latest-mac.yml, Apple Silicon first", () => {
  const expected = { version: "1.3.0", files: [zip("arm64"), zip("x64")], path: "Timewarp-1.3.0-arm64-mac.zip", sha512: "arm64-sha512==", releaseDate: "2026-10-11T12:00:00.000Z" };
  assert.deepEqual(mergeMacUpdateInfo([info("arm64"), info("x64")], expected.releaseDate), expected);
  assert.deepEqual(mergeMacUpdateInfo([info("x64"), info("arm64")], expected.releaseDate), expected, "Either order");
  assert.ok(!zip("x64").url.includes("arm64"), "An Intel Mac never takes the Apple Silicon zip");
  assert.throws(() => mergeMacUpdateInfo([info("arm64"), info("x64", "1.2.9")]), /same release version/);
  assert.throws(() => mergeMacUpdateInfo([info("arm64"), info("arm64")]), /one Apple Silicon/);
  assert.throws(() => mergeMacUpdateInfo([info("arm64")]), /Apple Silicon and the Intel/);
  assert.throws(() => mergeMacUpdateInfo([info("arm64"), { ...info("x64"), files: [{ ...zip("x64"), url: "Timewarp-1.3.0-x64.dmg" }] }]), /Mac zip/);
  assert.throws(() => mergeMacUpdateInfo([info("arm64"), { ...info("x64"), files: [{ ...zip("x64"), sha512: "" }] }]), /checksum/);
  assert.throws(() => mergeMacUpdateInfo([info("arm64"), { ...info("x64"), files: [zip("x64"), zip("x64")] }]), /one Apple Silicon/);
});

test("the merge script reads and writes YAML electron-updater can load", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-mac-update-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = ["arm64", "x64"].map(arch => { const file = path.join(directory, updateFileName(arch)); fs.writeFileSync(file, yaml.dump(info(arch))); return file; });
  const merged = yaml.load(mergeFiles(files.reverse(), "2026-10-11T12:00:00.000Z"));
  assert.deepEqual(merged.files.map(file => file.url), ["Timewarp-1.3.0-arm64-mac.zip", "Timewarp-1.3.0-x64-mac.zip"]);
  assert.equal(merged.path, "Timewarp-1.3.0-arm64-mac.zip");
  // Electron-updater's own choice for each Mac, relative to the feed.
  const { MacUpdater } = require("electron-updater/out/MacUpdater");
  const { resolveFiles, findFile } = require("electron-updater/out/providers/Provider");
  const resolved = resolveFiles(merged, new URL(MAC_FEED));
  assert.equal(findFile(MacUpdater.filterFilesForArch(resolved, true), "zip", ["pkg", "dmg"]).url.href, MAC_FEED + "Timewarp-1.3.0-arm64-mac.zip");
  assert.equal(findFile(MacUpdater.filterFilesForArch(resolved, false), "zip", ["pkg", "dmg"]).url.href, MAC_FEED + "Timewarp-1.3.0-x64-mac.zip");
  const out = path.join(directory, "latest-mac.yml");
  const run = require("node:child_process").spawnSync(process.execPath, [path.join(__dirname, "../scripts/merge-mac-update-info.cjs"), ...files, "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(yaml.load(fs.readFileSync(out, "utf8")).version, "1.3.0");
});

test("signed Mac packages add the update zip and the generic feed; drafts stay as they were", () => {
  const config = require("../mac-release.json");
  const feed = checkMacFeed({ enabled: true, version: config.version, updateUrl: config.updateUrl });
  assert.equal(feed.updateUrl, MAC_FEED);
  const common = { app: "app", output: "out", codex: "codex", version: config.version };
  const signed = builderOptions({ ...common, draft: false, config, feed });
  assert.deepEqual(signed.targets, ["dmg", "zip"]);
  assert.deepEqual(signed.config.publish, { provider: "generic", url: MAC_FEED });
  assert.equal(signed.config.dmg.writeUpdateInfo, false, "The stapled DMG stays out of latest-mac.yml");
  const name = arch => signed.config.zip.artifactName.replace("${version}", config.version).replace("${arch}", arch).replace("${ext}", "zip");
  assert.equal(name("arm64"), `Timewarp-${config.version}-arm64-mac.zip`);
  assert.equal(name("x64"), `Timewarp-${config.version}-x64-mac.zip`);
  assert.ok(!name("x64").includes("arm64"));
  assert.equal(signed.config.dmg.artifactName, "Timewarp-${version}-${arch}.${ext}", "DMG names are unchanged");
  const draft = builderOptions({ ...common, draft: true, config: null, feed: null });
  assert.deepEqual(draft.targets, ["dmg"]);
  assert.equal(draft.config.publish, null);
  assert.equal(draft.config.zip, undefined);
  assert.deepEqual(draft.config.dmg, { sign: false, artifactName: "Timewarp-Preview-${version}-${arch}.${ext}" });
  assert.equal(updateFileName("x64"), "latest-mac-x64.yml");
  for (const updateUrl of ["http://github.com/a/", "https://static.getenergy.com/mac/"]) assert.throws(() => checkMacFeed({ enabled: true, version: "1.3.0", updateUrl }), /public Timewarp/);
});
