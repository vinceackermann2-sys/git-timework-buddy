"use strict";
// Carrying a Chromium profile's sign-ins into the Timewarp profile made from it,
// so imported sites stay signed in, as the previous app did. Only the chosen
// profile's own cookie store is read, on this computer, to copy into Timewarp.
//
// Chromium encrypts cookie values with a per-user key kept in the browser's
// "Local State". Older values (v10/v11) use a key the operating system unlocks
// for the signed-in user (Windows DPAPI, macOS Keychain). Newer Chrome and Edge
// wrap that key with App-Bound Encryption (v20), which only the browser itself
// can unlock, so those sign-ins can't be copied and the site is signed in to
// once inside Timewarp instead.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const MAX_DB = 256 * 1024 * 1024;
const KEY_LENGTH = 32; // AES-256 key bytes (Windows).
const GCM_NONCE = 12, GCM_TAG = 16;
const DPAPI = Buffer.from("DPAPI");
// Microseconds between 1601-01-01 (Chromium's epoch) and 1970-01-01.
const EPOCH_MICROS = 11644473600000000n;
// Encrypted-value prefixes: v10/v11 can be read; v20 is App-Bound.
const READABLE = /^7631(30|31)/i; // "v10" / "v11"
const APP_BOUND = /^763230/i; // "v20"

const empty = () => ({ discovered: 0, imported: 0, failedDecryption: 0, appBound: 0, skippedExpired: 0, skippedInvalid: 0 });

// The profile's cookie store, newest Chromium keeps it under Network/.
function cookieFile(profilePath) {
  for (const name of [path.join("Network", "Cookies"), "Cookies"]) {
    const file = path.join(profilePath, name);
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}

// The AES key the operating system unlocks for this user, read from Local State.
// unprotect removes the OS wrapping (DPAPI on Windows); injected in tests.
function osKey({ userDataDir, platform, browserId, env, home, unprotect, keychain }) {
  if (platform === "win32") {
    const stateFile = path.join(userDataDir, "Local State");
    const encoded = JSON.parse(fs.readFileSync(stateFile, "utf8").replace(/^\ufeff/, ""))?.os_crypt?.encrypted_key;
    if (typeof encoded !== "string" || !encoded) throw new Error("This browser has no stored key.");
    const wrapped = Buffer.from(encoded, "base64");
    if (!wrapped.subarray(0, DPAPI.length).equals(DPAPI)) throw new Error("This browser's key is in an unexpected format.");
    const key = (unprotect || dpapiUnprotect)(wrapped.subarray(DPAPI.length));
    if (key.length !== KEY_LENGTH) throw new Error("This browser's key could not be unlocked.");
    return { key, platform };
  }
  if (platform === "darwin") {
    const secret = (keychain || macKeychain)(browserId);
    if (!secret) throw new Error("This browser's key could not be read from the Keychain.");
    return { key: crypto.pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1"), platform };
  }
  throw new Error("Sign-ins can't be copied on this platform.");
}

// Windows removes the user's DPAPI wrapping through PowerShell (no native addon).
function dpapiUnprotect(buffer) {
  const shell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$wrapped = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "$plain = [Security.Cryptography.ProtectedData]::Unprotect($wrapped, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($plain))",
  ].join("; ");
  const result = spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { input: buffer.toString("base64"), encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error("Windows couldn't unlock this browser's key.");
  return Buffer.from(result.stdout.trim(), "base64");
}

// macOS reads the browser's safe-storage secret from the login Keychain.
function macKeychain(browserId) {
  const accounts = { chrome: ["Chrome", "Chrome Safe Storage"], edge: ["Microsoft Edge", "Microsoft Edge Safe Storage"], brave: ["Brave", "Brave Safe Storage"], arc: ["Arc", "Arc Safe Storage"], vivaldi: ["Vivaldi", "Vivaldi Safe Storage"] };
  const [account, service] = accounts[browserId] || [];
  if (!account) return null;
  const result = spawnSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Decrypts one cookie value. Returns null when it can't be read (App-Bound or
// an unexpected format), so the caller counts it and moves on.
function decryptValue(hex, key, platform, dbVersion, hostKey) {
  if (!hex) return "";
  if (!READABLE.test(hex)) return null;
  const buffer = Buffer.from(hex, "hex");
  try {
    let plain;
    if (platform === "win32") {
      const nonce = buffer.subarray(3, 3 + GCM_NONCE);
      const body = buffer.subarray(3 + GCM_NONCE);
      if (body.length <= GCM_TAG) return null;
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(body.subarray(-GCM_TAG));
      plain = Buffer.concat([decipher.update(body.subarray(0, -GCM_TAG)), decipher.final()]);
    } else {
      const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
      decipher.setAutoPadding(false);
      const padded = Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()]);
      const pad = padded.at(-1) ?? 0;
      if (pad < 1 || pad > 16 || !padded.subarray(-pad).every(byte => byte === pad)) return null;
      plain = padded.subarray(0, -pad);
    }
    // Chrome 24+ prefixes the plaintext with a SHA-256 of the host; drop it.
    if (dbVersion >= 24 && hostKey) {
      const stamp = crypto.createHash("sha256").update(hostKey).digest();
      if (plain.length >= 32 && plain.subarray(0, 32).equals(stamp)) plain = plain.subarray(32);
    }
    return plain.toString("utf8");
  } catch { return null; }
}

// Copies the SQLite file (and its sidecars) so a running browser doesn't block
// the read, then opens the copy read-only.
function openCookieDb(file) {
  const { DatabaseSync } = require("node:sqlite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-cookies-"));
  const copy = path.join(dir, "Cookies");
  const stat = fs.statSync(file);
  if (stat.size > MAX_DB) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error("This browser's cookie store is too large to copy."); }
  fs.copyFileSync(file, copy);
  for (const suffix of ["-wal", "-journal"]) { try { fs.copyFileSync(file + suffix, copy + suffix); } catch {} }
  const db = new DatabaseSync(copy, { readOnly: true });
  return { db, cleanup: () => { try { db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); } };
}

