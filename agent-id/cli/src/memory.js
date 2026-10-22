// Memory already on this computer, in the apps people use with their agents,
// brought into an Agent ID's memory (read here, on this computer, and only
// sent once the person says yes):
//   Claude Code   CLAUDE.md and every project's memory folder
//                 (~/.claude, or CLAUDE_CONFIG_DIR)
//   Codex         AGENTS.md and its memories (~/.codex, or CODEX_HOME)
//   Cursor        its User Rules (kept in its settings database)
//   Antigravity   GEMINI.md and its knowledge items (~/.gemini), shared with
//                 Gemini CLI
//   Windsurf      its memories and global rules (~/.codeium/windsurf)
// Lines that look like keys, tokens or passwords are left out: those belong in
// the vault. Agent ID's own identity block (written by attach) is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Agent ID's own block in instruction files (as commands/attach.js writes it).
const START = '<!-- timewarp-agent-id:start -->';
const END = '<!-- timewarp-agent-id:end -->';

export const MAX_TEXT = 4000;

// The same as Agent ID refuses (timewarp/supabase/functions/agent-id/memory.ts).
export const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b(?:twa|two|twrp|twc)_[A-Za-z0-9_-]{20,}/,
  /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b0x[0-9a-fA-F]{64}\b/,
  /\b(?:password|passwd|pwd|passphrase|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token)\s*[:=]\s*["']?[^\s"']{6,}/i,
];
export const looksSecret = text => SECRET_PATTERNS.some(pattern => pattern.test(text));

// Lines that look like secrets taken out; how many were.
export function withoutSecrets(text) {
  let removed = 0;
  const kept = String(text).split(/\r?\n/).filter(line => {
    if (!looksSecret(line)) return true;
    removed++;
    return false;
  });
  return { text: kept.join('\n'), removed };
}

const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const list = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

// Agent ID's own block, written into instruction files by attach.
function withoutIdentityBlock(text) {
  const start = text.indexOf(START), end = text.indexOf(END);
  return start !== -1 && end > start ? text.slice(0, start) + text.slice(end + END.length) : text;
}
// A memory file's front matter (name: …), as Claude Code writes them.
function frontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (pair) meta[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

// Longer than a memory: split at paragraphs, else at the length.
function pieces(text) {
  if (text.length <= MAX_TEXT) return [text];
  const out = [];
  let current = '';
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length + 2 > MAX_TEXT) { out.push(current); current = ''; }
    if (paragraph.length > MAX_TEXT) { for (let i = 0; i < paragraph.length; i += MAX_TEXT) out.push(paragraph.slice(i, i + MAX_TEXT)); continue; }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) out.push(current);
  return out;
}

// A markdown file as memories: one per section (its heading is the topic),
// and one per bullet under a heading that says it holds memories.
export function sections(text, { from, file }) {
  const out = [];
  let topic = null, lines = [];
  const flush = () => {
    const body = lines.join('\n').trim();
    lines = [];
    if (!body) return;
    if (/memor/i.test(topic || '') && body.split('\n').every(line => /^\s*([-*]|\d+\.)\s+/.test(line) || !line.trim())) {
      for (const line of body.split('\n')) {
        const item = line.replace(/^\s*([-*]|\d+\.)\s+/, '').trim();
        if (item.length >= 8) out.push({ text: item, topic, from, file });
      }
      return;
    }
    for (const piece of pieces(body)) if (piece.trim().length >= 8) out.push({ text: piece.trim(), topic, from, file });
  };
  for (const line of withoutIdentityBlock(text).split(/\r?\n/)) {
    const heading = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); topic = heading[1].slice(0, 80); continue; }
    lines.push(line);
  }
  flush();
  return out;
}

// --- Each app --------------------------------------------------------------------------

function claudeCode(env, home) {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const out = [];
  const instructions = read(path.join(dir, 'CLAUDE.md'));
  if (instructions) out.push(...sections(instructions, { from: 'claude-code', file: path.join(dir, 'CLAUDE.md') }));
  for (const project of list(path.join(dir, 'projects'))) {
    if (!project.isDirectory()) continue;
    const memoryDir = path.join(dir, 'projects', project.name, 'memory');
    for (const entry of list(memoryDir)) {
      // MEMORY.md is the folder's index of the others.
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue;
      const file = path.join(memoryDir, entry.name);
      const text = read(file);
      if (!text) continue;
      const { meta, body } = frontMatter(text);
      const topic = (meta.name || entry.name.replace(/\.md$/, '')).slice(0, 80);
      for (const piece of pieces(body.trim())) if (piece.length >= 8) out.push({ text: piece, topic, from: 'claude-code', file });
    }
  }
  return out;
}

