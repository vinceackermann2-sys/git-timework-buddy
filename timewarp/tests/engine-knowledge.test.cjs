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

test("notes reach each turn in full unless memory is off; the instructions stay the same", t => {
  const { knowledge } = setup(t);
  assert.match(knowledge.instructions("enabled"), /memories[\\/]user\.md/);
  const before = knowledge.instructions("enabled");
  assert.equal(knowledge.context("enabled"), null, "Nothing to carry yet");
  const long = "Prefers metric units.\n" + "Detail. ".repeat(2000);
  knowledge.saveNotes(long);
  assert.equal(knowledge.instructions("enabled"), before, "Notes don't change the thread's instructions");
  assert.ok(knowledge.context("enabled").includes("<user_notes>\n" + long.trim() + "\n</user_notes>"), "The whole file, not the first 8,000 characters");
  assert.match(knowledge.context("read"), /metric/);
  assert.equal(knowledge.context("disabled"), null);
  assert.equal(knowledge.context("write"), null);
  assert.doesNotMatch(knowledge.instructions("disabled"), /metric/);
  assert.throws(() => knowledge.saveNotes("x".repeat(100001)), /under 100,000/);
});

test("the memory context has today's log and the latest days' summaries, the previous app's included", t => {
  const { runtimeDir, knowledge } = setup(t);
  const logs = path.join(runtimeDir, "entities/memories/daily-logs"), previous = path.join(runtimeDir, "entities/memories/imports/timewarp-previous/daily-logs");
  fs.mkdirSync(logs, { recursive: true }); fs.mkdirSync(previous, { recursive: true });
  fs.writeFileSync(path.join(logs, "2026-10-10.md"), "---\nsummary: Booked the dentist.\n---\n# 2026-10-10\n- Booked the dentist for Friday.\n");
  fs.writeFileSync(path.join(logs, "2026-10-09.md"), "---\nsummary: \"Planned the Rome trip.\"\n---\n- Long details.\n");
  fs.writeFileSync(path.join(previous, "2026-10-01.md"), "# 2026-10-01\nSent the invoice to Avery.\n");
  for (let day = 11; day <= 20; day++) fs.writeFileSync(path.join(previous, `2026-09-${day}.md`), `---\nsummary: Day ${day}.\n---\n`);
  const context = knowledge.context("enabled", new Date(2026, 9, 10, 12));
  assert.match(context, /Today's log \(.*2026-10-10\.md\):\n---\nsummary: Booked the dentist\.[\s\S]*Friday/);
  assert.match(context, /- 2026-10-09 \(.*\): Planned the Rome trip\./);
  assert.match(context, /- 2026-10-01 \(.*timewarp-previous.*\): Sent the invoice to Avery\./);
  assert.equal((context.match(/^- \d{4}-/gm) || []).length, 7, "The latest seven earlier days");
  assert.doesNotMatch(context, /Day 11\./);
});

test("placeholder notes are replaced by imported notes, keeping setup's blocks", t => {
  const { runtimeDir, knowledge } = setup(t);
  const notes = path.join(runtimeDir, "entities/memories/user.md");
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, "# User\n\n_No long-term memory has been saved yet._\n\n<!-- timewarp:onboarding-name -->\nPreferred name: \"Vi\".\n<!-- /timewarp:onboarding-name -->\n");
  assert.equal(knowledge.notesArePlaceholder(), true);
  assert.match(knowledge.context("enabled"), /Preferred name/, "Setup's names still reach the agent");
  knowledge.adoptNotes("# User\n\n- Works at Halden.\n");
  const text = fs.readFileSync(notes, "utf8");
  assert.match(text, /^# User\n\n- Works at Halden\.\n\n<!-- timewarp:onboarding-name -->\nPreferred name: "Vi"\.\n<!-- \/timewarp:onboarding-name -->\n$/);
  assert.equal(knowledge.notesArePlaceholder(), false);
  assert.throws(() => knowledge.saveImport("timewarp-previous", "../user.md", "x"), /outside/);
});

test("skill folders connected by the previous app are found again", t => {
  const { runtimeDir, home, knowledge } = setup(t);
  fs.writeFileSync(path.join(runtimeDir, "setup-import-sync.json"), JSON.stringify({ version: 2, enabledItemIds: ["claude-code:skills", "cursor:skills", "unknown:skills", "claude-code:memory"] }));
  assert.deepEqual(knowledge.legacySkillRoots(), [path.join(home, ".claude", "skills")]);
});

test("skills linked in by a skill installer are found and copied", t => {
  const { home, codexHome, knowledge } = setup(t);
  const shared = path.join(home, "skill-store/find-skills");
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, "SKILL.md"), "---\nname: find-skills\ndescription: Find skills.\n---\n");
  fs.mkdirSync(path.join(home, ".codex/skills"), { recursive: true });
  fs.symlinkSync(shared, path.join(home, ".codex/skills/find-skills"), "junction");
  // Codex reads ~/.agents/skills itself, so a skill there isn't copied a second time.
  const agents = path.join(home, ".agents/skills/media-use");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, "SKILL.md"), "---\nname: media-use\ndescription: Media.\n---\n");
  fs.symlinkSync(agents, path.join(home, ".codex/skills/media-use"), "junction");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tw-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "SKILL.md"), "outside\n");
  fs.symlinkSync(outside, path.join(home, ".codex/skills/elsewhere"), "junction");
  const items = Object.fromEntries(knowledge.detect().items.map(item => [item.id, item.names]));
  assert.deepEqual(items["codex-chatgpt:skills"], ["find-skills", "media-use"], "links outside the user's folders are ignored");
  const result = knowledge.importItems([{ id: "codex-chatgpt:skills", names: ["find-skills", "media-use"] }]);
  assert.equal(result.imported.skills, 2);
  const copied = path.join(codexHome, "skills/find-skills");
  assert.equal(fs.lstatSync(copied).isSymbolicLink(), false);
  assert.match(fs.readFileSync(path.join(copied, "SKILL.md"), "utf8"), /Find skills/);
  assert.equal(fs.existsSync(path.join(codexHome, "skills/media-use")), false, "a skill Codex already loads isn't copied");
});

