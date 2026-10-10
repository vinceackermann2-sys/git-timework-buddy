"use strict";
// Browser tools the agent calls through Codex dynamic tools. They act only on
// the conversation's tabs in Timewarp's built-in browser, using Electron's
// per-page debugger; no remote debugging port is opened.

const fs = require("node:fs");
const path = require("node:path");

const MAX_SNAPSHOT = 24000, MAX_TEXT = 20000, MAX_UPLOADS = 10;
// The longest value the vault keeps (vault.cjs).
const MAX_SECRET = 10000;
// Chooses a dropdown option by its text or value and tells the page.
const SELECT_IN_PAGE = `function (wanted) {
  const select = this.tagName === "SELECT" ? this : this.closest("select") || this.querySelector("select");
  if (!select) return { ok: false, error: "That element isn't a dropdown. Click it and choose from the list instead." };
  const text = value => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase(), target = text(wanted);
  const options = [...select.options];
  const option = options.find(item => text(item.label || item.text) === target) || options.find(item => text(item.value) === target) || options.find(item => text(item.label || item.text).includes(target));
  if (!option) return { ok: false, error: "No option matches. The options are: " + options.map(item => (item.label || item.text).trim()).join(", ").slice(0, 400) };
  select.focus();
  select.value = option.value;
  option.selected = true;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, label: (option.label || option.text).trim() };
}`;
const HOVER_IN_PAGE = `function () {
  this.scrollIntoView({ block: "center" });
  const box = this.getBoundingClientRect(), init = { bubbles: true, composed: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, view: window };
  this.dispatchEvent(new PointerEvent("pointerover", { ...init, pointerType: "mouse" }));
  this.dispatchEvent(new PointerEvent("pointerenter", { ...init, bubbles: false, pointerType: "mouse" }));
  this.dispatchEvent(new MouseEvent("mouseover", init));
  this.dispatchEvent(new MouseEvent("mouseenter", { ...init, bubbles: false }));
  this.dispatchEvent(new MouseEvent("mousemove", init));
}`;

