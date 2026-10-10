"use strict";
// Locates the official Codex distribution: next to the packaged app, or in the
// platform package installed from npm during development.
const crypto = require("node:crypto");
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

// A Microsoft Store install lives in WindowsApps, where sandboxed commands
// can't start programs. Its launchers (ripgrep) are copied into the Codex home
// under a folder named by their hash, and checked before each use.
function copyLaunchers(source, home) {
  const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  const files = fs.readdirSync(source).filter(name => /\.exe$/i.test(name) && fs.lstatSync(path.join(source, name)).isFile())
    .map(name => ({ name, bytes: fs.readFileSync(path.join(source, name)) }));
  if (!files.length) return source;
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(file.name).update(digest(file.bytes));
  const base = path.join(home, ".local", "timewarp-launchers"), target = path.join(base, hash.digest("hex"));
  fs.mkdirSync(target, { recursive: true });
  if (fs.lstatSync(target).isSymbolicLink() || path.dirname(fs.realpathSync(target)) !== fs.realpathSync(base)) throw new Error("Invalid launcher folder.");
  for (const { name, bytes } of files) {
    const destination = path.join(target, name);
    if (fs.existsSync(destination)) {
      const stat = fs.lstatSync(destination);
      if (!stat.isFile() || stat.isSymbolicLink() || digest(fs.readFileSync(destination)) !== digest(bytes)) throw new Error("A copied launcher was changed: " + name);
      continue;
    }
    try { fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST" || digest(fs.readFileSync(destination)) !== digest(bytes)) throw error; }
  }
  return target;
}

// Codex looks for its helper programs (sandbox setup, ripgrep) on PATH.
function codexEnv(root = vendorRoot(), env = process.env, { home = null, store = !!process.windowsStore, platform = process.platform } = {}) {
  const bundled = path.join(root, "codex-path");
  const launchers = store && home && platform === "win32" && fs.existsSync(bundled) ? copyLaunchers(bundled, home) : bundled;
  const extra = [launchers, path.join(root, "codex-resources")].filter(dir => fs.existsSync(dir));
  // Windows spells it Path; a second spelling would make the child's PATH ambiguous.
  const key = Object.keys(env).find(name => name.toUpperCase() === "PATH") || "PATH";
  return { [key]: [...extra, env[key] || ""].join(path.delimiter) };
}

module.exports = { vendorRoot, codexExecutable, codexEnv };
