"use strict";
// The previous app's memory store, a bare Git repository, is read without Git:
// loose objects, packs and deltas. Git only builds the test repositories.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createKnowledge } = require("../app/main/knowledge.cjs");
const { readBranch, importLegacyMemory, storeName, applyDelta } = require("../app/main/legacy-memory.cjs");

let gitAvailable = true;
try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { gitAvailable = false; }
const skip = !gitAvailable && "Git is not installed";

const USER = "00000000-0000-4000-8000-000000000042";
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const settingsStore = () => { const values = new Map(); return { get: (key, fallback = null) => values.has(key) ? values.get(key) : fallback, set: (key, value) => values.set(key, value) }; };
const digest = folder => { const hash = crypto.createHash("sha256"); const walk = dir => { for (const name of fs.readdirSync(dir).sort()) { const full = path.join(dir, name); if (fs.statSync(full).isDirectory()) walk(full); else hash.update(name).update(fs.readFileSync(full)); } }; walk(folder); return hash.digest("hex"); };

// A bare repository like the previous app's, built from commits of files.
function memoryRepo(root, name, commits, { pack = false, date = "2026-10-01T10:00:00Z" } = {}) {
  const work = path.join(root, name + "-work"), bare = path.join(root, name + ".git");
  fs.mkdirSync(work, { recursive: true });
  git(work, "init", "-q");
  for (const files of commits) {
    for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true }); fs.writeFileSync(path.join(work, file), text); }
    git(work, "add", "-A");
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "Update personal memory"], { cwd: work, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
  }
  git(root, "clone", "-q", "--bare", work, bare);
  if (pack) { git(bare, "repack", "-adf", "--window=50", "--depth=50"); git(bare, "pack-refs", "--all"); git(bare, "prune-packed"); }
  return bare;
}
const notesV1 = "# User\n\n" + Array.from({ length: 80 }, (_, index) => `- Fact ${index}: the user prefers option ${index % 7}.`).join("\n") + "\n";
const notesV2 = notesV1.replace("Fact 40: the user prefers option 5.", "Fact 40: changed to option 6.") + "- Works at Halden (2026-10-02).\n";

test("a packed memory store with deltas reads like Git wrote it", { skip }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-legacy-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bare = memoryRepo(root, "packed", [
    { "memory/user.md": notesV1, "memory/daily-logs/2026-10-01.md": "---\nsummary: First day.\n---\n- Met Avery.\n", ".energy-memory.json": "{}\n", "notes.txt": "not memory\n" },
    { "memory/user.md": notesV2, "memory/people/index.md": "# People\n\n- Avery: colleague.\n" },
  ], { pack: true });
  assert.ok(!fs.existsSync(path.join(bare, "refs", "heads", "main")), "The branch is in packed-refs");
  assert.match(git(bare, "verify-pack", "-v", ...fs.readdirSync(path.join(bare, "objects", "pack")).filter(name => name.endsWith(".idx")).map(name => path.join(bare, "objects", "pack", name))), /chain length = 1/, "The pack has deltas");
  const branch = readBranch(bare);
  assert.equal(branch.commit, git(bare, "rev-parse", "main").trim());
  assert.deepEqual(Object.keys(branch.files).sort(), ["memory/daily-logs/2026-10-01.md", "memory/people/index.md", "memory/user.md"]);
  assert.equal(branch.files["memory/user.md"].toString(), notesV2);
  assert.equal(branch.time, Date.parse("2026-10-01T10:00:00Z"));
});

