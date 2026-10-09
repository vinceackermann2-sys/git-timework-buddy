"use strict";
// What agents know about the user: notes in memories/user.md, knowledge
// imported from other assistants on this computer, and Codex skills. Imports
// are copies; the other assistants' files are only read.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseToml } = require("./toml-lite.cjs");

const fail = (status, message) => Object.assign(new Error(message), { status });
const NOTES_LIMIT = 100_000, FILE_LIMIT = 16 * 1024 * 1024, MAX_FILES = 500, SKILL_FILES = 2000, SKILL_BYTES = 64 * 1024 * 1024;
const MEMORY_FILE = /\.(md|mdc|txt)$/i;
const SKILL_NAME = /^[A-Za-z0-9][\w.-]{0,99}$/;
const PROMPT_NOTES = 8000, PROMPT_FILES = 40;

const within = (base, target) => target === base || target.startsWith(base + path.sep);
function lstat(file) { try { return fs.lstatSync(file); } catch { return null; } }

// Memory-like files under a folder, without following links.
function collect(root, relative, files, depth = 0) {
  const full = path.join(root, relative), stat = lstat(full);
  if (!stat || stat.isSymbolicLink() || files.length >= MAX_FILES) return;
  if (stat.isDirectory()) {
    if (depth > 8) return;
    for (const entry of fs.readdirSync(full).sort()) {
      if ((entry.startsWith(".") && entry !== ".cursorrules") || entry === "node_modules") continue;
      collect(root, relative ? relative + "/" + entry : entry, files, depth + 1);
    }
  } else if (stat.isFile() && stat.size <= FILE_LIMIT && (MEMORY_FILE.test(full) || path.basename(full) === ".cursorrules")) files.push(relative);
}

function expand(root, pattern) {
  const [head, ...rest] = pattern.split("/");
  if (head !== "*") return [pattern];
  const stat = lstat(root);
  if (!stat?.isDirectory()) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(entry => [entry.name, ...rest].join("/"));
}

// Where Claude's desktop app keeps its settings on each platform.
function claudeDesktopConfig(home, env, platform) {
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json");
}

