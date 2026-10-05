"use strict";
// Identity + endpoint rewriter for the energy-testv1 repack of Energy 0.8.20.
//
// Two jobs:
//   1. Rename every user-visible "Energy" identity string to "energy testv1".
//   2. Re-point every Energy-owned remote endpoint at the local server.
//
// Deliberately NOT renamed: internal protocol identifiers that the shipped
// codex agent definitions depend on (energy-worker, energy-task,
// energy-memory-writer, energy-onboarding, energy-browser, energy-subagent-calls,
// energy-defaults, energy-mcp-ecosystem, energy-nango-connectors,
// energy-document-preview-, energy-libreoffice-profile-, ENERGY_* env names).
// Renaming those would desync the agent TOMLs in the app's own data dir.

const fs = require("fs");
const path = require("path");

const TREE = process.argv[2];
const APP_NAME = process.argv[3] || "energy testv1";
const LOCAL = process.argv[4] || "http://127.0.0.1:7788";

const DEV_NAME = `${APP_NAME} Dev`;

// ---- endpoint rewrites -----------------------------------------------------
const ENDPOINTS = [
  ["https://api.getenergy.com", LOCAL],
  ["https://integrations.getenergy.com", LOCAL],
  ["https://proxy.getenergy.com", LOCAL],
  ["https://a.getenergy.com", LOCAL],
  ["https://static.getenergy.com", LOCAL],
  ["https://images.getenergy.com", LOCAL],
  ["https://upload.imagedelivery.net", LOCAL],
  ["https://newco-trace-ingest.computerwork.workers.dev", LOCAL],
  ["https://llm-proxy.generalwork.ai/v1", `${LOCAL}/v1`],
  [
    "https://1itNntairfw5QT6AmT1CGFPT@s2757855.eu-central-1a.betterstackdata.com/2757855",
    `${LOCAL}/betterstack`,
  ],
  ["wss://integrations.getenergy.com", `ws://127.0.0.1:7788`],
];

// ---- identity rewrites -----------------------------------------------------
// Ordered longest-first so compound phrases win over their substrings.
const IDENTITY = [
  // runtime name resolution (this is what app.setName() actually receives)
  [`"${APP_NAME === "energy testv1" ? "Energy" : APP_NAME} Dev"`, `"${DEV_NAME}"`],
  // agent / task display names
  ["Energy onboarding conversation", `${APP_NAME} onboarding conversation`],
  ["Energy onboarding agent.", `${APP_NAME} onboarding agent.`],
  ["Energy personal memory writer", `${APP_NAME} personal memory writer`],
  ["You maintain Energy personal memory.", `You maintain ${APP_NAME} personal memory.`],
  ["Energy memory writer", `${APP_NAME} memory writer`],
  ["Energy background worker", `${APP_NAME} background worker`],
  ["Energy user task", `${APP_NAME} user task`],
  ["Energy task agent.", `${APP_NAME} task agent.`],
  ["Energy LLM Proxy", `${APP_NAME} LLM Proxy`],
  ["Write and maintain Energy memory files", `Write and maintain ${APP_NAME} memory files`],
  // vault / passkeys
  ["Energy authentication is required.", `${APP_NAME} authentication is required.`],
  ["Energy vault", `${APP_NAME} vault`],
  ["Save in Energy vault", `Save in ${APP_NAME} vault`],
  ["Energy passkey", `${APP_NAME} passkey`],
  ["Energy browser profile", `${APP_NAME} browser profile`],
  // browser worker prompts
  ["You are Energy's browser worker.", `You are ${APP_NAME}'s browser worker.`],
  ["Browse and interact with websites in Energy\u2019s browser.",
   `Browse and interact with websites in ${APP_NAME}\u2019s browser.`],
  // errors / dialogs
  ["Energy auth is required.", `${APP_NAME} auth is required.`],
  ["Energy account changed during ChatGPT migration.",
   `${APP_NAME} account changed during ChatGPT migration.`],
  ["internal Energy error", `internal ${APP_NAME} error`],
  ["Energy failed to start", `${APP_NAME} failed to start`],
  ["Energy could not finish starting", `${APP_NAME} could not finish starting`],
  ["Energy recovery failed:", `${APP_NAME} recovery failed:`],
  ["Failed to report Energy startup failure:", `Failed to report ${APP_NAME} startup failure:`],
  ["Failed to save Energy startup failure", `Failed to save ${APP_NAME} startup failure`],
  ["Failed to open the Energy download:", `Failed to open the ${APP_NAME} download:`],
  ["Open Energy from Applications", `Open ${APP_NAME} from Applications`],
  ["To use Energy,", `To use ${APP_NAME},`],
  ["Failed to open Energy from Applications", `Failed to open ${APP_NAME} from Applications`],
  ["Quit Energy before updating it.", `Quit ${APP_NAME} before updating it.`],
  ["Invalid installed Energy version", `Invalid installed ${APP_NAME} version`],
  ["Could not restart Energy.", `Could not restart ${APP_NAME}.`],
  ["Energy couldn\u2019t load", `${APP_NAME} couldn\u2019t load`],
  ["Restart Energy", `Restart ${APP_NAME}`],
  ["Set up Energy", `Set up ${APP_NAME}`],
  // product surfaces
  ["Report an Energy product problem", `Report an ${APP_NAME} product problem`],
  ["Create a new Energy conversation", `Create a new ${APP_NAME} conversation`],
  ["Energy onboarding conversation", `${APP_NAME} onboarding conversation`],
  // about panel
  ["Copyright \u00a9 2026 Energy", `Copyright \u00a9 2026 ${APP_NAME}`],
  // remaining "from Energy." marketplace blurbs
  ["from Energy.", `from ${APP_NAME}.`],
  // window title
  ["Energy Desktop", APP_NAME],
];

