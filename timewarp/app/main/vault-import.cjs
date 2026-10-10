"use strict";
// Imports sign-ins into the vault from a passwords file the user exported
// from their browser or password manager (CSV from Chrome, Edge, Firefox,
// Safari, Bitwarden and others). Columns are matched by their names.
const fail = (status, message) => Object.assign(new Error(message), { status });
const MAX_BYTES = 5 * 1024 * 1024, MAX_ROWS = 5000;
const COLUMNS = {
  site: ["url", "login_uri", "website", "origin", "login url", "web site", "hostname"],
  username: ["username", "login_username", "user", "email", "login", "user name"],
  password: ["password", "login_password", "pass"],
  label: ["name", "title", "account"],
  notes: ["note", "notes", "extra", "comments"],
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim()));
}

function importPasswords({ vault, text }) {
  if (typeof text !== "string" || !text.trim()) throw fail(400, "That file is empty.");
  if (Buffer.byteLength(text) > MAX_BYTES) throw fail(413, "That file is too large to import.");
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  const names = (header || []).map(cell => cell.trim().toLowerCase());
  const column = key => names.findIndex(name => COLUMNS[key].includes(name));
  const index = Object.fromEntries(Object.keys(COLUMNS).map(key => [key, column(key)]));
  if (index.site < 0 || index.password < 0) throw fail(400, "This doesn't look like a passwords export. It needs website and password columns.");
  const existing = new Set(vault.list().filter(item => item.kind === "password").map(item => item.origin + "\n" + (item.username || "")));
  const result = { imported: 0, duplicates: 0, skipped: 0 };
  for (const cells of rows.slice(0, MAX_ROWS)) {
    const value = key => (index[key] >= 0 ? cells[index[key]] || "" : "").trim();
    const password = index.password >= 0 ? cells[index.password] || "" : "";
    if (!value("site") || !password) { result.skipped++; continue; }
    try {
      const saved = vault.create({ kind: "password", site: value("site"), username: value("username"), password, label: value("label"), notes: value("notes") }, { dedupe: existing });
      if (saved) result.imported++; else result.duplicates++;
    } catch { result.skipped++; }
  }
  if (rows.length > MAX_ROWS) result.skipped += rows.length - MAX_ROWS;
  return result;
}

module.exports = { importPasswords, parseCsv };
