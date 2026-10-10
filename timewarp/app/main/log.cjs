"use strict";
// The app log at runtime/logs/main.log, as in the previous app: start-up
// timing, windows, browser views, the Codex runtime, updates and shutdown.
// It records the app's own state only: never chat content, page content,
// files, account details or secrets.
const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 5 * 1024 * 1024;

function createLog(directory, { now = () => new Date() } = {}) {
  const file = path.join(directory, "main.log");
  let size = 0, failed = false;
  try { fs.mkdirSync(directory, { recursive: true }); size = fs.statSync(file).size; } catch {}
  // One previous file is kept, so the log stays under about 10 MB.
  function rotate() {
    try { fs.renameSync(file, path.join(directory, "main.1.log")); } catch {}
    size = 0;
  }
  function write(level, tag, message, data) {
    if (failed) return;
    // Every line is cleaned here, whatever wrote it (Codex's own output and
    // renderer errors included): addresses cut to their origin, secrets removed.
    let line = `${now().toISOString()} [${level}] [${tag}] ${clean(String(message).replace(/\s+/g, " ")).slice(0, 2000)}`;
    if (data !== undefined) {
      try { line += " " + clean(JSON.stringify(data)).slice(0, 2000); } catch {}
    }
    line += "\n";
    try {
      if (size + line.length > MAX_BYTES) rotate();
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch { failed = true; }
  }
  return {
    file, directory,
    info: (tag, message, data) => write("info", tag, message, data),
    warn: (tag, message, data) => write("warn", tag, message, data),
    error: (tag, message, data) => write("error", tag, message, data),
    // The latest lines, for the diagnostics file.
    tail(lines = 200) {
      try {
        const text = fs.readFileSync(file, "utf8");
        return text.split("\n").filter(Boolean).slice(-lines);
      } catch { return []; }
    },
  };
}

// Web addresses cut to their origin: a page's path and query can hold a
// search, a reset link or other personal details.
const originsOnly = text => String(text).replace(/\b(?:https?|wss?):\/\/[^\s"'`<>]+/gi, address => { try { return new URL(address).origin; } catch { return "[address]"; } });
// Tokens and keys that tools sometimes print: bearer tokens, JWTs, API keys and
// key=value secrets.
const SECRETS = [
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[redacted]"],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr])[-_][\w-]{16,}/g, "[redacted]"],
  [/\b((?:access|refresh|id|session|api|auth|client)?[_-]?(?:token|key|secret|password))(["']?\s*[:=]\s*["']?)[^\s"'&,;]{6,}/gi, "$1$2[redacted]"],
];
const redact = text => SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), String(text));
const clean = text => redact(originsOnly(text));

// Console warnings and errors go to the log (and `recent`, for diagnostics),
// and so do process warnings, which Node would print through console.error:
// Electron reports a page that didn't load as one, with its full address.
function captureConsole({ console, process, recent, log }) {
  for (const level of ["error", "warn"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      let line;
      try { line = args.map(value => value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value)).join(" "); } catch { line = String(args[0]); }
      line = clean(line);
      recent.push(`${new Date().toISOString()} ${level} ${line.slice(0, 500)}`);
      if (recent.length > 300) recent.shift();
      log()?.[level](/^\[timewarp\]/.test(line) ? "timewarp" : "console", line.replace(/^\[timewarp\]\s*/, ""));
      original(...args);
    };
  }
  process.removeAllListeners("warning");
  process.on("warning", warning => console.warn(originsOnly(`(${warning?.name || "Warning"}) ${warning?.message ?? warning}`)));
}

module.exports = { createLog, originsOnly, redact, captureConsole };