test("a delta copies and inserts as Git's format says", () => {
  const base = Buffer.from("Hello, Timewarp agent!");
  // Sizes 22 -> 19: copy 7 bytes from 0 ("Hello, "), insert "Orbit", copy 7 from 15 (" agent!").
  const delta = Buffer.from([22, 19, 0x90, 7, 5, ...Buffer.from("Orbit"), 0x91, 15, 7]);
  assert.equal(applyDelta(base, delta).toString(), "Hello, Orbit agent!");
  assert.throws(() => applyDelta(base, Buffer.from([21, 1, 1, 0x41])), /doesn't match/);
});

test("the previous app's newest memory is imported once and its store is left as it was", { skip }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-legacy-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime"), codexHome = path.join(runtimeDir, "codex");
  const stores = path.join(runtimeDir, "personal-memory");
  fs.mkdirSync(path.join(stores, "standard"), { recursive: true }); fs.mkdirSync(path.join(stores, "private"), { recursive: true });
  // Standard: real memory from October 2. Private: an older one, and an empty init commit in another account's name.
  fs.renameSync(memoryRepo(root, "standard", [
    { "memory/user.md": notesV1 },
    { "memory/user.md": notesV2, "memory/daily-logs/2026-10-02.md": "---\nsummary: Joined Halden.\n---\n- Started at Halden.\n", "memory/people/index.md": "# People\n- Avery\n" },
  ], { pack: true, date: "2026-10-02T09:00:00Z" }), path.join(stores, "standard", storeName(USER)));
  fs.renameSync(memoryRepo(root, "private", [{ "memory/user.md": "# User\n\n- An older private note.\n" }], { date: "2026-09-01T09:00:00Z" }), path.join(stores, "private", storeName(USER)));
  fs.renameSync(memoryRepo(root, "other", [{}], { date: "2026-10-05T09:00:00Z" }), path.join(stores, "standard", storeName("someone-else")));
  const before = digest(stores);

  const knowledge = createKnowledge({ runtimeDir, codexHome, home: root, env: {} });
  const notes = path.join(runtimeDir, "entities/memories/user.md");
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, "# User\n\n_No long-term memory has been saved yet._\n");
  const settings = settingsStore(), logged = [];
  const result = importLegacyMemory({ runtimeDir, userId: USER, knowledge, settings, log: line => logged.push(line) });
  assert.deepEqual(result, { files: 3, notes: true, store: "standard" });
  assert.equal(fs.readFileSync(notes, "utf8"), notesV2, "Placeholder notes become the previous app's notes");
  const imported = path.join(runtimeDir, "entities/memories/imports/timewarp-previous");
  assert.match(fs.readFileSync(path.join(imported, "daily-logs/2026-10-02.md"), "utf8"), /Joined Halden/);
  assert.ok(fs.existsSync(path.join(imported, "people/index.md")));
  assert.ok(!fs.existsSync(path.join(imported, "user.md")));
  assert.match(knowledge.context("enabled", new Date(2026, 9, 3)), /2026-10-02 \(.*\): Joined Halden\./);
  assert.equal(digest(stores), before, "The previous app's stores are unchanged");
  assert.equal(logged.length, 1);
  assert.equal(importLegacyMemory({ runtimeDir, userId: USER, knowledge, settings }), null, "Only once per user");
});

test("notes someone already wrote are kept; the previous app's go beside the other files", { skip }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-legacy-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime"), codexHome = path.join(runtimeDir, "codex");
  fs.mkdirSync(path.join(runtimeDir, "personal-memory", "private"), { recursive: true });
  fs.renameSync(memoryRepo(root, "private", [{ "memory/user.md": "# User\n\n- Private note.\n" }]), path.join(runtimeDir, "personal-memory", "private", storeName(USER)));
  const knowledge = createKnowledge({ runtimeDir, codexHome, home: root, env: {} });
  knowledge.saveNotes("- Written in Timewarp.");
  const result = importLegacyMemory({ runtimeDir, userId: USER, knowledge, settings: settingsStore() });
  assert.deepEqual(result, { files: 1, notes: false, store: "private" });
  assert.equal(knowledge.read().notes, "- Written in Timewarp.\n");
  assert.equal(fs.readFileSync(path.join(runtimeDir, "entities/memories/imports/timewarp-previous/user.md"), "utf8"), "# User\n\n- Private note.\n");
});

test("a user without the previous app's memory is marked done", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-legacy-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime"), settings = settingsStore();
  const knowledge = createKnowledge({ runtimeDir, codexHome: path.join(runtimeDir, "codex"), home: root, env: {} });
  assert.deepEqual(importLegacyMemory({ runtimeDir, userId: USER, knowledge, settings }), { files: 0, notes: false, store: null });
  assert.equal(importLegacyMemory({ runtimeDir, userId: USER, knowledge, settings }), null);
});
