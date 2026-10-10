"use strict";
// Identity + endpoint rewriter for the Timewarp runtime (base: Energy 0.8.20).
//
// Two jobs:
//   1. Rename every user-visible "Energy" identity string to "Timewarp".
//   2. Re-point every Energy-owned remote endpoint at the local Timewarp bridge,
//      so the app never contacts an Energy server.
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
const APP_NAME = process.argv[3] || "Timewarp";
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
     'e==="development"?`${UP} Dev`:UP,e==="development"?"timewarp-dev":"timewarp"'],
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

}

console.log(report.join("\n"));
console.log(`\nTOTAL EDITS: ${totalEdits}`);