// Files the agent may upload: only files inside its own workspace folder.
function workspaceFiles(agent, files) {
  if (!agent?.workspace) throw Object.assign(new Error("This agent has no workspace folder."), { status: 400 });
  if (!Array.isArray(files) || !files.length || files.length > MAX_UPLOADS) throw Object.assign(new Error(`Choose 1–${MAX_UPLOADS} files from your workspace folder.`), { status: 400 });
  const base = fs.realpathSync(agent.workspace);
  return files.map(file => {
    const candidate = path.resolve(base, String(file));
    let real;
    try { real = fs.realpathSync(candidate); } catch { throw Object.assign(new Error(`${file} isn't in your workspace folder.`), { status: 404 }); }
    if (real !== base && !real.startsWith(base + path.sep)) throw Object.assign(new Error("Only files in your workspace folder can be uploaded."), { status: 403 });
    if (!fs.statSync(real).isFile()) throw Object.assign(new Error(`${file} isn't a file.`), { status: 400 });
    return real;
  });
}
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "tab", "slider", "spinbutton", "treeitem", "listbox", "textarea"]);
const STRUCTURE = new Set(["heading", "img", "image", "cell", "columnheader", "rowheader", "listitem", "dialog", "alert", "status", "navigation", "main", "form", "table", "row", "paragraph", "StaticText", "list"]);
const KEYS = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" }, Tab: { key: "Tab", code: "Tab", keyCode: 9 }, Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 }, Delete: { key: "Delete", code: "Delete", keyCode: 46 }, Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 }, ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 }, ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }, ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 }, PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 }, Home: { key: "Home", code: "Home", keyCode: 36 }, End: { key: "End", code: "End", keyCode: 35 },
  Insert: { key: "Insert", code: "Insert", keyCode: 45 },
};
const KEY_ALIASES = { esc: "Escape", return: "Enter", del: "Delete", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", " ": "Space" };
// Modifier bits as the debugger takes them, by the names agents use for them.
const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const MODIFIERS = { alt: "Alt", option: "Alt", control: "Control", ctrl: "Control", meta: "Meta", cmd: "Meta", command: "Meta", win: "Meta", shift: "Shift", mod: process.platform === "darwin" ? "Meta" : "Control" };
const PUNCTUATION = { ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "`": 192, "[": 219, "\\": 220, "]": 221, "'": 222 };
// On macOS, editing shortcuts are menu commands, which a key event alone doesn't run.
const MAC_COMMANDS = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo" };
const fail = (status, message) => Object.assign(new Error(message), { status });
// "Control+A", "Shift+Tab", "Meta+K", "Enter" or "a": the key, its modifier
// bits and the text it types (none for a shortcut with Alt, Control or Meta).
function parseKey(input) {
  let rest = String(input ?? "").trim(), modifiers = 0;
  for (let match; (match = /^([A-Za-z]+)\s*\+\s*(.+)$/.exec(rest)) && MODIFIERS[match[1].toLowerCase()];) { modifiers |= MODIFIER_BITS[MODIFIERS[match[1].toLowerCase()]]; rest = match[2].trim() || match[2]; }
  const named = Object.keys(KEYS).find(name => name.toLowerCase() === rest.toLowerCase()) || KEY_ALIASES[rest.toLowerCase()];
  let spec;
  if (named) spec = { ...KEYS[named] };
  else if (/^F([1-9]|1[0-2])$/i.test(rest)) spec = { key: rest.toUpperCase(), code: rest.toUpperCase(), keyCode: 111 + Number(rest.slice(1)) };
  else if ([...rest].length === 1) {
    const upper = rest.toUpperCase(), letter = /^[a-z]$/i.test(rest), digit = /^\d$/.test(rest);
    const character = letter ? (modifiers & 8 ? upper : rest.toLowerCase()) : rest;
    spec = { key: character, code: letter ? "Key" + upper : digit ? "Digit" + rest : undefined, keyCode: letter || digit ? upper.charCodeAt(0) : PUNCTUATION[rest], text: character };
  } else throw fail(400, `Unsupported key: ${input}. Use a key name such as Enter, Tab or ArrowDown, a single character, or a combination such as Control+A.`);
  if (modifiers & 7) delete spec.text;
  const command = process.platform === "darwin" && modifiers & 4 && spec.key.length === 1 ? (/^z$/i.test(spec.key) && modifiers & 8 ? "redo" : MAC_COMMANDS[spec.key.toLowerCase()]) : null;
  return { ...spec, modifiers, ...(command ? { commands: [command] } : {}) };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const READ_ONLY = new Set(["tabs", "snapshot", "read", "screenshot", "wait"]);
// What still works while a page shows a dialog (its page waits for the answer).
const PAST_DIALOGS = new Set(["tabs", "dialog", "close_tab"]);
// A full pointer and mouse sequence at the element's center, then its default
// action (follow a link, toggle a box, submit a form); twice for a double click.
const CLICK_IN_PAGE = `function (count = 1) {
  this.scrollIntoView({ block: "center" });
  const box = this.getBoundingClientRect(), at = { bubbles: true, cancelable: true, composed: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, button: 0, view: window };
  for (let detail = 1; detail <= count; detail++) {
    const init = { ...at, detail };
    this.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
    this.dispatchEvent(new MouseEvent("mousedown", init));
    if (typeof this.focus === "function") this.focus();
    this.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
    this.dispatchEvent(new MouseEvent("mouseup", init));
    this.click();
  }
  if (count > 1) this.dispatchEvent(new MouseEvent("dblclick", { ...at, detail: count }));
}`;
// Whether a checkbox, radio button or switch (or the box a label is for) is checked.
const CHECKED_IN_PAGE = `function () {
  const box = this.tagName === "LABEL" && this.control ? this.control : this;
  if (box.tagName === "INPUT" && /^(checkbox|radio)$/i.test(box.type)) return { checked: box.checked, radio: box.type.toLowerCase() === "radio" };
  const state = String(box.getAttribute("aria-checked") ?? box.getAttribute("aria-pressed") ?? "").toLowerCase();
  return { checked: state === "true" ? true : state === "false" ? false : null, radio: box.getAttribute("role") === "radio" };
}`;
// An element's text and value, or one attribute: the element's own property
// where it has one, so href and src are whole addresses and value is current.
const ELEMENT_IN_PAGE = `function (name) {
  const password = this.tagName === "INPUT" && String(this.type).toLowerCase() === "password";
  if (name) {
    const value = name in this && !["object", "function"].includes(typeof this[name]) ? this[name] : this.getAttribute(name);
    return { password, attribute: value === null || value === undefined ? null : String(value) };
  }
  return { password, text: String(this.innerText ?? this.textContent ?? ""), value: "value" in this && typeof this.value !== "object" ? String(this.value ?? "") : null };
}`;
// Counts key presses that reach the page, to tell whether Chromium delivered one.
const KEY_WATCH = `(() => {
  if (!window.__timewarpKeys) { window.__timewarpKeys = { count: 0 }; addEventListener("keydown", event => { if (event.isTrusted) window.__timewarpKeys.count++; }, true); }
  return { count: window.__timewarpKeys.count, frame: /^(IFRAME|FRAME)$/.test(document.activeElement?.tagName || "") };
})()`;
// A page Chromium doesn't draw (no window, or it's minimized) gets no key
// presses, so it gets them as events, with the browser's usual effect done
// here: Enter sends the form or presses the focused button or link, Tab moves
// focus, Space presses, Backspace and Delete edit, arrows move or scroll,
// Control+A selects, and characters are typed.
const KEY_IN_PAGE = `(spec => {
  let doc = document, target = doc.activeElement;
  for (;;) {
    if (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
    else if (/^(IFRAME|FRAME)$/.test(target?.tagName || "")) { let inner = null; try { inner = target.contentDocument; } catch {} if (!inner) break; doc = inner; target = inner.activeElement; }
    else break;
  }
  target ||= doc.body || doc.documentElement;
  const view = doc.defaultView || window, name = spec.key;
  const alt = !!(spec.modifiers & 1), ctrl = !!(spec.modifiers & 2), meta = !!(spec.modifiers & 4), shift = !!(spec.modifiers & 8), command = ctrl || meta;
  const init = { key: name, code: spec.code || "", keyCode: spec.keyCode || 0, which: spec.keyCode || 0, altKey: alt, ctrlKey: ctrl, metaKey: meta, shiftKey: shift, bubbles: true, cancelable: true, composed: true, view };
  let go = target.dispatchEvent(new KeyboardEvent("keydown", init));
  if (go && spec.text) go = target.dispatchEvent(new KeyboardEvent("keypress", { ...init, charCode: spec.text.charCodeAt(0) }));
  if (go) {
    const field = target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|file|image|range|color|hidden)$/i.test(target.type));
    const editable = field || target.isContentEditable, write = text => doc.execCommand("insertText", false, text);
    const presses = "button, summary, a[href], [role=button], [role=link], [role=menuitem], [role=option], [role=tab], input[type=button], input[type=submit], input[type=reset], input[type=image]";
    const changed = () => { target.dispatchEvent(new Event("input", { bubbles: true })); target.dispatchEvent(new Event("change", { bubbles: true })); };
    if (command && /^a$/i.test(name)) { if (field) target.select(); else doc.execCommand("selectAll"); }
    else if (command) { const action = { c: "copy", x: "cut", v: "paste", y: "redo", z: shift ? "redo" : "undo" }[name.toLowerCase()]; if (action) doc.execCommand(action); }
    else if (name === "Tab") {
      const list = [...doc.querySelectorAll("a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]")]
        .filter(item => item.tabIndex >= 0 && !item.disabled && item.type !== "hidden" && item.getClientRects().length && view.getComputedStyle(item).visibility !== "hidden")
        .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : 1e9) - (b.tabIndex > 0 ? b.tabIndex : 1e9));
      const at = list.indexOf(target), next = list.length ? list[at < 0 ? (shift ? list.length - 1 : 0) : (at + (shift ? -1 : 1) + list.length) % list.length] : null;
      if (next) { next.focus(); if (/^(INPUT|TEXTAREA)$/.test(next.tagName)) try { next.select(); } catch {} }
    } else if (name === "Enter") {
      if (target.tagName === "TEXTAREA" || target.isContentEditable) write("\\n");
      else if (field && target.form) target.form.requestSubmit();
      else if (target.matches(presses)) target.click();
    } else if (name === " ") {
      if (editable) write(" ");
      else if (target.matches(presses + ", input[type=checkbox], input[type=radio], [role=checkbox], [role=switch], [role=radio]")) target.click();
      else view.scrollBy(0, view.innerHeight * (shift ? -0.85 : 0.85));
    } else if (name === "Backspace" || name === "Delete") { if (editable) doc.execCommand(name === "Backspace" ? "delete" : "forwardDelete"); }
    else if (/^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(name)) {
      const back = /Up|Left|Home/.test(name);
      if (target.tagName === "SELECT" && !/Left|Right|Page/.test(name)) {
        const last = target.options.length - 1, index = Math.max(0, Math.min(last, name === "Home" ? 0 : name === "End" ? last : target.selectedIndex + (back ? -1 : 1)));
        if (index !== target.selectedIndex) { target.selectedIndex = index; changed(); }
      } else if (field && target.type === "number" && /Arrow(Up|Down)/.test(name)) { if (back) target.stepUp(); else target.stepDown(); changed(); }
      else if (field && /Left|Right|Home|End/.test(name) && typeof target.selectionStart === "number") {
        const length = target.value.length, backward = target.selectionDirection === "backward";
        const anchor = backward ? target.selectionEnd : target.selectionStart, focus = backward ? target.selectionStart : target.selectionEnd;
        const moved = /Home/.test(name) ? 0 : /End/.test(name) ? length : !shift && anchor !== focus ? (back ? Math.min(anchor, focus) : Math.max(anchor, focus)) : Math.max(0, Math.min(length, focus + (back ? -1 : 1)));
        if (shift) target.setSelectionRange(Math.min(anchor, moved), Math.max(anchor, moved), moved < anchor ? "backward" : "forward"); else target.setSelectionRange(moved, moved);
      } else if (editable) view.getSelection()?.modify(shift ? "extend" : "move", back ? "backward" : "forward", /Up|Down|Page/.test(name) ? "line" : /Home|End/.test(name) ? "lineboundary" : "character");
      else if (name === "Home" || name === "End") view.scrollTo(view.scrollX, name === "Home" ? 0 : doc.documentElement.scrollHeight);
      else { const step = /Page/.test(name) ? view.innerHeight * 0.85 : 40; if (/Left|Right/.test(name)) view.scrollBy(back ? -step : step, 0); else view.scrollBy(0, back ? -step : step); }
    } else if (spec.text && !alt && editable) write(spec.text);
  }
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  return true;
})`;
const quote = value => JSON.stringify(String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300));
// What the agent hears about a dialog a page is showing.
const dialogText = item => item.forAgent
  ? `The page${item.site ? ` (${item.site})` : ""} is showing a ${item.type}: ${quote(item.message)}${item.type === "prompt" ? `, suggested answer ${quote(item.value)}` : ""}. It waits for an answer: use the dialog tool with accept true or false${item.type === "prompt" ? " (and text for your answer)" : ""}. Unanswered, it's dismissed after a minute.`
  : `The page is asking the user something (a ${item.type}: ${quote(item.message)}). Wait until they answer it.`;

const ref = { type: "string", description: "Element reference from the latest snapshot, for example e12." };
const tab = { type: "string", description: "Optional tab id from the tabs tool. Defaults to the active tab." };
const TOOLS = [
  ["open", "Open a web address (or search words) in the built-in browser that the user can see. Use new_tab to keep the current page.", { url: { type: "string" }, new_tab: { type: "boolean" } }, ["url"]],
  ["tabs", "List this conversation's browser tabs with their ids, addresses and titles.", {}, []],
  ["snapshot", "Read the current page as an outline of headings, text, links with their addresses, and interactive elements with references (e1, e2, …) for click and type.", { tab }, []],
  ["click", "Click an element by its reference from the latest snapshot. double: double-click. checked: the state a checkbox, radio button or switch should end in (clicked only if needed).", { ref, double: { type: "boolean" }, checked: { type: "boolean" }, tab }, ["ref"]],
  ["type", "Type text into a field by its reference, replacing its text, or without a reference into the focused element. Set submit to press Enter afterwards.", { ref, text: { type: "string" }, submit: { type: "boolean" }, tab }, ["text"]],
  ["press", "Press a key or combination on the focused element, such as Enter, Tab, Escape, Backspace, ArrowDown, PageDown, Control+A, Shift+Tab or Meta+K.", { key: { type: "string" }, tab }, ["key"]],
  ["scroll", "Scroll the page up or down.", { direction: { type: "string", enum: ["up", "down"] }, amount: { type: "number", description: "Screens to scroll, default 1." }, tab }, ["direction"]],
  ["read", "Read the visible text of the page, with its title and address. With ref: one element's text and value, or its attribute (such as href). With url: another page, read in the background without changing the open one.", { ref, attribute: { type: "string" }, url: { type: "string" }, tab }, []],
  ["screenshot", "Take a screenshot of the page to check its visual state.", { tab }, []],
  ["back", "Go back to the previous page.", { tab }, []],
  ["forward", "Go forward.", { tab }, []],
  ["wait", "Wait until text appears, the address contains url, or the page has loaded (load), for at most 20 seconds; or wait a number of seconds.", { text: { type: "string" }, url: { type: "string" }, load: { type: "boolean" }, seconds: { type: "number" }, tab }, []],
  ["close_tab", "Close a browser tab.", { tab }, []],
  ["select", "Choose an option in a dropdown (select) by its reference, matching the option's visible text or value.", { ref, option: { type: "string" }, tab }, ["ref", "option"]],
  ["hover", "Move the pointer over an element, for example to open a menu.", { ref, tab }, ["ref"]],
  ["upload", "Attach files from your workspace folder to a file field by its reference.", { ref, files: { type: "array", items: { type: "string" }, description: "Paths relative to your workspace folder." }, tab }, ["ref", "files"]],
  ["dialog", "Answer the alert, confirm or prompt the page is showing: accept or dismiss it; text answers a prompt.", { accept: { type: "boolean" }, text: { type: "string" }, tab }, ["accept"]],
];

function toolSpecs() {
  return [{
    type: "namespace", name: "timewarp_browser",
    description: "Timewarp's built-in browser, visible to the user beside the chat. Use it for web research, signed-in websites and forms. Take a snapshot before clicking or typing, and read back the result after each action.",
    tools: TOOLS.map(([name, description, properties, required]) => ({ type: "function", name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } })),
  }];
}

