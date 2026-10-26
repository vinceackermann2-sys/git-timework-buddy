"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { readBrowserCookies, cookieDetails, decryptCookie, cookieKey, readCookieExport } = require("../app/main/browser-cookies.cjs");
const { writeHelper, createBrowserImportHelper } = require("../app/main/browser-import-helper.cjs");

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-cookie-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function encrypt(value, host, key, platform = "win32", version = 24) {
  const body = Buffer.concat([...(version >= 24 ? [crypto.createHash("sha256").update(host).digest()] : []), Buffer.from(value)]);
  const iv = platform === "win32" ? Buffer.alloc(12, 1) : Buffer.alloc(16, 32);
  const cipher = crypto.createCipheriv(platform === "win32" ? "aes-256-gcm" : "aes-128-cbc", key, iv);
  return Buffer.concat([Buffer.from("v10"), ...(platform === "win32" ? [iv] : []), cipher.update(body), cipher.final(), ...(platform === "win32" ? [cipher.getAuthTag()] : [])]);
}

test("encrypted cookies retain their value, verify the host hash and reject tampering", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const key = Buffer.alloc(platform === "win32" ? 32 : 16, 7);
    const encrypted = encrypt("signed-in-fixture", ".example.com", key, platform);
    assert.equal(decryptCookie(encrypted, { platform, key, host: ".example.com", version: 24 }), "signed-in-fixture");
    assert.throws(() => decryptCookie(encrypted, { platform, key, host: "other.example", version: 24 }));
    assert.equal(decryptCookie(encrypt("older-value", "example.com", key, platform, 23), { platform, key, host: "example.com", version: 23 }), "older-value");
  }
  assert.throws(() => decryptCookie(Buffer.from("v20fixture"), { platform: "win32" }), /helper/);
});

test("cookie conversion preserves host scope, security, expiry and SameSite without broadening partitioned cookies", () => {
  const base = { domain: "example.com", name: "session", value: "fixture", path: "/account", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 2000000000 };
  assert.deepEqual(cookieDetails(base, 100), { url: "https://example.com/", name: "session", value: "fixture", path: "/account", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 2000000000 });
  assert.equal(cookieDetails({ ...base, domain: ".example.com" }, 100).domain, ".example.com");
  assert.equal(cookieDetails({ ...base, domain: ".example.com", hostOnly: true }, 100).domain, undefined);
  assert.equal(cookieDetails({ ...base, expirationDate: 50 }, 100), null);
  assert.equal(cookieDetails({ ...base, partitionKey: { topLevelSite: "https://elsewhere.example" } }), null);
  assert.equal(cookieDetails({ ...base, domain: "example.com/path" }), null);
  assert.equal(cookieDetails({ ...base, session: true }).expirationDate, undefined);
  assert.equal(cookieDetails({ ...base, value: "" }).value, "");
});

test("reading a source cookie database decrypts supported cookies, counts protected ones and never modifies it", async t => {
  const directory = temp(t), file = path.join(directory, "Cookies"), key = Buffer.alloc(32, 7);
  const db = new DatabaseSync(file);
  db.exec("create table meta(key text, value text); insert into meta values('version','24'); create table cookies(host_key text, name text, value text, encrypted_value blob, path text, is_secure integer, is_httponly integer, samesite integer, is_persistent integer, expires_utc integer, top_frame_site_key text)");
  const insert = db.prepare("insert into cookies values('.example.com',?,?,?,'/',1,1,1,1,20000000000000000,'')");
  insert.run("encrypted", "", encrypt("fixture", ".example.com", key));
  insert.run("plain", "plain-fixture", Buffer.alloc(0));
  insert.run("protected", "", Buffer.from("v20protected"));
  insert.run("partitioned", "partition-fixture", Buffer.alloc(0));
  insert.run("expired", "expired-fixture", Buffer.alloc(0));
  db.exec("update cookies set top_frame_site_key = 'https://elsewhere.example' where name = 'partitioned'; update cookies set expires_utc = 1000000 where name = 'expired'");
  db.close();
  const before = fs.readFileSync(file);
  const result = await readBrowserCookies({ root: directory, directory, browserId: "chrome", platform: "win32", getKey: async () => key });
  assert.equal(result.cookies.length, 2);
  assert.equal(result.cookies[0].value, "fixture");
  assert.equal(result.cookies[0].sameSite, "lax");
  assert.equal(result.failedDecryption, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(fs.readFileSync(file), before);
});

test("cookie keys use the selected browser's OS keychain and Windows DPAPI", async t => {
  const root = temp(t), key = Buffer.alloc(32, 7);
  fs.writeFileSync(path.join(root, "Local State"), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from("wrapped")]).toString("base64") } }));
  assert.deepEqual(await cookieKey({ root, platform: "win32", browserId: "chrome", dpapi: async bytes => { assert.equal(bytes.toString(), "wrapped"); return key; } }), key);
  const calls = [], run = async (...args) => { calls.push(args); return "keychain-password"; };
  const mac = await cookieKey({ platform: "darwin", browserId: "edge", run });
  assert.deepEqual(mac, crypto.pbkdf2Sync("keychain-password", "saltysalt", 1003, 16, "sha1"));
  assert.deepEqual(calls[0], ["/usr/bin/security", ["find-generic-password", "-w", "-s", "Microsoft Edge Safe Storage"]]);
  await cookieKey({ platform: "linux", browserId: "chrome", run });
  assert.deepEqual(calls[1], ["secret-tool", ["lookup", "application", "chrome"]]);
});

test("the protected-cookie helper runs offline and accepts only a bounded cookie export", async t => {
  const directory = writeHelper(path.join(temp(t), "helper"));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json")));
  assert.deepEqual(manifest.permissions, ["cookies", "downloads"]);
  const code = fs.readFileSync(path.join(directory, "popup.js"), "utf8");
  assert.match(code, /chrome.cookies.getAll/);
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|https?:\/\//);
  new Function(code);
  const file = path.join(directory, "cookies.json");
  fs.writeFileSync(file, JSON.stringify({ cookies: [{ name: "session", value: "fixture", domain: "example.com" }] }));
  assert.equal(readCookieExport(file).length, 1);
  let opens = 0;
  const assist = createBrowserImportHelper({ profile: directory, shell: { openPath: async () => { opens++; return ""; } }, dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } });
  assert.equal((await assist({ browser: "Chrome", label: "Work", source: { browserId: "chrome" } })).length, 1);
  assert.equal(opens, 1);
  fs.writeFileSync(file, '{"cookies":[{"value":"wrong"}]}');
  assert.throws(() => readCookieExport(file), /valid cookies/);
});
