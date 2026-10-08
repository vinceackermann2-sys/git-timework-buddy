"use strict";
// Packages the Timewarp engine for Windows from Timewarp's own source:
// Timewarp.exe is the official Electron executable with Timewarp's fuses and
// archive integrity, next to the app archive and the official Codex runtime.
// Usage:
//   node scripts/package-engine.cjs --draft         unsigned "Timewarp Preview" installer for local testing
//   node scripts/package-engine.cjs --draft --stage only stage the app (build/engine/stage)
//   node scripts/package-engine.cjs                 signed public release (release.json + signing setup)
// Nothing here uploads, installs or publishes.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const draft = process.argv.includes("--draft");
const stageOnly = process.argv.includes("--stage");
const stage = path.join(root, "build", "engine", "stage");
const COPYRIGHT = "Copyright © 2026 Timewarp.";

function clean(directory) {
  if (!fs.existsSync(directory)) return;
  const expected = path.join(fs.realpathSync(path.join(root, "build")), path.relative(path.join(root, "build"), directory));
  if (fs.realpathSync(directory) !== expected || fs.lstatSync(directory).isSymbolicLink()) throw new Error("Unsafe packaging path: " + directory);
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function codexRuntime(destination) {
  const name = `@openai/codex-${process.platform}-${process.arch}`;
  const vendor = path.join(path.dirname(require.resolve(`${name}/package.json`)), "vendor");
  const [triple] = fs.readdirSync(vendor).filter(entry => fs.statSync(path.join(vendor, entry)).isDirectory());
  fs.cpSync(path.join(vendor, triple), destination, { recursive: true });
  const manifest = require("@openai/codex/package.json");
  const apache = fs.readFileSync(path.join(root, "node_modules/detect-libc/LICENSE"), "utf8");
  if (!/Apache License\s+Version 2\.0/.test(apache)) throw new Error("The Apache License text used for the Codex notice changed.");
  fs.writeFileSync(path.join(destination, "NOTICE.txt"), `OpenAI Codex ${manifest.version} (${manifest.repository?.url || "https://github.com/openai/codex"})\nLicensed under the ${manifest.license}.\n\n${apache}`);
  return manifest.version;
}

async function main() {
  if (process.platform !== "win32") throw new Error("Windows packaging runs on Windows.");
  const { checkRelease } = require("./release-config.cjs");
  const releaseFile = process.env.TIMEWARP_RELEASE_CONFIG || path.join(root, "release.json");
  const release = draft ? { enabled: false } : checkRelease(JSON.parse(fs.readFileSync(releaseFile, "utf8")));
  if (!draft && !release.enabled) throw new Error("Public installers require an enabled release configuration.");
  if (!draft && !process.env.TIMEWARP_CERT_SHA1 && !process.env.WIN_CSC_LINK && !process.env.TIMEWARP_SIGN_SCRIPT) throw new Error("Release signing credentials/service have not been configured.");

  // 1. The app itself.
  const env = { ...process.env, ...(draft ? {} : { TIMEWARP_RELEASE_CONFIG: releaseFile }) };
  cp.execFileSync(process.execPath, [path.join(__dirname, "build-engine.cjs"), ...(draft ? [] : ["--release"])], { env, stdio: "inherit", windowsHide: true });
  const app = path.join(root, "build", "engine", "app");
  const manifest = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
  const buildInfo = JSON.parse(fs.readFileSync(path.join(app, "build.json"), "utf8"));
  if (buildInfo.fixture) throw new Error("Preview builds can't be packaged.");
  cp.execFileSync(process.execPath, [path.join(__dirname, "audit-engine.cjs")], { stdio: "inherit", windowsHide: true });

  // 2. Stage: Electron core files, the archive, Timewarp.exe and Codex.
  clean(stage);
  fs.mkdirSync(path.join(stage, "resources"), { recursive: true });
  const { prepareExecutable, copyElectronCore } = require("./electron-runtime.cjs");
  copyElectronCore(stage);
  const archive = path.join(stage, "resources", "app.asar");
  await (await import("@electron/asar")).createPackage(app, archive);
  const exe = path.join(stage, "Timewarp.exe");
  await prepareExecutable(exe, archive);
  const fileVersion = manifest.version.split("-")[0];
  await (await import("rcedit")).rcedit(exe, {
    icon: path.join(root, "assets", "app-icon.ico"),
    "version-string": { ProductName: "Timewarp", FileDescription: "Timewarp", CompanyName: "Timewarp", LegalCopyright: COPYRIGHT, InternalName: "Timewarp", OriginalFilename: "Timewarp.exe" },
    "file-version": fileVersion, "product-version": fileVersion,
  });
  const codexVersion = codexRuntime(path.join(stage, "resources", "codex"));
  if (release.enabled) fs.writeFileSync(path.join(stage, "resources", "app-update.yml"), require("js-yaml").dump({ provider: "generic", url: release.updateUrl, channel: "latest", updaterCacheDirName: "timewarp-updater", publisherName: release.publisherNames }));
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  const report = { builtAt: new Date().toISOString(), version: manifest.version, profile: buildInfo.profile, appId: buildInfo.appId, electronVersion: require("electron/package.json").version, codexVersion, exe, asarSha256: sha256(archive), publicRelease: release.enabled, signed: false };
  fs.writeFileSync(path.join(root, "reports", "engine-package.json"), JSON.stringify(report, null, 2));
  console.log(`Timewarp ${manifest.version} staged at ${stage} (profile "${buildInfo.profile}", Codex ${codexVersion}).`);
  if (stageOnly) return;

  // 3. Installer.
  const { signFile, requireSignature } = require("./signing.cjs");
  if (!draft) { await signFile(exe); requireSignature(exe, release.publisherNames); }
  const executableName = draft ? "Timewarp Preview" : "Timewarp";
  if (draft) fs.renameSync(exe, path.join(stage, executableName + ".exe"));
  const output = path.join(root, draft ? "build/engine-installer-draft" : "build/engine-release");
  clean(output);
  const nsisInclude = require("./nsis.cjs").generateInclude(path.join(root, "build/engine-uninstaller.nsh"), stage);
  const { build, Platform, Arch } = require("electron-builder");
  await build({
    projectDir: root, prepackaged: stage, publish: "never", targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64), config: {
      appId: buildInfo.appId, productName: executableName, executableName, electronVersion: require("electron/package.json").version, forceCodeSigning: !draft,
      extraMetadata: { name: draft ? "timewarp-preview" : "timewarp-desktop", version: manifest.version, description: "Timewarp", author: "Timewarp" },
      directories: { output, buildResources: path.join(root, "assets") }, npmRebuild: false,
      publish: draft ? null : [{ provider: "generic", url: release.updateUrl, channel: "latest" }],
      win: {
        target: "nsis", icon: path.join(root, "assets/app-icon.ico"), signExecutable: !draft, verifyUpdateCodeSignature: true,
        signtoolOptions: { signingHashAlgorithms: ["sha256"], ...(draft ? {} : { publisherName: release.publisherNames, sign: async options => { await signFile(options.path); requireSignature(options.path, release.publisherNames); } }) },
      },
      nsis: {
        include: nsisInclude, oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, runAfterFinish: false,
        shortcutName: executableName, artifactName: draft ? "Timewarp-Preview-${version}-${arch}.${ext}" : "Timewarp-Setup-${version}-${arch}.${ext}",
      },
    },
  });
  if (!draft) {
    // The signed app embeds this release's feed, and the update metadata
    // points at the one signed installer.
    const assert = require("node:assert/strict");
    const embedded = JSON.parse((await import("@electron/asar")).extractFile(archive, "build.json").toString()).release;
    assert.deepEqual(embedded, release, "The app embeds the requested feed and publisher");
    const installer = require("./verify-release.cjs").verifyManifest(require("js-yaml").load(fs.readFileSync(path.join(output, "latest.yml"), "utf8")), release, output);
    const appSignature = requireSignature(exe, release.publisherNames), installerSignature = requireSignature(installer, release.publisherNames);
    fs.writeFileSync(path.join(output, "release-verification.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), version: release.version, updateUrl: release.updateUrl, appSignature, installerSignature, installer: path.basename(installer), sha256: sha256(installer) }, null, 2));
  }
  console.log((draft ? "Unsigned preview installer built for local testing: " : "Signed installer prepared (publish only after acceptance): ") + output);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
