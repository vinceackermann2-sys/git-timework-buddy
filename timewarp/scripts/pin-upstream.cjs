"use strict";
// Deliberate vendor-input maintenance operation; never run automatically in a build.
const fs = require('node:fs'), path = require('node:path');
const { inputRoot, inputFile, hash } = require('./upstream.cjs');
const base = inputRoot();
function entry(relative) { const file = inputFile(base, relative); return { path: relative, bytes: fs.statSync(file).size, sha256: hash(file) }; }
const files = [];
function visit(relative) {
  for (const item of fs.readdirSync(path.join(base, relative), { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    const name = relative + '/' + item.name;
    if (item.isSymbolicLink()) throw new Error('Upstream symlinks are not permitted.');
    if (item.isDirectory()) visit(name);
    else if (item.isFile() && !/\.(?:exe|log)$/i.test(name.slice(4)) && name !== 'app/resources/app.asar' && name !== 'app/resources/app-update.yml') files.push(entry(name));
    // Root executable is replaced with the pinned pristine input; bundled
    // executable tools under resources are retained below.
    else if (item.isFile() && name.startsWith('app/resources/') && /\.exe$/i.test(name)) files.push(entry(name));
  }
}
visit('app');
const lock = { format: 1, productVersion: '0.8.20', electronVersion: '43.2.0', platform: 'win32', arch: 'x64', archive: entry('build/app.asar.pristine'), executable: entry('upstream.exe'), files };
fs.writeFileSync(path.resolve(__dirname, '../upstream-lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log(`Pinned ${files.length} runtime files. Review the lock diff and vendor provenance before accepting new inputs.`);
