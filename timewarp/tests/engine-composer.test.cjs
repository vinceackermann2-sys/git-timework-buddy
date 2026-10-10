"use strict";
// The chat composer: sending while the agent works, Stop, keeping what was
// typed, prompt history, dropped and pasted files, voice input keys, and the
// report dialog's feedback ID.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { flushSync } from "react-dom"; import { Composer } from "./app/renderer/src/components/Composer.jsx"; import { FeedbackDialog } from "./app/renderer/src/components/Chat.jsx"; import { ToastProvider } from "./app/renderer/src/components/common.jsx"; globalThis.ui = { React, createRoot, flushSync, Composer, FeedbackDialog, ToastProvider };', resolveDir: root, loader: "jsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".js": "jsx", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
}).outputFiles[0].text;
// React renders updates that follow a promise on a timer in the page.
const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); await new Promise(resolve => setTimeout(resolve, 5)); } };

function mount(t, { calls = {}, props = {}, element = "Composer" } = {}) {
  const dom = new JSDOM('<section class="tw-main"><div id="host"></div></section>', { url: "https://fixture.invalid", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const made = [];
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.tw = { call: async (method, input) => { made.push([method, input]); return calls[method] ? calls[method](input) : null; }, on: () => () => {}, getPathForFile: file => file.diskPath || "" };
  window.eval(bundle);
  const { React, createRoot, flushSync, ToastProvider } = window.ui;
  const host = window.document.getElementById("host");
  const reactRoot = createRoot(host);
  let current = { models: { choices: [], selected: null }, ...props };
  const render = next => { current = { ...current, ...next }; flushSync(() => reactRoot.render(React.createElement(ToastProvider, null, React.createElement(window.ui[element], current)))); };
  render();
  t.after(() => { reactRoot.unmount(); window.close(); });
  const $ = selector => window.document.querySelector(selector);
  const area = () => $("textarea");
  const type = async value => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(area(), value);
    area().dispatchEvent(new window.Event("input", { bubbles: true }));
    await flush();
  };
  const key = async (target, init) => { target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); await flush(); };
  const click = async selector => { $(selector).dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await flush(); };
  const toasts = () => [...window.document.querySelectorAll(".tw-toast, [role='status'], [role='alert']")].map(node => node.textContent).join(" | ");
  return { window, $, area, type, key, click, render, made, toasts };
}

test("while the agent works a message can be sent, and Stop shows only with nothing to send", async t => {
  const sent = [];
  let stopped = 0;
  const ui = mount(t, { props: { running: true, onSend: async message => { sent.push(message); }, onStop: () => { stopped++; } } });
  assert.ok(ui.$(".tw-send.stop"), "Stop with an empty box");
  await ui.type("Add Friday");
  assert.equal(ui.$(".tw-send.stop"), null);
  assert.equal(ui.$(".tw-send").disabled, false);
  await ui.key(ui.area(), { key: "Enter" });
  assert.deepEqual(sent.map(message => message.text), ["Add Friday"]);
  assert.ok(ui.$(".tw-send.stop"));
  await ui.click(".tw-send.stop");
  assert.equal(stopped, 1);
});

test("the box clears as a message is sent, and it comes back if sending fails and nothing new was typed", async t => {
  let fail, during = null;
  const ui = mount(t, { props: { onSend: () => new Promise((_resolve, reject) => { fail = reject; }) } });
  await ui.type("Plan my week");
  await ui.key(ui.area(), { key: "Enter" });
  assert.equal(ui.area().value, "", "Cleared at once");
  fail(new Error("Offline"));
  await flush();
  assert.equal(ui.area().value, "Plan my week");
  // Typed while it was sending: kept.
  await ui.key(ui.area(), { key: "Enter" });
  await ui.type("Something else");
  during = ui.area().value;
  fail(new Error("Offline"));
  await flush();
  assert.equal(ui.area().value, during);
});

