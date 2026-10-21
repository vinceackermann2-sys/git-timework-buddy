// JSON with comments (opencode.jsonc, editor settings): read it, and add or
// remove one member of one top-level object in place, so the rest of the
// file (comments, order, spacing) stays exactly as it was.

function skip(text, i) {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('//', i)) { const end = text.indexOf('\n', i); i = end === -1 ? text.length : end; continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 2; continue; }
    return i;
  }
}

function stringEnd(text, i) {
  for (i++; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '"') return i + 1;
  }
  throw new SyntaxError('A string is not closed.');
}

function valueEnd(text, i) {
  const c = text[i];
  if (c === '"') return stringEnd(text, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    while (i < text.length) {
      i = skip(text, i);
      const ch = text[i];
      if (ch === '"') { i = stringEnd(text, i); continue; }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    throw new SyntaxError('An object or list is not closed.');
  }
  while (i < text.length && !/[\s,}\]/]/.test(text[i])) i++;
  return i;
}

// The members of the object whose "{" is at `open`.
function members(text, open) {
  const props = [];
  let i = skip(text, open + 1);
  while (text[i] !== '}') {
    if (text[i] !== '"') throw new SyntaxError(`Expected a key at ${i}.`);
    const keyStart = i, keyEnd = stringEnd(text, i);
    const key = JSON.parse(text.slice(keyStart, keyEnd));
    i = skip(text, keyEnd);
    if (text[i] !== ':') throw new SyntaxError(`Expected ":" at ${i}.`);
    const valueStart = skip(text, i + 1), end = valueEnd(text, valueStart);
    i = skip(text, end);
    let comma = null;
    if (text[i] === ',') { comma = i; i = skip(text, i + 1); }
    props.push({ key, keyStart, valueStart, valueEnd: end, comma });
  }
  return { props, close: i };
}

// The text as plain JSON.
export function stripJsonc(text) {
  let out = '', i = 0;
  while (i < text.length) {
    if (text[i] === '"') { const end = stringEnd(text, i); out += text.slice(i, end); i = end; continue; }
    const next = skip(text, i);
    if (next !== i) { out += text.slice(i, next).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' '); i = next; continue; }
    out += text[i++];
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
export const parseJsonc = text => JSON.parse(stripJsonc(text.replace(/^\uFEFF/, '')) || '{}');

// The file's indentation step: its smallest indentation of a key or closing bracket.
function indentUnit(text) {
  let unit = null;
  for (const match of text.matchAll(/\n([ \t]+)["}\]]/g)) if (unit === null || match[1].length < unit.length) unit = match[1];
  return unit || '  ';
}

function root(text) {
  const open = skip(text, 0);
  if (text[open] !== '{') throw new SyntaxError('The file does not hold a JSON object.');
  return open;
}

function render(value, unit, depth, eol) {
  return JSON.stringify(value, null, unit).split('\n').join(eol + unit.repeat(depth));
}

function insert(text, open, object, key, value, depth) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = indentUnit(text), pad = unit.repeat(depth);
  const member = `${JSON.stringify(key)}: ${render(value, unit, depth, eol)}`;
  if (!object.props.length) return `${text.slice(0, open + 1)}${eol}${pad}${member}${eol}${unit.repeat(depth - 1)}${text.slice(object.close)}`;
  const last = object.props[object.props.length - 1];
  if (last.comma !== null) return `${text.slice(0, last.comma + 1)}${eol}${pad}${member},${text.slice(last.comma + 1)}`;
  return `${text.slice(0, last.valueEnd)},${eol}${pad}${member}${text.slice(last.valueEnd)}`;
}

// The text without member `index` (exactly undoing `insert`); null when it
// is the object's only member.
function cut(text, object, index) {
  const { props } = object, prop = props[index];
  if (index < props.length - 1) return text.slice(0, prop.keyStart) + text.slice(props[index + 1].keyStart);
  if (index === 0) return null;
  const previous = props[index - 1];
  return prop.comma !== null
    ? text.slice(0, previous.comma + 1) + text.slice(prop.comma + 1)
    : text.slice(0, previous.comma) + text.slice(prop.valueEnd);
}

// container.name = value; returns the new text and whether it made the container.
export function setMember(text, container, name, value) {
  const source = text && text.trim() ? text : '{}\n';
  const open = root(source);
  const top = members(source, open);
  const holder = top.props.find(p => p.key === container);
  if (!holder) return { text: insert(source, open, top, container, { [name]: value }, 1), createdContainer: true };
  if (source[holder.valueStart] !== '{') throw new SyntaxError(`"${container}" is not an object.`);
  const inner = members(source, holder.valueStart);
  const existing = inner.props.find(p => p.key === name);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (existing) return { text: source.slice(0, existing.valueStart) + render(value, indentUnit(source), 2, eol) + source.slice(existing.valueEnd), createdContainer: false };
  return { text: insert(source, holder.valueStart, inner, name, value, 2), createdContainer: false };
}

// The value of container.name, or undefined.
export function getMember(text, container, name) {
  try { return parseJsonc(text)?.[container]?.[name]; } catch { return undefined; }
}

// Removes container.name (and the container, if `dropEmptyContainer` and it is now empty).
export function removeMember(text, container, name, { dropEmptyContainer = false } = {}) {
  const open = root(text);
  const top = members(text, open);
  const holderIndex = top.props.findIndex(p => p.key === container);
  if (holderIndex === -1) return text;
  const holder = top.props[holderIndex];
  if (text[holder.valueStart] !== '{') return text;
  const inner = members(text, holder.valueStart);
  const index = inner.props.findIndex(p => p.key === name);
  if (index === -1) return text;
  if (inner.props.length === 1) {
    if (dropEmptyContainer) {
      const after = cut(text, top, holderIndex);
      if (after !== null) return after;
      return `${text.slice(0, open + 1)}${text.slice(top.close)}`;
    }
    return `${text.slice(0, holder.valueStart + 1)}${text.slice(inner.close)}`;
  }
  return cut(text, inner, index);
}
