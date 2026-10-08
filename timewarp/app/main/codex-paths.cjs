"use strict";
// Locates the official Codex distribution: next to the packaged app, or in the
// platform package installed from npm during development.
const fs = require("node:fs");
const path = require("node:path");

function vendorRoot(packaged = !!process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, "codex"))) {
  if (packaged) return path.join(process.resourcesPath, "codex");
  const name = `@openai/codex-${process.platform}-${process.arch}`;
  const vendor = path.join(path.dirname(require.resolve(`${name}/package.json`)), "vendor");
  const [triple] = fs.readdirSync(vendor).filter(entry => fs.statSync(path.join(vendor, entry)).isDirectory());
  if (!triple) throw new Error("The Codex runtime is missing from " + name + ".");
  return path.join(vendor, triple);
}

function codexExecutable(root = vendorRoot()) {
  return path.join(root, "bin", process.platform === "win32" ? "codex.exe" : "codex");
}

// Codex looks for its helper programs (sandbox setup, ripgrep) on PATH.
function codexEnv(root = vendorRoot(), env = process.env) {
  const extra = [path.join(root, "codex-path"), path.join(root, "codex-resources")].filter(dir => fs.existsSync(dir));
  // Windows spells it Path; a second spelling would make the child's PATH ambiguous.
  const key = Object.keys(env).find(name => name.toUpperCase() === "PATH") || "PATH";
  return { [key]: [...extra, env[key] || ""].join(path.delimiter) };
}

module.exports = { vendorRoot, codexExecutable, codexEnv };
