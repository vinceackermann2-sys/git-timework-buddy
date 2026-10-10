"use strict";
// On a Mac, agent commands get the login shell's PATH; workers learn their agent.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loginShellPath, mergePath } = require("../app/main/login-shell.cjs");
const { workerInstructions, WORKER } = require("../app/main/instructions.cjs");

test("the login shell's PATH is read between markers, past profile output", async () => {
  const calls = [];
  const run = (shell, args, options, done) => { calls.push({ shell, args, options }); done(null, "Welcome back!\n__TIMEWARP_PATH_START__/opt/homebrew/bin:/Users/vi/.nvm/versions/node/v22/bin:/usr/bin__TIMEWARP_PATH_END__"); };
  const value = await loginShellPath({ env: { SHELL: "/bin/zsh", PATH: "/usr/bin" }, platform: "darwin", run });
  assert.equal(value, "/opt/homebrew/bin:/Users/vi/.nvm/versions/node/v22/bin:/usr/bin");
  assert.equal(calls[0].shell, "/bin/zsh");
  assert.equal(calls[0].args[0], "-ilc", "An interactive login shell, as the previous app used");
  assert.equal(await loginShellPath({ platform: "win32", run }), null, "Not on Windows");
  assert.equal(await loginShellPath({ env: {}, platform: "darwin", run: (_shell, _args, _options, done) => done(new Error("timed out"), "") }), null);
  assert.equal(mergePath("/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin", { home: "/Users/vi", delimiter: ":" }).split(":").join(" "), require("node:path").join("/Users/vi", ".local", "bin") + " /opt/homebrew/bin /usr/bin /bin");
});

test("workers are told their agent's ID for connected apps", () => {
  const text = workerInstructions({ id: "agent-123", name: "Orbit" });
  assert.ok(text.startsWith(WORKER));
  assert.match(text, /"Orbit"\. Its agent ID is agent-123/);
  assert.match(WORKER, /including sending or submitting/, "A request to send covers sending");
  assert.equal(workerInstructions(null), WORKER);
});