function createKnowledge({ runtimeDir, codexHome, cursorRoot = () => null, home = os.homedir(), env = process.env, platform = process.platform }) {
  const memoriesRoot = path.join(runtimeDir, "entities", "memories");
  const importsRoot = path.join(memoriesRoot, "imports");
  const notesFile = path.join(memoriesRoot, "user.md");
  const skillsRoot = path.join(codexHome, "skills");

  // Each assistant's folder, its memory files and the settings files that
  // list its MCP servers. The paths are the same on Windows and macOS except
  // for Claude's desktop app.
  function sources() {
    const codex = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, ".codex");
    const claude = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, ".claude");
    const cursor = cursorRoot() || path.join(home, ".cursor");
    return {
      "codex-chatgpt": { root: codex, memory: ["AGENTS.md", "memories"], mcp: [{ file: path.join(codex, "config.toml"), format: "toml" }] },
      "claude-code": {
        root: claude, memory: ["CLAUDE.md", "*/memory"], within: "projects",
        mcp: [{ file: env.CLAUDE_CONFIG_DIR ? path.join(claude, ".claude.json") : path.join(home, ".claude.json") }, { file: claudeDesktopConfig(home, env, platform) }],
      },
      "cursor": {
        root: cursor, memory: ["rules", ".cursor/rules", "memories", "AGENTS.md", "MEMORY.md", ".cursorrules"],
        mcp: [{ file: path.join(cursor, "mcp.json") }, { file: path.join(cursor, ".cursor", "mcp.json") }, ...(cursorRoot() ? [{ file: path.join(home, ".cursor", "mcp.json") }] : [])],
      },
    };
  }
  // MCP servers listed in an assistant's settings, by name.
  function mcpServers(source) {
    const servers = new Map();
    for (const { file, format } of source.mcp || []) {
      const stat = lstat(file);
      if (!stat?.isFile() || stat.size > 5 * 1024 * 1024) continue;
      const text = fs.readFileSync(file, "utf8");
      const data = format === "toml" ? parseToml(text) : JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      const listed = format === "toml" ? data.mcp_servers : data.mcpServers;
      if (!listed || typeof listed !== "object") continue;
      for (const [name, value] of Object.entries(listed)) {
        if (servers.has(name) || !value || typeof value !== "object" || /^timewarp/i.test(name)) continue;
        const config = format === "toml" ? value : value.url || value.serverUrl
          ? { url: value.url || value.serverUrl, http_headers: value.headers }
          : { command: value.command, args: value.args, env: value.env, cwd: value.cwd };
        if (typeof config.url === "string" || typeof config.command === "string") servers.set(name, config);
      }
    }
    return servers;
  }
  function memoryNames(source) {
    const files = [];
    for (const pattern of source.memory) {
      if (pattern.startsWith("*/")) {
        const base = path.join(source.root, source.within);
        for (const relative of expand(base, pattern)) collect(source.root, source.within + "/" + relative, files);
      } else collect(source.root, pattern, files);
    }
    return files;
  }
  // A skill folder, or a link to one in the user's folders: skill installers
  // link one copy into each assistant (a junction on Windows, a symbolic link
  // on macOS).
  function skillFolder(directory, name) {
    if (!SKILL_NAME.test(name)) return null;
    const entry = path.join(directory, name), stat = lstat(entry);
    if (!stat || (!stat.isDirectory() && !stat.isSymbolicLink())) return null;
    let real;
    try { real = fs.realpathSync(entry); } catch { return null; }
    if (stat.isSymbolicLink()) {
      let base;
      try { base = fs.realpathSync(home); } catch { return null; }
      if (!within(base, real)) return null;
    }
    if (!lstat(real)?.isDirectory() || !lstat(path.join(real, "SKILL.md"))?.isFile()) return null;
    return real;
  }
  function skillNames(root) {
    const directory = path.join(root, "skills"), stat = lstat(directory);
    if (!stat?.isDirectory()) return [];
    return fs.readdirSync(directory).filter(name => skillFolder(directory, name)).sort();
  }

  function detect() {
    const items = [], errors = [];
    for (const [id, source] of Object.entries(sources())) {
      if (path.resolve(source.root) === path.resolve(codexHome)) continue;
      try {
        const memory = memoryNames(source), skills = skillNames(source.root);
        if (memory.length) items.push({ id: id + ":memory", category: "memory", source: id, names: memory });
        if (skills.length) items.push({ id: id + ":skills", category: "skills", source: id, names: skills });
      } catch (error) { errors.push({ message: `${id}: ${error.message}` }); }
      try {
        const servers = [...mcpServers(source).keys()].sort();
        if (servers.length) items.push({ id: id + ":mcp", category: "mcp", source: id, names: servers });
      } catch (error) { errors.push({ message: `${id}: ${error.message}` }); }
    }
    return { items, errors };
  }

  // Resolves a detected file inside its source folder, refusing links out.
  function sourceFile(root, relative) {
    const base = fs.realpathSync(root), target = path.resolve(base, relative);
    if (!within(base, target)) throw fail(400, "An import selection is outside its folder.");
    const real = fs.realpathSync(target);
    if (!within(base, real)) throw fail(400, "An import selection is outside its folder.");
    return real;
  }
  function writeAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, data, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  function copySkill(from, name) {
    if (!SKILL_NAME.test(name)) throw fail(400, "That skill has an unsupported name.");
    let files = 0, bytes = 0;
    const staging = path.join(skillsRoot, `.import-${crypto.randomUUID()}`);
    const copy = (source, target) => {
      const stat = lstat(source);
      if (!stat || stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        for (const entry of fs.readdirSync(source)) if (entry !== ".git" && entry !== "node_modules") copy(path.join(source, entry), path.join(target, entry));
      } else if (stat.isFile()) {
        files++; bytes += stat.size;
        if (files > SKILL_FILES || bytes > SKILL_BYTES) throw fail(413, `The skill ${name} is too large to import.`);
        fs.copyFileSync(source, target);
      }
    };
    try {
      copy(from, staging);
      const destination = path.join(skillsRoot, name);
      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(staging, destination);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }

  function importItems(selections) {
    if (!Array.isArray(selections) || !selections.length) throw fail(400, "Select at least one memory or skill.");
    const available = detect().items, all = sources();
    const chosen = selections.map(selection => {
      const item = available.find(entry => entry.id === selection?.id);
      if (!item || !Array.isArray(selection.names) || !selection.names.length || selection.names.some(name => !item.names.includes(name))) throw fail(409, "An import selection is no longer available. Refresh and try again.");
      return { item, names: [...new Set(selection.names)] };
    });
    const imported = { memoryFiles: 0, skills: 0 };
    for (const { item, names } of chosen) {
      const root = all[item.source].root;
      for (const name of names) {
        if (item.category === "memory") {
          const destination = path.resolve(importsRoot, item.source, name);
          if (!within(path.join(importsRoot, item.source), destination)) throw fail(400, "An import selection is outside its folder.");
          writeAtomic(destination, fs.readFileSync(sourceFile(root, name)));
          imported.memoryFiles++;
        } else {
          const folder = skillFolder(path.join(root, "skills"), name);
          if (!folder) throw fail(409, "An import selection is no longer available. Refresh and try again.");
          // Codex already loads skills from ~/.agents/skills; a copy would list them twice.
          if (!lstat(path.join(home, ".agents", "skills", name, "SKILL.md"))?.isFile()) copySkill(folder, name);
          imported.skills++;
        }
      }
    }
    return { imported };
  }

  function notes() { try { return fs.readFileSync(notesFile, "utf8"); } catch { return ""; } }
  function importedFiles() {
    const files = [];
    if (lstat(importsRoot)?.isDirectory()) collect(importsRoot, "", files);
    return files.map(relative => {
      const stat = lstat(path.join(importsRoot, relative));
      return { path: relative, source: relative.split("/")[0], size: stat?.size ?? 0, modifiedAt: stat ? stat.mtime.toISOString() : null };
    });
  }

  return {
    memoriesRoot, importsRoot, skillsRoot, notesFile, detect, importItems,
    // The settings of one MCP server found by detect(), for importing.
    mcpServer(sourceId, name) {
      const source = sources()[sourceId];
      const config = source && mcpServers(source).get(name);
      if (!config) throw fail(409, "An import selection is no longer available. Refresh and try again.");
      return config;
    },
    read: () => ({ notes: notes(), files: importedFiles(), folder: memoriesRoot }),
    saveNotes(text) {
      if (typeof text !== "string" || text.length > NOTES_LIMIT) throw fail(400, "Notes must be text under 100,000 characters.");
      writeAtomic(notesFile, text.trim() ? text.trimEnd() + "\n" : "");
      return { notes: notes() };
    },
    removeImport(relative) {
      const target = path.resolve(importsRoot, String(relative || ""));
      if (!within(importsRoot, target) || target === importsRoot || !lstat(target)?.isFile()) throw fail(404, "That imported file no longer exists.");
      fs.rmSync(target);
      return { files: importedFiles() };
    },
    // A new skill written by the user: a folder with SKILL.md.
    createSkill({ name, description, instructions }) {
      const slug = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
      const summary = String(description || "").replace(/\s+/g, " ").trim().slice(0, 300);
      const body = String(instructions || "").trim().slice(0, 100000);
      if (!slug || !SKILL_NAME.test(slug)) throw fail(400, "Give the skill a name with letters or numbers.");
      if (!summary) throw fail(400, "Describe when agents should use the skill.");
      if (!body) throw fail(400, "Write the skill's instructions.");
      const target = path.join(skillsRoot, slug);
      if (lstat(target)) throw fail(409, "A skill with that name already exists.");
      const quote = value => JSON.stringify(value);
      writeAtomic(path.join(target, "SKILL.md"), `---\nname: ${slug}\ndescription: ${quote(summary)}\n---\n\n${body}\n`);
      return { name: slug };
    },
    removeSkill(name) {
      if (!SKILL_NAME.test(String(name || ""))) throw fail(400, "That skill can't be removed.");
      const target = path.join(skillsRoot, name);
      if (!lstat(path.join(target, "SKILL.md"))?.isFile()) throw fail(404, "That skill isn't installed in Timewarp.");
      fs.rmSync(target, { recursive: true, force: true });
      return { removed: true };
    },
    // Skill folders the previous app kept connected to their source.
    legacySkillRoots() {
      let saved;
      try { saved = JSON.parse(fs.readFileSync(path.join(runtimeDir, "setup-import-sync.json"), "utf8")); } catch { return []; }
      const all = sources();
      return (Array.isArray(saved?.enabledItemIds) ? saved.enabledItemIds : [])
        .filter(id => typeof id === "string" && id.endsWith(":skills") && all[id.slice(0, -7)])
        .map(id => path.join(all[id.slice(0, -7)].root, "skills"))
        .filter(directory => lstat(directory)?.isDirectory());
    },
    // The memory section of an agent's instructions.
    // Modes: enabled, read (read only), write (write only) and none.
    instructions(mode) {
      if (mode === "disabled" || mode === "none") return "Memory is turned off. Don't read or write the user's memory files.";
      if (mode === "write") return `Your memory about the user is in ${notesFile}. When the user shares a lasting preference or fact, or asks you to remember something, add it to that file briefly. Don't read the file or use what it says. Never store passwords, keys or payment details there.`;
      const text = notes().trim(), files = importedFiles();
      const lines = [
        mode === "read"
          ? `Your memory about the user is in ${notesFile}. Use it, but don't change that file.`
          : `Your memory about the user is in ${notesFile}. When the user shares a lasting preference or fact, or asks you to remember something, update that file briefly. Never store passwords, keys or payment details there.`,
      ];
      if (text) lines.push("Current notes:\n<user_notes>\n" + (text.length > PROMPT_NOTES ? text.slice(0, PROMPT_NOTES) + "\n…" : text) + "\n</user_notes>");
      if (files.length) {
        lines.push(`Knowledge the user imported from other assistants is in ${importsRoot}. Read a file when it would help:`);
        lines.push(...files.slice(0, PROMPT_FILES).map(file => "- " + file.path), ...(files.length > PROMPT_FILES ? [`- …and ${files.length - PROMPT_FILES} more`] : []));
      }
      return lines.join("\n");
    },
  };
}

module.exports = { createKnowledge };
