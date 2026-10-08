"use strict";
// Browser tools the agent calls through Codex dynamic tools. They act only on
// the conversation's tabs in Timewarp's built-in browser, using Electron's
// per-page debugger; no remote debugging port is opened.

const MAX_SNAPSHOT = 24000, MAX_TEXT = 20000;
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "tab", "slider", "spinbutton", "treeitem", "listbox", "textarea"]);
const STRUCTURE = new Set(["heading", "img", "image", "cell", "columnheader", "rowheader", "listitem", "dialog", "alert", "status", "navigation", "main", "form", "table", "row", "paragraph", "StaticText", "list"]);
const KEYS = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" }, Tab: { key: "Tab", code: "Tab", keyCode: 9 }, Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 }, Delete: { key: "Delete", code: "Delete", keyCode: 46 }, Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 }, ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 }, ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }, ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 }, PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 }, Home: { key: "Home", code: "Home", keyCode: 36 }, End: { key: "End", code: "End", keyCode: 35 },
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const ref = { type: "string", description: "Element reference from the latest snapshot, for example e12." };
const tab = { type: "string", description: "Optional tab id from the tabs tool. Defaults to the active tab." };
const TOOLS = [
  ["open", "Open a web address (or search words) in the built-in browser that the user can see. Use new_tab to keep the current page.", { url: { type: "string" }, new_tab: { type: "boolean" } }, ["url"]],
  ["tabs", "List this conversation's browser tabs with their ids, addresses and titles.", {}, []],
  ["snapshot", "Read the current page as an outline of headings, text and interactive elements with references (e1, e2, …) for click and type.", { tab }, []],
  ["click", "Click an element by its reference from the latest snapshot.", { ref, tab }, ["ref"]],
  ["type", "Type text into a field by its reference. Replaces the field's current text. Set submit to press Enter afterwards.", { ref, text: { type: "string" }, submit: { type: "boolean" }, tab }, ["ref", "text"]],
  ["press", "Press a key on the focused element: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home or End.", { key: { type: "string" }, tab }, ["key"]],
  ["scroll", "Scroll the page up or down.", { direction: { type: "string", enum: ["up", "down"] }, amount: { type: "number", description: "Screens to scroll, default 1." }, tab }, ["direction"]],
  ["read", "Read the visible text of the page, with its title and address.", { tab }, []],
  ["screenshot", "Take a screenshot of the page to check its visual state.", { tab }, []],
  ["back", "Go back to the previous page.", { tab }, []],
  ["forward", "Go forward.", { tab }, []],
  ["wait", "Wait for the page: until text appears, or for a number of seconds (at most 20).", { text: { type: "string" }, seconds: { type: "number" }, tab }, []],
  ["close_tab", "Close a browser tab.", { tab }, []],
];

function toolSpecs() {
  return [{
    type: "namespace", name: "timewarp_browser",
    description: "Timewarp's built-in browser, visible to the user beside the chat. Use it for web research, signed-in websites and forms. Take a snapshot before clicking or typing, and read back the result after each action.",
    tools: TOOLS.map(([name, description, properties, required]) => ({ type: "function", name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } })),
  }];
}

