"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { readCookies, writeCookies, importCookies, cookieUrl } = require("../app/main/browser-cookies.cjs");

const EPOCH_MICROS = 11644473600000000n;
const toChromeTime = unixSeconds => (BigInt(Math.round(unixSeconds * 1e6)) + EPOCH_MICROS).toString();

// Encrypts a value the way Chromium does for a v10 cookie, so readCookies can
// round-trip it with the same key.
function encryptV10(value, key, hostKey, version) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  let plain = Buffer.from(value, "utf8");
  if (version >= 24 && hostKey) plain = Buffer.concat([crypto.createHash("sha256").update(hostKey).digest(), plain]);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from("v10"), nonce, body, cipher.getAuthTag()]);
}

// Builds a Chromium-style profile with a Local State key and a Cookies db.
function fakeProfile(t, { version = 10, rows }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-ck-src-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, "Google", "Chrome", "User Data");
  const profileDir = path.join(userData, "Default");
  fs.mkdirSync(path.join(profileDir, "Network"), { recursive: true });
  fs.writeFileSync(path.join(userData, "Local State"), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.alloc(4)]).toString("base64") } }));
  const db = new DatabaseSync(path.join(profileDir, "Network", "Cookies"));
  db.exec("create table meta (key text primary key, value text)");
  db.exec(`insert into meta values ('version', '${version}')`);
  db.exec("create table cookies (host_key text, name text, encrypted_value blob, value text, path text, expires_utc text, is_secure integer, is_httponly integer, samesite integer)");
  const insert = db.prepare("insert into cookies (host_key, name, encrypted_value, value, path, expires_utc, is_secure, is_httponly, samesite) values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const row of rows) insert.run(row.host_key, row.name, row.encrypted_value ?? null, row.value ?? null, row.path, row.expires_utc ?? "0", row.is_secure ?? 1, row.is_httponly ?? 0, row.samesite ?? 0);
  db.close();
  return { source: { browserId: "chrome", profilePath: profileDir }, root };
}

test("reads and decrypts v10 cookies, skips app-bound and expired", t => {
  const key = crypto.randomBytes(32);
  const future = Date.now() / 1000 + 86400;
  const { source } = fakeProfile(t, { version: 10, rows: [
    { host_key: ".example.com", name: "sid", encrypted_value: encryptV10("secret-value", key, ".example.com", 10), path: "/", expires_utc: toChromeTime(future), is_secure: 1, is_httponly: 1, samesite: 2 },
    { host_key: "app.example.com", name: "plain", value: "visible", path: "/", expires_utc: "0" },
    { host_key: ".locked.com", name: "ab", encrypted_value: Buffer.concat([Buffer.from("v20"), crypto.randomBytes(40)]), path: "/" },
    { host_key: ".old.com", name: "gone", encrypted_value: encryptV10("x", key, ".old.com", 10), path: "/", expires_utc: toChromeTime(Date.now() / 1000 - 100) },
    { host_key: ".bad.com", name: "nopath", encrypted_value: encryptV10("x", key, ".bad.com", 10), path: "relative" },
  ] });
  const { cookies, summary } = readCookies(source, { platform: "win32", unprotect: () => key });
  assert.equal(summary.discovered, 5);
  assert.equal(summary.appBound, 1);
  assert.equal(summary.skippedExpired, 1);
  assert.equal(summary.skippedInvalid, 1);
  assert.equal(summary.failedDecryption, 0);
  const byName = Object.fromEntries(cookies.map(c => [c.name, c]));
  assert.equal(byName.sid.value, "secret-value");
  assert.equal(byName.sid.domain, "example.com");
  assert.equal(byName.sid.hostOnly, false);
  assert.equal(byName.sid.sameSite, "strict");
  assert.equal(byName.plain.value, "visible");
  assert.equal(byName.plain.hostOnly, true);
});

test("strips the host hash Chrome 24+ prepends to the value", t => {
  const key = crypto.randomBytes(32);
  const { source } = fakeProfile(t, { version: 24, rows: [
    { host_key: ".example.com", name: "sid", encrypted_value: encryptV10("fresh-value", key, ".example.com", 24), path: "/" },
  ] });
  const { cookies } = readCookies(source, { platform: "win32", unprotect: () => key });
  assert.equal(cookies[0].value, "fresh-value");
});

test("writeCookies builds a url and reports failures without throwing", async () => {
  const captured = [];
  const session = { cookies: { set: async details => { if (details.name === "boom") throw new Error("bad"); captured.push(details); } } };
  const result = await writeCookies(session, [
    { domain: "example.com", hostOnly: false, name: "sid", value: "v", path: "/", secure: true, httpOnly: true, sameSite: "lax", expirationDate: 123 },
    { domain: "host.com", hostOnly: true, name: "boom", value: "v", path: "/", secure: false, httpOnly: false, sameSite: "unspecified", expirationDate: null },
  ]);
  assert.equal(result.written, 1);
  assert.equal(result.failed, 1);
  assert.equal(captured[0].url, "https://example.com/");
  assert.equal(captured[0].domain, ".example.com");
  assert.equal(captured[0].expirationDate, 123);
  assert.equal(cookieUrl({ secure: false, domain: "host.com", path: "/a" }), "http://host.com/a");
});

test("importCookies copies into the session and flags app-bound sign-in", async t => {
  const key = crypto.randomBytes(32);
  const { source } = fakeProfile(t, { version: 10, rows: [
    { host_key: ".example.com", name: "sid", encrypted_value: encryptV10("v", key, ".example.com", 10), path: "/" },
    { host_key: ".locked.com", name: "ab", encrypted_value: Buffer.concat([Buffer.from("v20"), crypto.randomBytes(40)]), path: "/" },
  ] });
  const set = [];
  const session = { cookies: { set: async d => { set.push(d); } } };
  const summary = await importCookies(source, session, { platform: "win32", unprotect: () => key });
  assert.equal(summary.imported, 1);
  assert.equal(summary.appBound, 1);
  assert.equal(summary.needsSignin, true);
  assert.equal(set.length, 1);
});

test("a profile with no cookie store imports nothing", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-ck-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { cookies, summary } = readCookies({ browserId: "chrome", profilePath: root }, { platform: "win32", unprotect: () => Buffer.alloc(32) });
  assert.deepEqual(cookies, []);
  assert.equal(summary.discovered, 0);
});
