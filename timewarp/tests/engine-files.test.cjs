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

test("chat file cards refuse files on other computers before looking them up", { skip: process.platform !== "win32" && "network paths are a Windows feature" }, t => {
  const { createMethods } = require("../app/main/methods.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-cards-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "agent");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "report.md"), "# Report\n");
  let revealed = null;
  const methods = createMethods({
    store: { settings: { get: () => null } }, services: { auth: { userId: () => "user-1" } },
    agents: { get: () => ({ id: "agent-1", workspace: folder }) }, harness: { conversations: { get: () => ({ agentId: "agent-1" }) } },
    shell: { showItemInFolder: file => { revealed = file; }, openPath: async () => "" },
  });
  const report = methods["cards.resolve"]({ conversationId: "chat-1", path: "report.md" });
  assert.deepEqual([report.inside, report.exists, report.relative], [true, true, "report.md"]);
  // Looking one of these up would send the user's Windows sign-in to that computer.
  for (const file of ["\\\\attacker.invalid\\share\\a.png", "//attacker.invalid/share/a.png", "\\\\?\\UNC\\attacker.invalid\\share\\a.png", "\\\\.\\pipe\\x"]) {
    assert.throws(() => methods["cards.resolve"]({ conversationId: "chat-1", path: file }), error => error.status === 400, file);
    assert.throws(() => methods["cards.revealFile"]({ conversationId: "chat-1", path: file }), error => error.status === 400, file);
  }
  assert.equal(revealed, null);
});

test("programs, scripts and shortcuts in the workspace don't open from the Files view", async t => {
  const { createMethods } = require("../app/main/methods.cjs");
  const { agent } = workspace(t);
  const runnable = ["setup.bat", "run.ps1", "app.hta", "Report.lnk", "site.url", "macro.vbs", "tool.js", "help.chm"];
  for (const name of runnable) fs.writeFileSync(path.join(agent, name), "x");
  const opened = [];
  const methods = createMethods({
    store: { settings: { get: () => null } }, services: { auth: { userId: () => "user-1" } },
    agents: { get: () => ({ id: "agent-1", workspace: agent }) }, harness: { conversations: { get: () => ({ agentId: "agent-1" }) } },
    shell: { openPath: async file => { opened.push(file); return ""; }, showItemInFolder() {} },
  });
  for (const name of runnable) {
    await assert.rejects(methods["files.open"]({ agentId: "agent-1", path: name }), error => error.status === 400 && /Show in folder/.test(error.message), name);
  }
  assert.deepEqual(opened, []);
  assert.deepEqual(await methods["files.open"]({ agentId: "agent-1", path: "notes/plan.md" }), { opened: true });
  assert.deepEqual(opened, [fs.realpathSync(path.join(agent, "notes", "plan.md"))]);
  // Chat cards refuse the same files.
  await assert.rejects(methods["cards.openFile"]({ conversationId: "chat-1", path: "setup.bat" }), /don't open from a chat/);
});

test("dropped files are described like chosen ones, and a pasted image is saved in the profile", t => {
  const { createMethods } = require("../app/main/methods.cjs");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tw-paste-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  fs.writeFileSync(path.join(profile, "notes.txt"), "notes");
  fs.writeFileSync(path.join(profile, "shot.PNG"), "png");
  const methods = createMethods({ profile, store: { settings: { get: () => null } }, services: { auth: { userId: () => "user-1" } } });
  assert.deepEqual(methods["attachments.describe"]({ paths: [path.join(profile, "notes.txt"), path.join(profile, "shot.PNG"), profile, path.join(profile, "gone.txt"), "relative.txt", 7] }),
    [{ path: path.join(profile, "notes.txt"), image: false, size: 5 }, { path: path.join(profile, "shot.PNG"), image: true, size: 3 }], "Folders, missing files and relative paths are left out");
  const saved = methods["attachments.savePasted"]({ data: new Uint8Array([137, 80, 78, 71]).buffer, type: "image/png", name: "image.png" });
  assert.deepEqual([saved.image, saved.size, path.basename(saved.path)], [true, 4, "image.png"]);
  assert.ok(saved.path.startsWith(path.join(profile, "attachments") + path.sep));
  assert.deepEqual([...fs.readFileSync(saved.path)], [137, 80, 78, 71]);
  // Unnamed: named for its type; names can't leave the folder.
  assert.equal(path.basename(methods["attachments.savePasted"]({ data: new Uint8Array([1]), type: "image/jpeg", name: "" }).path), "pasted.jpg");
  assert.equal(path.dirname(methods["attachments.savePasted"]({ data: new Uint8Array([1]), type: "", name: "..\\..\\evil.txt" }).path).startsWith(path.join(profile, "attachments")), true);
  assert.throws(() => methods["attachments.savePasted"]({ data: new ArrayBuffer(0), type: "image/png" }), error => error.status === 400);
  assert.throws(() => methods["attachments.savePasted"]({ data: { length: 5 }, type: "image/png" }), error => error.status === 400);
});

test("a report goes with the app version, platform and the chat it was sent from", async () => {
  const { createMethods } = require("../app/main/methods.cjs");
  let sent = null;
  const methods = createMethods({ version: "2.0.1", services: { submitFeedback: async input => { sent = input; return { traceId: "20261010_0123456789abcdef" }; } },
    harness: { conversations: { get: id => { if (id !== "chat-1") throw new Error("unavailable"); return { id }; } } } });
  assert.deepEqual(await methods["feedback.submit"]({ description: "Stuck", category: "general", conversationId: "chat-1", route: "#/chat/chat-1" }), { traceId: "20261010_0123456789abcdef" });
  assert.deepEqual(sent, { description: "Stuck", route: "#/chat/chat-1", conversationId: "chat-1", environment: { app: "desktop", appVersion: "2.0.1", platform: process.platform } });
  await methods["feedback.submit"]({ description: "Other", conversationId: "someone-else" });
  assert.equal(sent.conversationId, null, "Only the user's own chats are named");
});