function dbVersionOf(db) {
  try { return Number(db.prepare("select value from meta where key = 'version'").get()?.value) || 0; } catch { return 0; }
}

const sameSite = value => ({ 0: "no_restriction", 1: "lax", 2: "strict" })[String(value)] || "unspecified";

// Reads and decrypts a Chromium profile's cookies into plain records, with a
// summary of what couldn't be copied. Pure Node, so it can be tested on disk.
function readCookies(source, { platform = process.platform, env = process.env, home = os.homedir(), unprotect, keychain } = {}) {
  const { browserId, profilePath } = source || {};
  const summary = empty();
  const file = cookieFile(profilePath || "");
  if (!file) return { cookies: [], summary };
  const userDataDir = path.dirname(path.dirname(file).endsWith("Network") ? path.dirname(path.dirname(file)) : path.dirname(file));
  const { key } = osKey({ userDataDir, platform, browserId, env, home, unprotect, keychain });
  const { db, cleanup } = openCookieDb(file);
  const cookies = [];
  try {
    const version = dbVersionOf(db);
    const rows = db.prepare('select host_key, name, hex(encrypted_value) as enc, value, path, expires_utc, is_secure, is_httponly, samesite from cookies').all();
    const now = Date.now() / 1000;
    for (const row of rows) {
      summary.discovered++;
      if (!row.host_key || row.name === null || !String(row.path || "").startsWith("/")) { summary.skippedInvalid++; continue; }
      const enc = String(row.enc || "");
      if (APP_BOUND.test(enc)) { summary.appBound++; continue; }
      const value = enc ? decryptValue(enc, key, platform, version, row.host_key) : String(row.value ?? "");
      if (value === null) { summary.failedDecryption++; continue; }
      let expires = null;
      if (row.expires_utc && String(row.expires_utc) !== "0") {
        try { const seconds = Number(BigInt(row.expires_utc) - EPOCH_MICROS) / 1e6; if (Number.isFinite(seconds)) expires = seconds; } catch {}
        if (expires !== null && expires <= now) { summary.skippedExpired++; continue; }
      }
      const hostOnly = !String(row.host_key).startsWith(".");
      cookies.push({
        domain: String(row.host_key).replace(/^\.+/, "").toLowerCase(), hostOnly, name: String(row.name), value,
        path: String(row.path), secure: row.is_secure === 1, httpOnly: row.is_httponly === 1,
        sameSite: sameSite(row.samesite), expirationDate: expires,
      });
    }
  } finally { cleanup(); }
  return { cookies, summary };
}

// The URL a cookie is set against, from its host and path.
function cookieUrl(cookie) {
  const scheme = cookie.secure ? "https" : "http";
  return `${scheme}://${cookie.domain}${cookie.path}`;
}

// Writes decrypted cookies into a Timewarp profile's Electron session. Failures
// to write a single cookie are counted, never thrown, so one bad cookie never
// stops the rest.
async function writeCookies(session, cookies) {
  let written = 0, failed = 0;
  for (const cookie of cookies) {
    const details = {
      url: cookieUrl(cookie), name: cookie.name, value: cookie.value, path: cookie.path,
      secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
      ...(cookie.hostOnly ? {} : { domain: "." + cookie.domain }),
      ...(cookie.expirationDate !== null ? { expirationDate: cookie.expirationDate } : {}),
    };
    try { await session.cookies.set(details); written++; } catch { failed++; }
  }
  return { written, failed };
}

// Reads a source profile's sign-ins and writes them into a Timewarp session.
// Returns a summary the caller surfaces, including whether a one-time sign-in is
// still needed (App-Bound browsers, or values that couldn't be read).
async function importCookies(source, session, options = {}) {
  const { cookies, summary } = readCookies(source, options);
  if (session && cookies.length) {
    const result = await writeCookies(session, cookies);
    summary.imported = result.written;
    summary.failedDecryption += result.failed;
  }
  summary.needsSignin = summary.appBound > 0 || summary.failedDecryption > 0;
  return summary;
}

module.exports = { readCookies, writeCookies, importCookies, cookieUrl };
