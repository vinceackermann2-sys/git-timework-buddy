"use strict";
// Builds the Timewarp desktop app from Timewarp's own source into
// build/engine/app. Usage: node scripts/build-engine.cjs [--dev|--release] [--fixture] [--launch]
// Only --release uses the existing "Timewarp Energy" profile; other builds
// use a separate profile so they never touch a real installation's data.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "build", "engine", "app");
const dev = process.argv.includes("--dev");
const release = process.argv.includes("--release");
const launch = process.argv.includes("--launch");
const fixture = process.argv.includes("--fixture");
if (dev && release) throw new Error("Choose either --dev or --release.");
if (fixture && release) throw new Error("Preview mode cannot enter a release build.");
const identity = release ? { profile: "Timewarp Energy", appId: "com.timewarp.desktop" }
  : dev ? { profile: "Timewarp Dev", appId: "com.timewarp.desktop.dev" } : { profile: "Timewarp Preview", appId: "com.timewarp.desktop.preview" };

function clean(directory) {
  if (!fs.existsSync(directory)) return;
  const expected = path.join(fs.realpathSync(path.join(root, "build")), "engine", "app");
  if (fs.realpathSync(directory) !== expected || fs.lstatSync(directory).isSymbolicLink()) throw new Error("Unsafe engine build path.");
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };

function packageOf(input) {
  const match = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(input);
  return match ? match[1].replace(/\\/g, "/") : null;
}

// Collects the license text of every npm package that entered a bundle.
function notices(metafiles) {
  const packages = new Set();
  for (const meta of metafiles) for (const input of Object.keys(meta.inputs)) { const name = packageOf(input); if (name) packages.add(name); }
  const sections = [];
  for (const name of [...packages].sort()) {
    const directory = path.join(root, "node_modules", name);
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")); } catch {}
    const license = fs.existsSync(directory) ? fs.readdirSync(directory).find(file => /^(license|licence|copying)(\.|$)/i.test(file)) : null;
    const text = license ? fs.readFileSync(path.join(directory, license), "utf8").trim() : `License: ${manifest.license || "see package"}`;
    sections.push(`${name} ${manifest.version || ""}\n${"-".repeat(72)}\n${text}`);
  }
  return sections;
}

async function build() {
  const esbuild = require("esbuild");
  const version = require("../package.json").version;
  clean(out);
  fs.mkdirSync(out, { recursive: true });
  const common = { bundle: true, logLevel: "warning", metafile: true, legalComments: "none", minify: !dev, sourcemap: dev ? "inline" : false };
  const main = await esbuild.build({
    ...common, entryPoints: [path.join(root, "app/main/main.cjs")], outfile: path.join(out, "main/main.cjs"),
    platform: "node", format: "cjs", target: "node24", external: ["electron"],
  });
  const renderer = await esbuild.build({
    ...common, entryPoints: [path.join(root, "app/renderer/src/main.jsx")], outfile: path.join(out, "renderer/app.js"),
    platform: "browser", format: "iife", target: "chrome140", jsx: "automatic", loader: { ".js": "jsx" },
    define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
  });
  copy(path.join(root, "app/preload/preload.cjs"), path.join(out, "preload/preload.cjs"));
  if (fixture) copy(path.join(root, "app/main/fixture.cjs"), path.join(out, "main/fixture.cjs"));

  const renderDir = path.join(out, "renderer");
  copy(path.join(root, "app/renderer/index.html"), path.join(renderDir, "index.html"));
  copy(path.join(root, "app/renderer/styles/app.css"), path.join(renderDir, "app.css"));
  const screens = { "auth-ui.js": "auth.js", "organization-gate.js": "organization.js", "native-billing.js": "billing.js", "onboarding-ui.js": "onboarding.js", "auth.css": "auth.css", "billing.css": "billing.css", "onboarding.css": "onboarding.css" };
  for (const [from, to] of Object.entries(screens)) copy(path.join(root, "desktop", from), path.join(renderDir, "screens", to));
  copy(path.join(root, "assets/timewarp-logo.svg"), path.join(renderDir, "timewarp-logo.svg"));
  copy(path.join(root, "assets/app-icon.svg"), path.join(renderDir, "app-icon.svg"));
  copy(path.join(root, "assets/mascots"), path.join(renderDir, "mascots"));
  copy(path.join(root, "assets/onboarding-icons"), path.join(renderDir, "onboarding-icons"));
  for (const name of ["orbit", "nova", "cosmo"]) copy(path.join(root, "assets/mascots", name + ".png"), path.join(renderDir, "assets", `timewarp-mascot-${name}.png`));
  for (const file of ["app-icon.ico", "app-icon.png", "app-icon.svg", "timewarp-logo.svg", "auth-bridge.css"]) copy(path.join(root, "assets", file), path.join(out, "assets", file));
  copy(path.join(root, "assets/mascots"), path.join(out, "assets/mascots"));

  fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({
    name: "timewarp-desktop", productName: "Timewarp", version, description: "Timewarp desktop", main: "main/main.cjs",
    author: { name: "Timewarp" }, license: "UNLICENSED", private: true,
  }, null, 2));
  fs.writeFileSync(path.join(out, "build.json"), JSON.stringify({
    version, ...identity, release: { enabled: false }, ...(fixture ? { fixture: true } : {}),
  }, null, 2));
  const sections = notices([main.metafile, renderer.metafile]);
  fs.writeFileSync(path.join(out, "THIRD_PARTY_NOTICES.txt"), `Timewarp desktop includes the following open-source software.\n\n${sections.join("\n\n\n")}\n`);
  const size = file => (fs.statSync(path.join(out, file)).size / 1024).toFixed(0) + " KB";
  console.log(`Timewarp ${version} built at ${out} (main ${size("main/main.cjs")}, interface ${size("renderer/app.js")}, ${sections.length} open-source notices).`);
  if (launch) {
    const electron = require("electron");
    const child = cp.spawn(electron, [out], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    console.log("Opened Timewarp.");
  }
}

build().catch(error => { console.error(error.message); process.exitCode = 1; });
