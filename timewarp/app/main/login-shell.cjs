"use strict";
// An app opened from Finder gets macOS's minimal PATH, without what the user's
// shell profile adds (Homebrew, nvm, pyenv and the like). As the previous app
// did, Timewarp asks the user's login shell for its PATH once and gives agent
// commands that PATH, with ~/.local/bin first.
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const START = "__TIMEWARP_PATH_START__", END = "__TIMEWARP_PATH_END__";

// The PATH an interactive login shell sets, or null (other platforms, a
// shell that fails or takes too long).
function loginShellPath({ env = process.env, platform = process.platform, run = execFile, timeoutMs = 5000 } = {}) {
  if (platform !== "darwin" && platform !== "linux") return Promise.resolve(null);
  const shell = env.SHELL && path.isAbsolute(env.SHELL) ? env.SHELL : platform === "darwin" ? "/bin/zsh" : "/bin/sh";
  return new Promise(resolve => {
    // Markers keep profile output (greetings, prompts) out of the value.
    run(shell, ["-ilc", `printf '%s%s%s' '${START}' "$PATH" '${END}'`], { env: { ...env, TERM: "dumb" }, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      const text = String(stdout || ""), start = text.lastIndexOf(START), end = text.lastIndexOf(END);
      resolve(!error && start >= 0 && end > start ? text.slice(start + START.length, end).trim() || null : null);
    });
  });
}

// ~/.local/bin, the login shell's PATH, then the app's own, without repeats.
function mergePath(current, shellPath, { home = os.homedir(), delimiter = path.delimiter } = {}) {
  const parts = [path.join(home, ".local", "bin"), ...String(shellPath || "").split(delimiter), ...String(current || "").split(delimiter)].filter(Boolean);
  return [...new Set(parts)].join(delimiter);
}

module.exports = { loginShellPath, mergePath };
