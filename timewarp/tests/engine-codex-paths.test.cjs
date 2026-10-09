"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { codexEnv } = require("../app/main/codex-paths.cjs");

test("Store installs run Codex's launchers from a verified copy outside WindowsApps", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-codex-paths-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vendor = path.join(root, "WindowsApps", "codex"), home = path.join(root, "codex-home");
  fs.mkdirSync(path.join(vendor, "codex-path"), { recursive: true });
  fs.mkdirSync(path.join(vendor, "codex-resources"), { recursive: true });
  fs.writeFileSync(path.join(vendor, "codex-path", "rg.exe"), "ripgrep");
  const direct = codexEnv(vendor, { Path: "C:\Windows" }, { home, store: false, platform: "win32" });
  assert.ok(direct.Path.startsWith(path.join(vendor, "codex-path")), "Other installs use the bundled launchers");
  assert.equal(Object.keys(direct).length, 1, "Windows keeps one PATH spelling");
  const store = codexEnv(vendor, { Path: "C:\Windows" }, { home, store: true, platform: "win32" });
  const first = store.Path.split(path.delimiter)[0];
  assert.ok(first.startsWith(path.join(home, ".local", "timewarp-launchers")), first);
  assert.equal(fs.readFileSync(path.join(first, "rg.exe"), "utf8"), "ripgrep");
  assert.ok(store.Path.includes(path.join(vendor, "codex-resources")));
});
