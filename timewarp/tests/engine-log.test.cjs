"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLog } = require("../app/main/log.cjs");

test("the app log writes tagged lines, keeps one older file and returns its tail", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tw-log-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = createLog(path.join(directory, "logs"), { now: () => new Date("2026-10-09T10:00:00Z") });
  log.info("startup", "Timewarp starting", { platform: "win32" });
  log.warn("codex:app-server:stderr", "line\nwith  breaks");
  assert.deepEqual(log.tail(5), [
    '2026-10-09T10:00:00.000Z [info] [startup] Timewarp starting {"platform":"win32"}',
    "2026-10-09T10:00:00.000Z [warn] [codex:app-server:stderr] line with breaks",
  ]);
  const big = "x".repeat(1900);
  for (let index = 0; index < 3000; index++) log.info("turn", big);
  assert.ok(fs.existsSync(path.join(directory, "logs", "main.1.log")), "The log rotates");
  assert.ok(fs.statSync(path.join(directory, "logs", "main.log")).size <= 5 * 1024 * 1024);
});

test("web addresses reach the log as their origin only, from console lines and process warnings", () => {
  const { originsOnly, captureConsole } = require("../app/main/log.cjs");
  const { EventEmitter } = require("node:events");
  assert.equal(originsOnly("Failed to load URL: https://bank.example/reset?token=abc#x with error: ERR_ABORTED"), "Failed to load URL: https://bank.example with error: ERR_ABORTED");
  assert.equal(originsOnly("open http://user:pw@intranet.local:8080/a/b and wss://socket.example/feed?id=1"), "open http://intranet.local:8080 and wss://socket.example");
  assert.equal(originsOnly("no address here"), "no address here");
  // Electron reports a page that didn't load as a process warning, which Node
  // prints through console.error unless a handler takes its place.
  const printed = [], written = [], recent = [];
  const fakeConsole = { error: (...args) => printed.push(["error", ...args]), warn: (...args) => printed.push(["warn", ...args]) };
  const fakeProcess = new EventEmitter();
  fakeProcess.on("warning", warning => fakeConsole.error(`(node:1) ${warning.name}: ${warning.message}`));
  const log = { warn: (tag, message) => written.push(["warn", tag, message]), error: (tag, message) => written.push(["error", tag, message]) };
  captureConsole({ console: fakeConsole, process: fakeProcess, recent, log: () => log });
  assert.equal(fakeProcess.listenerCount("warning"), 1, "Node's own printer is replaced");
  fakeProcess.emit("warning", Object.assign(new Error("Failed to load URL: https://mail.example/inbox/msg-123?search=lawyer with error: ERR_NAME_NOT_RESOLVED"), { name: "electron" }));
  fakeConsole.error("[timewarp] Sign-in failed at https://auth.example/callback?code=secret");
  // The log file and the diagnostics lines; the terminal still gets what was printed.
  const everything = JSON.stringify([written, recent]);
  assert.ok(!/inbox|lawyer|callback|code=secret/.test(everything), everything);
  assert.deepEqual(written, [
    ["warn", "console", "(electron) Failed to load URL: https://mail.example with error: ERR_NAME_NOT_RESOLVED"],
    ["error", "timewarp", "Sign-in failed at https://auth.example"],
  ]);
  assert.equal(recent.length, 2);
  assert.equal(printed[0][1], "(electron) Failed to load URL: https://mail.example with error: ERR_NAME_NOT_RESOLVED");
});

test("every log line is cleaned where it is written: addresses to their origin, tokens and keys removed", t => {
  const { redact } = require("../app/main/log.cjs");
  assert.equal(redact("Authorization: Bearer abcdefghijklmnop123"), "Authorization: Bearer [redacted]");
  assert.equal(redact('token=supersecret123 api_key: "sk-abcdefghijklmnopqrstuvwxyz"'), 'token=[redacted] api_key: "[redacted]"');
  assert.equal(redact("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P"), "jwt [redacted]");
  assert.equal(redact("mode=enabled tokens=12 keyPath=mcp_servers.x"), "mode=enabled tokens=12 keyPath=mcp_servers.x", "ordinary values stay");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tw-log-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = createLog(directory, { now: () => new Date("2026-10-10T10:00:00Z") });
  // Codex's stderr and renderer errors reach the log directly, not through the console.
  log.warn("codex:app-server:stderr", "GET https://api.example.com/v1/x?token=abc123456 failed", { url: "https://mcp.example.com/sse?key=zzzzzzzz", durationMs: 1200 });
  assert.deepEqual(log.tail(1), ['2026-10-10T10:00:00.000Z [warn] [codex:app-server:stderr] GET https://api.example.com failed {"url":"https://mcp.example.com","durationMs":1200}']);
});
