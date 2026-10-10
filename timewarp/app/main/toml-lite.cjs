"use strict";
// Reads TOML such as another app's Codex config.toml, to import its MCP
// servers. Supports tables, arrays of tables, dotted keys, strings, numbers,
// booleans, dates (as text), arrays and inline tables.
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const ESCAPES = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
const SCALAR = /^(?:\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?|true|false|[+-]?(?:inf|nan)|0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|[+-]?[0-9_]+(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/;

function parseToml(input) {
  const src = String(input).replace(/\r\n/g, "\n");
  let i = 0;
  const fail = message => { throw new Error(`config.toml line ${src.slice(0, i).split("\n").length}: ${message}`); };
  const spaces = () => { while (src[i] === " " || src[i] === "\t") i++; };
  const blank = () => {
    for (;;) {
      spaces();
      if (src[i] === "\n") { i++; continue; }
      if (src[i] === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
      return;
    }
  };
  const endOfLine = () => {
    spaces();
    if (src[i] === "#") while (i < src.length && src[i] !== "\n") i++;
    if (i < src.length && src[i] !== "\n") fail("Unexpected text after a value.");
    i++;
  };
  function escaped(multiline) {
    let out = "";
    while (i < src.length) {
      if (multiline && src.startsWith('"""', i)) {
        let end = i + 3;
        while (src[end] === '"' && end - i < 5) end++;
        out += src.slice(i, end - 3); i = end;
        return out;
      }
      const ch = src[i];
      if (!multiline && ch === '"') { i++; return out; }
      if (!multiline && ch === "\n") fail("A string isn't closed.");
      if (ch === "\\") {
        const next = src[i + 1];
        if (next in ESCAPES) { out += ESCAPES[next]; i += 2; continue; }
        if (next === "u" || next === "U") {
          const length = next === "u" ? 4 : 8, hex = src.substr(i + 2, length);
          if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== length) fail("Invalid unicode escape.");
          out += String.fromCodePoint(parseInt(hex, 16)); i += 2 + length; continue;
        }
        if (multiline && /[ \t\n]/.test(next)) { i++; while (/[ \t\n]/.test(src[i] || "")) i++; continue; }
        fail("Invalid escape in a string.");
      }
      out += ch; i++;
    }
    fail("A string isn't closed.");
  }
  function string() {
    const quote = src[i];
    if (src.startsWith(quote.repeat(3), i)) {
      i += 3;
      if (src[i] === "\n") i++;
      if (quote === '"') return escaped(true);
      const end = src.indexOf("'''", i);
      if (end < 0) fail("A string isn't closed.");
      let close = end + 3;
      while (src[close] === "'" && close - end < 5) close++;
      const value = src.slice(i, close - 3); i = close;
      return value;
    }
    i++;
    if (quote === '"') return escaped(false);
    const end = src.indexOf("'", i), line = src.indexOf("\n", i);
    if (end < 0 || (line >= 0 && line < end)) fail("A string isn't closed.");
    const value = src.slice(i, end); i = end + 1;
    return value;
  }
  function key() {
    spaces();
    let name;
    if (src[i] === '"' || src[i] === "'") name = string();
    else {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_-]/.test(src[i])) i++;
      if (start === i) fail("Expected a key.");
      name = src.slice(start, i);
    }
    if (UNSAFE.has(name)) fail(`"${name}" can't be used as a key.`);
    spaces();
    return name;
  }
  function keyPath() {
    const parts = [key()];
    while (src[i] === ".") { i++; parts.push(key()); }
    return parts;
  }
  const isTable = value => value && typeof value === "object" && !Array.isArray(value);
  function tableAt(base, path) {
    let node = base;
    for (const part of path) {
      if (!(part in node)) node[part] = {};
      let next = node[part];
      if (Array.isArray(next)) next = next[next.length - 1];
      if (!isTable(next)) fail(`"${part}" is not a table.`);
      node = next;
    }
    return node;
  }
  function assign(base, path, value) {
    const parent = tableAt(base, path.slice(0, -1)), last = path[path.length - 1];
    if (last in parent) fail(`"${last}" is set twice.`);
    parent[last] = value;
  }
  function value() {
    spaces();
    const ch = src[i];
    if (ch === '"' || ch === "'") return string();
    if (ch === "[") {
      i++;
      const list = [];
      for (;;) {
        blank();
        if (src[i] === "]") { i++; return list; }
        list.push(value());
        blank();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "]") { i++; return list; }
        fail("Expected , or ] in an array.");
      }
    }
    if (ch === "{") {
      i++;
      const table = {};
      spaces();
      if (src[i] === "}") { i++; return table; }
      for (;;) {
        const path = keyPath();
        if (src[i] !== "=") fail("Expected = in an inline table.");
        i++;
        assign(table, path, value());
        spaces();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "}") { i++; return table; }
        fail("Expected , or } in an inline table.");
      }
    }
    const match = SCALAR.exec(src.slice(i, i + 64));
    if (!match) fail("Unsupported value.");
    i += match[0].length;
    const text = match[0];
    if (text === "true" || text === "false") return text === "true";
    if (/^\d{4}-|^\d{2}:/.test(text)) return text;
    if (/inf$/.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
    if (/nan$/.test(text)) return NaN;
    if (/^0[xob]/.test(text)) return Number(text.replace(/_/g, ""));
    return Number(text.replace(/_/g, ""));
  }

  const root = {};
  let current = root;
  for (;;) {
    blank();
    if (i >= src.length) return root;
    if (src[i] === "[") {
      const array = src[i + 1] === "[";
      i += array ? 2 : 1;
      const path = keyPath();
      if (src[i] !== "]" || (array && src[i + 1] !== "]")) fail("Expected ] after a table name.");
      i += array ? 2 : 1;
      endOfLine();
      if (array) {
        const parent = tableAt(root, path.slice(0, -1)), last = path[path.length - 1];
        if (!(last in parent)) parent[last] = [];
        if (!Array.isArray(parent[last])) fail(`"${last}" is not an array of tables.`);
        current = {};
        parent[last].push(current);
      } else current = tableAt(root, path);
      continue;
    }
    const path = keyPath();
    if (src[i] !== "=") fail("Expected = after a key.");
    i++;
    assign(current, path, value());
    endOfLine();
  }
}

module.exports = { parseToml };
