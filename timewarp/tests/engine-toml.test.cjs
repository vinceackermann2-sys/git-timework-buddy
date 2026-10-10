"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseToml } = require("../app/main/toml-lite.cjs");

test("Codex settings files are read: tables, strings, arrays and inline tables", () => {
  const text = [
    'model = "gpt" # comment',
    "[mcp_servers.repl]",
    String.raw`command = "C:\\Tools\\node.exe"`,
    "args = [",
    '  "--port", # first',
    "  '3000',",
    "]",
    "startup_timeout_sec = 1_000",
    "env = { TOKEN = \"a\tb\", nested.key = true }",
    '[mcp_servers."quoted name"]',
    'url = """',
    'https://example.com"""',
    "[[profiles]]",
    "name = 'one'",
    "[[profiles]]",
    "when = 1979-05-27T07:32:00Z",
  ].join("\r\n");
  const value = parseToml(text);
  assert.equal(value.mcp_servers.repl.command, String.raw`C:\Tools\node.exe`);
  assert.deepEqual(value.mcp_servers.repl.args, ["--port", "3000"]);
  assert.equal(value.mcp_servers.repl.startup_timeout_sec, 1000);
  assert.deepEqual(value.mcp_servers.repl.env, { TOKEN: "a\tb", nested: { key: true } });
  assert.equal(value.mcp_servers["quoted name"].url, "https://example.com");
  assert.deepEqual(value.profiles, [{ name: "one" }, { when: "1979-05-27T07:32:00Z" }]);
});

test("invalid or unsafe TOML is refused", () => {
  assert.throws(() => parseToml('a = "open'), /line 1/);
  assert.throws(() => parseToml("a = 1\na = 2"), /set twice/);
  assert.throws(() => parseToml("[__proto__]\nx = 1"), /can't be used/);
  assert.equal(Object.prototype.polluted, undefined);
});