function codex(env, home) {
  const dir = env.CODEX_HOME || path.join(home, '.codex');
  const out = [];
  const instructions = read(path.join(dir, 'AGENTS.md'));
  if (instructions) out.push(...sections(instructions, { from: 'codex', file: path.join(dir, 'AGENTS.md') }));
  // Its memories: the full set where there is one, else the summary.
  const full = read(path.join(dir, 'memories', 'MEMORY.md'));
  const summary = full ? null : read(path.join(dir, 'memories', 'memory_summary.md'));
  const memories = full || summary;
  if (memories) out.push(...sections(memories, { from: 'codex', file: path.join(dir, 'memories', full ? 'MEMORY.md' : 'memory_summary.md') }));
  return out;
}

function gemini(env, home) {
  const dir = path.join(home, '.gemini');
  const out = [];
  const rules = read(path.join(dir, 'GEMINI.md'));
  if (rules) out.push(...sections(rules, { from: 'antigravity', file: path.join(dir, 'GEMINI.md') }));
  // Antigravity's knowledge items: a folder each, with a title and its notes.
  const knowledge = path.join(dir, 'antigravity', 'knowledge');
  for (const item of list(knowledge)) {
    if (!item.isDirectory()) continue;
    const itemDir = path.join(knowledge, item.name);
    let meta = {};
    try { meta = JSON.parse(read(path.join(itemDir, 'metadata.json')) || '{}'); } catch { /* none */ }
    const topic = String(meta.title || item.name).slice(0, 80);
    if (typeof meta.summary === 'string' && meta.summary.trim().length >= 8) out.push({ text: meta.summary.trim().slice(0, MAX_TEXT), topic, from: 'antigravity', file: itemDir });
    const files = list(itemDir).flatMap(entry => entry.isDirectory() ? list(path.join(itemDir, entry.name)).map(inner => [path.join(itemDir, entry.name, inner.name), inner]) : [[path.join(itemDir, entry.name), entry]]);
    for (const [file, entry] of files.slice(0, 20)) {
      if (!entry.isFile() || !/\.(md|txt)$/i.test(entry.name)) continue;
      const text = read(file);
      if (text) for (const piece of pieces(text.trim())) if (piece.length >= 8) out.push({ text: piece, topic, from: 'antigravity', file });
    }
  }
  return out;
}

function windsurf(env, home) {
  const dir = path.join(home, '.codeium', 'windsurf', 'memories');
  return list(dir).filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .flatMap(entry => sections(read(path.join(dir, entry.name)) || '', { from: 'windsurf', file: path.join(dir, entry.name) }));
}

// Cursor keeps its User Rules in its settings database (SQLite), which Node
// reads from version 22.13 on; older Node skips it.
async function cursor(env, home) {
  const base = process.platform === 'win32' ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Cursor') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor');
  const file = path.join(base, 'User', 'globalStorage', 'state.vscdb');
  if (!fs.existsSync(file)) return [];
  let sqlite;
  const warn = process.emitWarning;
  process.emitWarning = (warning, ...rest) => { if (!/SQLite/i.test(String(warning))) warn.call(process, warning, ...rest); };
  try { sqlite = await import('node:sqlite'); } catch { return { skipped: 'Cursor (needs Node 22.13 or later)' }; } finally { process.emitWarning = warn; }
  let db;
  try {
    db = new sqlite.DatabaseSync(file, { readOnly: true });
    const row = db.prepare("select value from ItemTable where key = 'aicontext.personalContext'").get();
    const rules = row?.value ? String(row.value) : '';
    return rules.trim() ? sections(rules, { from: 'cursor', file }).map(item => ({ ...item, topic: item.topic || 'Cursor User Rules' })) : [];
  } catch {
    return { skipped: 'Cursor (its settings were busy; close Cursor and try again)' };
  } finally {
    try { db?.close(); } catch { /* closed */ }
  }
}

export const SOURCES = { 'claude-code': claudeCode, codex, cursor, antigravity: gemini, windsurf };
export const SOURCE_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor', antigravity: 'Antigravity and Gemini', windsurf: 'Windsurf' };

// Everything found, secrets taken out, per app.
export async function collect({ env = process.env, home = env.HOME || env.USERPROFILE || os.homedir(), from = Object.keys(SOURCES) } = {}) {
  const found = {}, skipped = [];
  let removed = 0;
  for (const name of from) {
    const result = await SOURCES[name](env, home);
    if (!Array.isArray(result)) { if (result?.skipped) skipped.push(result.skipped); continue; }
    const items = [];
    for (const item of result) {
      const clean = withoutSecrets(item.text);
      removed += clean.removed;
      const text = clean.text.trim();
      if (text.length < 8 || looksSecret(text)) continue;
      items.push({ ...item, text });
    }
    if (items.length) found[name] = items;
  }
  return { found, skipped, removed };
}
