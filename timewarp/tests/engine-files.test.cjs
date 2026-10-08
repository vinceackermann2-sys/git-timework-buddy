"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFiles } = require("../app/main/files.cjs");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agent = path.join(root, "agent");
  fs.mkdirSync(path.join(agent, "notes"), { recursive: true });
  fs.mkdirSync(path.join(agent, "node_modules"));
  fs.writeFileSync(path.join(agent, "AGENTS.md"), "# Agent\n");
  fs.writeFileSync(path.join(agent, "notes", "plan.md"), "- one\n");
  fs.writeFileSync(path.join(agent, "script.py"), "print('hi')\n");
  fs.writeFileSync(path.join(agent, "people.tsv"), "a\tb\n");
  fs.writeFileSync(path.join(agent, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  fs.writeFileSync(path.join(agent, "pixel.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  fs.writeFileSync(path.join(root, "secret.txt"), "outside");
  return { root, agent, files: createFiles({ workspaceOf: () => agent }) };
}

test("the Files view lists folders first and hides tooling folders", t => {
  const { files } = workspace(t);
  const listing = files.list("a");
  assert.deepEqual(listing.entries.map(entry => entry.name), ["notes", "AGENTS.md", "blob.bin", "people.tsv", "pixel.png", "script.py"]);
  assert.equal(files.list("a", "notes").entries[0].path, "notes/plan.md");
});

test("files open as the right preview kind", t => {
  const { files } = workspace(t);
  assert.equal(files.read("a", "notes/plan.md").kind, "markdown");
  assert.deepEqual([files.read("a", "script.py").kind, files.read("a", "script.py").language], ["text", "python"]);
  assert.deepEqual([files.read("a", "people.tsv").kind, files.read("a", "people.tsv").delimiter], ["csv", "\t"]);
  assert.equal(files.read("a", "blob.bin").kind, "binary");
  assert.match(files.read("a", "pixel.png").dataUrl, /^data:image\/png;base64,/);
});

test("paths and links outside the agent's workspace are refused", t => {
  const { root, agent, files } = workspace(t);
  assert.throws(() => files.read("a", "../secret.txt"), /outside/);
  assert.throws(() => files.read("a", path.join(root, "secret.txt")), /outside|no longer exists/);
  let linked = false;
  try { fs.symlinkSync(path.join(root, "secret.txt"), path.join(agent, "link.txt")); linked = true; } catch {}
  if (linked) assert.throws(() => files.read("a", "link.txt"), /outside/);
});

test("search finds names in nested folders and skips hidden ones", t => {
  const { agent, files } = workspace(t);
  fs.writeFileSync(path.join(agent, "node_modules", "plan.js"), "");
  assert.deepEqual(files.search("a", "PLAN").map(entry => entry.path), ["notes/plan.md"]);
  assert.deepEqual(files.search("a", "  "), []);
});
