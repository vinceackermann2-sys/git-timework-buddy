"use strict";
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const launchers = ['browser.exe', 'nango.exe', 'rg.exe'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Restricted Windows child processes cannot execute the CLI shims from an
// MSIX WindowsApps directory. Materialize only the shipped, hash-verified
// launchers in the harness home before spawning Codex. Keep their names:
// the browser/nango multicall binary dispatches using its executable basename.
// This changes neither sandbox permissions nor the authenticated tool gateway.
function prepareHarnessPath(packageRoot, home, platform = process.platform) {
  const source = path.join(packageRoot, 'codex-path');
  if (platform !== 'win32' || !fs.existsSync(source)) return source;
  const files = launchers.filter(name => fs.existsSync(path.join(source, name)))
    .map(name => ({ name, bytes: fs.readFileSync(path.join(source, name)) }));
  if (!files.length) return source;
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file.name).update(digest(file.bytes));
  const base = path.join(home, '.local', 'timewarp-launchers');
  fs.mkdirSync(base, { recursive: true });
  const target = path.join(base, hash.digest('hex'));
  fs.mkdirSync(target, { recursive: true });
  if (fs.lstatSync(target).isSymbolicLink() || path.dirname(fs.realpathSync(target)) !== fs.realpathSync(base)) {
    throw Error('Invalid harness launcher directory.');
  }
  for (const { name, bytes } of files) {
    const destination = path.join(target, name);
    if (fs.existsSync(destination)) {
      if (!fs.lstatSync(destination).isFile() || fs.lstatSync(destination).isSymbolicLink() || digest(fs.readFileSync(destination)) !== digest(bytes)) {
        throw Error('Harness launcher integrity check failed: ' + name);
      }
      continue;
    }
    try { fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o700 }); }
    catch (error) {
      // Another app process may have prepared the same immutable version.
      if (error.code !== 'EEXIST' || !fs.lstatSync(destination).isFile() || digest(fs.readFileSync(destination)) !== digest(bytes)) throw error;
    }
  }
  // Keep an explicitly installed compatibility repair current after an app
  // upgrade. Do not create or modify users' other environment overrides.
  const config = path.join(home, 'config.toml');
  if (fs.existsSync(config)) {
    const before = fs.readFileSync(config, 'utf8');
    const pattern = /(# Timewarp WindowsApps launcher repair\r?\n\[shell_environment_policy\.set\]\r?\nPATH = )("[^\r\n]*")/;
    const match = pattern.exec(before);
    if (match) {
      const current = JSON.parse(match[2]), end = current.indexOf(';');
      if (end > 0 && current.slice(0, end).startsWith(base + path.sep)) {
        const next = target + current.slice(end);
        if (current !== next) fs.writeFileSync(config, before.replace(pattern, (_all, prefix) => prefix + JSON.stringify(next)));
      }
    }
  }
  return target;
}
module.exports = { prepareHarnessPath };
