"use strict";
// The previous app kept each user's memory in a small Git repository:
// runtime/personal-memory/<standard|private>/personal-memory-<sha256(user id)>.git
// (private while Privacy Mode was on), branch main, with memory/**/*.md. On a
// user's first start, Timewarp copies the newest of those into its own memory
// folder. Git isn't needed: this reads the repository's files directly (loose
// objects and pack files, with deltas). The repository is only ever read.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { PREVIOUS_APP, placeholderNotes } = require("./knowledge.cjs");

const MAX_FILES = 2000, MAX_FILE = 16 * 1024 * 1024, MAX_TOTAL = 64 * 1024 * 1024, MAX_DEPTH = 16, MAX_DELTA_CHAIN = 64;
const TYPES = { 1: "commit", 2: "tree", 3: "blob", 4: "tag" };
const fail = message => Object.assign(new Error(message), { code: "invalid-repository" });
const isHash = value => /^[0-9a-f]{40}$/.test(value);

// A Git object as { type, data }, from a loose file or a pack.
function createObjectReader(gitDir) {
  const objects = path.join(gitDir, "objects");
  let packs = null;
  function loadPacks() {
    if (packs) return packs;
    packs = [];
    const folder = path.join(objects, "pack");
    let names = [];
    try { names = fs.readdirSync(folder).filter(name => name.endsWith(".idx")); } catch {}
    for (const name of names) {
      const index = fs.readFileSync(path.join(folder, name));
      const pack = path.join(folder, name.slice(0, -4) + ".pack");
      if (!fs.existsSync(pack)) continue;
      // Version 2 index: magic, version, 256 fan-out counts, hashes, CRCs, offsets, large offsets.
      if (index.readUInt32BE(0) !== 0xff744f63 || index.readUInt32BE(4) !== 2) throw fail("Unsupported pack index.");
      const count = index.readUInt32BE(8 + 255 * 4);
      packs.push({ index, count, file: pack, data: null });
    }
    return packs;
  }
  function packOffset(pack, hash) {
    const { index, count } = pack;
    const want = Buffer.from(hash, "hex"), first = want[0];
    let low = first ? index.readUInt32BE(8 + (first - 1) * 4) : 0, high = index.readUInt32BE(8 + first * 4);
    const hashes = 8 + 256 * 4;
    while (low < high) {
      const middle = (low + high) >> 1, order = Buffer.compare(want, index.subarray(hashes + middle * 20, hashes + middle * 20 + 20));
      if (order === 0) {
        const offsets = hashes + count * 24;
        const value = index.readUInt32BE(offsets + middle * 4);
        if (!(value & 0x80000000)) return value;
        const large = offsets + count * 4 + (value & 0x7fffffff) * 8;
        return Number(index.readBigUInt64BE(large));
      }
      if (order < 0) high = middle; else low = middle + 1;
    }
    return -1;
  }
  function readPacked(pack, offset, depth = 0) {
    if (depth > MAX_DELTA_CHAIN) throw fail("A pack delta chain is too long.");
    pack.data ||= fs.readFileSync(pack.file);
    const data = pack.data;
    let position = offset, byte = data[position++];
    const type = (byte >> 4) & 7;
    let size = byte & 15, shift = 4;
    while (byte & 0x80) { byte = data[position++]; size += (byte & 0x7f) * 2 ** shift; shift += 7; }
    if (size > MAX_FILE) throw fail("An object is too large.");
    if (type === 6 || type === 7) {
      let base;
      if (type === 6) {
        byte = data[position++];
        let distance = byte & 0x7f;
        while (byte & 0x80) { byte = data[position++]; distance = (distance + 1) * 128 + (byte & 0x7f); }
        base = readPacked(pack, offset - distance, depth + 1);
      } else {
        base = read(data.subarray(position, position + 20).toString("hex"), depth + 1);
        position += 20;
      }
      return { type: base.type, data: applyDelta(base.data, zlib.inflateSync(data.subarray(position))) };
    }
    if (!TYPES[type]) throw fail("Unknown pack object type.");
    return { type: TYPES[type], data: zlib.inflateSync(data.subarray(position)) };
  }
  function read(hash, depth = 0) {
    if (!isHash(hash)) throw fail("Invalid object name.");
    const loose = path.join(objects, hash.slice(0, 2), hash.slice(2));
    if (fs.existsSync(loose)) {
      const raw = zlib.inflateSync(fs.readFileSync(loose));
      const space = raw.indexOf(0x20), nul = raw.indexOf(0);
      if (space < 0 || nul < space) throw fail("Invalid loose object.");
      return { type: raw.subarray(0, space).toString(), data: raw.subarray(nul + 1) };
    }
    for (const pack of loadPacks()) {
      const offset = packOffset(pack, hash);
      if (offset >= 0) return readPacked(pack, offset, depth);
    }
    throw fail("Missing object " + hash.slice(0, 8) + ".");
  }
  return { read };
}

// Git's delta format: base and result sizes, then copy and insert instructions.
function applyDelta(base, delta) {
  let position = 0;
  const varint = () => { let value = 0, shift = 0, byte; do { byte = delta[position++]; value += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80); return value; };
  if (varint() !== base.length) throw fail("A delta doesn't match its base.");
  const size = varint();
  if (size > MAX_FILE) throw fail("An object is too large.");
  const out = Buffer.alloc(size);
  let written = 0;
  while (position < delta.length) {
    const op = delta[position++];
    if (op & 0x80) {
      let offset = 0, length = 0;
      for (let bit = 0; bit < 4; bit++) if (op & (1 << bit)) offset += delta[position++] * 2 ** (8 * bit);
      for (let bit = 0; bit < 3; bit++) if (op & (1 << (4 + bit))) length += delta[position++] * 2 ** (8 * bit);
      if (!length) length = 0x10000;
      if (offset + length > base.length || written + length > size) throw fail("A delta copies outside its base.");
      base.copy(out, written, offset, offset + length);
      written += length;
    } else if (op) {
      if (written + op > size || position + op > delta.length) throw fail("A delta inserts too much.");
      delta.copy(out, written, position, position + op);
      written += op; position += op;
    } else throw fail("Invalid delta instruction.");
  }
  if (written !== size) throw fail("A delta has the wrong size.");
  return out;
}

