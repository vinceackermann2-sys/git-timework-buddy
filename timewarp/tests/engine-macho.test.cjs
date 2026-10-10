"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readMachO, floor } = require("../scripts/macho-min-os.cjs");

// A minimal 64-bit Mach-O with one load command declaring the minimum macOS.
function thin(cpu, major, minor, { legacy = false } = {}) {
  const command = Buffer.alloc(legacy ? 16 : 24);
  const version = (major << 16) | (minor << 8);
  if (legacy) { command.writeUInt32LE(0x24, 0); command.writeUInt32LE(16, 4); command.writeUInt32LE(version, 8); }
  else { command.writeUInt32LE(0x32, 0); command.writeUInt32LE(24, 4); command.writeUInt32LE(1, 8); command.writeUInt32LE(version, 12); }
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(cpu, 4); header.writeUInt32LE(2, 12); header.writeUInt32LE(1, 16); header.writeUInt32LE(command.length, 20);
  return Buffer.concat([header, command, Buffer.alloc(2048)]);
}
function universal(slices) {
  const header = Buffer.alloc(8 + slices.length * 20);
  header.writeUInt32BE(0xcafebabe, 0); header.writeUInt32BE(slices.length, 4);
  let offset = 4096;
  const bodies = [];
  slices.forEach((slice, index) => { header.writeUInt32BE(offset, 8 + index * 20 + 8); header.writeUInt32BE(slice.length, 8 + index * 20 + 12); bodies.push({ offset, slice }); offset += slice.length + 4096; });
  const file = Buffer.alloc(offset);
  header.copy(file, 0);
  for (const { offset: at, slice } of bodies) slice.copy(file, at);
  return file;
}

test("minimum macOS versions are read from thin and universal binaries", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-macho-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "app"), thin(0x0100000c, 12, 0));
  fs.writeFileSync(path.join(root, "old-tool"), thin(0x01000007, 10, 12, { legacy: true }));
  fs.writeFileSync(path.join(root, "both"), universal([thin(0x01000007, 11, 0), thin(0x0100000c, 13, 3)]));
  fs.writeFileSync(path.join(root, "notes.txt"), "not a binary ".repeat(200));
  assert.deepEqual(readMachO(path.join(root, "app")), [{ arch: "arm64", minimum: "12.0" }]);
  assert.deepEqual(readMachO(path.join(root, "old-tool")), [{ arch: "x64", minimum: "10.12" }]);
  assert.deepEqual(readMachO(path.join(root, "both")), [{ arch: "x64", minimum: "11.0" }, { arch: "arm64", minimum: "13.3" }]);
  assert.equal(readMachO(path.join(root, "notes.txt")), null);
  const result = floor([root]);
  assert.equal(result.byArch.arm64.minimum, "13.3");
  assert.equal(result.byArch.x64.minimum, "11.0");
});
