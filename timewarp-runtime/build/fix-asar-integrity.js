"use strict";
// Keeps the exe's embedded asar-integrity resource in sync with the repacked
// app.asar.
//
// electron-builder bakes
//   ELECTRONASARINTEGRITY -> [{"file":"resources\\app.asar","alg":"SHA256","value":"<hex>"}]
// into the executable's PE resources. Electron recomputes that hash at boot and
// aborts on mismatch, so any repack of app.asar must update this string or the
// app will not start. Both hashes are 64 hex chars, so the substitution is
// length-preserving and the PE layout does not need adjusting.
//
// Usage: node fix-asar-integrity.js <exe> <asar>

const fs = require("fs");
const crypto = require("crypto");

const exePath = process.argv[2];
const asarPath = process.argv[3];

if (!exePath || !asarPath) {
  console.error("usage: node fix-asar-integrity.js <exe> <asar>");
  process.exit(1);
}

// Electron hashes the asar *header JSON only*, not the payload: bytes
// [16, 16 + u32@12), where the uint32 at offset 12 is the real JSON length
// (offset 8 holds the length including the pickle's trailing alignment
// padding). Verified to reproduce both the value Energy 0.8.20 shipped
// (19c9c129...) and the value Electron computed for a fresh repack.
function electronAsarHash(buf) {
  const jsonLength = buf.readUInt32LE(12);
  return crypto.createHash("sha256").update(buf.slice(16, 16 + jsonLength)).digest("hex");
}

const asar = fs.readFileSync(asarPath);
const want = electronAsarHash(asar);
const wholeFile = crypto.createHash("sha256").update(asar).digest("hex");
console.log(`asar            : ${asarPath}`);
console.log(`electron hash   : ${want}`);
console.log(`whole-file hash : ${wholeFile}`);

// Work purely on Buffers. Round-tripping a 225 MB binary through a JS string
// and back corrupts it (Buffer.from(string) defaults to utf8), which turns the
// PE into an unloadable image.
const exe = fs.readFileSync(exePath);

// Anchor on the full resource payload rather than a bare `"value":"` so we
// cannot latch onto an unrelated JSON blob elsewhere in the binary.
const marker = Buffer.from('[{"file":"resources\\\\app.asar","alg":"SHA256","value":"', "latin1");
const at = exe.indexOf(marker);
if (at < 0) {
  console.error("ELECTRONASARINTEGRITY resource not found in the exe");
  process.exit(3);
}
const start = at + marker.length;
const current = exe.slice(start, start + 64).toString("latin1");
if (!/^[0-9a-f]{64}$/.test(current)) {
  console.error(`unexpected integrity value at ${start}: ${current}`);
  process.exit(2);
}

// Same length in, same length out: the PE resource layout is unchanged.
exe.write(want, start, 64, "latin1");
console.log(`embedded hash   : ${current}`);
console.log(`new embedded    : ${want}`);
fs.writeFileSync(exePath, exe);
console.log(`wrote ${exePath}`);