"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { safeUrl, recordable } = require("../app/main/browser.cjs");
const { toolSpecs } = require("../app/main/browser-tools.cjs");

test("the built-in browser opens web pages only and turns plain words into a search", () => {
  assert.equal(safeUrl("example.com"), "https://example.com/");
  assert.equal(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeUrl("localhost:3000/app"), "http://localhost:3000/app");
  assert.equal(safeUrl("example.com:8443/x"), "https://example.com:8443/x");
  assert.equal(safeUrl("best pizza near me"), "https://duckduckgo.com/?q=best%20pizza%20near%20me");
  assert.equal(safeUrl("about:blank"), "about:blank");
  for (const blocked of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "chrome://settings", "app://app/index.html", "https://user:pass@example.com/"]) {
    assert.throws(() => safeUrl(blocked), /web pages|credentials/, blocked);
  }
  assert.throws(() => safeUrl("   "), /Enter an address/);
});

test("recent sites never store credentials or internal pages", () => {
  assert.equal(recordable("https://example.com/"), true);
  assert.equal(recordable("https://u:p@example.com/"), false);
  assert.equal(recordable("about:blank"), false);
  assert.equal(recordable("not a url"), false);
});

test("agent browser tools use a non-reserved namespace with strict schemas", () => {
  const [namespace] = toolSpecs();
  assert.equal(namespace.type, "namespace");
  assert.notEqual(namespace.name, "browser", "browser is reserved by the Responses API");
  const names = namespace.tools.map(tool => tool.name);
  assert.deepEqual(names, ["open", "tabs", "snapshot", "click", "type", "press", "scroll", "read", "screenshot", "back", "forward", "wait", "close_tab", "select", "hover", "upload"]);
  for (const tool of namespace.tools) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
});

test("values filled from the vault are hidden from page output, even when reformatted", () => {
  const { patternFor } = require("../app/main/browser-tools.cjs");
  const hide = (text, value) => text.replace(new RegExp(patternFor(value), "g"), "[filled from vault]");
  assert.equal(hide("Card: 4242 4242 4242 4242 ok", "4242424242424242"), "Card: [filled from vault] ok");
  assert.equal(hide("Card: 4242-4242-4242-4242", "4242424242424242"), "Card: [filled from vault]");
  assert.equal(hide('value="p@ss.(word)+"', "p@ss.(word)+"), 'value="[filled from vault]"');
});

test("the agent can upload only files inside its own workspace", t => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { workspaceFiles } = require("../app/main/browser-tools.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-upload-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "cv.pdf"), "pdf");
  fs.writeFileSync(path.join(root, "secret.txt"), "secret");
  const agent = { workspace };
  assert.deepEqual(workspaceFiles(agent, ["docs/cv.pdf"]), [fs.realpathSync(path.join(workspace, "docs", "cv.pdf"))]);
  assert.throws(() => workspaceFiles(agent, ["../secret.txt"]), /workspace folder/);
  assert.throws(() => workspaceFiles(agent, [path.join(root, "secret.txt")]), /workspace folder/);
  assert.throws(() => workspaceFiles(agent, ["docs"]), /isn't a file/);
  assert.throws(() => workspaceFiles(agent, []), /Choose 1/);
});