test("MCP servers are found in Codex, Claude and Cursor settings on Windows and macOS", t => {
  for (const platform of ["win32", "darwin"]) {
    const { root, home, runtimeDir, codexHome } = setup(t);
    const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    write(path.join(home, ".codex/config.toml"), 'model = "x"\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\n\n[mcp_servers.repl]\ncommand = "node"\nargs = ["server.js", "--port", "3000"]\n[mcp_servers.repl.env]\nTOKEN = "abc"\n[mcp_servers.timewarp_composio]\nurl = "http://127.0.0.1:7788/mcp"\n');
    write(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { github: { type: "stdio", command: "npx", args: ["-y", "gh-mcp"], env: { GH: "1" } } }, projects: {} }));
    const desktop = platform === "win32" ? path.join(root, "appdata/Claude/claude_desktop_config.json") : path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
    write(desktop, "\uFEFF" + JSON.stringify({ mcpServers: { files: { command: "files-mcp" }, github: { command: "ignored-duplicate" } } }));
    write(path.join(home, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { linear: { url: "https://mcp.linear.app/sse", headers: { Authorization: "Bearer x" } } } }));
    const knowledge = createKnowledge({ runtimeDir, codexHome, home, env: { APPDATA: path.join(root, "appdata") }, platform });
    const items = Object.fromEntries(knowledge.detect().items.map(item => [item.id, item.names]));
    assert.deepEqual(items["codex-chatgpt:mcp"], ["docs", "repl"], platform);
    assert.deepEqual(items["claude-code:mcp"], ["files", "github"], platform);
    assert.deepEqual(items["cursor:mcp"], ["linear"], platform);
    assert.deepEqual(knowledge.mcpServer("codex-chatgpt", "repl"), { command: "node", args: ["server.js", "--port", "3000"], env: { TOKEN: "abc" } });
    assert.equal(knowledge.mcpServer("claude-code", "github").command, "npx");
    assert.deepEqual(knowledge.mcpServer("cursor", "linear"), { url: "https://mcp.linear.app/sse", http_headers: { Authorization: "Bearer x" } });
    assert.throws(() => knowledge.mcpServer("codex-chatgpt", "timewarp_composio"), /no longer available/);
  }
});

test("a chosen Cursor project folder supplies its rules", t => {
  const { root, home, runtimeDir, codexHome } = setup(t);
  const project = path.join(root, "project");
  fs.mkdirSync(path.join(project, ".cursor/rules"), { recursive: true });
  fs.writeFileSync(path.join(project, ".cursor/rules/api.mdc"), "Use REST.\n");
  fs.writeFileSync(path.join(project, "AGENTS.md"), "Run tests.\n");
  const knowledge = createKnowledge({ runtimeDir, codexHome, home, env: {}, cursorRoot: () => project });
  const items = Object.fromEntries(knowledge.detect().items.map(item => [item.id, item.names]));
  assert.deepEqual(items["cursor:memory"], [".cursor/rules/api.mdc", "AGENTS.md"]);
});
