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

test("skills linked in by a skill installer are found and copied", t => {
  const { home, codexHome, knowledge } = setup(t);
  const shared = path.join(home, ".agents/skills/find-skills");
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, "SKILL.md"), "---\nname: find-skills\ndescription: Find skills.\n---\n");
  fs.mkdirSync(path.join(home, ".codex/skills"), { recursive: true });
  fs.symlinkSync(shared, path.join(home, ".codex/skills/find-skills"), "junction");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tw-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "SKILL.md"), "outside\n");
  fs.symlinkSync(outside, path.join(home, ".codex/skills/elsewhere"), "junction");
  const items = Object.fromEntries(knowledge.detect().items.map(item => [item.id, item.names]));
  assert.deepEqual(items["codex-chatgpt:skills"], ["find-skills"], "links outside the user's folders are ignored");
  knowledge.importItems([{ id: "codex-chatgpt:skills", names: ["find-skills"] }]);
  const copied = path.join(codexHome, "skills/find-skills");
  assert.equal(fs.lstatSync(copied).isSymbolicLink(), false);
  assert.match(fs.readFileSync(path.join(copied, "SKILL.md"), "utf8"), /Find skills/);
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
