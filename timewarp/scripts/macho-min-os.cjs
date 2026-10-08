"use strict";
// Reads the minimum macOS version each Mach-O binary declares (LC_BUILD_VERSION
// or LC_VERSION_MIN_MACOSX), for thin and universal files. The highest one in
// an app is the oldest macOS it can run on.
// Usage: node scripts/macho-min-os.cjs <file-or-folder>...
const fs = require("node:fs");
const path = require("node:path");

const LC_BUILD_VERSION = 0x32, LC_VERSION_MIN_MACOSX = 0x24, PLATFORM_MACOS = 1;
const CPU = { 0x01000007: "x64", 0x0100000c: "arm64", 7: "x86", 12: "arm" };
const versionOf = value => `${value >>> 16}.${(value >>> 8) & 0xff}${value & 0xff ? "." + (value & 0xff) : ""}`;
const compare = (a, b) => { const [x, y] = [a, b].map(value => value.split(".").map(Number)); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

// One architecture slice starting at `offset`.
function slice(buffer, offset) {
  const magic = buffer.readUInt32LE(offset);
  if (magic !== 0xfeedfacf && magic !== 0xfeedface) return null;
  const is64 = magic === 0xfeedfacf, cpu = buffer.readUInt32LE(offset + 4), commands = buffer.readUInt32LE(offset + 16);
  let cursor = offset + (is64 ? 32 : 28);
  for (let index = 0; index < commands && cursor + 8 <= buffer.length; index++) {
    const command = buffer.readUInt32LE(cursor), size = buffer.readUInt32LE(cursor + 4);
    if (command === LC_BUILD_VERSION && buffer.readUInt32LE(cursor + 8) === PLATFORM_MACOS) return { arch: CPU[cpu] || cpu.toString(16), minimum: versionOf(buffer.readUInt32LE(cursor + 12)) };
    if (command === LC_VERSION_MIN_MACOSX) return { arch: CPU[cpu] || cpu.toString(16), minimum: versionOf(buffer.readUInt32LE(cursor + 8)) };
    if (size < 8) break;
    cursor += size;
  }
  return { arch: CPU[cpu] || cpu.toString(16), minimum: null };
}

function readMachO(file) {
  const handle = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(4);
    if (fs.readSync(handle, head, 0, 4, 0) < 4) return null;
    const big = head.readUInt32BE(0), little = head.readUInt32LE(0);
    if (big !== 0xcafebabe && big !== 0xcafebabf && little !== 0xfeedfacf && little !== 0xfeedface) return null;
    const buffer = fs.readFileSync(file);
    if (big === 0xcafebabe || big === 0xcafebabf) {
      const wide = big === 0xcafebabf, count = buffer.readUInt32BE(4), slices = [];
      if (count > 16) return null; // Java class files share this magic
      for (let index = 0; index < count; index++) {
        const entry = 8 + index * (wide ? 32 : 20);
        const offset = wide ? Number(buffer.readBigUInt64BE(entry + 8)) : buffer.readUInt32BE(entry + 8);
        const found = slice(buffer, offset);
        if (found) slices.push(found);
      }
      return slices;
    }
    return [slice(buffer, 0)].filter(Boolean);
  } finally { fs.closeSync(handle); }
}

function scan(target, results = []) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return results;
  if (stat.isDirectory()) { for (const entry of fs.readdirSync(target)) scan(path.join(target, entry), results); return results; }
  const slices = stat.size > 1024 ? readMachO(target) : null;
  if (slices?.length) results.push({ file: target, slices });
  return results;
}

// The oldest macOS every binary under the given paths supports, per arch.
function floor(targets) {
  const binaries = targets.flatMap(target => scan(target));
  const byArch = {};
  for (const binary of binaries) for (const item of binary.slices) {
    if (!item.minimum) continue;
    const current = byArch[item.arch];
    if (!current || compare(item.minimum, current.minimum) > 0) byArch[item.arch] = { minimum: item.minimum, file: binary.file };
  }
  return { binaries, byArch };
}

module.exports = { readMachO, scan, floor, compare };

if (require.main === module) {
  const targets = process.argv.slice(2);
  if (!targets.length) { console.log("Usage: node scripts/macho-min-os.cjs <file-or-folder>..."); process.exit(0); }
  const result = floor(targets);
  for (const binary of result.binaries) console.log(binary.slices.map(item => `${item.arch} ${item.minimum || "?"}`).join(", ").padEnd(28), path.relative(process.cwd(), binary.file));
  for (const [arch, item] of Object.entries(result.byArch)) console.log(`Oldest supported macOS for ${arch}: ${item.minimum} (set by ${path.basename(item.file)})`);
}
