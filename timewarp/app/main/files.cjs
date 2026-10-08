"use strict";
// Read-only access to an agent's workspace folder for the Files view. Every
// path is resolved inside the workspace; links that leave it are refused.
const fs = require("node:fs");
const path = require("node:path");

const TEXT_LIMIT = 1024 * 1024, IMAGE_LIMIT = 12 * 1024 * 1024, BINARY_LIMIT = 40 * 1024 * 1024, LIST_LIMIT = 2000;
const HIDDEN = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db"]);
const IMAGES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon" };
const DOCUMENTS = { ".pdf": "application/pdf", ".xlsx": "spreadsheet", ".xls": "spreadsheet", ".csv": "csv", ".tsv": "csv", ".docx": "document" };
const LANGUAGES = { ".js": "javascript", ".cjs": "javascript", ".mjs": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript", ".json": "json", ".md": "markdown", ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java", ".cs": "csharp", ".c": "c", ".h": "c", ".cpp": "cpp", ".css": "css", ".scss": "scss", ".html": "xml", ".xml": "xml", ".svg": "xml", ".yml": "yaml", ".yaml": "yaml", ".toml": "ini", ".ini": "ini", ".sh": "bash", ".ps1": "powershell", ".sql": "sql", ".php": "php", ".swift": "swift", ".kt": "kotlin", ".txt": "plaintext", ".log": "plaintext" };
const fail = (status, message) => Object.assign(new Error(message), { status });

function inside(root, relative = "") {
  const base = fs.realpathSync(root);
  const target = path.resolve(base, String(relative || "").replace(/^[\\/]+/, ""));
  if (target !== base && !target.startsWith(base + path.sep)) throw fail(403, "That file is outside the agent's workspace.");
  if (!fs.existsSync(target)) throw fail(404, "That file no longer exists.");
  const real = fs.realpathSync(target);
  if (real !== base && !real.startsWith(base + path.sep)) throw fail(403, "That file is outside the agent's workspace.");
  return { base, target: real, relative: path.relative(base, real).split(path.sep).join("/") };
}

function looksText(buffer) {
  const sample = buffer.subarray(0, 8000);
  if (sample.includes(0)) return false;
  let odd = 0;
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) odd++;
  return odd / Math.max(1, sample.length) < 0.02;
}

function createFiles({ workspaceOf }) {
  function list(agentId, dir = "") {
    const root = workspaceOf(agentId);
    fs.mkdirSync(root, { recursive: true });
    const { target, relative } = inside(root, dir);
    if (!fs.statSync(target).isDirectory()) throw fail(400, "That is not a folder.");
    const entries = fs.readdirSync(target, { withFileTypes: true }).filter(entry => !HIDDEN.has(entry.name)).slice(0, LIST_LIMIT).map(entry => {
      const full = path.join(target, entry.name);
      let stat = null;
      try { stat = fs.statSync(full); } catch {}
      return { name: entry.name, path: (relative ? relative + "/" : "") + entry.name, type: stat?.isDirectory() ? "dir" : "file", size: stat?.isFile() ? stat.size : null, modifiedAt: stat ? stat.mtime.toISOString() : null };
    });
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.type === "dir" ? -1 : 1));
    return { path: relative, entries };
  }
  function read(agentId, file) {
    const { target, relative } = inside(workspaceOf(agentId), file);
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw fail(400, "That is not a file.");
    const ext = path.extname(target).toLowerCase();
    const base = { path: relative, name: path.basename(target), size: stat.size, modifiedAt: stat.mtime.toISOString() };
    if (IMAGES[ext] && ext !== ".svg") {
      if (stat.size > IMAGE_LIMIT) return { ...base, kind: "large" };
      return { ...base, kind: "image", dataUrl: `data:${IMAGES[ext]};base64,${fs.readFileSync(target).toString("base64")}` };
    }
    if (DOCUMENTS[ext]) {
      if (stat.size > BINARY_LIMIT) return { ...base, kind: "large" };
      if (DOCUMENTS[ext] === "csv") return { ...base, kind: "csv", text: fs.readFileSync(target, "utf8").slice(0, TEXT_LIMIT), delimiter: ext === ".tsv" ? "\t" : "," };
      return { ...base, kind: DOCUMENTS[ext] === "application/pdf" ? "pdf" : DOCUMENTS[ext], base64: fs.readFileSync(target).toString("base64") };
    }
    if (stat.size > TEXT_LIMIT) return { ...base, kind: "large" };
    const buffer = fs.readFileSync(target);
    if (!looksText(buffer)) return { ...base, kind: "binary" };
    return { ...base, kind: ext === ".md" || ext === ".markdown" ? "markdown" : "text", language: LANGUAGES[ext] || null, text: buffer.toString("utf8") };
  }
  function search(agentId, query) {
    const root = fs.realpathSync(workspaceOf(agentId)), needle = String(query || "").toLowerCase().trim();
    if (!needle) return [];
    const results = [], queue = [""];
    let visited = 0;
    while (queue.length && results.length < 200 && visited < 20000) {
      const dir = queue.shift();
      let entries = [];
      try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (HIDDEN.has(entry.name) || entry.isSymbolicLink()) continue;
        visited++;
        const relative = dir ? dir + "/" + entry.name : entry.name;
        if (entry.isDirectory()) queue.push(relative);
        if (entry.name.toLowerCase().includes(needle)) results.push({ name: entry.name, path: relative, type: entry.isDirectory() ? "dir" : "file" });
      }
    }
    return results;
  }
  return { list, read, search, absolute: (agentId, file) => inside(workspaceOf(agentId), file).target };
}

module.exports = { createFiles, inside, looksText };
