"use strict";
// Independence audit for the Timewarp engine. Checks that the built app is
// made only from Timewarp's source and open-source packages: nothing from the
// Energy runtime, its patch pipeline or its services. Production names kept
// by decision (the timewarp-energy cloud function, the "Timewarp Energy"
// profile folder and the energy-desktop sign-in target) are allowed and listed.
// Usage: node scripts/audit-engine.cjs [--report]   (run after an engine build)
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = path.join(root, "build", "engine", "app");
const stage = path.join(root, "build", "engine", "stage");
const report = process.argv.includes("--report");

// Source folders the engine may be built from.
const ALLOWED_SOURCES = [/^app\//, /^desktop\/[\w.-]+\.(cjs|js)$/, /^shared\/[\w.-]+\.cjs$/, /^config\.json$/, /^assets\//];
// Never part of the engine: the old runtime, its upstream archive and patches.
const FORBIDDEN_SOURCES = [/timewarp-runtime/i, /(^|\/)upstream\//i, /(^|\/)build\/(native|app|mac)/i, /app\.asar/i, /energy-git/i, /comp-work/i,
  // The old pipeline's patches into the inherited app never belong in the engine.
  /^desktop\/(runtime|bridge|product-bridge|harness-instructions|harness-path|preload|task-activity|model-picker|inherited-[\w-]+)\.cjs$/,
  /^desktop\/(workspace-home|connector-browser|browser-cursor)\.js$/, /^scripts\//];
// Energy's services and identifiers. Any hit fails the audit.
const FORBIDDEN_TEXT = [/getenergy\.com/i, /generalwork\.ai/i, /computerwork/i, /comp-work/i, /energy-llm-proxy/i, /energy-memory-writer/i, /energy-git/i, /@energy\//i, /static\.getenergy/i, /Computer Work Company/i];
// Production names kept by decision.
const KEPT = [/timewarp-energy/gi, /Timewarp Energy/g, /energy-desktop/gi, /timewarp_energy/gi];

function files(directory) {
  const out = [];
  if (!fs.existsSync(directory)) return out;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...files(full));
    else out.push(full);
  }
  return out;
}

function audit() {
  const problems = [], kept = new Map(), packages = new Set(), sources = new Set();
  const inputsFile = path.join(root, "build", "engine", "inputs.json");
  if (!fs.existsSync(inputsFile)) throw new Error("Build the engine first (npm run engine:build).");
  for (const input of JSON.parse(fs.readFileSync(inputsFile, "utf8"))) {
    const file = input.replace(/\\/g, "/");
    const npm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file);
    if (FORBIDDEN_SOURCES.some(pattern => pattern.test(file))) problems.push("Forbidden build input: " + file);
    else if (npm) { packages.add(npm[1]); if (/energy|comp-work|computerwork/i.test(npm[1])) problems.push("Energy package in the bundle: " + npm[1]); }
    else if (!ALLOWED_SOURCES.some(pattern => pattern.test(file))) problems.push("Unexpected build input: " + file);
    else sources.add(file);
  }
  const outputs = [...files(app), ...files(path.join(stage, "resources")).filter(file => !file.includes(path.join("resources", "codex")))];
  for (const file of outputs) {
    if (!/\.(cjs|js|mjs|json|html|css|txt|yml|svg)$/.test(file) && !file.endsWith("app.asar")) continue;
    if (file.endsWith("app.asar")) continue; // the staged archive is the same app folder, audited above
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_TEXT) {
      const match = pattern.exec(text);
      if (match) problems.push(`${path.relative(root, file)} contains "${text.slice(Math.max(0, match.index - 40), match.index + 60).replace(/\s+/g, " ")}"`);
    }
    // Other mentions of Energy must be a kept production name.
    const stripped = KEPT.reduce((value, pattern) => value.replace(pattern, match => { kept.set(match, (kept.get(match) || 0) + 1); return ""; }), text);
    if (path.basename(file) === "THIRD_PARTY_NOTICES.txt") continue;
    const other = /energy/gi;
    let hit;
    while ((hit = other.exec(stripped))) problems.push(`${path.relative(root, file)}: "${stripped.slice(Math.max(0, hit.index - 50), hit.index + 50).replace(/\s+/g, " ")}"`);
  }
  return { problems, kept: Object.fromEntries(kept), packages: [...packages].sort(), sources: [...sources].sort() };
}

const result = audit();
if (report) {
  console.log(`Timewarp sources (${result.sources.length}):\n  ` + result.sources.filter(file => !file.startsWith("app/")).join("\n  ") + `\n  …and ${result.sources.filter(file => file.startsWith("app/")).length} files in app/`);
  console.log(`Open-source packages (${result.packages.length}): ${result.packages.join(", ")}`);
  console.log("Kept production names:", JSON.stringify(result.kept));
}
if (result.problems.length) {
  console.error(`Independence audit failed (${result.problems.length}):\n- ` + result.problems.slice(0, 60).join("\n- "));
  process.exitCode = 1;
} else console.log("Independence audit passed: the engine is built only from Timewarp source and open-source packages.");
