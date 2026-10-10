"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { createSandbox, CHECK_TOKEN } = require("../app/main/sandbox.cjs");
const { CodexClient, CodexError } = require("../app/main/codex-client.cjs");
const { vendorRoot, codexExecutable, codexEnv } = require("../app/main/codex-paths.cjs");
const { CODEX_FEATURES, WINDOWS_SANDBOX_FEATURES, THREAD_CONFIG, PERMISSIONS } = require("../app/main/codex-config.cjs");

// A Codex app server double: readiness, setup (answered by a notification), the
// check command and config writes, each scripted by the test.
function fakeCodex({ readiness = ["ready"], setup = { success: true }, check = () => ({ exitCode: 0, stdout: CHECK_TOKEN + "\r\n" }) } = {}) {
  const client = new EventEmitter(), calls = [];
  let ready = [...readiness];
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "windowsSandbox/readiness") return { status: ready.length > 1 ? ready.shift() : ready[0] };
    if (method === "windowsSandbox/setupStart") {
      setImmediate(() => client.emit("notification", { method: "windowsSandbox/setupCompleted", params: { mode: params.mode, success: setup.success, error: setup.error ?? null } }));
      return { started: true };
    }
    if (method === "command/exec") return check(params);
    if (method === "config/value/write") return { status: "ok" };
    throw new Error("Unexpected " + method);
  };
  return { client, calls, methods: () => calls.map(call => call.method) };
}

function settingsStore(initial = {}) {
  const values = { ...initial };
  return { get: key => values[key], set: (key, value) => { values[key] = value; }, values };
}

const options = (codex, extra = {}) => {
  const restarts = [];
  return { restarts, sandbox: createSandbox({ client: codex.client, settings: extra.settings || settingsStore(), cwd: "C:\\Profile\\runtime\\agents", restart: async opts => { restarts.push(opts); codex.client.emit("status", { status: "starting" }); }, codexVersion: "0.160.1", platform: "win32", checkTimeoutMs: 50, setupTimeoutMs: 1000, ...extra }) };
};

test("macOS and Linux need no setup and Codex isn't asked", async () => {
  const codex = fakeCodex();
  const sandbox = createSandbox({ client: codex.client, settings: settingsStore(), cwd: "/tmp", restart: async () => {}, platform: "darwin" });
  assert.deepEqual(await sandbox.ensure({ setup: true }), { supported: false, status: "ready" });
  assert.deepEqual(await sandbox.status(), { supported: false, status: "ready" });
  assert.equal(sandbox.useAppContainer(), false);
  assert.deepEqual(codex.calls, []);
});

test("a sandbox Windows already offers is checked once per Codex run, without setup", async () => {
  const codex = fakeCodex();
  const { sandbox, restarts } = options(codex);
  assert.equal(sandbox.useAppContainer(), true);
  assert.deepEqual(await sandbox.ensure(), { supported: true, status: "ready" });
  assert.deepEqual(await sandbox.ensure(), { supported: true, status: "ready" });
  assert.deepEqual(codex.methods().filter(method => method === "command/exec").length, 1);
  assert.ok(!codex.methods().includes("windowsSandbox/setupStart"));
  assert.deepEqual(restarts, []);
  const [exec] = codex.calls.filter(call => call.method === "command/exec");
  assert.equal(exec.params.permissionProfile, ":workspace");
  assert.equal(exec.params.cwd, "C:\\Profile\\runtime\\agents");
  // Codex restarted: the next run is checked again.
  codex.client.emit("status", { status: "starting" });
  await sandbox.ensure();
  assert.equal(codex.methods().filter(method => method === "command/exec").length, 2);
});

test("without setup a sandbox that isn't there is left for onboarding", async () => {
  const codex = fakeCodex({ readiness: ["notConfigured"] });
  const { sandbox, restarts } = options(codex);
  assert.deepEqual(await sandbox.ensure(), { supported: true, status: "notConfigured" });
  assert.deepEqual(codex.methods(), ["windowsSandbox/readiness", "windowsSandbox/readiness"]);
  assert.deepEqual(restarts, []);
});

test("setup runs Codex's unelevated setup with a folder, restarts Codex and checks the sandbox", async () => {
  const codex = fakeCodex({ readiness: ["notConfigured", "ready"] });
  const { sandbox, restarts } = options(codex);
  assert.deepEqual(await sandbox.ensure({ setup: true }), { supported: true, status: "ready" });
  const start = codex.calls.find(call => call.method === "windowsSandbox/setupStart");
  assert.deepEqual(start.params, { mode: "unelevated", cwd: "C:\\Profile\\runtime\\agents" });
  assert.deepEqual(restarts, [{ urgent: false }]);
  assert.deepEqual(codex.methods(), ["windowsSandbox/readiness", "windowsSandbox/setupStart", "windowsSandbox/readiness", "command/exec"]);
});

test("updateRequired is set up again, as the previous app did", async () => {
  const codex = fakeCodex({ readiness: ["updateRequired", "ready"] });
  const { sandbox } = options(codex);
  assert.equal((await sandbox.ensure({ setup: true })).status, "ready");
  assert.ok(codex.methods().includes("windowsSandbox/setupStart"));
});

test("a failed setup reports Codex's error and changes nothing", async () => {
  const codex = fakeCodex({ readiness: ["notConfigured"], setup: { success: false, error: "Access denied" } });
  const { sandbox, restarts } = options(codex);
  await assert.rejects(sandbox.ensure({ setup: true }), /Access denied/);
  assert.deepEqual(restarts, []);
  assert.equal(sandbox.useAppContainer(), true);
});

