"use strict";
// Native verification with synthetic cookies and an isolated profile. Does not
// open or change any installed browser's real data. Run with Node.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const assert = require("node:assert/strict");

async function native() {
  const { app, BrowserWindow } = require("electron");
  const root = process.env.TIMEWARP_COOKIE_FIXTURE;
  app.setPath("userData", path.join(root, "app"));
  app.setName("Timewarp import verification");
  await app.whenReady();
  app.on("window-all-closed", () => {});
  const { openStore } = require("../app/main/store.cjs");
  const { createBrowser } = require("../app/main/browser.cjs");
  const { createBrowserImport, consolidateBrowserProfiles } = require("../app/main/browser-import.cjs");
  const { createMethods } = require("../app/main/methods.cjs");
  const store = openStore(path.join(root, "store.sqlite"));
  const browser = createBrowser({ window: () => null, store });
  if (process.env.TIMEWARP_COOKIE_STAGE === "import") {
    const old = store.browserProfiles.create({ label: "Old profile" });
    await browser.sessionFor(old.id, { migration: true }).cookies.set({ url: "http://127.0.0.1/", name: "previous", value: "previous-fixture", expirationDate: Date.now() / 1000 + 86400 });
    await consolidateBrowserProfiles({ store, sessionFor: id => browser.sessionFor(id, { migration: true }) });
    const browserImport = createBrowserImport({ store, sessionFor: browser.sessionFor, userId: () => "fixture" });
    const methods = createMethods({ store, services: { auth: { userId: () => "fixture" } }, browserImport });
    const result = await methods["browser.importProfile"]({ browserId: "chrome", profilePath: "Default" });
    assert.equal(result.summary.imported, 1);
    assert.equal(result.summary.failedDecryption, 0);
    assert.equal(methods["browser.profiles"]().length, 1);
  }
  const session = browser.sessionFor("any-old-id");
  const cookies = await session.cookies.get({ url: "http://127.0.0.1/" });
  assert.ok(cookies.some(cookie => cookie.name === "session" && cookie.value === "signed-in-fixture" && cookie.httpOnly));
  assert.ok(cookies.some(cookie => cookie.name === "previous" && cookie.value === "previous-fixture"));
  const server = require("node:http").createServer((req, res) => {
    const signedIn = req.headers.cookie?.includes("session=signed-in-fixture");
    res.end("<!doctype html><title>Import verification</title><h1>" + (signedIn ? "Signed in" : "Signed out") + "</h1>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const window = new BrowserWindow({ show: false, webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('h1').textContent"), "Signed in");
  assert.equal(await window.webContents.executeJavaScript("document.cookie.includes('session=')"), false, "HttpOnly stays private to network requests");
  await session.cookies.flushStore();
  window.destroy();
  await new Promise(resolve => server.close(resolve));
  browser.destroy(); store.close();
  console.log("Native cookie import " + process.env.TIMEWARP_COOKIE_STAGE + ": passed");
  app.exit(0);
}

async function controller() {
  if (process.platform !== "win32") throw new Error("This native fixture currently verifies Windows DPAPI. Portable tests cover macOS and Linux cookie formats.");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-native-cookie-"));
  try {
    const { DatabaseSync } = require("node:sqlite");
    const source = path.join(root, "Google/Chrome/User Data"), directory = path.join(source, "Default/Network");
    fs.mkdirSync(directory, { recursive: true });
    const key = crypto.randomBytes(32);
    const protect = "Add-Type -AssemblyName System.Security; [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String([Console]::In.ReadToEnd()), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)))";
    const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", protect], { input: key.toString("base64"), encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, "fixture key is protected with Windows DPAPI");
    fs.writeFileSync(path.join(source, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Fixture" } } }, os_crypt: { encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from(result.stdout, "base64")]).toString("base64") } }));
    const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const body = Buffer.concat([crypto.createHash("sha256").update("127.0.0.1").digest(), Buffer.from("signed-in-fixture")]);
    const encrypted = Buffer.concat([Buffer.from("v10"), nonce, cipher.update(body), cipher.final(), cipher.getAuthTag()]);
    const db = new DatabaseSync(path.join(directory, "Cookies"));
    db.exec("create table meta(key text,value text); insert into meta values('version','24'); create table cookies(host_key text,name text,value text,encrypted_value blob,path text,is_secure integer,is_httponly integer,samesite integer,is_persistent integer,expires_utc integer,top_frame_site_key text)");
    db.prepare("insert into cookies values('127.0.0.1','session','',?,'/',0,1,1,1,?,'')").run(encrypted, BigInt(Math.round((Date.now() / 1000 + 86400 + 11644473600) * 1000000)));
    db.close();
    for (const stage of ["import", "restart"]) await new Promise((resolve, reject) => {
      const env = { ...process.env, LOCALAPPDATA: root, TIMEWARP_COOKIE_FIXTURE: root, TIMEWARP_COOKIE_STAGE: stage };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = cp.spawn(require("electron"), [__filename], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
      let output = "";
      child.stdout.on("data", bytes => output += bytes);
      child.stderr.on("data", bytes => output += bytes);
      const timer = setTimeout(() => { child.kill(); reject(new Error("Native cookie verification timed out.")); }, 60000);
      child.on("error", reject);
      child.on("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(output.slice(-2500))); else { console.log(output.split(/\r?\n/).find(line => line.startsWith("Native cookie import"))); resolve(); } });
    });
  } finally {
    // root is a fresh mkdtemp child of the OS temp directory, never user data.
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) && path.dirname(root) !== os.tmpdir()) throw new Error("Unexpected fixture cleanup path.");
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (process.versions.electron) native().catch(error => { console.error(error); require("electron").app.exit(1); });
else controller().catch(error => { console.error(error.message); process.exitCode = 1; });
