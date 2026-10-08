"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createKnowledge } = require("../app/main/knowledge.cjs");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-knowledge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home"), runtimeDir = path.join(root, "runtime"), codexHome = path.join(runtimeDir, "codex");
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true }); fs.writeFileSync(path.join(home, file), text); };
  write(".claude/CLAUDE.md", "Keep replies short.\n");
  write(".claude/projects/app/memory/notes.md", "Launch in spring.\n");
  write(".claude/projects/app/session.jsonl", "{}\n");
  write(".claude/skills/summarize/SKILL.md", "---\nname: summarize\ndescription: Summaries.\n---\n");
  write(".claude/skills/summarize/scripts/run.py", "print(1)\n");
  write(".claude/skills/.hidden/SKILL.md", "hidden\n");
  write(".codex/AGENTS.md", "Prefer TypeScript.\n");
  write(".cursor/rules/style.mdc", "Use tabs.\n");
  write(".cursor/.cursorrules", "Be brief.\n");
  fs.mkdirSync(codexHome, { recursive: true });
  return { root, home, runtimeDir, codexHome, knowledge: createKnowledge({ runtimeDir, codexHome, home, env: {} }) };
}

test("other assistants' memory and skills are detected without reading unrelated files", t => {
  const { knowledge } = setup(t);
  const items = Object.fromEntries(knowledge.detect().items.map(item => [item.id, item.names]));
  assert.deepEqual(items["claude-code:memory"], ["CLAUDE.md", "projects/app/memory/notes.md"]);
  assert.deepEqual(items["claude-code:skills"], ["summarize"]);
  assert.deepEqual(items["codex-chatgpt:memory"], ["AGENTS.md"]);
  assert.deepEqual(items["cursor:memory"], ["rules/style.mdc", ".cursorrules"]);
  assert.equal(items["codex-chatgpt:skills"], undefined);
});

test("imports copy the selected files into the profile and skills into Codex", t => {
  const { home, runtimeDir, codexHome, knowledge } = setup(t);
  const result = knowledge.importItems([{ id: "claude-code:memory", names: ["projects/app/memory/notes.md"] }, { id: "claude-code:skills", names: ["summarize"] }]);
  assert.deepEqual(result.imported, { memoryFiles: 1, skills: 1 });
  assert.equal(fs.readFileSync(path.join(runtimeDir, "entities/memories/imports/claude-code/projects/app/memory/notes.md"), "utf8"), "Launch in spring.\n");
  assert.ok(fs.existsSync(path.join(codexHome, "skills/summarize/scripts/run.py")));
  assert.equal(fs.readFileSync(path.join(home, ".claude/CLAUDE.md"), "utf8"), "Keep replies short.\n");
  assert.deepEqual(knowledge.read().files.map(file => file.path), ["claude-code/projects/app/memory/notes.md"]);
  assert.deepEqual(knowledge.removeImport("claude-code/projects/app/memory/notes.md").files, []);
  assert.throws(() => knowledge.removeImport("../user.md"), /no longer exists/);
});

test("imports refuse selections that were not detected", t => {
  const { knowledge } = setup(t);
  assert.throws(() => knowledge.importItems([{ id: "claude-code:memory", names: ["../.codex/AGENTS.md"] }]), /no longer available/);
  assert.throws(() => knowledge.importItems([{ id: "claude-code:skills", names: [".hidden"] }]), /no longer available/);
  assert.throws(() => knowledge.importItems([]), /Select at least one/);
});

test("notes feed the agent instructions unless memory is off", t => {
  const { knowledge } = setup(t);
  assert.match(knowledge.instructions("enabled"), /memories[\\/]user\.md/);
  knowledge.saveNotes("Prefers metric units.");
  assert.match(knowledge.instructions("enabled"), /<user_notes>\nPrefers metric units\.\n<\/user_notes>/);
  assert.doesNotMatch(knowledge.instructions("disabled"), /metric/);
  assert.throws(() => knowledge.saveNotes("x".repeat(100001)), /under 100,000/);
});

test("skill folders connected by the previous app are found again", t => {
  const { runtimeDir, home, knowledge } = setup(t);
  fs.writeFileSync(path.join(runtimeDir, "setup-import-sync.json"), JSON.stringify({ version: 2, enabledItemIds: ["claude-code:skills", "cursor:skills", "unknown:skills", "claude-code:memory"] }));
  assert.deepEqual(knowledge.legacySkillRoots(), [path.join(home, ".claude", "skills")]);
});
