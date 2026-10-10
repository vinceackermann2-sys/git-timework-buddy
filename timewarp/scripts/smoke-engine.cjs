"use strict";
// Smoke test of a packaged Timewarp engine app, on Windows or macOS: the app
// starts with a throwaway profile and shows the sign-in screen, and its
// bundled Codex runs a conversation against a local fake model. No account,
// network or credits are used.
// Usage: node scripts/smoke-engine.cjs <Timewarp.exe | Timewarp.app>
const fs = require("node:fs");
const path = require("node:path");
const { startup, engine } = require("./bench-engine.cjs");

function locate(target) {
  const app = path.resolve(target);
  if (app.endsWith(".app")) {
    const executable = fs.readdirSync(path.join(app, "Contents", "MacOS"))[0];
    return { exe: path.join(app, "Contents", "MacOS", executable), resources: path.join(app, "Contents", "Resources") };
  }
  return { exe: app, resources: path.join(path.dirname(app), "resources") };
}

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node scripts/smoke-engine.cjs <Timewarp.exe | Timewarp.app>");
  const { exe, resources } = locate(target);
  const codex = path.join(resources, "codex");
  const app = await startup(exe);
  if (!app.signInMs) throw new Error("The sign-in screen didn't appear.");
  const agent = await engine({ exe: path.join(codex, "bin", process.platform === "win32" ? "codex.exe" : "codex"), leadingArgs: ["app-server"], resources: codex });
  if (!(agent.followUp.replyMs > 0)) throw new Error("The bundled Codex didn't complete a conversation.");
  const report = { checkedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, app: path.basename(target), startup: app, agent };
  fs.mkdirSync(path.resolve(__dirname, "..", "reports"), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, "..", "reports", `engine-smoke-${process.platform}-${process.arch}.json`), JSON.stringify(report, null, 2));
  console.log(`Smoke test passed: sign-in screen after ${app.signInMs} ms, ${app.workingSetMb} MB; a conversation through the bundled Codex in ${agent.first.replyMs} ms.`);
}

main().catch(error => { console.error("Smoke test failed:", error.message); process.exitCode = 1; });