test("a sandbox whose commands stall is turned off for this Codex version", async () => {
  const codex = fakeCodex({ check: () => new Promise(() => {}) });
  const settings = settingsStore();
  const { sandbox, restarts } = options(codex, { settings });
  const result = await sandbox.ensure({ setup: true });
  assert.equal(result.status, "unavailable");
  assert.match(result.error, /isn't available on this PC/);
  assert.deepEqual(restarts, [{ urgent: true }]);
  const write = codex.calls.find(call => call.method === "config/value/write");
  assert.deepEqual(write.params, { keyPath: "windows.sandbox", value: null, mergeStrategy: "replace" });
  assert.equal(settings.values.windowsSandbox.off, true);
  assert.equal(settings.values.windowsSandbox.codex, "0.160.1");
  // Codex starts without Windows' own sandbox, and later starts leave it off.
  assert.equal(sandbox.useAppContainer(), false);
  const calls = codex.calls.length;
  assert.equal((await sandbox.ensure({ setup: true })).status, "unavailable");
  assert.equal(codex.calls.length, calls);
});

test("a failing check command turns the sandbox off too", async () => {
  const codex = fakeCodex({ check: async () => ({ exitCode: 1, stdout: "", stderr: "denied" }) });
  const { sandbox } = options(codex);
  assert.equal((await sandbox.ensure()).status, "unavailable");
  const failed = fakeCodex({ check: async () => { throw new CodexError({ message: "failed to prepare MXC sandbox" }, "command/exec"); } });
  assert.equal((await options(failed).sandbox.ensure()).status, "unavailable");
});

test("Codex stopping during the check isn't held against the sandbox", async () => {
  const codex = fakeCodex({ check: async () => { throw new Error("Codex stopped."); } });
  const settings = settingsStore();
  const { sandbox, restarts } = options(codex, { settings });
  assert.equal((await sandbox.ensure()).status, "ready");
  assert.equal(settings.values.windowsSandbox, undefined);
  assert.deepEqual(restarts, []);
});

test("Retry clears a sandbox turned off earlier and a newer Codex is checked again", async () => {
  const settings = settingsStore({ windowsSandbox: { off: true, codex: "0.160.1" } });
  const codex = fakeCodex();
  const { sandbox, restarts } = options(codex, { settings });
  assert.equal((await sandbox.status()).status, "unavailable");
  assert.equal(sandbox.useAppContainer(), false);
  assert.equal((await sandbox.ensure({ setup: true, retry: true })).status, "ready");
  assert.equal(settings.values.windowsSandbox, null);
  assert.deepEqual(restarts, [{ urgent: false }]);
  const newer = createSandbox({ client: fakeCodex().client, settings: settingsStore({ windowsSandbox: { off: true, codex: "0.150.0" } }), cwd: "C:\\x", restart: async () => {}, codexVersion: "0.160.1", platform: "win32" });
  assert.equal(newer.useAppContainer(), true);
});

// The bundled Codex with a chat's permission profile: it writes in the
// workspace, can't write elsewhere and reaches the network. On Windows it runs
// where Windows offers its own sandbox; macOS uses Seatbelt with no setup.
let available = false;
try { available = fs.existsSync(codexExecutable(vendorRoot())); } catch {}
test("commands run in Codex's sandbox with a chat's permissions", { skip: !available && "Codex runtime is not installed", timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.homedir(), ".timewarp-sandbox-test-"));
  const workspace = path.join(root, "workspace"), outside = path.join(root, "outside"), home = path.join(root, "codex");
  for (const dir of [workspace, outside, home]) fs.mkdirSync(dir, { recursive: true });
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end("timewarp-network-ok"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const vendor = vendorRoot();
  const permissions = Object.entries(THREAD_CONFIG).filter(([key]) => /^permissions\.|^default_permissions$/.test(key)).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);
  const client = new CodexClient({
    executable: codexExecutable(vendor), cwd: workspace,
    args: [...CODEX_FEATURES, ...(process.platform === "win32" ? WINDOWS_SANDBOX_FEATURES : [])].flatMap(setting => ["-c", setting]).concat(permissions),
    env: { CODEX_HOME: home, ...codexEnv(vendor) }, clientInfo: { name: "timewarp", title: "Timewarp", version: "0.0.0-test" },
  });
  t.after(async () => {
    await client.stop(); server.close();
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch (error) { console.warn("cleanup:", error.message); }
  });
  if (process.platform === "win32") {
    const { status } = await client.request("windowsSandbox/readiness", {});
    if (status !== "ready") { t.skip("Windows offers no sandbox without setup here (" + status + ")"); return; }
  }
  const run = async script => {
    const command = process.platform === "win32" ? ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script] : ["/bin/sh", "-c", script];
    return Promise.race([client.request("command/exec", { command, cwd: workspace, permissionProfile: PERMISSIONS, timeoutMs: 30000 }), new Promise((_, reject) => setTimeout(() => reject(new Error("The sandboxed command stalled.")), 40000).unref())]);
  };
  const inside = path.join(workspace, "inside.txt"), escaped = path.join(outside, "escaped.txt"), url = `http://127.0.0.1:${server.address().port}/`;
  const windows = process.platform === "win32";
  await run(windows ? `Set-Content -LiteralPath '${inside}' -Value ok` : `printf ok > '${inside}'`);
  assert.ok(fs.existsSync(inside), "The command couldn't write in the workspace");
  await run(windows ? `Set-Content -LiteralPath '${escaped}' -Value escaped` : `printf escaped > '${escaped}'`);
  assert.ok(!fs.existsSync(escaped), "The command wrote outside the workspace");
  const fetched = await run(windows ? `(Invoke-WebRequest -UseBasicParsing -Uri '${url}').Content` : `curl -s '${url}'`);
  assert.match(fetched.stdout, /timewarp-network-ok/, "The command couldn't reach the network: " + fetched.stderr);
});
