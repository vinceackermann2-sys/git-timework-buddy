"use strict";
// Whether 1Password is on this computer and its command-line tool has an
// account, for the home screen's "Set up 1Password" suggestion, as before.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function appPaths(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === "darwin") return ["/Applications/1Password.app", path.join(home, "Applications", "1Password.app")];
  if (platform === "win32") return [
    path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "1Password", "app", "8", "1Password.exe"),
    path.join(env.ProgramFiles || "C:\\Program Files", "1Password", "app", "8", "1Password.exe"),
  ];
  return ["/opt/1Password/1password", "/usr/bin/1password"];
}

// { installed, configured }: configured once `op account list` names an
// account. A missing command line tool leaves it unconfigured.
function onePasswordSetup({ run = execFile, exists = fs.existsSync, platform = process.platform } = {}) {
  const installed = appPaths(platform).some(file => { try { return exists(file); } catch { return false; } });
  return new Promise(resolve => {
    run("op", ["account", "list", "--format=json"], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) { resolve({ installed: installed || error.code !== "ENOENT", configured: false }); return; }
      let accounts = [];
      try { accounts = JSON.parse(String(stdout || "[]")); } catch {}
      resolve({ installed: true, configured: Array.isArray(accounts) && accounts.length > 0 });
    });
  });
}

module.exports = { onePasswordSetup, appPaths };
