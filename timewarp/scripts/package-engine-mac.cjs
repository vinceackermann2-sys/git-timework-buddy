"use strict";
// Packages the Timewarp engine for macOS from Timewarp's own source, for Apple
// Silicon and Intel Macs on macOS 12 Monterey or later (including Macs running
// newer macOS through OpenCore Legacy Patcher). Runs on macOS.
//   node scripts/package-engine-mac.cjs --draft [--arch arm64|x64|both]   ad-hoc signed preview DMGs
//   node scripts/package-engine-mac.cjs [--arch arm64|x64|both]           Developer ID signed, notarized DMGs (mac-release.json)
// Every DMG's app is checked: no binary needs a newer macOS than the declared
// minimum, and the packaged app starts and runs a conversation (smoke test,
// on the matching Mac only). Signed builds also make the update for that
// architecture: Timewarp-<version>-<arch>-mac.zip and latest-mac-<arch>.yml
// (scripts/merge-mac-update-info.cjs joins the two into latest-mac.yml).
// Nothing is uploaded or published.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");
const draft = process.argv.includes("--draft");
const archArg = process.argv.indexOf("--arch");
const requested = archArg > 0 ? process.argv[archArg + 1] : process.arch;
const ARCHES = requested === "both" ? ["arm64", "x64"] : [requested];
// Electron 43 runs on macOS 12 and later; Codex itself needs 10.12 (Intel) or 11.0.
const MINIMUM_MACOS = "12.0";
// Codex extras Timewarp doesn't use: a zsh build for an experimental shell
// feature (macOS 15) and the live voice host (macOS 14). Dictation uses
// Timewarp's own transcription.
const UNUSED_CODEX = ["codex-resources/zsh", "codex-resources/voice"];

function clean(directory) {
  if (!fs.existsSync(directory)) return;
  if (!fs.realpathSync(directory).startsWith(fs.realpathSync(path.join(root, "build")) + path.sep)) throw new Error("Unsafe packaging path: " + directory);
  fs.rmSync(directory, { recursive: true, force: true });
}

// The official Codex runtime for a Mac architecture, from npm.
function codexVendor(arch) {
  const version = require("@openai/codex/package.json").version;
  let directory;
  try { directory = path.join(path.dirname(require.resolve(`@openai/codex-darwin-${arch}/package.json`)), "vendor"); }
  catch {
    // Building for the other architecture: fetch its package into build/.
    const download = path.join(root, "build", "engine", `codex-darwin-${arch}`);
    clean(download); fs.mkdirSync(download, { recursive: true });
    const archive = cp.execFileSync("npm", ["pack", `@openai/codex@${version}-darwin-${arch}`, "--silent"], { cwd: download, encoding: "utf8" }).trim().split("\n").pop();
    cp.execFileSync("tar", ["-xzf", archive, "-C", download], { cwd: download });
    directory = path.join(download, "package", "vendor");
  }
  const [triple] = fs.readdirSync(directory).filter(entry => fs.statSync(path.join(directory, entry)).isDirectory());
  return { path: path.join(directory, triple), version };
}

function stageCodex(arch) {
  const vendor = codexVendor(arch), destination = path.join(root, "build", "engine", `mac-codex-${arch}`);
  clean(destination);
  fs.cpSync(vendor.path, destination, { recursive: true, verbatimSymlinks: true, filter: source => !UNUSED_CODEX.some(unused => path.relative(vendor.path, source).split(path.sep).join("/").startsWith(unused)) });
  const apache = fs.readFileSync(path.join(root, "node_modules/detect-libc/LICENSE"), "utf8");
  fs.writeFileSync(path.join(destination, "NOTICE.txt"), `OpenAI Codex ${vendor.version} (https://github.com/openai/codex)\nLicensed under the Apache License 2.0.\n\n${apache}`);
  return destination;
}