// Matches a filled vault value in page output, including card numbers the
// page reformats with spaces or dashes.
function patternFor(secret) {
  const value = String(secret);
  if (/^\d{12,19}$/.test(value)) return value.split("").join("[\\s-]?");
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createBrowserTools({ browser, onActivity = () => {} }) {
  const refs = new WeakMap(); // webContents -> Map(ref -> backendNodeId)
  const filled = new WeakMap(); // webContents -> RegExp of vault values typed into it
  const redact = (contents, value) => {
    const pattern = filled.get(contents);
    return pattern ? String(value).replace(pattern, "[filled from vault]") : String(value);
  };
  async function cdp(contents, method, params = {}) {
    if (!contents.debugger.isAttached()) {
      try { contents.debugger.attach("1.3"); } catch (error) { throw fail(409, "The page can't be controlled right now: " + error.message); }
    }
    return contents.debugger.sendCommand(method, params);
  }
  async function snapshot(contents) {
    await cdp(contents, "Accessibility.enable");
    const { nodes } = await cdp(contents, "Accessibility.getFullAXTree");
    const byId = new Map(nodes.map(node => [node.nodeId, node]));
    const map = new Map();
    const lines = [];
    let counter = 0, size = 0;
    const visit = (node, depth) => {
      if (!node || size > MAX_SNAPSHOT) return;
      const role = node.role?.value || "";
      const name = String(node.name?.value || "").replace(/\s+/g, " ").trim().slice(0, 160);
      const value = node.value?.value !== undefined ? String(node.value.value).slice(0, 120) : "";
      let shown = false;
      if (!node.ignored && (INTERACTIVE.has(role) || (STRUCTURE.has(role) && name))) {
        let line = `${"  ".repeat(Math.min(depth, 12))}- ${role === "StaticText" ? "text" : role}${name ? ` "${name}"` : ""}`;
        if (value && value !== name) line += ` value="${value}"`;
        const level = node.properties?.find(item => item.name === "level")?.value?.value;
        if (role === "heading" && level) line += ` (level ${level})`;
        if (node.properties?.some(item => item.name === "disabled" && item.value?.value)) line += " (disabled)";
        if (node.properties?.some(item => item.name === "checked" && item.value?.value === "true")) line += " (checked)";
        if (INTERACTIVE.has(role) && node.backendDOMNodeId) { const id = "e" + (++counter); map.set(id, node.backendDOMNodeId); line += ` [ref=${id}]`; }
        lines.push(line); size += line.length + 1; shown = true;
      }
      for (const child of node.childIds || []) visit(byId.get(child), depth + (shown ? 1 : 0));
    };
    visit(nodes.find(node => !node.parentId) || nodes[0], 0);
    refs.set(contents, map);
    return redact(contents, lines.join("\n") + (size > MAX_SNAPSHOT ? "\n… (page outline truncated; scroll or read for more)" : ""));
  }
  function nodeFor(contents, id) {
    const node = refs.get(contents)?.get(String(id || "").replace(/^@?\[?ref=?/, "").replace(/\]$/, ""));
    if (!node) throw fail(400, `Reference ${id} isn't on the latest snapshot. Take a new snapshot.`);
    return node;
  }
  async function centerOf(contents, backendNodeId) {
    await cdp(contents, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
    const { model } = await cdp(contents, "DOM.getBoxModel", { backendNodeId });
    const quad = model.border;
    return { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 };
  }
  async function key(contents, name) {
    const spec = KEYS[name] || (String(name).length === 1 ? { key: name, text: name } : null);
    if (!spec) throw fail(400, "Unsupported key: " + name);
    await cdp(contents, "Input.dispatchKeyEvent", { type: spec.text ? "keyDown" : "rawKeyDown", windowsVirtualKeyCode: spec.keyCode, key: spec.key, code: spec.code, text: spec.text });
    await cdp(contents, "Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: spec.keyCode, key: spec.key, code: spec.code });
  }
  async function settle(contents, ms = 600) {
    const started = Date.now();
    await pause(150);
    while (contents.isLoading() && Date.now() - started < 8000) await pause(150);
    await pause(ms);
  }
  const text = value => ({ contentItems: [{ type: "inputText", text: String(value) }], success: true });
  async function pageText(contents) {
    const result = await contents.executeJavaScript(`(() => ({ title: document.title, url: location.href, text: (document.body?.innerText || "").slice(0, ${MAX_TEXT}) }))()`, true);
    return redact(contents, `${result.title}\n${result.url}\n\n${result.text}`);
  }
  async function focusAndClear(contents, node) {
    const { object } = await cdp(contents, "DOM.resolveNode", { backendNodeId: node });
    await cdp(contents, "Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){this.scrollIntoView({block:'center'});this.focus();if('value' in this){this.value='';this.dispatchEvent(new Event('input',{bubbles:true}));}else if(this.isContentEditable){this.textContent='';}}" });
  }

  return {
    specs: toolSpecs,
    async call(conversationId, params, agent) {
      const name = params.tool, input = params.arguments || {};
      const target = () => browser.webContents(conversationId, input.tab);
      const note = (tabId, action) => { browser.markAgent(conversationId, tabId, action ? { name: agent?.name, avatarUrl: agent?.avatarUrl, action } : null); onActivity(conversationId, action); };
      switch (name) {
        case "open": {
          const state = input.new_tab ? browser.openTab(conversationId, { url: input.url }) : browser.navigate(conversationId, { url: input.url });
          note(state.id, "Opening " + state.url);
          const { contents } = browser.webContents(conversationId, state.id);
          await settle(contents, 400);
          return text(`Opened ${contents.getURL()} in tab ${state.id}: ${contents.getTitle()}`);
        }
        case "tabs": {
          const state = browser.state(conversationId);
          return text(state.tabs.length ? state.tabs.map(item => `${item.id === state.active ? "* " : "  "}${item.id} ${item.url || "(home)"} ${item.title}`).join("\n") : "No tabs are open. Use the open tool.");
        }
        case "snapshot": { const { tab: item, contents } = target(); note(item.id, "Reading the page"); return text(`${contents.getTitle()}\n${contents.getURL()}\n\n${await snapshot(contents)}`); }
        case "click": {
          const { tab: item, contents } = target(); const node = nodeFor(contents, input.ref); const point = await centerOf(contents, node);
          note(item.id, "Clicking");
          for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp(contents, "Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
          await settle(contents);
          return text(`Clicked ${input.ref}. Now on ${contents.getURL()}: ${contents.getTitle()}. Take a snapshot to see the result.`);
        }
        case "type": {
          const { tab: item, contents } = target(); const node = nodeFor(contents, input.ref);
          note(item.id, "Typing");
          await focusAndClear(contents, node);
          await cdp(contents, "Input.insertText", { text: String(input.text ?? "") });
          if (input.submit) await key(contents, "Enter");
          await settle(contents, input.submit ? 800 : 200);
          return text(`Typed into ${input.ref}${input.submit ? " and pressed Enter" : ""}.`);
        }
        case "press": { const { tab: item, contents } = target(); note(item.id, "Pressing " + input.key); await key(contents, input.key); await settle(contents, 300); return text(`Pressed ${input.key}.`); }
        case "scroll": {
          const { tab: item, contents } = target(); note(item.id, "Scrolling");
          const amount = Math.max(0.2, Math.min(10, Number(input.amount) || 1)) * (input.direction === "up" ? -1 : 1);
          await contents.executeJavaScript(`window.scrollBy({ top: ${amount} * window.innerHeight * 0.85, behavior: "instant" })`, true);
          await pause(250);
          return text(`Scrolled ${input.direction}.`);
        }
        case "read": { const { tab: item, contents } = target(); note(item.id, "Reading the page"); return text(await pageText(contents)); }
        case "screenshot": {
          const { tab: item, contents } = target(); note(item.id, "Taking a screenshot");
          let image = await contents.capturePage();
          if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
          return { contentItems: [{ type: "inputImage", imageUrl: "data:image/jpeg;base64," + image.toJPEG(78).toString("base64") }], success: true };
        }
        case "back": { const { tab: item, contents } = target(); browser.back(conversationId, item.id); await settle(contents); return text(`Now on ${contents.getURL()}`); }
        case "forward": { const { tab: item, contents } = target(); browser.forward(conversationId, item.id); await settle(contents); return text(`Now on ${contents.getURL()}`); }
        case "wait": {
          const { contents } = target(), deadline = Date.now() + Math.min(20, Math.max(0, Number(input.seconds) || (input.text ? 15 : 2))) * 1000;
          if (!input.text) { await pause(deadline - Date.now()); return text("Waited."); }
          while (Date.now() < deadline) { if ((await pageText(contents)).includes(input.text)) return text(`"${input.text}" is on the page.`); await pause(500); }
          return { contentItems: [{ type: "inputText", text: `"${input.text}" did not appear.` }], success: false };
        }
        case "close_tab": { const state = browser.close(conversationId, input.tab); return text(`Closed the tab. ${state.tabs.length} tab(s) remain.`); }
        default: throw fail(404, "Unknown browser tool: " + name);
      }
    },
    finished(conversationId) { for (const item of browser.state(conversationId).tabs) if (item.agent) browser.markAgent(conversationId, item.id, null); },
    // For vault tools: the page a field is on, and typing a value the model
    // never sees. Later page output hides the value.
    pageUrl(conversationId, tabId) { return browser.webContents(conversationId, tabId).contents.getURL(); },
    async fillSecret(conversationId, { ref: id, tab: tabId, value, agent }) {
      const { tab: item, contents } = browser.webContents(conversationId, tabId);
      const node = nodeFor(contents, id);
      browser.markAgent(conversationId, item.id, { name: agent?.name, avatarUrl: agent?.avatarUrl, action: "Filling from the vault" });
      onActivity(conversationId, "Filling from the vault");
      await focusAndClear(contents, node);
      await cdp(contents, "Input.insertText", { text: String(value) });
      // Short values (a security code) would hide ordinary page text too.
      if (String(value).length >= 6) {
        const previous = filled.get(contents)?.source;
        filled.set(contents, new RegExp((previous ? previous + "|" : "") + patternFor(value), "g"));
      }
      await settle(contents, 150);
      return contents.getURL();
    },
  };
}

module.exports = { createBrowserTools, toolSpecs, patternFor };
