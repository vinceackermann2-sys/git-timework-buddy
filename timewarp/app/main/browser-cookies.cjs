"use strict";
// Carrying a Chromium profile's sign-ins into Timewarp's browser. Only the
// selected profile's own cookie database is read (from a copy, so the browser's
// file is never opened or changed). Secrets never enter IPC, diagnostics or
// command-line arguments. Older values (v10/v11) use a key the operating system
// unlocks for the signed-in user (Windows DPAPI, macOS Keychain, Linux secret
// service). Newer Chrome and Edge wrap that key with App-Bound Encryption (v20),
// which only the browser itself can unlock: those cookies come in through the
// browser import helper (browser-import-helper.cjs) instead of trying to bypass
// the source browser's protection.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const MAX_COOKIES = 50000, MAX_FILE = 32 * 1024 * 1024, MAX_DB = 256 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { status: 400 });

function command(file, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const parts = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(fail("Cookie access timed out. Unlock your system keychain and try again.")); }, 60000);
    child.stdout.on("data", chunk => { size += chunk.length; if (size <= 128 * 1024) parts.push(chunk); else child.kill(); });
    child.on("error", () => { clearTimeout(timer); reject(fail("The system cookie key could not be read.")); });
    child.on("close", code => { clearTimeout(timer); code === 0 && size <= 128 * 1024 ? resolve(Buffer.concat(parts).toString("utf8").replace(/\r?\n$/, "")) : reject(fail("The system cookie key could not be read.")); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function unprotect(value) {
  const script = "Add-Type -AssemblyName System.Security; try { [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([Console]::In.ReadToEnd()), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))) } catch { exit 1 }";
  const shell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return Buffer.from(await command(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], value.toString("base64")), "base64");
}

async function cookieKey({ platform, browserId, root, run = command, dpapi = unprotect }) {
  if (platform === "win32") {
    const state = JSON.parse(fs.readFileSync(path.join(root, "Local State"), "utf8").replace(/^\uFEFF/, ""));
    const encrypted = Buffer.from(state.os_crypt?.encrypted_key || "", "base64");
    if (encrypted.subarray(0, 5).toString() !== "DPAPI") throw fail("This browser protects its sign-ins. Use the browser import helper.");
    return dpapi(encrypted.subarray(5));
  }
  const product = { chrome: "Chrome", edge: "Microsoft Edge", brave: "Brave", vivaldi: "Vivaldi", arc: "Arc", chromium: "Chromium" }[browserId];
  if (!product) throw fail("This browser's cookie key is unavailable.");
  if (platform === "darwin") {
    const password = await run("/usr/bin/security", ["find-generic-password", "-w", "-s", product + " Safe Storage"]);
    return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  }
  const application = { edge: "microsoft-edge", brave: "brave", chromium: "chromium", vivaldi: "vivaldi", chrome: "chrome" }[browserId];
  const password = await run("secret-tool", ["lookup", "application", application]);
  if (!password) throw fail("Unlock your system keychain and try again.");
  return crypto.pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
}

function decryptCookie(encrypted, { platform, key, host, version }) {
  const prefix = encrypted.subarray(0, 3).toString();
  if (prefix === "v20") throw fail("This cookie requires the browser import helper.");
  let decoded;
  if (platform === "win32") {
    if (prefix !== "v10" || key.length !== 32 || encrypted.length < 31) throw fail("This cookie could not be decrypted.");
    const cipher = crypto.createDecipheriv("aes-256-gcm", key, encrypted.subarray(3, 15));
    cipher.setAuthTag(encrypted.subarray(-16));
    decoded = Buffer.concat([cipher.update(encrypted.subarray(15, -16)), cipher.final()]);
  } else {
    if (!["v10", "v11"].includes(prefix)) throw fail("This cookie could not be decrypted.");
    const cipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    decoded = Buffer.concat([cipher.update(encrypted.subarray(3)), cipher.final()]);
  }
  if (version >= 24) {
    const hash = crypto.createHash("sha256").update(host).digest();
    if (decoded.length < 32 || !crypto.timingSafeEqual(decoded.subarray(0, 32), hash)) throw fail("Cookie verification failed.");
    decoded = decoded.subarray(32);
  }
  return decoded.toString("utf8");
}

function cookieDetails(cookie, now = Date.now() / 1000) {
  const domain = cookie.domain, host = typeof domain === "string" ? domain.replace(/^\./, "") : "";
  if (!host || /[\s/:\\?#@\x00-\x1f\x7f]/.test(host) || typeof cookie.name !== "string" || typeof cookie.value !== "string") return null;
  // Electron's cookies API cannot preserve partition keys. Never turn a
  // partitioned cookie into a cookie with broader access.
  if (cookie.partitionKey || cookie.top_frame_site_key) return null;
  const secure = cookie.secure === true;
  const url = new URL((secure ? "https://" : "http://") + host + "/");
  if (url.hostname !== host.toLowerCase()) return null;
  const expires = cookie.expirationDate ?? cookie.expires;
  if (!cookie.session && typeof expires === "number" && expires > 0 && expires <= now) return null;
  return {
    url: url.href, name: cookie.name, value: cookie.value,
    ...(domain.startsWith(".") && cookie.hostOnly !== true ? { domain } : {}),
    path: typeof cookie.path === "string" && cookie.path.startsWith("/") ? cookie.path : "/",
    secure, httpOnly: cookie.httpOnly === true,
    sameSite: ({ none: "no_restriction", no_restriction: "no_restriction", lax: "lax", strict: "strict", unspecified: "unspecified" })[cookie.sameSite] || "unspecified",
    ...(!cookie.session && Number.isFinite(expires) && expires > 0 ? { expirationDate: expires } : {}),
  };
}

async function readBrowserCookies({ root, directory, browserId, platform = process.platform, getKey = cookieKey, dpapi = unprotect }) {
  const file = [path.join(directory, "Network", "Cookies"), path.join(directory, "Cookies")].find(file => fs.existsSync(file));
  if (!file) return { cookies: [], failedDecryption: 0 };
  let db, rows, version, copy;
  try {
    // A private copy with its journal, so the browser's own file is never
    // opened; SQLite may fold the journal into the copy.
    if (fs.statSync(file).size > MAX_DB) throw fail("This profile's cookie database is too large to import.");
    copy = fs.mkdtempSync(path.join(os.tmpdir(), "tw-cookies-"));
    const target = path.join(copy, "Cookies");
    fs.copyFileSync(file, target);
    for (const suffix of ["-wal", "-journal"]) { try { fs.copyFileSync(file + suffix, target + suffix); } catch {} }
    db = new DatabaseSync(target);
    db.exec("pragma query_only = ON; begin");
    version = Number(db.prepare("select value from meta where key = 'version'").get()?.value || 0);
    const query = db.prepare("select * from cookies limit ?");
    // Chromium's microseconds since 1601 exceed JavaScript's safe integer
    // range. Ask SQLite for BigInts before converting timestamps to seconds.
    query.setReadBigInts(true);
    rows = query.all(MAX_COOKIES + 1);
    if (rows.length > MAX_COOKIES) throw fail("This profile has too many cookies to import at once.");
  } catch (error) {
    if (error.status === 400) throw error;
    throw fail("Close " + ({ chrome: "Chrome", edge: "Edge", brave: "Brave" }[browserId] || "the source browser") + " completely, including background processes, then try importing again. Its cookie database could not be read.");
  } finally {
    try { db?.close(); } catch {}
    if (copy) fs.rmSync(copy, { recursive: true, force: true });
  }
  let keyPromise;
  const cookies = []; let failedDecryption = 0, skipped = 0;
  for (const row of rows) {
    if (row.top_frame_site_key) { skipped++; continue; }
    const expires = Number(row.expires_utc) / 1000000 - 11644473600;
    if (row.is_persistent && expires <= Date.now() / 1000) { skipped++; continue; }
    let value = row.value;
    const encrypted = Buffer.from(row.encrypted_value || []);
    if (encrypted.length) {
      try {
        const prefix = encrypted.subarray(0, 3).toString();
        if (prefix === "v20") throw fail("Browser helper required.");
        if (platform === "win32" && prefix !== "v10") value = (await dpapi(encrypted)).toString("utf8");
        else {
          // Linux v10 always uses Chromium's documented fallback key.
          const currentKey = platform === "linux" && prefix === "v10" ? crypto.pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1") : await (keyPromise ||= getKey({ root, browserId, platform }));
          value = decryptCookie(encrypted, { platform, key: currentKey, host: row.host_key, version });
        }
      } catch { failedDecryption++; continue; }
    }
    cookies.push({ domain: row.host_key, name: row.name, value, path: row.path, secure: !!row.is_secure, httpOnly: !!row.is_httponly,
      sameSite: ({ "-1": "unspecified", 0: "no_restriction", 1: "lax", 2: "strict" })[row.samesite],
      session: !row.is_persistent, expirationDate: expires });
  }
  return { cookies, failedDecryption, skipped };
}

function readCookieExport(file) {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > MAX_FILE) throw fail("Choose a cookies JSON file smaller than 32 MB.");
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { throw fail("This is not a valid cookies JSON export."); }
  const cookies = Array.isArray(data) ? data : data?.cookies;
  if (!Array.isArray(cookies) || cookies.length > MAX_COOKIES || cookies.some(cookie => !cookie || typeof cookie.domain !== "string" || typeof cookie.name !== "string" || typeof cookie.value !== "string")) throw fail("This is not a valid cookies JSON export.");
  return cookies;
}

module.exports = { readBrowserCookies, readCookieExport, cookieDetails, decryptCookie, cookieKey };