// electron-builder's targets and configuration. Signed builds add the zip
// Squirrel.Mac installs and the generic feed: the app gets app-update.yml and
// latest-mac.yml is written beside the zip (publish "never" uploads nothing).
function builderOptions({ draft, config, feed, app, output, codex, version }) {
  return {
    targets: draft ? ["dmg"] : ["dmg", "zip"],
    config: {
      appId: draft ? "com.timewarp.desktop.preview" : config.appId, productName: draft ? "Timewarp Preview" : "Timewarp", copyright: "Copyright © 2026 Timewarp.",
      electronVersion: require("electron/package.json").version,
      directories: { app, output, buildResources: path.join(root, "assets") }, npmRebuild: false, forceCodeSigning: !draft, asar: true, files: ["**/*"],
      extraResources: [{ from: codex, to: "codex" }], publish: draft ? null : { provider: "generic", url: feed.updateUrl },
      extraMetadata: { name: draft ? "timewarp-preview" : "timewarp-desktop", version, author: "Timewarp" },
      electronFuses: { runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, grantFileProtocolExtraPrivileges: false },
      mac: {
        target: draft ? "dmg" : ["dmg", "zip"], icon: path.join(root, "assets/app-icon.icns"), category: "public.app-category.productivity",
        identity: draft ? "-" : config.identity.replace(/^Developer ID Application: /, ""), hardenedRuntime: true, notarize: false, gatekeeperAssess: false,
        entitlements: path.join(root, "assets/entitlements.mac.plist"), entitlementsInherit: path.join(root, "assets/entitlements.mac.plist"),
        // Codex's V8 programs are signed with Codex's own entitlements (sign-mac.cjs).
        sign: path.join(__dirname, "sign-mac.cjs"),
        minimumSystemVersion: MINIMUM_MACOS,
        extendInfo: { NSMicrophoneUsageDescription: "Timewarp uses the microphone when you dictate messages.", NSCameraUsageDescription: "Timewarp uses the camera when a website in its browser asks for it and you allow it." },
        // The zip's name (the DMG has its own below). electron-builder has no
        // zip section; an Apple Silicon Mac takes the zip with "arm64" in its
        // name, an Intel Mac the other.
        ...(draft ? {} : { artifactName: "Timewarp-${version}-${arch}-mac.${ext}" }),
      },
      // The DMG is stapled after it's built, which changes its checksum, so
      // updates list only the zip.
      dmg: { sign: !draft, ...(draft ? {} : { writeUpdateInfo: false }), artifactName: draft ? "Timewarp-Preview-${version}-${arch}.${ext}" : "Timewarp-${version}-${arch}.${ext}" },
    },
  };
}
const updateFileName = arch => `latest-mac-${arch}.yml`;

