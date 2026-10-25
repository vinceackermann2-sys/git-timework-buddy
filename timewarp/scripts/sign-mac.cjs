"use strict";
// Signs the Mac app as electron-builder does (package-engine-mac.cjs), except
// that Codex's programs that run V8 (codex, and the host its code tool runs
// JavaScript in) get the entitlements OpenAI signs them with
// (assets/entitlements.codex.mac.plist). Under the hardened runtime V8 also
// makes memory executable that wasn't mapped for JIT, which needs
// allow-unsigned-executable-memory: with allow-jit alone, the code tool's host
// crashes on an Intel Mac at a GPT model's first tool call (openai/codex#30953),
// so no tool works. Everything else keeps the app's own entitlements.
const path = require("node:path");

const CODEX_V8 = /\/Contents\/Resources\/codex\/bin\/(?:codex|codex-app-server|codex-code-mode-host)$/;
const CODEX_ENTITLEMENTS = path.join(__dirname, "..", "assets", "entitlements.codex.mac.plist");

// electron-builder's signing options for each file, with Codex's entitlements
// for its V8 programs. @electron/osx-sign reads the result as it is, so it
// stays synchronous.
function withCodexEntitlements(optionsForFile) {
  return file => {
    const options = optionsForFile ? optionsForFile(file) : {};
    return CODEX_V8.test(file.split(path.sep).join("/")) ? { ...options, entitlements: CODEX_ENTITLEMENTS } : options;
  };
}

// electron-builder's own signing (with its retries), on the options it built.
async function sign(options) {
  const { sign: signApp } = require("app-builder-lib/out/codeSign/macCodeSign");
  return signApp({ ...options, optionsForFile: withCodexEntitlements(options.optionsForFile) });
}

module.exports = { sign, withCodexEntitlements, CODEX_ENTITLEMENTS };
