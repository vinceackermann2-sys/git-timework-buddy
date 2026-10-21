// Just enough TOML to replace one table in a file people edit by hand (Codex's
// config.toml) without touching anything else: comments, ordering and other
// tables stay exactly as they were.

// A dotted key, unquoted: a."b.c" . d → ['a', 'b.c', 'd']; null if it isn't one.
export function parseKey(text) {
  const s = text.trim();
  const parts = [];
  let i = 0;
  if (!s) return null;
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    let part = '';
    if (s[i] === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) {
          const next = s[i + 1];
          if (next === 'u' || next === 'U') {
            const length = next === 'u' ? 4 : 8;
            part += String.fromCodePoint(parseInt(s.slice(i + 2, i + 2 + length), 16) || 0);
            i += 2 + length;
            continue;
          }
          part += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[next] ?? next;
          i += 2;
          continue;
        }
        part += s[i++];
      }
      if (s[i] !== '"') return null;
      i++;
    } else if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return null;
      part = s.slice(i + 1, end);
      i = end + 1;
    } else {
      while (i < s.length && /[A-Za-z0-9_-]/.test(s[i])) part += s[i++];
      if (!part) return null;
    }
    parts.push(part);
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (i >= s.length) break;
    if (s[i] !== '.') return null;
    i++;
  }
  return parts;
}

const HEADER = /^\s*(\[\[?)\s*([^\]#]*?)\s*(\]\]?)\s*(#.*)?$/;
const startsWith = (key, prefix) => key.length >= prefix.length && prefix.every((part, i) => key[i] === part);
const isComment = line => /^\s*(#.*)?$/.test(line);

// How much a line opens [ and { outside strings and comments, and whether a
// multi-line string is still open at its end.
function depthChange(line, state) {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (state.string) {
      if (line.startsWith(state.string, i)) { i += state.string.length - 1; state.string = null; }
      else if (state.string === '"""' && line[i] === '\\') i++;
      continue;
    }
    const c = line[i];
    if (c === '#') break;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) { state.string = line.slice(i, i + 3); i += 2; continue; }
    if (c === '"') { i++; while (i < line.length && line[i] !== '"') { if (line[i] === '\\') i++; i++; } continue; }
    if (c === "'") { const end = line.indexOf("'", i + 1); i = end === -1 ? line.length : end; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
  }
  return depth;
}

// Lines grouped by the table they belong to; key/value statements spanning
// several lines (arrays, multi-line strings) are kept together.
function statements(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const out = [];
  let table = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = HEADER.exec(line);
    const headerKey = header && header[1].length === header[3].length ? parseKey(header[2]) : null;
    if (headerKey) { table = headerKey; out.push({ kind: 'header', table, lines: [line] }); continue; }
    if (isComment(line)) { out.push({ kind: 'comment', table, lines: [line] }); continue; }
    const eq = line.indexOf('=');
    const key = eq === -1 ? null : parseKey(line.slice(0, eq));
    const group = [line];
    const state = { string: null };
    let depth = depthChange(eq === -1 ? line : line.slice(eq + 1), state);
    while ((depth > 0 || state.string) && i + 1 < lines.length) {
      const next = lines[++i];
      group.push(next);
      depth += depthChange(next, state);
    }
    out.push({ kind: 'value', table, key: key ? [...table, ...key] : null, lines: group });
  }
  return out;
}

// Replaces the table at `path` (with its sub-tables, and any inline or dotted
// definition of it) by `block`: where the old table was, or else at the end.
// The file's lines without the table at `path`, where it was, and its lines.
function partition(text, path) {
  const all = statements(text);
  const kept = [], removed = [];
  let insertAt = -1, headerBased = false;
  for (let i = 0; i < all.length; i++) {
    const statement = all[i];
    if (startsWith(statement.table, path)) {
      if (statement.kind === 'header' && insertAt === -1) { insertAt = kept.length; headerBased = true; }
      // Comments right before the next table belong to that table.
      if (statement.kind === 'comment') {
        let j = i;
        while (j < all.length && all[j].kind === 'comment' && startsWith(all[j].table, path)) j++;
        const nextIsOtherTable = j < all.length && all[j].kind === 'header' && !startsWith(all[j].table, path);
        if (nextIsOtherTable) { for (let k = i; k < j; k++) kept.push(...all[k].lines); i = j - 1; continue; }
      }
      removed.push(...statement.lines);
      continue;
    }
    if (statement.kind === 'value' && statement.key && startsWith(statement.key, path)) { removed.push(...statement.lines); continue; }
    kept.push(...statement.lines);
  }
  return { kept, removed, insertAt, headerBased };
}

// The table at `path` as written ([header] form only), or null.
export function extractTable(text, path) {
  const { removed, headerBased } = partition(text || '', path);
  if (!removed.length || !headerBased) return null;
  const lines = [...removed];
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

// The file without the table at `path`.
export function removeTable(text, path) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const { kept, removed, insertAt } = partition(text, path);
  if (!removed.length) return text;
  const before = kept.slice(0, insertAt === -1 ? kept.length : insertAt), after = kept.slice(insertAt === -1 ? kept.length : insertAt);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  const result = [...before, ...(before.length && after.length ? [''] : []), ...after];
  return result.length ? result.join(eol) + eol : '';
}

export function upsertTable(text, path, block) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const parts = partition(text, path);
  const { kept } = parts;
  const insertAt = parts.headerBased ? parts.insertAt : -1;
  const blockLines = block.replace(/\s+$/, '').split(/\r?\n/);
  let result;
  if (insertAt === -1) {
    result = [...kept];
    while (result.length && result[result.length - 1].trim() === '') result.pop();
    if (result.length) result.push('');
    result.push(...blockLines);
  } else {
    const before = kept.slice(0, insertAt), after = kept.slice(insertAt);
    while (before.length && before[before.length - 1].trim() === '') before.pop();
    while (after.length && after[0].trim() === '') after.shift();
    result = [...before, ...(before.length ? [''] : []), ...blockLines, ...(after.length ? ['', ...after] : [])];
  }
  while (result.length && result[result.length - 1].trim() === '') result.pop();
  return result.join(eol) + eol;
}

// TOML values for the few shapes Codex's MCP tables need.
export function tomlValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([k, v]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)} = ${tomlValue(v)}`).join(', ')} }`;
  throw new TypeError(`No TOML for ${value}`);
}