function resolveRef(gitDir, ref) {
  try { const value = fs.readFileSync(path.join(gitDir, ...ref.split("/")), "utf8").trim(); if (isHash(value)) return value; } catch {}
  try {
    for (const line of fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8").split(/\r?\n/)) {
      const [hash, name] = line.trim().split(" ");
      if (name === ref && isHash(hash)) return hash;
    }
  } catch {}
  return null;
}

// A tree entry's name that is safe to write under a folder on any platform.
const safeName = name => !!name && name !== "." && name !== ".." && !/[\\/:*?"<>|\x00-\x1f]/.test(name);

// The files of a branch: { commit, time (ms), files: { "memory/user.md": Buffer } }.
// prefix limits which files are read; Markdown only.
function readBranch(gitDir, { ref = "refs/heads/main", prefix = "memory/" } = {}) {
  const commit = resolveRef(gitDir, ref);
  if (!commit) return null;
  const objects = createObjectReader(gitDir);
  const head = objects.read(commit);
  if (head.type !== "commit") throw fail("The branch doesn't point to a commit.");
  const text = head.data.toString("utf8");
  const tree = /^tree ([0-9a-f]{40})$/m.exec(text)?.[1];
  const committed = /^committer .* (\d+) [+-]\d{4}$/m.exec(text)?.[1];
  if (!tree) throw fail("The commit has no tree.");
  const files = {};
  let count = 0, total = 0;
  const walk = (hash, folder, depth) => {
    if (depth > MAX_DEPTH) return;
    const { type, data } = objects.read(hash);
    if (type !== "tree") return;
    for (let position = 0; position < data.length; ) {
      const space = data.indexOf(0x20, position), nul = data.indexOf(0, space);
      if (space < 0 || nul < 0) throw fail("Invalid tree.");
      const mode = data.subarray(position, space).toString(), name = data.subarray(space + 1, nul).toString("utf8");
      const entry = data.subarray(nul + 1, nul + 21).toString("hex");
      position = nul + 21;
      if (!safeName(name)) continue;
      const full = folder + name;
      if (mode === "40000") {
        if (prefix.startsWith(full + "/") || full.startsWith(prefix)) walk(entry, full + "/", depth + 1);
      } else if (/^100(644|755)$/.test(mode) && full.startsWith(prefix) && /\.md$/i.test(name)) {
        if (++count > MAX_FILES) throw fail("The memory has too many files.");
        const blob = objects.read(entry);
        if (blob.type !== "blob") continue;
        total += blob.data.length;
        if (total > MAX_TOTAL) throw fail("The memory is too large.");
        files[full] = blob.data;
      }
    }
  };
  walk(tree, "", 0);
  return { commit, time: committed ? Number(committed) * 1000 : 0, files };
}

const storeName = userId => `personal-memory-${crypto.createHash("sha256").update(String(userId)).digest("hex")}.git`;
// A memory file with something in it: not empty and not the placeholder notes.
const meaningful = (file, data) => {
  const text = data.toString("utf8");
  return file === "memory/user.md" ? !placeholderNotes(text) : !!text.trim();
};

// The previous app's memory for a user: the newer of its standard and private
// stores that has anything in it, or null.
function findLegacyMemory(runtimeDir, userId) {
  const found = [];
  for (const kind of ["standard", "private"]) {
    const gitDir = path.join(runtimeDir, "personal-memory", kind, storeName(userId));
    if (!fs.existsSync(gitDir)) continue;
    const branch = readBranch(gitDir);
    if (!branch) continue;
    const files = Object.entries(branch.files).filter(([file, data]) => meaningful(file, data));
    if (files.length) found.push({ kind, gitDir, time: branch.time, commit: branch.commit, files });
  }
  return found.sort((a, b) => b.time - a.time)[0] || null;
}

// Copies the previous app's memory once per user: its notes become the
// user's notes while those hold nothing yet (otherwise they are kept beside
// the other files), and every other file goes to memories/imports/timewarp-previous.
// settings: the store's settings, which remember who was imported.
function importLegacyMemory({ runtimeDir, userId, knowledge, settings, log = () => {} }) {
  if (!userId) return null;
  const key = crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 32);
  const done = settings.get("legacyMemoryImports", {}) || {};
  if (done[key]) return null;
  const legacy = findLegacyMemory(runtimeDir, userId);
  const result = { files: 0, notes: false, store: legacy?.kind || null };
  for (const [file, data] of legacy?.files || []) {
    const relative = file.slice("memory/".length);
    if (relative === "user.md" && knowledge.notesArePlaceholder()) { knowledge.adoptNotes(data.toString("utf8")); result.notes = true; }
    else knowledge.saveImport(PREVIOUS_APP, relative, data);
    result.files++;
  }
  settings.set("legacyMemoryImports", { ...done, [key]: { at: new Date().toISOString(), ...result } });
  if (legacy) log(`Imported ${result.files} memory file(s) from the previous app's ${legacy.kind} memory.`);
  return result;
}

module.exports = { readBranch, findLegacyMemory, importLegacyMemory, applyDelta, storeName };
