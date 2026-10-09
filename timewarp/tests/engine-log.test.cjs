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
