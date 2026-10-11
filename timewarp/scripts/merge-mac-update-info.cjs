"use strict";
// Merges the two Mac builds' update files (latest-mac-arm64.yml and
// latest-mac-x64.yml, one per CI job) into the latest-mac.yml published with
// the GitHub release. Electron-updater on an Apple Silicon Mac picks the file
// with "arm64" in its name; an Intel Mac takes the other.
//   node scripts/merge-mac-update-info.cjs <latest-mac-arm64.yml> <latest-mac-x64.yml> [--out latest-mac.yml]
const fs = require("node:fs");
const yaml = require("js-yaml");

function mergeMacUpdateInfo(infos, releaseDate = new Date().toISOString()) {
  if (infos.length !== 2) throw new Error("Merge the Apple Silicon and the Intel update files.");
  const version = infos[0]?.version;
  if (!/^\d+\.\d+\.\d+$/.test(String(version)) || infos.some(info => info?.version !== version)) throw new Error("Both update files need the same release version.");
  const files = infos.flatMap(info => Array.isArray(info.files) ? info.files : []);
  for (const file of files) {
    if (typeof file?.url !== "string" || !/^[\w.-]+-mac\.zip$/.test(file.url) || typeof file.sha512 !== "string" || !file.sha512 || !(file.size > 0)) throw new Error("Each update file lists one Mac zip with its checksum and size.");
    if (!file.url.includes(version)) throw new Error(`${file.url} isn't the ${version} zip.`);
  }
  const arm64 = files.filter(file => file.url.includes("arm64")), intel = files.filter(file => !file.url.includes("arm64"));
  if (files.length !== 2 || arm64.length !== 1 || intel.length !== 1) throw new Error("Expected one Apple Silicon (arm64) zip and one Intel zip.");
  // path and sha512 are read by older updaters; they name the Apple Silicon zip.
  return { version, files: [arm64[0], intel[0]], path: arm64[0].url, sha512: arm64[0].sha512, releaseDate };
}

const dump = info => yaml.dump(info, { lineWidth: -1, noRefs: true });
const mergeFiles = (paths, releaseDate) => dump(mergeMacUpdateInfo(paths.map(file => yaml.load(fs.readFileSync(file, "utf8"))), releaseDate));

if (require.main === module) {
  try {
    const args = process.argv.slice(2), at = args.indexOf("--out");
    const out = at >= 0 ? args[at + 1] : null, inputs = args.filter((_, index) => at < 0 || (index !== at && index !== at + 1));
    if (inputs.length !== 2 || (at >= 0 && !out)) throw new Error("Usage: node scripts/merge-mac-update-info.cjs <latest-mac-arm64.yml> <latest-mac-x64.yml> [--out latest-mac.yml]");
    const text = mergeFiles(inputs);
    if (out) { fs.writeFileSync(out, text); console.log("Wrote " + out + "."); }
    else process.stdout.write(text);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { mergeMacUpdateInfo, mergeFiles };