// The agent's cursor, drawn in the page (in an isolated world and a closed
// shadow root, so the page can't restyle or read it) where the agent acts.
function cursorScript(x, y, label) {
  return `(() => {
  const ID = "__timewarp_agent_cursor";
  let host = document.getElementById(ID), parts = host && host.__timewarp;
  if (!parts) {
    host = document.createElement("div");
    host.id = ID;
    host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "closed" });
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;top:0;transition:transform .35s cubic-bezier(.2,.8,.2,1),opacity .3s;opacity:0;pointer-events:none;";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "22"); svg.setAttribute("height", "22"); svg.setAttribute("viewBox", "0 0 22 22");
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("d", "M3 2 L3 18 L7.5 13.8 L10.6 20 L13.4 18.6 L10.4 12.6 L16.5 12.6 Z");
    arrow.setAttribute("fill", "#7c3aed"); arrow.setAttribute("stroke", "#ffffff"); arrow.setAttribute("stroke-width", "1.6"); arrow.setAttribute("stroke-linejoin", "round");
    svg.append(arrow);
    const name = document.createElement("span");
    name.style.cssText = "position:absolute;left:16px;top:18px;padding:2px 8px;border-radius:999px;background:#7c3aed;color:#fff;font:600 11px/16px system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25);";
    box.append(svg, name);
    root.append(box);
    (document.body || document.documentElement).append(host);
    parts = host.__timewarp = { box, name, timer: 0 };
  }
  parts.name.textContent = ${JSON.stringify(label)};
  parts.box.style.opacity = "1";
  parts.box.style.transform = "translate(${Math.round(x) - 3}px, ${Math.round(y) - 2}px)";
  clearTimeout(parts.timer);
  parts.timer = setTimeout(() => { parts.box.style.opacity = "0"; }, 6000);
})()`;
}

// Matches a filled vault value in page output, including card numbers the
// page reformats with spaces or dashes.
function patternFor(secret) {
  const value = String(secret);
  if (/^\d{12,19}$/.test(value)) return value.split("").join("[\\s-]?");
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// The value as written, and as it appears in a web address once a page or a
// form sends it (forms also escape ! ' ( ) ~ and send spaces as +).
function patternsFor(secret) {
  const value = String(secret), encoded = encodeURIComponent(value), form = new URLSearchParams([["", value]]).toString().slice(1);
  return [...new Set([value, encoded, encoded.replace(/%20/g, "+"), form, form.replace(/\+/g, "%20")])].map(patternFor);
}
// The page's text and what its fields show (password fields show dots, hidden
// fields nothing), read in an isolated world the page can't change.
const SHOWN_IN_PAGE = `(() => ({
  text: (document.body?.innerText || "").slice(0, 500000),
  values: [...document.querySelectorAll("input, textarea")].filter(field => !["password", "hidden"].includes(String(field.type).toLowerCase())).map(field => String(field.value || "")),
}))()`;
// capturePage never settles for a page whose window has closed.
function within(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(fail(504, message)), ms); })]).finally(() => clearTimeout(timer));
}
// Whether a field filled from the vault still shows its value on screen:
// password fields show dots; any other field shows the text itself.
const SHOWS_VALUE_IN_PAGE = `function () {
  if (!this.isConnected) return false;
  if (this.tagName === "INPUT" && String(this.type).toLowerCase() === "password") return false;
  return "value" in this ? !!this.value : !!(this.isContentEditable && this.textContent);
}`;
const PASSWORD_FIELD_IN_PAGE = `function () { return this.tagName === "INPUT" && String(this.type).toLowerCase() === "password"; }`;
// For vault tools: what a field is and holds now (an input's type, length
// limit and hints, or a list's options), so card details go in as it wants them.
const FIELD_IN_PAGE = `function () {
  const select = this.tagName === "SELECT" ? this : this.closest?.("select") || this.querySelector?.("select");
  const field = select || this;
  const label = [field.getAttribute?.("aria-label"), field.getAttribute?.("name"), field.id, field.getAttribute?.("autocomplete"), field.labels?.[0]?.textContent].filter(Boolean).join(" ").replace(/\\s+/g, " ").slice(0, 300);
  return {
    tag: field.tagName.toLowerCase(), type: String(field.type || "").toLowerCase(), maxLength: typeof field.maxLength === "number" ? field.maxLength : -1,
    placeholder: String(field.placeholder || "").slice(0, 100), label, value: "value" in field ? String(field.value ?? "") : String(field.textContent || ""),
    options: select ? [...select.options].slice(0, 400).map(option => ({ value: option.value, text: String(option.label || option.text || "").trim().slice(0, 100) })) : undefined,
  };
}`;