test("ArrowUp at the start of the box recalls this chat's earlier prompts and ArrowDown goes back to the draft", async t => {
  const ui = mount(t, { props: { autoFocusKey: "chat-1", historyKey: "chat-1", onSend: async () => {} } });
  for (const text of ["first", "second"]) { await ui.type(text); await ui.key(ui.area(), { key: "Enter" }); }
  await ui.type("dra");
  ui.area().setSelectionRange(3, 3);
  await ui.key(ui.area(), { key: "ArrowUp" });
  assert.equal(ui.area().value, "dra", "Not at the start: the caret moves as usual");
  ui.area().setSelectionRange(0, 0);
  await ui.key(ui.area(), { key: "ArrowUp" });
  assert.equal(ui.area().value, "second");
  await ui.key(ui.area(), { key: "ArrowUp" });
  assert.equal(ui.area().value, "first");
  await ui.key(ui.area(), { key: "ArrowDown" });
  await ui.key(ui.area(), { key: "ArrowDown" });
  assert.equal(ui.area().value, "dra");
  assert.deepEqual(JSON.parse(ui.window.localStorage.getItem("tw.prompts.chat-1")), ["second", "first"]);
});

test("files dropped on the chat attach from where they are, a pasted image is saved first, and at most 10 attach", async t => {
  const sent = [];
  const ui = mount(t, { props: { onSend: async message => { sent.push(message); } }, calls: {
    "attachments.describe": ({ paths }) => paths.map(file => ({ path: file, image: /\.png$/.test(file), size: 10 })),
    "attachments.savePasted": ({ name }) => ({ path: "C:\\profile\\attachments\\" + name, image: true, size: 3 }),
  } });
  // jsdom's files have no arrayBuffer().
  const file = (name, diskPath) => Object.assign(new ui.window.File(["abc"], name, { type: name.endsWith(".png") ? "image/png" : "text/plain" }), { diskPath, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const drop = (type, files) => {
    const event = new ui.window.Event(type, { bubbles: true, cancelable: true });
    event.dataTransfer = { types: ["Files"], files, items: [], dropEffect: "none" };
    ui.$(".tw-main").dispatchEvent(event);
    return event;
  };
  drop("dragenter", []);
  await flush();
  assert.ok(ui.$(".tw-main > .tw-drop-overlay"), "The chat shows it can take the files");
  assert.equal(drop("drop", [file("report.pdf", "C:\\docs\\report.pdf")]).defaultPrevented, true);
  await flush();
  assert.equal(ui.$(".tw-drop-overlay"), null);
  // A screenshot pasted into the box has no file on disk.
  const paste = new ui.window.Event("paste", { bubbles: true, cancelable: true });
  paste.clipboardData = { types: ["Files"], files: [file("image.png")], items: [] };
  ui.area().dispatchEvent(paste);
  await flush();
  assert.deepEqual(ui.made.filter(([method]) => method.startsWith("attachments.")).map(([method, input]) => [method, JSON.parse(JSON.stringify(input.paths || input.name))]), [["attachments.describe", ["C:\\docs\\report.pdf"]], ["attachments.savePasted", "image.png"]]);
  assert.equal(ui.made.find(([method]) => method === "attachments.savePasted")[1].data.byteLength, 3);
  drop("drop", Array.from({ length: 12 }, (_value, index) => file(`page${index}.txt`, `C:\\docs\\page${index}.txt`)));
  await flush();
  assert.equal(ui.window.document.querySelectorAll(".tw-chip").length, 10);
  assert.match(ui.toasts(), /Up to 10 files/);
  await ui.type("Read these");
  await ui.key(ui.area(), { key: "Enter" });
  assert.deepEqual([sent[0].files.length, [...sent[0].images]], [9, ["C:\\profile\\attachments\\image.png"]]);
});

test("Ctrl+Space starts voice input once however fast it's pressed, and Escape discards the recording", async t => {
  const ui = mount(t, { props: { onSend: async () => {} } });
  let opened = 0, release;
  const track = { stopped: false, stop() { this.stopped = true; } };
  ui.window.navigator.mediaDevices = { getUserMedia: () => { opened++; return new Promise(resolve => { release = () => resolve({ getTracks: () => [track] }); }); } };
  class Recorder { constructor() { this.state = "inactive"; } static isTypeSupported() { return true; } start() { this.state = "recording"; } stop() { this.state = "inactive"; this.onstop?.(); } }
  ui.window.MediaRecorder = Recorder;
  await ui.key(ui.window.document.body, { key: " ", code: "Space", ctrlKey: true });
  await ui.click('[aria-label="Start voice input"]');
  assert.equal(opened, 1, "A second press while the microphone opens doesn't open another");
  assert.equal(ui.$('[aria-label="Start voice input"]').disabled, true);
  release();
  await flush();
  assert.ok(ui.$('[aria-label="Discard recording"]'), "Recording");
  await ui.key(ui.window.document.body, { key: "Escape" });
  assert.equal(track.stopped, true);
  assert.equal(ui.$('[aria-label="Discard recording"]'), null);
  assert.equal(ui.made.some(([method]) => method === "dictation.transcribe"), false, "A discarded recording isn't sent");
});

test("a report is sent with its chat and its feedback ID can be copied", async t => {
  let copied = null;
  const ui = mount(t, { element: "FeedbackDialog", props: { open: true, onClose: () => {}, conversationId: "chat-1" }, calls: { "feedback.submit": () => ({ traceId: "20261010_0123456789abcdef" }) } });
  Object.defineProperty(ui.window.navigator, "clipboard", { value: { writeText: async value => { copied = value; } } });
  await ui.type("The reply never finished");
  await ui.click(".tw-btn.primary");
  const [, input] = ui.made.find(([method]) => method === "feedback.submit");
  assert.deepEqual([input.description, input.conversationId], ["The reply never finished", "chat-1"]);
  assert.match(ui.$("dialog").textContent, /Feedback sent/);
  await ui.click(".tw-link");
  assert.equal(copied, "20261010_0123456789abcdef");
  assert.match(ui.$(".tw-link").textContent, /Copied feedback ID/);
});

test("a report that can't be sent says so in the dialog", async t => {
  const ui = mount(t, { element: "FeedbackDialog", props: { open: true, onClose: () => {} }, calls: { "feedback.submit": () => { throw new Error(""); } } });
  assert.equal(ui.area().rows, 5);
  await ui.type("Nothing loads");
  await ui.click(".tw-btn.primary");
  assert.equal(ui.$(".tw-feedback-error").textContent, "Unable to send feedback right now.");
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("the composer's buttons say what they do, as before", async t => {
  const ui = mount(t, { props: { running: true, onSend: async () => {} } });
  assert.equal(ui.$('[aria-label="Add context"]').title, "Add photos & files");
  assert.equal(ui.$('[aria-label="Start voice input"]').title, "Dictate (Ctrl+Space)");
  assert.equal(ui.$(".tw-send.stop").getAttribute("aria-label"), "Stop response");
  await ui.type("Hello");
  assert.equal(ui.$(".tw-send").getAttribute("aria-label"), "Send message");
  assert.equal(ui.$(".tw-send").title, "Send ↵");
});

test("@ offers people, skills and the agent's files; a choice shows as a chip and is sent as a reference", async t => {
  const sent = [];
  const ui = mount(t, { props: { agentId: "agent-1", onSend: async message => { sent.push(message); } }, calls: {
    "skills.list": () => ({ skills: [{ name: "pdf", title: "PDF", description: "Read PDFs", path: "/skills/pdf/SKILL.md", enabled: true }] }),
    "organizations.members": () => [{ userId: "me", name: "Me Myself", email: "me@example.com" }, { userId: "u2", name: "Ada Lovelace", email: "ada@example.com" }],
    "account.get": () => ({ user: { id: "me" } }),
    "files.search": ({ query }) => [{ name: "report.pdf", path: "docs/report.pdf", type: "file" }].filter(file => file.name.includes(query)),
  } });
  await ui.type("Summarize @");
  const menu = () => ui.$('[aria-label="Composer suggestions"]');
  assert.match(menu().textContent, /People.*Ada Lovelace.*Skills.*pdf.*Files.*Type to search for files/);
  assert.doesNotMatch(menu().textContent, /Me Myself/, "Not the user themself");
  await ui.key(ui.area(), { key: "Escape" });
  assert.equal(menu(), null, "Escape closes it");
  await ui.type("Summarize @r");
  assert.equal(menu(), null, "…until something else is typed");
  await ui.type("Summarize ");
  await ui.type("Summarize @rep");
  await wait(150); await flush();
  assert.deepEqual([...ui.window.document.querySelectorAll('[role="option"]')].map(option => option.textContent), ["report.pdfdocs/report.pdf"]);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.made.filter(([method]) => method === "files.search").at(-1)[1])), { agentId: "agent-1", query: "rep" });
  await ui.key(ui.area(), { key: "Enter" });
  assert.equal(ui.area().value, "Summarize @report.pdf ");
  assert.equal(ui.$(".tw-mention-chip").textContent, "report.pdf");
  await ui.type("Summarize @report.pdf with $p");
  assert.match(menu().textContent, /^Skills/);
  await ui.key(ui.area(), { key: "Tab" });
  assert.equal(ui.area().value, "Summarize @report.pdf with $pdf ");
  assert.equal(ui.window.document.querySelectorAll(".tw-mention-chip").length, 2);
  await ui.key(ui.area(), { key: "Enter" });
  assert.equal(sent[0].text, 'Summarize <ref type="file" name="report.pdf" path="docs/report.pdf" content-type="application/pdf"></ref> with $pdf');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].skills)), [{ name: "pdf", path: "/skills/pdf/SKILL.md" }]);
  assert.deepEqual(JSON.parse(ui.window.localStorage.getItem("tw.prompts.undefined") || "null"), null, "No history without a chat");
});