// literal identity replacements applied per-file only to the files that declare
// the runtime name constants, so we never touch unrelated bundle text.
const EXACT = {
  "out/main/index.js": [
    ['UP="Energy"', `UP="${APP_NAME}"`],
    ['yb="Energy"', `yb="${APP_NAME}"`],
    [
      'F4==="development"?"Energy Dev":"Energy"',
      `F4==="development"?${JSON.stringify(DEV_NAME)}:${JSON.stringify(APP_NAME)}`,
    ],
    ['e==="development"?`${UP} Dev`:UP,e==="development"?"energy-dev":"energy"',
     'e==="development"?`${UP} Dev`:UP,e==="development"?"energy-testv1-dev":"energy testv1"'],
    ['const W4=F4==="development"?"Energy Dev":"Energy";',
     `const W4=F4==="development"?${JSON.stringify(DEV_NAME)}:${JSON.stringify(APP_NAME)};`],
    ['title:"Energy"', `title:${JSON.stringify(APP_NAME)}`],
    ['label:"Energy"', `label:${JSON.stringify(APP_NAME)}`],
  ],
  "out/renderer/index.html": [
    ["<title>Energy Desktop</title>", `<title>${APP_NAME}</title>`],
  ],
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const report = [];
let totalEdits = 0;

// ---- critical: isolate userData ------------------------------------------
//
// Electron resolves and caches app.getPath('userData') from the packaged
// productName *before* any user code runs, so the bundle's later
// app.setName("energy testv1") does NOT move it. Without this shim the repack
// silently opens and writes the real Energy profile at
// %APPDATA%\Energy - which is exactly what happened on the first test run
// (it read the real session token, got a 401 from the local backend, and
// deleted account-session.json).
//
// bootstrap.js is package.json's "main", so it is the first bundle code to
// execute and the only safe place to relocate the profile.
const USERDATA_SHIM = `"use strict";
// --- energy testv1: data-dir isolation shim -------------------------------
// Electron latches userData from the packaged productName before user code
// runs, so app.setName() later in the main bundle is not enough. Relocate
// every profile path here, before anything reads it.
(() => {
  const { app, safeStorage } = require("electron");
  const path = require("node:path");
  const fs = require("node:fs");
  const base = process.env.ETV1_DATA_DIR ||
    path.join(process.env.APPDATA || path.join(require("node:os").homedir(), "AppData", "Roaming"), "energy testv1");
  for (const p of [base, path.join(base, "logs"), path.join(base, "Cache"), path.join(base, "Partitions")]) {
    try { fs.mkdirSync(p, { recursive: true }); } catch {}
  }
  app.setName("energy testv1");
  for (const key of ["userData", "sessionData", "logs", "cache", "userCache", "temp", "downloads"]) {
    try { app.setPath(key, key === "logs" ? path.join(base, "logs") : base); } catch {}
  }
  try { app.setAppLogsPath(path.join(base, "logs")); } catch {}
  try { process.env.ENERGY_DATA_DIR = path.join(base, "runtime"); } catch {}

  // Diagnostics: record what the profile paths actually resolved to, plus
  // whether the stored session file is readable, so a misdirected profile is
  // obvious from the log instead of silent.
  try {
    const diag = [];
    for (const k of ["userData", "sessionData", "logs", "appData"]) {
      diag.push(k + " = " + app.getPath(k));
    }
    // Which session store the bundle will pick: packaged => DPAPI
    // {encryptedToken,version}, unpackaged => plaintext {token}.
    diag.push("app.isPackaged = " + app.isPackaged);
    diag.push("process.defaultApp = " + JSON.stringify(process.defaultApp));
    diag.push("process.execPath = " + process.execPath);
    diag.push("process.resourcesPath = " + process.resourcesPath);
    diag.push("app.getAppPath() = " + app.getAppPath());
    diag.push("app.getName() = " + app.getName());
    diag.push("safeStorage.isEncryptionAvailable = " + (() => { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return "threw: " + e.message; } })());
    const f = path.join(app.getPath("userData"), "account-session.json");
    diag.push("accountSessionPath = " + f);
    diag.push("exists = " + fs.existsSync(f));
    if (fs.existsSync(f)) {
      const raw = fs.readFileSync(f, "utf8");
      diag.push("bytes = " + raw.length);
      diag.push("content = " + JSON.stringify(raw));
      try {
        const parsed = JSON.parse(raw);
        diag.push("jsonKeys = " + JSON.stringify(Object.keys(parsed)));
        diag.push("version = " + JSON.stringify(parsed.version));
        diag.push("tokenLen = " + (parsed.encryptedToken || "").length);
      } catch (err) {
        diag.push("JSON.parse FAILED: " + err.message);
      }
    }
    fs.writeFileSync(path.join(base, "shim-diag.txt"), diag.join("\\n") + "\\n");
  } catch (err) {
    try { fs.appendFileSync(path.join(base, "shim-diag-error.txt"), String(err && err.stack) + "\\n"); } catch {}
  }
})();
// --- end shim --------------------------------------------------------------
`;

// The original file begins with `"use strict";\n`. Swap that for the shim, which
// opens with its own `"use strict";` so the module semantics are unchanged.
function injectShim(rel, text, edits) {
  if (rel !== "out/main/bootstrap.js") return text;
  const m = /^("use strict";)/.exec(text);
  if (!m) {
    report.push(`  ${rel}: SHIM NOT APPLIED (unexpected file head)`);
    return text;
  }
  report.push(`  ${rel}: injected userData isolation shim`);
  return USERDATA_SHIM + text.slice(m[1].length);
}

for (const abs of walk(TREE)) {
  const rel = path.relative(TREE, abs).replace(/\\/g, "/");
  if (!/\.(js|mjs|html|css|json|yml)$/.test(rel)) continue;
  // Vendor blobs only. Note: out/renderer/assets/mermaid-*.js is NOT a vendor
  // blob - despite the name it is the app's main React chunk (5.5 MB) and holds
  // the renderer's PostHog/telemetry wiring, so it must be patched.
  if (rel.startsWith("out/licenses/")) continue;
  if (/spreadsheet-preview|pdf\.worker|markdown-document/.test(rel)) continue;

  const before = fs.readFileSync(abs, "utf8");
  let text = before;
  let edits = 0;

  for (const [from, to] of ENDPOINTS) {
    if (!text.includes(from)) continue;
    const n = text.split(from).length - 1;
    text = text.split(from).join(to);
    edits += n;
    report.push(`  ${rel}: endpoint ${from} -> ${to} (${n})`);
  }

  for (const [from, to] of EXACT[rel] || []) {
    if (!text.includes(from)) continue;
    const n = text.split(from).length - 1;
    text = text.split(from).join(to);
    edits += n;
    report.push(`  ${rel}: exact ${JSON.stringify(from)} (${n})`);
  }

  for (const [from, to] of IDENTITY) {
    if (from === to || !text.includes(from)) continue;
    const n = text.split(from).length - 1;
    text = text.split(from).join(to);
    edits += n;
    report.push(`  ${rel}: identity ${JSON.stringify(from)} (${n})`);
  }

  if (edits > 0) {
    fs.writeFileSync(abs, text);
    totalEdits += edits;
    report.push(`${rel}: ${edits} edits`);
  }

  const injected = injectShim(rel, text, edits);
  if (injected !== text) fs.writeFileSync(abs, injected);
}

console.log(report.join("\n"));
console.log(`\nTOTAL EDITS: ${totalEdits}`);