async function main() {
  if (process.platform !== "darwin") throw new Error("Build Mac packages on macOS.");
  if (ARCHES.some(arch => !["arm64", "x64"].includes(arch))) throw new Error("Choose --arch arm64, x64 or both.");
  const config = draft ? null : require("../mac-release.json");
  let feed = null;
  if (!draft) {
    if (!/^\d+\.\d+\.\d+$/.test(config.version) || !/^com\.[a-z0-9.]+$/.test(config.appId) || !/^[A-Z0-9]{10}$/.test(config.teamId)) throw new Error("Invalid Mac release configuration.");
    feed = require("./release-config.cjs").checkMacFeed({ enabled: true, version: config.version, updateUrl: config.updateUrl });
    if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD) throw new Error("Supply the protected Developer ID Application signing identity.");
    if (!process.env.TIMEWARP_NOTARY_KEYCHAIN_PROFILE) throw new Error("Configure a notarization keychain profile before building a signed release.");
  }
  const run = (script, args = [], env = process.env) => cp.execFileSync(process.execPath, [path.join(__dirname, script), ...args], { env, stdio: "inherit" });
  run("build-engine.cjs", draft ? [] : ["--release"], { ...process.env, ...(draft ? {} : { TIMEWARP_APP_VERSION: config.version, TIMEWARP_MAC_UPDATE_URL: feed.updateUrl }) });
  run("audit-engine.cjs");
  const app = path.join(root, "build", "engine", "app");
  const manifest = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
  const output = path.join(root, draft ? "build/engine-mac-draft" : "build/mac-release");
  const { build, Platform, Arch } = require("electron-builder");
  const { floor, compare } = require("./macho-min-os.cjs");
  const yaml = require("js-yaml");
  const results = [], updateFiles = [];
  for (const arch of ARCHES) {
    const codex = stageCodex(arch);
    const options = builderOptions({ draft, config, feed, app, output, codex, version: manifest.version });
    const artifacts = await build({ projectDir: root, publish: "never", targets: Platform.MAC.createTarget(options.targets, arch === "x64" ? Arch.x64 : Arch.arm64), config: options.config });
    const bundle = path.join(output, arch === "x64" ? "mac" : "mac-arm64", options.config.productName + ".app");
    // No binary in the app may need a newer macOS than the one it declares.
    const found = floor([bundle]).byArch[arch];
    if (!found || compare(found.minimum, MINIMUM_MACOS) > 0) throw new Error(`${path.basename(found?.file || "A binary")} needs macOS ${found?.minimum}, above the declared ${MINIMUM_MACOS}.`);
    const plist = fs.readFileSync(path.join(bundle, "Contents", "Info.plist"), "utf8");
    const declared = /<key>LSMinimumSystemVersion<\/key>\s*<string>([\d.]+)<\/string>/.exec(plist)?.[1];
    if (declared !== MINIMUM_MACOS) throw new Error(`The app declares macOS ${declared || "nothing"} instead of ${MINIMUM_MACOS}.`);
    let update = {};
    if (!draft) {
      // This architecture's update: the app's feed, the zip, and latest-mac.yml
      // renamed so both CI jobs' files can be downloaded together and merged.
      const embedded = yaml.load(fs.readFileSync(path.join(bundle, "Contents", "Resources", "app-update.yml"), "utf8"));
      if (embedded.provider !== "generic" || embedded.url !== feed.updateUrl) throw new Error("The app's update feed differs from mac-release.json.");
      const zip = artifacts.find(file => file.endsWith("-mac.zip")), info = path.join(output, updateFileName(arch));
      fs.renameSync(path.join(output, "latest-mac.yml"), info);
      const listed = yaml.load(fs.readFileSync(info, "utf8"));
      if (!zip || listed.version !== manifest.version || listed.files?.length !== 1 || listed.files[0].url !== path.basename(zip)) throw new Error(`${path.basename(info)} should list only this build's zip.`);
      updateFiles.push(info);
      update = { zip, updateInfo: info };
    }
    if (arch === process.arch) run("smoke-engine.cjs", [bundle]);
    const dmg = artifacts.find(file => file.endsWith(".dmg"));
    if (!draft) run("notarize-mac.cjs", [dmg]);
    results.push({ arch, dmg, ...update, minimumMacOS: MINIMUM_MACOS, strictestBinary: { file: path.relative(bundle, found.file), minimum: found.minimum }, smokeTested: arch === process.arch });
  }
  // Both architectures built here: the merged latest-mac.yml to publish.
  if (updateFiles.length === 2) fs.writeFileSync(path.join(output, "latest-mac.yml"), require("./merge-mac-update-info.cjs").mergeFiles(updateFiles));
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports", "engine-mac.json"), JSON.stringify({ builtAt: new Date().toISOString(), version: manifest.version, draft, results }, null, 2));
  console.log((draft ? "Ad hoc signed preview DMGs: " : "Signed and notarized DMGs: ") + results.map(item => item.dmg).join(", ") + (draft ? "" : "; update zips: " + results.map(item => item.zip).join(", ")));
}

// electron-builder registers shutdown handlers; exit explicitly on failure.
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });

module.exports = { builderOptions, updateFileName };
