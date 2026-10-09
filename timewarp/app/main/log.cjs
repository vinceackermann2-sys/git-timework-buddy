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
    let line = `${now().toISOString()} [${level}] [${tag}] ${String(message).replace(/\s+/g, " ").slice(0, 2000)}`;
    if (data !== undefined) {
      try { line += " " + JSON.stringify(data).slice(0, 2000); } catch {}
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

module.exports = { createLog };
