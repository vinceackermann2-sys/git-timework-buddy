"use strict";
// Messages as drawn in the chat: the HTML a message may use, footnotes,
// images written into a message, a user's references, and Find.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { flushSync } from "react-dom"; import { Markdown } from "./app/renderer/src/markdown.jsx"; import { findMatches } from "./app/renderer/src/components/Chat.jsx"; import { ToastProvider } from "./app/renderer/src/components/common.jsx"; globalThis.ui = { React, createRoot, flushSync, Markdown, findMatches, ToastProvider };', resolveDir: root, loader: "jsx" },
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