test("an unsent draft is kept per chat, and a sent one is cleared", async t => {
  const ui = mount(t, { props: { historyKey: "chat-1", onSend: async () => {} } });
  await ui.type("Half a thought");
  assert.equal(JSON.parse(ui.window.localStorage.getItem("tw.draft.chat-1")).text, "Half a thought");
  ui.render({ historyKey: "chat-2" });
  await flush();
  assert.equal(ui.area().value, "", "Another chat has its own");
  ui.render({ historyKey: "chat-1" });
  await flush();
  assert.equal(ui.area().value, "Half a thought");
  await ui.key(ui.area(), { key: "Enter" });
  assert.equal(ui.window.localStorage.getItem("tw.draft.chat-1"), null);
});

test("a long paste becomes a Clipboard chip that goes after what was typed", async t => {
  const sent = [];
  const ui = mount(t, { props: { onSend: async message => { sent.push(message); } } });
  const pasted = Array.from({ length: 12 }, (_value, index) => "row " + index).join("\n");
  const paste = new ui.window.Event("paste", { bubbles: true, cancelable: true });
  paste.clipboardData = { types: ["text/plain"], files: [], items: [], getData: type => type === "text/plain" ? pasted : "" };
  ui.area().dispatchEvent(paste);
  await flush();
  assert.equal(paste.defaultPrevented, true);
  assert.match(ui.$(".tw-clip-chip").textContent, /Clipboard \(12 lines\)/);
  assert.equal(ui.area().value, "");
  await ui.type("Sort these");
  await ui.key(ui.area(), { key: "Enter" });
  assert.equal(sent[0].text, "Sort these\n\n" + pasted);
});

