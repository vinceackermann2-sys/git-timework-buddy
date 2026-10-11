"use strict";
// Messages as drawn in the chat: the HTML a message may use, footnotes,
// images written into a message, a user's references, Find, and streaming
// messages drawn in parts.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { flushSync } from "react-dom"; import { Markdown } from "./app/renderer/src/markdown.jsx"; import { loadHighlighter } from "./app/renderer/src/highlighter.js"; import { findMatches } from "./app/renderer/src/components/Chat.jsx"; import { ToastProvider } from "./app/renderer/src/components/common.jsx"; globalThis.ui = { React, createRoot, flushSync, Markdown, loadHighlighter, findMatches, ToastProvider };', resolveDir: root, loader: "jsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".js": "jsx", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
}).outputFiles[0].text;

function draw(t, text, props = {}) {
  const dom = new JSDOM('<div id="host"></div>', { url: "https://fixture.invalid", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.tw = { call: async () => null, on: () => () => {} };
  window.eval(bundle);
  const { React, createRoot, flushSync, Markdown, ToastProvider } = window.ui;
  const reactRoot = createRoot(window.document.getElementById("host"));
  flushSync(() => reactRoot.render(React.createElement(ToastProvider, null, React.createElement(Markdown, { text, cards: false, ...props }))));
  t.after(() => { reactRoot.unmount(); window.close(); });
  return window.document.querySelector(".tw-markdown");
}

test("a small set of HTML is drawn as elements; any other tag stays text", t => {
  const node = draw(t, "Press <kbd>Ctrl</kbd>+<kbd>K</kbd><br>H<sub>2</sub>O and x<sup>2</sup>, <b>bold</b> <span>plain</span>\n\n<details>\n<summary>More</summary>\n\nHidden **text**\n\n</details>\n\n<script>alert(1)</script>\n\nA <marquee>moving</marquee> word and <b>an open tag");
  assert.deepEqual([...node.querySelectorAll("kbd")].map(key => key.textContent), ["Ctrl", "K"]);
  assert.ok(node.querySelector("br"));
  assert.equal(node.querySelector("sub").textContent, "2");
  assert.equal(node.querySelector("sup").textContent, "2");
  assert.equal(node.querySelector("strong").textContent, "bold");
  assert.equal(node.querySelector("details > summary").textContent, "More");
  assert.equal(node.querySelector("details strong").textContent, "text", "Markdown inside details");
  assert.equal(node.querySelector("script"), null);
  assert.equal(node.querySelector("marquee"), null);
  assert.match(node.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(node.textContent, /A <marquee>moving<\/marquee> word and <b>an open tag/, "Unknown and unclosed tags stay text");
});

test("HTML can't carry scripts, event handlers or unsafe links and images", t => {
  const node = draw(t, '<img src="http://tracker.test/x.png" onerror="alert(1)"> <a href="javascript:alert(1)" onclick="alert(2)">link</a> <img src="data:image/png;base64,iVBORw0KGgo=" alt="dot" width="20">\n\n<p align="center"><img src="https://example.com/logo.png" alt="Logo"></p>');
  assert.equal(node.querySelector("[onerror], [onclick]"), null);
  assert.equal(node.querySelector('[href^="javascript"]'), null);
  assert.ok(node.querySelector('img[src^="data:image/png"][width="20"]'), "An image written into the message shows");
  assert.ok(node.querySelector('img[src="https://example.com/logo.png"]'));
  assert.equal(node.querySelector('img[src^="http:"]'), null, "Only secure images load");
  assert.equal(node.querySelector(".tw-html-p").style.textAlign, "center");
});

test("footnotes are numbered as referred to and listed at the end; citation marks go", t => {
  const node = draw(t, "First claim[^b] and second[^a].citeturn0search1\n\n[^a]: Source A.\n[^b]: Source **B**.\n[^unused]: Never cited.");
  assert.deepEqual([...node.querySelectorAll(".tw-footnote-ref")].map(ref => ref.textContent), ["1", "2"]);
  assert.deepEqual([...node.querySelectorAll(".tw-footnotes li")].map(item => item.dataset.footnote), ["b", "a"]);
  assert.match(node.querySelector(".tw-footnotes").textContent, /Source B.*Source A/);
  assert.equal(node.querySelector(".tw-footnotes strong").textContent, "B");
  assert.doesNotMatch(node.textContent, /Never cited|\[\^|cite|turn0/);
});

test("a user's message draws its references and leaves other tags as text", t => {
  const node = draw(t, 'Ask <ref type="person" user-id="u2" name="Ada" email="ada@example.com"></ref> to <button label="Go" prompt="go" />', { cards: { only: ["ref", "widget-interaction"] } });
  assert.equal(node.querySelector('.tw-ref[data-ref="person"]').textContent, "Ada");
  assert.match(node.textContent, /<button label="Go" prompt="go" \/>/);
});

// A streaming message drawn as it arrives, a few characters at a time, next
// to the same text drawn at once: each step and the finished message match.
async function streams(t, text, props = {}) {
  const dom = new JSDOM('<div id="live"></div><div id="fresh"></div>', { url: "https://fixture.invalid", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  // Cards wait for their chat, the same way in both.
  window.tw = { call: () => new Promise(() => {}), on: () => () => {} };
  window.eval(bundle);
  const { React, createRoot, flushSync, Markdown, ToastProvider, loadHighlighter } = window.ui;
  await loadHighlighter();
  const live = createRoot(window.document.getElementById("live")), fresh = createRoot(window.document.getElementById("fresh"));
  t.after(() => { live.unmount(); fresh.unmount(); window.close(); });
  const html = id => window.document.querySelector(`#${id} .tw-markdown`).outerHTML;
  const show = (target, element) => flushSync(() => target.render(React.createElement(ToastProvider, null, element)));
  // The steps follow each other at once, so a code block still arriving isn't
  // highlighted in between (see the next test); it is once it's finished.
  let steps = 0;
  for (let length = 0, step = 1; length < text.length; step = (step * 7) % 23 + 1) {
    length = Math.min(text.length, length + step);
    show(live, React.createElement(Markdown, { text: text.slice(0, length), streaming: true, ...props }));
    show(fresh, React.createElement(Markdown, { key: length, text: text.slice(0, length), streaming: true, ...props }));
    assert.equal(html("live"), html("fresh"), `Drawn the same after ${length} characters`);
    steps++;
  }
  const streamed = [...window.document.querySelector("#live .tw-markdown").children];
  show(live, React.createElement(Markdown, { text, ...props }));
  show(fresh, React.createElement(Markdown, { key: "done", text, ...props }));
  assert.equal(html("live"), html("fresh"), "The finished message is drawn as a whole one");
  // Its blocks stay the same elements, so what they hold (a copied state, an open table) stays.
  assert.ok([...window.document.querySelector("#live .tw-markdown").children].every((child, index) => child === streamed[index]), "Nothing is drawn anew when the message finishes");
  return { node: window.document.querySelector("#live .tw-markdown"), steps };
}

const REPLY = [1, 2, 3].map(part => `## Part ${part}\n\nStep ${part} in **detail**, with a [link](https://example.com/${part}) and \`code\`. It goes on${part === 2 ? "\ncontinued on a second line" : ""}.\n\n- First point\n- Second, *emphasis*\n\n\`\`\`js\nfunction part${part}(items) {\n  return items.filter(item => item.ready);\n}\n\`\`\`\n\n| Column | Value |\n| --- | :-: |\n| Part | ${part} |`).join("\n\n");
const MIXED = [
  "Setext heading\n===",
  "1. one\n2. two\n\n3. three (loose)",
  "> A quote\nwith a lazy line\n\n> and another",
  "A paragraph\n| a | b |\n| - | - |\n| 1 | 2 |",
  "Not a table\n| a | b |\n| - | - x |\nafter all",
  "    indented code\n\n    more of it",
  "- [ ] task\n- [x] done\n  ```python\n  print('nested')\n  ```\n- after",
  "~~~\nplain fence\n~~~",
  "Press <kbd>Ctrl</kbd>, see https://example.com and a citation mark\uE200cite\uE202turn0search1\uE201.",
  "***",
  "```unknownlang\nkeep me\n```",
  "Last paragraph without a newline",
].join("\n\n");

test("a streaming reply draws the same as the whole text at each step, finished parts kept", async t => {
  const { node, steps } = await streams(t, REPLY + "\n\n" + MIXED);
  assert.ok(steps > 100);
  assert.ok(node.querySelector(".tw-code code.language-js .hljs-keyword"), "Finished code is highlighted");
  assert.equal(node.querySelectorAll("table").length, 4);
  assert.equal(node.querySelector("h1").textContent, "Setext heading");
  assert.equal(node.querySelectorAll(".tw-task-item").length, 2);
});

test("a code block still arriving stays highlighted up to its last complete line", async t => {
  const dom = new JSDOM('<div id="live"></div><div id="whole"></div>', { url: "https://fixture.invalid", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.tw = { call: () => new Promise(() => {}), on: () => () => {} };
  window.eval(bundle);
  const { React, createRoot, flushSync, Markdown, loadHighlighter } = window.ui;
  await loadHighlighter();
  const live = createRoot(window.document.getElementById("live")), whole = createRoot(window.document.getElementById("whole"));
  t.after(() => { live.unmount(); whole.unmount(); window.close(); });
  const show = (target, props) => flushSync(() => target.render(React.createElement(Markdown, { cards: false, ...props })));
  const code = () => window.document.querySelector("#live code");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const start = "Here it is:\n\n```js\nconst total = 1;\nfunction add(value) {\n  ret";
  show(live, { text: start, streaming: true });
  await wait(60);
  assert.equal(code().className, "hljs language-js", "Highlighted once highlight.js is there");
  assert.deepEqual([...code().querySelectorAll(".hljs-keyword")].map(node => node.textContent), ["const", "function"]);
  assert.equal(code().lastChild.nodeType, window.Node.TEXT_NODE, "The line being written is plain");
  assert.equal(code().textContent, "const total = 1;\nfunction add(value) {\n  ret");
  // A line that just completed shows plain until the next highlight, the earlier ones stay colored.
  show(live, { text: start + "urn value + total;\n}\nadd(", streaming: true });
  assert.deepEqual([...code().querySelectorAll(".hljs-keyword")].map(node => node.textContent), ["const", "function"]);
  assert.equal(code().textContent, "const total = 1;\nfunction add(value) {\n  return value + total;\n}\nadd(");
  await wait(260);
  assert.deepEqual([...code().querySelectorAll(".hljs-keyword")].map(node => node.textContent), ["const", "function", "return"]);
  const text = start + "urn value + total;\n}\nadd(2);\n```\n\nDone.";
  show(live, { text });
  show(whole, { text });
  assert.equal(window.document.querySelector("#live .tw-markdown").outerHTML, window.document.querySelector("#whole .tw-markdown").outerHTML, "The finished block is drawn as a whole one");
});

test("a streaming reply's cards, footnotes, link references and HTML match the whole text", async t => {
  const cards = { conversationId: "c1" };
  await streams(t, 'I wrote it.\n\n<file label="Report" path="C:\\\\work\\\\report.docx" action="created" />\n\nApprove? <button label="Approve" prompt="I approve." />\n\nMore text after the cards.\n\n- item <button label="Two" prompt="two" />', { cards });
  await streams(t, "First claim[^b] and second[^a].\n\nMore text.\n\n[^a]: Source A.\n[^b]: Source **B**.");
  await streams(t, "See [the docs][docs] and [docs].\n\nMore text.\n\n[docs]: https://example.com/docs");
  await streams(t, "Before\n\n<details>\n<summary>More</summary>\n\nHidden **text**\n\n</details>\n\nAfter");
});

test("Find matches message text across formatting, not the intro or times", () => {
  const dom = new JSDOM('<div id="thread"><div class="tw-chat-start">World intro</div><div data-message-id="a">Hello <b>wor</b>ld</div><div data-message-id="b">world again<time data-message-time>world</time></div></div>', { url: "https://fixture.invalid", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.tw = { call: async () => null, on: () => () => {} };
  dom.window.eval(bundle);
  const found = dom.window.ui.findMatches(dom.window.document.getElementById("thread"), "WORLD");
  assert.deepEqual([...found].map(range => range.toString()), ["world", "world"]);
  assert.equal(found[0].startContainer.parentElement.tagName, "B", "Across the bold part");
  assert.equal(dom.window.ui.findMatches(dom.window.document.getElementById("thread"), "   ").length, 0);
  dom.window.close();
});
