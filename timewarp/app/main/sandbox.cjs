"use strict";
// Codex's command sandbox, which lets agent commands write in the agent's
// workspace without an approval review. On macOS (Seatbelt) and Linux Codex
// sandboxes commands without any setup.
//
// On Windows the previous app set up Codex's unelevated sandbox in onboarding
// ("Protect work with Windows security"), without administrator rights; the
// engine does the same, and once for accounts that finished setup without it.
// Where Windows offers its own app container sandbox (MXC), Codex uses that
// instead and nothing needs setting up (features.prefer_mxc, codex-config.cjs).
//
// Unlike the previous app's Codex build, the official one applies a setup only
// once it restarts, and its setup never finishes without a folder. Every run of
// Codex first checks that a sandboxed command finishes: security software can
// stall them all. A sandbox that fails the check is turned off for that Codex
// version, so commands get an approval review, as without a sandbox, instead
// of hanging.

const { CodexError } = require("./codex-client.cjs");

const CHECK_TOKEN = "timewarp-sandbox-ok";
const UNAVAILABLE = "Windows security isn't available on this PC. Commands are reviewed before they run instead.";

// settings: the app's settings store. cwd: a folder for the setup and the
// check (the agents' folder). restart({ urgent }): restarts Codex, once no
// reply is running (urgent: within a minute, as replies can't run commands).
// codexVersion: the bundled Codex's version.
function createSandbox({ client, settings, cwd, restart, codexVersion = null, log = () => {}, platform = process.platform, setupTimeoutMs = 120000, checkTimeoutMs = 20000 }) {
  const windows = platform === "win32";
  let checked = null; // this Codex run's check: a promise of true or false
  let running = null; // a setup or check in progress
  let checks = 0;
  let passed = false; // this Codex run's check passed
  client.on("status", ({ status }) => { if (status !== "ready") { checked = null; passed = false; } });

  const saved = () => settings.get("windowsSandbox") || null;
  // Turned off for this Codex version; a newer Codex is checked again.
  const off = () => { const value = saved(); return !!value?.off && value.codex === codexVersion; };

  function timeout(promise, ms, message) {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(message), { code: "timeout" })), ms); timer.unref?.(); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  async function readiness() {
    try { return (await client.request("windowsSandbox/readiness", {})).status; }
    catch (error) { log("warn", "Codex couldn't report the Windows sandbox: " + error.message); return "unavailable"; }
  }

  async function status() {
    if (!windows) return { supported: false, status: "ready" };
    if (off()) return { supported: true, status: "unavailable", error: UNAVAILABLE };
    const current = await readiness();
    if (current === "unavailable") return { supported: true, status: "unavailable", error: "Windows security setup is unavailable." };
    return { supported: true, status: current };
  }

  // Codex's unelevated setup, as the previous app ran it, waiting for Codex to
  // report the result.
  async function setUp() {
    let resolve;
    const completed = new Promise(done => { resolve = done; });
    const listener = ({ method, params }) => { if (method === "windowsSandbox/setupCompleted" && params?.mode === "unelevated") resolve(params); };
    client.on("notification", listener);
    try {
      const started = await client.request("windowsSandbox/setupStart", { mode: "unelevated", cwd });
      if (!started?.started) throw new Error("Windows security setup didn't start.");
      const result = await timeout(completed, setupTimeoutMs, "Windows security setup didn't finish.");
      if (!result.success) throw new Error(result.error || "Windows security setup failed.");
      log("info", "Windows sandbox set up");
    } finally { client.off("notification", listener); }
  }

  // Runs one harmless command with a chat's workspace permissions: true when
  // it finished, false when it failed or stalled, null when Codex stopped
  // meanwhile (checked again later). Codex can't stop a stalled sandboxed
  // command; turning the sandbox off restarts Codex, which ends it.
  function check() {
    if (checked) return checked;
    const processId = `timewarp-sandbox-check-${++checks}`;
    const started = Date.now();
    const run = client.request("command/exec", { command: ["cmd.exe", "/d", "/c", "echo " + CHECK_TOKEN], processId, cwd, permissionProfile: ":workspace", timeoutMs: checkTimeoutMs });
    checked = timeout(run, checkTimeoutMs + Math.min(5000, checkTimeoutMs), "The sandboxed check command didn't finish.")
      .then(result => {
        const ok = result?.exitCode === 0 && String(result.stdout || "").includes(CHECK_TOKEN);
        log(ok ? "info" : "warn", ok ? "Windows sandbox checked" : "The sandboxed check command failed", { ms: Date.now() - started, exitCode: result?.exitCode ?? null });
        passed = ok;
        return ok;
      }, error => {
        if (error.code !== "timeout" && !(error instanceof CodexError)) { checked = null; return null; }
        log("warn", "The sandboxed check command failed: " + error.message, { ms: Date.now() - started });
        return false;
      });
    return checked;
  }

  async function turnOff() {
    settings.set("windowsSandbox", { off: true, codex: codexVersion, at: new Date().toISOString() });
    await client.request("config/value/write", { keyPath: "windows.sandbox", value: null, mergeStrategy: "replace" }).catch(error => log("warn", "The Windows sandbox setting couldn't be removed: " + error.message));
    log("warn", "Windows sandbox turned off; commands are reviewed instead");
    await restart({ urgent: true });
  }

  // setup: set the sandbox up when it isn't yet (onboarding, and accounts that
  // finished it). retry: also after it was turned off on this PC. Without
  // setup, a sandbox that is already there (MXC, or one set up earlier) is
  // still checked.
  function ensure({ setup = false, retry = false } = {}) {
    if (!windows) return Promise.resolve({ supported: false, status: "ready" });
    if (running) return running;
    running = (async () => {
      if (off()) {
        if (!retry) return status();
        settings.set("windowsSandbox", null);
        await restart({ urgent: false });
      }
      let current = await readiness();
      if (current !== "ready") {
        if (!setup || current === "unavailable") return status();
        await setUp();
        await restart({ urgent: false });
        current = await readiness();
        if (current !== "ready") throw new Error("Windows security setup didn't finish. Try again.");
      }
      if (await check() === false) { await turnOff(); return status(); }
      return { supported: true, status: "ready" };
    })().finally(() => { running = null; });
    return running;
  }

  // Codex starts with Windows' app container sandbox unless it was turned off.
  const useAppContainer = () => windows && !off();
  // The sandbox ran a command in this Codex run (instructions.cjs: apply_patch
  // works then).
  const verified = () => windows && passed;

  return { status, ensure, useAppContainer, verified, UNAVAILABLE };
}

module.exports = { createSandbox, CHECK_TOKEN };