test("a failed transcription keeps the recording for Retry, and Transcribe and send sends the words", async t => {
  const sent = [];
  let answers = 0;
  const ui = mount(t, { props: { onSend: async message => { sent.push(message); } }, calls: {
    "dictation.transcribe": () => { answers += 1; if (answers === 1) throw Object.assign(new Error("Busy"), { status: 503 }); return { text: answers === 2 ? "hello there" : "and send" }; },
  } });
  const track = { stop() {} };
  ui.window.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [track] }) };
  ui.window.Blob.prototype.arrayBuffer = async function () { return new Uint8Array([7, 7, 7]).buffer; };
  class Recorder { constructor() { this.state = "inactive"; } static isTypeSupported() { return true; } start() { this.state = "recording"; } stop() { this.state = "inactive"; this.ondataavailable?.({ data: new ui.window.Blob(["abc"]) }); this.onstop?.(); } }
  ui.window.MediaRecorder = Recorder;
  await ui.click('[aria-label="Start voice input"]');
  await wait(300);
  await ui.click('[aria-label="Transcribe"]');
  assert.match(ui.toasts(), /Transcription failed, try again in 5 seconds!/);
  await ui.click('[aria-label="Retry"]');
  const tries = ui.made.filter(([method]) => method === "dictation.transcribe").map(([, input]) => [...new Uint8Array(input.audio)]);
  assert.deepEqual(tries, [[7, 7, 7], [7, 7, 7]], "The same recording");
  assert.equal(ui.area().value, "hello there");
  await ui.click('[aria-label="Start voice input"]');
  await wait(300);
  await ui.click('[aria-label="Transcribe and send"]');
  await flush();
  assert.deepEqual(sent.map(message => message.text), ["hello there and send"]);
});