function createBrowserTools({ browser, onActivity = () => {} }) {
  // An element is a node and the debugger session of its frame's process:
  // none for the page and its frames from the same site, their own for frames
  // from other sites (a card form, a sign-in box), which run in their own process.
  const refs = new WeakMap(); // webContents -> Map(ref -> { node: backendNodeId, session, url of its page or frame })
  const elementKey = element => `${element.session || ""} ${element.node}`;
  // Vault values filled in a conversation's tabs are hidden from everything
  // its browser tools return, in any of its tabs. The fields themselves are
  // remembered too, so their values stay hidden whatever their length.
  const secrets = new Map(); // conversationId -> RegExp of filled vault values
  const filledFields = new WeakMap(); // webContents -> Map(element key -> element)
  // Passwords, card numbers and secrets filled in a conversation, for checks
  // that don't depend on their length (not usernames, expiry dates or names).
  const sensitive = new Map(); // conversationId -> Set of values
  const redact = (conversationId, value) => {
    const pattern = secrets.get(conversationId);
    return pattern ? String(value).replace(pattern, "[filled from vault]") : String(value);
  };
  // A field showing a short vault value (a PIN) the page copied in: values
  // under 6 characters aren't hidden in page text, as they'd hide ordinary words.
  const showsShortSecret = (conversationId, value) => [...(sensitive.get(conversationId) || [])].some(secret => secret.length >= 3 && secret.length < 6 && value.includes(secret));
  const redactResult = (conversationId, result) => !Array.isArray(result?.contentItems) ? result : {
    ...result, contentItems: result.contentItems.map(item => item.type === "inputText" ? { ...item, text: redact(conversationId, item.text) } : item),
  };
  async function cdp(contents, method, params = {}, session) {
    if (!contents.debugger.isAttached()) {
      try { contents.debugger.attach("1.3"); } catch (error) { throw fail(409, "The page can't be controlled right now: " + error.message); }
    }
    return session ? contents.debugger.sendCommand(method, params, session) : contents.debugger.sendCommand(method, params);
  }
  // Frames from other sites are attached as they appear (Target.setAutoAttach,
  // flattened), and so are the frames inside them.
  const frameState = new WeakMap(); // webContents -> { sessions: Map(session -> { frameId, url, parent }), watched: Set }
  async function frameSessions(contents) {
    let state = frameState.get(contents);
    if (!state) {
      state = { sessions: new Map(), watched: new Set() };
      frameState.set(contents, state);
      contents.debugger.on("message", (_event, method, params, parent) => {
        if (method === "Target.attachedToTarget" && params?.targetInfo?.type === "iframe") state.sessions.set(params.sessionId, { frameId: params.targetInfo.targetId, url: params.targetInfo.url, parent: parent || undefined });
        else if (method === "Target.detachedFromTarget") state.sessions.delete(params?.sessionId);
      });
      contents.debugger.on("detach", () => { state.sessions.clear(); state.watched.clear(); });
    }
    for (let pending; (pending = [undefined, ...state.sessions.keys()].filter(session => !state.watched.has(session || ""))).length;) {
      for (const session of pending) {
        state.watched.add(session || "");
        await cdp(contents, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: "iframe" }] }, session).catch(() => {});
      }
    }
    return state.sessions;
  }
  // Every frame but the page itself, with its current address and the
  // session its iframe element is in (ownerSession). A blank or srcdoc frame
  // belongs to the page that made it, so it gets that page's address.
  async function frameList(contents) {
    const sessions = await frameSessions(contents);
    const remote = new Set([...sessions.values()].map(info => info.frameId));
    const below = (item, url) => (item.childFrames || []).flatMap(child => {
      const own = /^about:(blank|srcdoc)/i.test(child.frame.url || "about:blank") ? url : child.frame.url;
      return [{ id: child.frame.id, url: own }, ...below(child, own)];
    });
    const list = [];
    for (const session of [undefined, ...sessions.keys()]) {
      const info = sessions.get(session);
      let tree = null;
      try { ({ frameTree: tree } = await cdp(contents, "Page.getFrameTree", {}, session)); } catch {}
      const url = info ? tree?.frame?.url || info.url : contents.getURL();
      if (info) list.push({ session, frameId: info.frameId, root: true, url, ownerSession: info.parent });
      for (const frame of tree ? below(tree, url) : []) if (!remote.has(frame.id)) list.push({ session, frameId: frame.id, url: frame.url, ownerSession: session });
    }
    return list;
  }
  // The page's outline, with each frame's outline where the frame is.
  async function snapshot(conversationId, contents) {
    await cdp(contents, "Accessibility.enable");
    const trees = [{ session: undefined, nodes: (await cdp(contents, "Accessibility.getFullAXTree")).nodes, url: contents.getURL() }];
    for (const frame of await frameList(contents)) {
      try {
        if (frame.root) await cdp(contents, "Accessibility.enable", {}, frame.session);
        const { nodes } = await cdp(contents, "Accessibility.getFullAXTree", frame.root ? {} : { frameId: frame.frameId }, frame.session);
        const { backendNodeId } = await cdp(contents, "DOM.getFrameOwner", { frameId: frame.frameId }, frame.ownerSession);
        trees.push({ session: frame.session, nodes, owner: elementKey({ session: frame.ownerSession, node: backendNodeId }), url: frame.url });
      } catch {}
    }
    const nested = new Map(trees.slice(1).map(tree => [tree.owner, tree]));
    const placed = new Set();
    const map = new Map();
    const lines = [];
    const fields = filledFields.get(contents);
    let counter = 0, size = 0;
    const visitTree = (tree, depth) => {
      const byId = new Map(tree.nodes.map(node => [node.nodeId, node]));
      const visit = (node, depth) => {
        if (!node || size > MAX_SNAPSHOT) return;
        const role = node.role?.value || "";
        // A field filled from the vault, or one the page copied a short vault
        // value into, shows as filled, and what's inside it (its value again,
        // as text) isn't read, however short the value is.
        const raw = node.value?.value !== undefined ? String(node.value.value) : "";
        const filled = !!fields?.has(elementKey({ session: tree.session, node: node.backendDOMNodeId })) || (!!raw && showsShortSecret(conversationId, raw));
        const label = String(node.name?.value || "");
        // Vault values are hidden before text is shortened, so no part of one shows.
        const name = redact(conversationId, (filled && raw ? label.split(raw).join("[filled from vault]") : label).replace(/\s+/g, " ").trim()).slice(0, 160);
        const value = raw && filled ? "[filled from vault]" : redact(conversationId, raw).slice(0, 120);
        let shown = false;
        if (!node.ignored && (INTERACTIVE.has(role) || (STRUCTURE.has(role) && name))) {
          let line = `${"  ".repeat(Math.min(depth, 12))}- ${role === "StaticText" ? "text" : role}${name ? ` "${name}"` : ""}`;
          if (value && value !== name) line += ` value="${value}"`;
          const level = node.properties?.find(item => item.name === "level")?.value?.value;
          if (role === "heading" && level) line += ` (level ${level})`;
          if (node.properties?.some(item => item.name === "disabled" && item.value?.value)) line += " (disabled)";
          if (node.properties?.some(item => item.name === "checked" && item.value?.value === "true")) line += " (checked)";
          if (node.properties?.some(item => item.name === "focused" && item.value?.value === true)) line += " (focused)";
          const address = role === "link" && node.properties?.find(item => item.name === "url")?.value?.value;
          if (typeof address === "string" && /^https?:/i.test(address)) line += ` url="${address.slice(0, 200)}"`;
          if (INTERACTIVE.has(role) && node.backendDOMNodeId) { const id = "e" + (++counter); map.set(id, { node: node.backendDOMNodeId, session: tree.session, url: tree.url }); line += ` [ref=${id}]`; }
          lines.push(line); size += line.length + 1; shown = true;
        }
        if (filled) return;
        for (const child of node.childIds || []) visit(byId.get(child), depth + (shown ? 1 : 0));
        const frame = node.backendDOMNodeId && nested.get(elementKey({ session: tree.session, node: node.backendDOMNodeId }));
        if (frame && !placed.has(frame)) frameOutline(frame, depth + (shown ? 1 : 0));
      };
      visit(tree.nodes.find(node => !node.parentId) || tree.nodes[0], depth);
    };
    // A frame's outline under a line naming its site; a frame with nothing to show is left out.
    const frameOutline = (tree, depth) => {
      placed.add(tree);
      const at = lines.length;
      let site = "";
      try { site = /^https?:$/.test(new URL(tree.url).protocol) ? new URL(tree.url).host : ""; } catch {}
      const line = `${"  ".repeat(Math.min(depth, 12))}- frame${site ? ` "${site}"` : ""}`;
      lines.push(line); size += line.length + 1;
      visitTree(tree, depth + 1);
      if (lines.length === at + 1) { lines.pop(); size -= line.length + 1; }
    };
    visitTree(trees[0], 0);
    for (const tree of trees.slice(1)) if (!placed.has(tree)) frameOutline(tree, 0);
    refs.set(contents, map);
    return redact(conversationId, lines.join("\n") + (size > MAX_SNAPSHOT ? "\n… (page outline truncated; scroll or read for more)" : ""));
  }
  async function callOn(contents, element, functionDeclaration, options = {}) {
    const { object } = await cdp(contents, "DOM.resolveNode", { backendNodeId: element.node }, element.session);
    return cdp(contents, "Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration, ...options }, element.session);
  }
  // Whether a field filled from the vault still shows its value; fields that
  // are gone are forgotten.
  async function showsFilledValue(contents) {
    const fields = filledFields.get(contents);
    for (const [key, element] of fields || []) {
      let object;
      try { ({ object } = await cdp(contents, "DOM.resolveNode", { backendNodeId: element.node }, element.session)); } catch { fields.delete(key); continue; }
      const { result } = await cdp(contents, "Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: SHOWS_VALUE_IN_PAGE, returnByValue: true }, element.session);
      if (result?.value !== false) return true;
    }
    return false;
  }
  // Whether the page shows a filled value again elsewhere: echoed in its text
  // ("Card 4242 4242 …"), in a field it rendered anew, or copied into another
  // field, in the page or its frames. Values under 6 characters are looked
  // for in fields only. A page that can't be read counts as showing one.
  async function echoesFilledValue(conversationId, contents) {
    const values = [...(sensitive.get(conversationId) || [])];
    if (!values.length) return false;
    const shown = [];
    try { shown.push(await contents.executeJavaScriptInIsolatedWorld(1010, [{ code: SHOWN_IN_PAGE }])); } catch { return true; }
    for (const frame of await frameList(contents)) {
      try {
        const { executionContextId } = await cdp(contents, "Page.createIsolatedWorld", { frameId: frame.frameId, worldName: "timewarp-check" }, frame.session);
        shown.push((await cdp(contents, "Runtime.evaluate", { expression: SHOWN_IN_PAGE, contextId: executionContextId, returnByValue: true }, frame.session)).result?.value);
      } catch {}
    }
    const fields = shown.flatMap(item => Array.isArray(item?.values) ? item.values.map(String) : []);
    const texts = [...shown.map(item => String(item?.text || "")), ...fields];
    return values.some(value => value.length >= 6 ? texts.some(text => new RegExp(patternFor(value)).test(text)) : fields.some(text => text.includes(value)));
  }
  function nodeFor(contents, id) {
    const element = refs.get(contents)?.get(String(id || "").replace(/^@?\[?ref=?/, "").replace(/\]$/, ""));
    if (!element) throw fail(400, `Reference ${id} isn't on the latest snapshot. Take a new snapshot.`);
    return element;
  }
  // The element's center on the page. A frame from another site measures in
  // its own coordinates, so the places of its iframe elements are added.
  async function centerOf(contents, element) {
    await cdp(contents, "DOM.scrollIntoViewIfNeeded", { backendNodeId: element.node }, element.session).catch(() => {});
    const { model } = await cdp(contents, "DOM.getBoxModel", { backendNodeId: element.node }, element.session);
    const quad = model.border, point = { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 };
    const sessions = frameState.get(contents)?.sessions;
    for (let info = element.session && sessions?.get(element.session); info; info = info.parent && sessions.get(info.parent)) {
      const { backendNodeId } = await cdp(contents, "DOM.getFrameOwner", { frameId: info.frameId }, info.parent);
      const owner = (await cdp(contents, "DOM.getBoxModel", { backendNodeId }, info.parent)).model.content;
      point.x += owner[0]; point.y += owner[1];
    }
    return point;
  }
  // A key or combination: a real key press where Chromium delivers one (the
  // page is drawn; see browser.keyInput), checked to have reached the page,
  // else page events (KEY_IN_PAGE).
  const inWorld = (contents, code) => contents.executeJavaScriptInIsolatedWorld(1011, [{ code }], true);
  async function press(conversationId, tabId, contents, name) {
    const spec = parseKey(name);
    const wait = browser.keyInput ? browser.keyInput(conversationId, tabId) : 0;
    if (wait >= 0) {
      if (wait) await pause(wait);
      const before = await inWorld(contents, KEY_WATCH).catch(() => null);
      const base = { key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, modifiers: spec.modifiers };
      await cdp(contents, "Input.dispatchKeyEvent", { type: spec.text ? "keyDown" : "rawKeyDown", ...base, text: spec.text, unmodifiedText: spec.text, commands: spec.commands });
      await cdp(contents, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
      // A key for a frame from another site can't be counted here.
      if (!before || before.frame) return;
      const after = await inWorld(contents, KEY_WATCH).catch(() => null);
      if (!after || after.count > before.count) return;
    }
    await inWorld(contents, `${KEY_IN_PAGE}(${JSON.stringify(spec)})`);
  }
  // Whether Chromium draws the page, so it takes mouse input: a window other
  // apps cover entirely isn't drawn.
  const drawn = async contents => (await cdp(contents, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }).catch(() => null))?.result?.value !== "hidden";
  async function settle(contents, ms = 600) {
    const started = Date.now();
    await pause(150);
    while (contents.isLoading() && Date.now() - started < 8000) await pause(150);
    await pause(ms);
  }
  const text = value => ({ contentItems: [{ type: "inputText", text: String(value) }], success: true });
  // Chat links to a tab, opened in the pane when the user clicks them.
  const tabLink = (conversationId, tabId) => `timewarp://conversation/${conversationId}/browser/${tabId}`;
  // Read with room for the longest vault value past the limit, so a value at
  // the cut is hidden before the text is shortened.
  async function pageText(conversationId, contents) {
    const result = await contents.executeJavaScript(`(() => ({ title: document.title, url: location.href, text: (document.body?.innerText || "").slice(0, ${MAX_TEXT + MAX_SECRET}) }))()`, true);
    return redact(conversationId, `${result.title}\n${result.url}\n\n`) + redact(conversationId, result.text).slice(0, MAX_TEXT);
  }
  const showCursor = (contents, point, agent) => contents.executeJavaScriptInIsolatedWorld(1009, [{ code: cursorScript(point.x, point.y, agent?.name || "Agent") }]).catch(() => {});
  // Typed text goes to the focused field, in a frame from another site too.
  const focusAndClear = (contents, element) => callOn(contents, element, "function(){this.scrollIntoView({block:'center'});this.focus();if('value' in this){this.value='';this.dispatchEvent(new Event('input',{bubbles:true}));}else if(this.isContentEditable){this.textContent='';}}");

  // Each worker browses in its own tab, so workers running at once don't
  // navigate each other's pages or the chat agent's: a worker's first open
  // starts a tab in the background, and its calls without a tab act on it.
  const workerTabs = new Map(); // "<conversation id> <worker thread id>" -> tab id
  const workerKey = (conversationId, params) => params?.worker && params.threadId ? `${conversationId} ${params.threadId}` : null;
  function ownTab(conversationId, params) {
    const id = workerTabs.get(workerKey(conversationId, params));
    return id && browser.state(conversationId).tabs.some(item => item.id === id) ? id : null;
  }

  // scope: the tabs the call acts on, filled in as it finds them (for dialogs they open).
  async function act(conversationId, params, agent, scope = new Set()) {
    const name = params.tool, input = params.arguments || {};
    const own = workerKey(conversationId, params), mine = ownTab(conversationId, params);
    const target = () => { const found = browser.webContents(conversationId, input.tab || mine || undefined); scope.add(found.tab.id); return found; };
    const note = (tabId, action) => { browser.markAgent(conversationId, tabId, action ? { name: agent?.name, avatarUrl: agent?.avatarUrl, action } : null); onActivity(conversationId, action); };
    const failed = message => ({ contentItems: [{ type: "inputText", text: message }], success: false });
    // While the user has taken over, the agent can look but not act.
    if (browser.userInControl(conversationId) && !READ_ONLY.has(name)) {
      return { contentItems: [{ type: "inputText", text: "The user has taken control of the browser. Don't use browser actions until they hand it back; tell the user what you were about to do, or continue without the browser." }], success: false };
    }
    // A page showing a dialog waits for the answer; until then it can't be read or used.
    if (!PAST_DIALOGS.has(name) && !(name === "open" && (input.new_tab || (own && !mine))) && !(name === "read" && input.url)) {
      const tabId = input.tab || mine || browser.state(conversationId).active;
      const pending = (browser.dialogs?.(conversationId) || []).find(item => item.tabId === tabId);
      if (pending) return failed(dialogText(pending));
    }
    switch (name) {
      case "open": {
        const state = input.new_tab || (own && !mine) ? browser.openTab(conversationId, { url: input.url, activate: !own, worker: !!own }) : browser.navigate(conversationId, { tabId: mine || undefined, url: input.url });
        scope.add(state.id);
        if (own) workerTabs.set(own, state.id);
        note(state.id, "Opening " + state.url);
        const { contents } = browser.webContents(conversationId, state.id);
        // A new tab's page can take a moment to start loading; wait until it
        // has an address and finished, so the agent reads the page it opened.
        for (const started = Date.now(); Date.now() - started < 10000 && (!contents.getURL() || contents.isLoading());) await pause(150);
        await settle(contents, 400);
        return text(`Opened ${contents.getURL()} in tab ${state.id}: ${contents.getTitle()}\nTab link: ${tabLink(conversationId, state.id)}`);
      }
      case "tabs": {
        const state = browser.state(conversationId), current = own ? mine : state.active;
        return text(state.tabs.length ? state.tabs.map(item => `${item.id === current ? "* " : "  "}${item.id} ${item.url || "(home)"} ${item.title}`).join("\n") : "No tabs are open. Use the open tool.");
      }
      case "snapshot": { const { tab: item, contents } = target(); note(item.id, "Reading the page"); return text(`${contents.getTitle()}\n${contents.getURL()}\n\n${await snapshot(conversationId, contents)}`); }
      case "click": {
        const { tab: item, contents, onScreen } = target(); const element = nodeFor(contents, input.ref);
        // checked: the box is clicked only when it isn't in that state yet.
        const checkedNow = async () => (await callOn(contents, element, CHECKED_IN_PAGE, { returnByValue: true }).catch(() => null))?.result?.value || null;
        const wanted = typeof input.checked === "boolean" ? input.checked : null, before = wanted === null ? null : await checkedNow();
        if (wanted !== null) {
          if (typeof before?.checked !== "boolean") return failed(`${input.ref} doesn't say whether it's checked. Click it without checked, then take a snapshot.`);
          if (before.checked === wanted) return text(`${input.ref} is already ${wanted ? "checked" : "unchecked"}.`);
          if (before.radio && !wanted) return failed("A radio button can't be unchecked; choose another option instead.");
        }
        const point = await centerOf(contents, element), count = input.double ? 2 : 1;
        note(item.id, input.double ? "Double-clicking" : "Clicking");
        await showCursor(contents, point, agent);
        await pause(250);
        // Chromium only takes mouse input on pages it draws on screen. A page
        // behind a closed pane or another tab gets the click through the DOM.
        if (onScreen && await drawn(contents)) {
          await within(cdp(contents, "Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "left", clickCount: 0 }), 3000, "").catch(() => {});
          for (let click = 1; click <= count; click++) for (const type of ["mousePressed", "mouseReleased"]) await cdp(contents, "Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: click });
        } else await callOn(contents, element, CLICK_IN_PAGE, { arguments: [{ value: count }] });
        await settle(contents);
        if (wanted !== null) {
          const after = await checkedNow();
          return after?.checked === wanted ? text(`${wanted ? "Checked" : "Unchecked"} ${input.ref}.`) : failed(`Clicked ${input.ref}, but it is still ${wanted ? "unchecked" : "checked"}. Take a snapshot to see why.`);
        }
        return text(`${input.double ? "Double-clicked" : "Clicked"} ${input.ref}. Now on ${contents.getURL()}: ${contents.getTitle()}. Take a snapshot to see the result.`);
      }
      case "type": {
        // Without a reference, the text goes where the focus is, after what's there.
        const { tab: item, contents } = target(); const element = input.ref ? nodeFor(contents, input.ref) : null;
        note(item.id, "Typing");
        if (element) {
          await showCursor(contents, await centerOf(contents, element), agent);
          await focusAndClear(contents, element);
        }
        await cdp(contents, "Input.insertText", { text: String(input.text ?? "") });
        if (input.submit) await press(conversationId, item.id, contents, "Enter");
        await settle(contents, input.submit ? 800 : 200);
        return text(`Typed into ${input.ref || "the focused element"}${input.submit ? " and pressed Enter" : ""}.`);
      }
      case "press": { const { tab: item, contents } = target(); note(item.id, "Pressing " + input.key); await press(conversationId, item.id, contents, input.key); await settle(contents, 300); return text(`Pressed ${input.key}.`); }
      case "select": {
        const { tab: item, contents } = target(); const element = nodeFor(contents, input.ref);
        note(item.id, "Choosing an option");
        await showCursor(contents, await centerOf(contents, element), agent);
        const { result } = await callOn(contents, element, SELECT_IN_PAGE, { arguments: [{ value: String(input.option ?? "") }], returnByValue: true });
        if (!result?.value?.ok) throw fail(400, result?.value?.error || "That option isn't in the list.");
        await settle(contents, 300);
        return text(`Chose "${result.value.label}" in ${input.ref}.`);
      }
      case "hover": {
        const { tab: item, contents, onScreen } = target(); const element = nodeFor(contents, input.ref); const point = await centerOf(contents, element);
        note(item.id, "Pointing");
        await showCursor(contents, point, agent);
        if (onScreen && await drawn(contents)) await within(cdp(contents, "Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y }), 3000, "").catch(() => callOn(contents, element, HOVER_IN_PAGE));
        else await callOn(contents, element, HOVER_IN_PAGE);
        await settle(contents, 400);
        return text(`Pointing at ${input.ref}. Take a snapshot to see what appeared.`);
      }
      case "upload": {
        const { tab: item, contents } = target(); const element = nodeFor(contents, input.ref);
        const files = workspaceFiles(agent, input.files);
        note(item.id, "Attaching files");
        await cdp(contents, "DOM.setFileInputFiles", { backendNodeId: element.node, files }, element.session);
        await settle(contents, 300);
        return text(`Attached ${files.map(file => path.basename(file)).join(", ")} to ${input.ref}.`);
      }
      case "scroll": {
        const { tab: item, contents } = target(); note(item.id, "Scrolling");
        const amount = Math.max(0.2, Math.min(10, Number(input.amount) || 1)) * (input.direction === "up" ? -1 : 1);
        await contents.executeJavaScript(`window.scrollBy({ top: ${amount} * window.innerHeight * 0.85, behavior: "instant" })`, true);
        await pause(250);
        return text(`Scrolled ${input.direction}.`);
      }
      case "read": {
        if (input.url) { onActivity(conversationId, "Reading " + input.url); return text(await browser.readAway(conversationId, input.url, contents => pageText(conversationId, contents))); }
        const { tab: item, contents } = target(); note(item.id, "Reading the page");
        return text(input.ref ? await readElement(conversationId, contents, nodeFor(contents, input.ref), input.ref, input.attribute) : await pageText(conversationId, contents));
      }
      case "screenshot": {
        const { tab: item, contents, inWindow } = target(); note(item.id, "Taking a screenshot");
        if (inWindow === false) return { contentItems: [{ type: "inputText", text: "Screenshots need Timewarp's window to be open. Take a snapshot or read the page instead." }], success: false };
        // A picture can't be redacted: while the page shows a value filled from
        // the vault (a card number, a secret), the page is only read.
        if (await showsFilledValue(contents) || await echoesFilledValue(conversationId, contents)) return { contentItems: [{ type: "inputText", text: "This page shows values filled from the vault, so it can't be captured until the form is sent or the fields are cleared. Take a snapshot to check the form: filled values show as [filled from vault]." }], success: false };
        let image = await within(contents.capturePage(), 15000, "The page couldn't be captured. Take a snapshot or read the page instead.");
        if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
        return { contentItems: [{ type: "inputImage", imageUrl: "data:image/jpeg;base64," + image.toJPEG(78).toString("base64") }], success: true };
      }
      case "back": { const { tab: item, contents } = target(); browser.back(conversationId, item.id); await settle(contents); return text(`Now on ${contents.getURL()}`); }
      case "forward": { const { tab: item, contents } = target(); browser.forward(conversationId, item.id); await settle(contents); return text(`Now on ${contents.getURL()}`); }
      case "wait": {
        const { contents } = target(), until = !!(input.text || input.url || input.load);
        const deadline = Date.now() + Math.min(20, Math.max(0, Number(input.seconds) || (until ? 15 : 2))) * 1000;
        if (!until) { await pause(deadline - Date.now()); return text("Waited."); }
        const met = async () => (!input.url || contents.getURL().includes(input.url)) && (!input.load || !contents.isLoading())
          && (!input.text || (await pageText(conversationId, contents).catch(() => "")).includes(input.text));
        const wanted = [input.text && `"${input.text}" on the page`, input.url && `an address with "${input.url}"`, input.load && "the page loaded"].filter(Boolean).join(" and ");
        for (;;) {
          if (await met()) return text(`Done waiting: ${wanted}. Now on ${contents.getURL()}`);
          if (Date.now() >= deadline) return failed(`Still no ${wanted} after waiting. Now on ${contents.getURL()}${contents.isLoading() ? " (still loading)" : ""}.`);
          await pause(400);
        }
      }
      case "close_tab": { const state = browser.close(conversationId, input.tab || mine || undefined); return text(`Closed the tab. ${state.tabs.length} tab(s) remain.`); }
      case "dialog": {
        // The given tab, the agent's own or the active one, else any page waiting for the agent.
        const open = browser.dialogs?.(conversationId) || [], tabId = input.tab || mine || browser.state(conversationId).active;
        const pending = open.find(item => item.tabId === tabId) || (input.tab ? null : open.find(item => item.forAgent));
        if (!pending) return failed("No dialog is open on this page.");
        if (!pending.forAgent) return failed(dialogText(pending));
        scope.add(pending.tabId);
        const accept = input.accept !== false;
        browser.answerDialog(conversationId, pending.tabId, { accept, text: input.text });
        note(pending.tabId, accept ? "Accepting a dialog" : "Dismissing a dialog");
        const { contents } = browser.webContents(conversationId, pending.tabId);
        await settle(contents, 400);
        return text(`${accept ? "Accepted" : "Dismissed"} the ${pending.type}${accept && pending.type === "prompt" ? ` with ${quote(input.text ?? pending.value)}` : ""}. Now on ${contents.getURL()}: ${contents.getTitle()}`);
      }
      default: throw fail(404, "Unknown browser tool: " + name);
    }
  }

  // One element's text and value, or one attribute. A value filled from the
  // vault, or a password, isn't shown.
  async function readElement(conversationId, contents, element, id, attribute) {
    const { result } = await callOn(contents, element, ELEMENT_IN_PAGE, { arguments: [{ value: attribute ? String(attribute) : "" }], returnByValue: true });
    const info = result?.value || {}, filled = !!filledFields.get(contents)?.has(elementKey(element));
    const guard = value => info.password ? "[password hidden]" : filled || showsShortSecret(conversationId, value) ? "[filled from vault]" : value;
    if (attribute) return info.attribute === null || info.attribute === undefined ? `${id} has no ${attribute}.` : `${attribute}: ${(attribute === "value" ? guard(info.attribute) : info.attribute).slice(0, MAX_TEXT)}`;
    const lines = [`Text: ${(filled ? "[filled from vault]" : String(info.text || "").trim()).slice(0, MAX_TEXT)}`];
    if (typeof info.value === "string") lines.push(`Value: ${guard(info.value).slice(0, MAX_TEXT)}`);
    return lines.join("\n");
  }

  // A call whose page opens a dialog doesn't finish until it's answered, so
  // the agent hears about the dialog instead; the call goes on once it is.
  async function interruptible(conversationId, scope, run) {
    let stop = () => {};
    const opened = new Promise(resolve => { stop = browser.onDialog?.((id, tabId) => { if (id === conversationId && (!scope.size || scope.has(tabId))) resolve(tabId); }) || stop; });
    const work = run();
    work.catch(() => {});
    try {
      const first = await Promise.race([work.then(value => ({ value })), opened.then(tabId => ({ tabId }))]);
      if (!("tabId" in first)) return first.value;
      const pending = (browser.dialogs?.(conversationId) || []).find(item => item.tabId === first.tabId);
      return pending ? text(dialogText(pending)) : await work;
    } finally { stop(); }
  }
  // Alerts the page showed, dialogs dismissed and pages left since the last result.
  function withNotes(conversationId, result) {
    const lines = browser.notes?.(conversationId) || [];
    return lines.length && Array.isArray(result?.contentItems) ? { ...result, contentItems: [...result.contentItems, { type: "inputText", text: lines.join("\n") }] } : result;
  }

  // Says where downloads the agent started went (browser.cjs saves them in its
  // workspace). A download that just started gets a few seconds to finish.
  async function withDownloads(conversationId, result) {
    const found = new Map();
    const take = () => { for (const item of browser.downloads?.(conversationId) || []) found.set(item.file, item.state); };
    take();
    for (const started = Date.now(); [...found.values()].includes("progressing") && Date.now() - started < 10000;) { await pause(250); take(); }
    if (!found.size || !Array.isArray(result?.contentItems)) return result;
    const lines = [...found].map(([file, state]) => state === "completed" ? `Downloaded ${file}`
      : state === "progressing" ? `Downloading ${file} (still in progress; a later browser result says when it's done)` : `The download of ${path.basename(file)} didn't finish (${state}).`);
    return { ...result, contentItems: [...result.contentItems, { type: "inputText", text: lines.join("\n") }] };
  }

  return {
    specs: toolSpecs,
    async call(conversationId, params, agent) {
      const scope = new Set();
      const result = await interruptible(conversationId, scope, () => act(conversationId, params, agent, scope));
      return redactResult(conversationId, withNotes(conversationId, await withDownloads(conversationId, result)));
    },
    finished(conversationId) {
      browser.endAgentDialogs?.(conversationId);
      for (const item of browser.state(conversationId).tabs) if (item.agent) browser.markAgent(conversationId, item.id, null);
    },
    // The tab a call acts on when it names none: a worker's own tab, or the active one.
    defaultTab: (conversationId, params) => ownTab(conversationId, params) || undefined,
    // For vault tools: the page a field is on, and typing a value the model
    // never sees. Later page output hides the value. A password goes only
    // into a password field, so it can't land in a search box or address.
    // field: "password", "secret", "username" (not hidden) or "detail" (a
    // card's expiry or name: hidden, but not looked for elsewhere on the page).
    pageUrl(conversationId, tabId) { return browser.webContents(conversationId, tabId).contents.getURL(); },
    // choose: pick the list option with this value (an expiry month or year) instead of typing.
    async fillSecret(conversationId, { ref: id, tab: tabId, value, agent, field = "secret", choose = false }) {
      if (browser.userInControl(conversationId)) throw fail(409, "The user has taken control of the browser.");
      const { tab: item, contents } = browser.webContents(conversationId, tabId);
      const element = nodeFor(contents, id);
      if (field === "password") {
        const { result } = await callOn(contents, element, PASSWORD_FIELD_IN_PAGE, { returnByValue: true });
        if (result?.value !== true) throw fail(400, `${id} isn't a password field. Pass the reference of the page's password field.`);
      }
      browser.markAgent(conversationId, item.id, { name: agent?.name, avatarUrl: agent?.avatarUrl, action: "Filling from the vault" });
      onActivity(conversationId, "Filling from the vault");
      // Remembered before typing, so the value is hidden even if typing fails.
      if (field !== "username") {
        if (!filledFields.has(contents)) filledFields.set(contents, new Map());
        filledFields.get(contents).set(elementKey(element), element);
      }
      if (field !== "username" && field !== "detail") {
        if (!sensitive.has(conversationId)) sensitive.set(conversationId, new Set());
        sensitive.get(conversationId).add(String(value));
      }
      // Short values (a security code) would hide ordinary page text too.
      if (String(value).length >= 6) {
        const sources = new Set([...(secrets.get(conversationId)?.sources || []), ...patternsFor(value)]);
        secrets.set(conversationId, Object.assign(new RegExp([...sources].join("|"), "g"), { sources }));
      }
      if (choose) {
        const { result } = await callOn(contents, element, SELECT_IN_PAGE, { arguments: [{ value: String(value) }], returnByValue: true });
        if (!result?.value?.ok) throw fail(400, "That option isn't in the list.");
      } else {
        await focusAndClear(contents, element);
        await cdp(contents, "Input.insertText", { text: String(value) });
      }
      await settle(contents, 150);
      return redact(conversationId, contents.getURL());
    },
    // The address of the page or frame a field from the latest snapshot is in,
    // as the browser reported it when the snapshot was taken.
    fieldUrl(conversationId, { ref: id, tab: tabId }) {
      const { contents } = browser.webContents(conversationId, tabId);
      return nodeFor(contents, id).url || contents.getURL();
    },
    // What a field from the latest snapshot is and holds now (see FIELD_IN_PAGE).
    async inspectField(conversationId, { ref: id, tab: tabId }) {
      const { contents } = browser.webContents(conversationId, tabId);
      const { result } = await callOn(contents, nodeFor(contents, id), FIELD_IN_PAGE, { returnByValue: true });
      return result?.value || null;
    },
    // A value filled into a chat's page without these tools (a sign-in the
    // user filled from the toolbar) is hidden from them too.
    rememberFilled(conversationId, value, field = "secret") {
      if (!value) return;
      if (field !== "username" && field !== "detail") {
        if (!sensitive.has(conversationId)) sensitive.set(conversationId, new Set());
        sensitive.get(conversationId).add(String(value));
      }
      if (String(value).length >= 6) {
        const sources = new Set([...(secrets.get(conversationId)?.sources || []), ...patternsFor(value)]);
        secrets.set(conversationId, Object.assign(new RegExp([...sources].join("|"), "g"), { sources }));
      }
    },
  };
}

module.exports = { createBrowserTools, toolSpecs, patternFor, workspaceFiles, parseKey };
