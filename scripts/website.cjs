"use strict";
// Call the export step explicitly so npm and Bun prepare the same hosted files.
require("./sync-website.cjs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const result = spawnSync(process.execPath, [
  path.join(root, "node_modules/vite/bin/vite.js"), ...process.argv.slice(2),
], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
