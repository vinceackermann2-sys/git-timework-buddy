"use strict";
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const inputRoot = () => path.resolve(process.env.TIMEWARP_UPSTREAM_DIR || path.join(root, '../timewarp-runtime'));
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function inputFile(base, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..') || /[:\0]/.test(relative)) throw new Error('Invalid upstream input path.');
  const file = path.resolve(base, relative), actualBase = fs.realpathSync(base), actual = fs.realpathSync(file);
  if (!actual.startsWith(actualBase + path.sep) || !fs.statSync(actual).isFile()) throw new Error('Upstream input escapes its directory: ' + relative);
  return actual;
}
function validateLock(lock) {
  if (lock.format !== 1 || lock.platform !== 'win32' || lock.arch !== 'x64' || !Array.isArray(lock.files) || !lock.files.length) throw new Error('Invalid upstream lock.');
  const seen = new Set();
  for (const entry of [lock.archive, lock.executable, ...lock.files]) {
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || typeof entry.path !== 'string') throw new Error('Invalid upstream hash entry.');
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate upstream input: ' + entry.path);
    seen.add(key);
  }
  return lock;
}
function verifyUpstream(base = inputRoot(), lock = require('../upstream-lock.json')) {
  validateLock(lock);
  for (const entry of [lock.archive, lock.executable, ...lock.files]) {
    const file = inputFile(base, entry.path);
    if (fs.statSync(file).size !== entry.bytes || hash(file) !== entry.sha256) throw new Error('Upstream integrity check failed: ' + entry.path);
  }
  return { base, lock, archive: inputFile(base, lock.archive.path), executable: inputFile(base, lock.executable.path) };
}
function copyRuntime(inputs, destination) {
  // Copy only the reviewed inventory. Stray archives, update feeds, logs and
  // device state in a supplied distribution cannot enter a release.
  for (const entry of inputs.lock.files) {
    if (!entry.path.startsWith('app/')) throw new Error('Runtime input must be under app/.');
    const source = inputFile(inputs.base, entry.path);
    const target = path.join(destination, entry.path.slice(4));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}
module.exports = { hash, inputFile, inputRoot, validateLock, verifyUpstream, copyRuntime };
if (require.main === module) { const { lock } = verifyUpstream(); console.log(`Verified ${lock.productVersion} upstream: archive, executable and ${lock.files.length} runtime files.`); }
