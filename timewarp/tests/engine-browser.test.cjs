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
  assert.equal(safeUrl("best pizza near me"), "https://www.google.com/search?q=best%20pizza%20near%20me");
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
  assert.deepEqual(names, ["open", "tabs", "snapshot", "click", "type", "press", "scroll", "read", "screenshot", "back", "forward", "wait", "close_tab", "select", "hover", "upload", "dialog"]);
  for (const tool of namespace.tools) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
});

test("values filled from the vault are hidden from page output, even when reformatted", () => {
  const { patternFor } = require("../app/main/browser-tools.cjs");
  const hide = (text, value) => text.replace(new RegExp(patternFor(value), "g"), "[filled from vault]");
  assert.equal(hide("Card: 4242 4242 4242 4242 ok", "4242424242424242"), "Card: [filled from vault] ok");
  assert.equal(hide("Card: 4242-4242-4242-4242", "4242424242424242"), "Card: [filled from vault]");
  assert.equal(hide('value="p@ss.(word)+"', "p@ss.(word)+"), 'value="[filled from vault]"');
});

// A page with form fields. The browser tools' in-page functions run against
// plain objects standing in for its elements.
function fakePage(fields) {
  const { createBrowserTools } = require("../app/main/browser-tools.cjs");
  const elements = new Map(fields.map(([id, name, type]) => [id, { tagName: "INPUT", type, name, value: "", checked: false, isConnected: true, scrollIntoView() {}, dispatchEvent() {}, focus() { page.focused = this; }, getAttribute(key) { return key === "data-kind" ? "field" : null; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), click() { if (type === "checkbox") this.checked = !this.checked; } }]));
  const page = { url: "https://shop.example/checkout", text: "Checkout", focused: null, elements, inWindow: true, downloads: [] };
  const run = (declaration, element, args = []) => new Function("return (" + declaration + ")")().apply(element, args.map(arg => arg.value));
  const contents = {
    debugger: { isAttached: () => true, attach() {}, on() {}, sendCommand: async (method, params) => {
      if (method === "Accessibility.enable" || method === "Target.setAutoAttach" || method === "DOM.scrollIntoViewIfNeeded") return {};
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", url: page.url } } };
      if (method === "DOM.getBoxModel") return { model: { border: [0, 0, 10, 0, 10, 10, 0, 10] } };
      // As in Chromium, a field's text is also a text node inside it.
      if (method === "Accessibility.getFullAXTree") return { nodes: [
        { nodeId: "root", role: { value: "RootWebArea" }, childIds: [...elements.keys()].map(id => "n" + id) },
        ...[...elements].flatMap(([id, element]) => [
          { nodeId: "n" + id, parentId: "root", role: { value: "textbox" }, name: { value: element.name }, value: { value: element.value }, backendDOMNodeId: id, childIds: ["g" + id] },
          { nodeId: "g" + id, parentId: "n" + id, role: { value: "generic" }, ignored: true, childIds: element.value ? ["t" + id] : [] },
          { nodeId: "t" + id, parentId: "g" + id, role: { value: "StaticText" }, name: { value: element.type === "password" ? "•".repeat(element.value.length) : element.value } },
        ]),
      ] };
      if (method === "DOM.resolveNode") { if (!elements.get(params.backendNodeId)?.isConnected) throw new Error("No node with that id."); return { object: { objectId: String(params.backendNodeId) } }; }
      if (method === "Runtime.callFunctionOn") return { result: { value: run(params.functionDeclaration, elements.get(Number(params.objectId)), params.arguments) } };
      if (method === "Input.insertText") { page.focused.value += params.text; return {}; }
      throw new Error("Unexpected " + method);
    } },
    getURL: () => page.url, getTitle: () => "Checkout", isLoading: () => false,
    executeJavaScript: async () => ({ title: "Checkout", url: page.url, text: page.text }),
    // The text and field values the screenshot check reads in an isolated world.
    executeJavaScriptInIsolatedWorld: async (_world, [{ code }]) => /innerText/.test(code) ? { text: page.text, values: [...elements.values()].filter(element => element.isConnected && element.type !== "password").map(element => element.value) } : undefined,
    capturePage: async () => ({ getSize: () => ({ width: 800 }), toJPEG: () => Buffer.from("picture") }),
  };
  const browser = {
    webContents: () => ({ tab: { id: "tab-1" }, contents, onScreen: false, inWindow: page.inWindow }), markAgent() {}, userInControl: () => false,
    state: () => ({ tabs: [{ id: "tab-1", url: page.url, title: "Checkout" }], active: "tab-1" }),
    downloads: () => page.downloads.splice(0),
  };
  const tools = createBrowserTools({ browser });
  const call = async (tool, args = {}) => (await tools.call("chat-1", { tool, arguments: args }, { name: "Orbit" })).contentItems.map(item => item.text || item.imageUrl).join("\n");
  return { page, tools, call };
}

test("vault values stay hidden whatever their length, in any output and in web addresses", async () => {
  const { page, tools, call } = fakePage([[1, "API key", "text"], [2, "Search", "search"]]);
  await call("snapshot");
  // Longer than the 120 characters a field's value is shortened to.
  const secret = "sk-proj-" + "Ab3".repeat(50) + " x/y";
  await tools.fillSecret("chat-1", { ref: "e1", value: secret, agent: { name: "Orbit" } });
  const hidden = text => !text.includes(secret.slice(0, 12)) && !text.includes(encodeURIComponent(secret).slice(0, 12));
  const outline = await call("snapshot");
  assert.ok(hidden(outline), outline);
  assert.match(outline, /textbox "API key" value="\[filled from vault\]"/);
  // The page shows it back, cut where the text is shortened, and sends it in an address.
  page.text = "x".repeat(20000 - 50) + secret;
  page.url = "https://shop.example/search?q=" + encodeURIComponent(secret).replace(/%20/g, "+");
  for (const tool of ["read", "snapshot", "tabs"]) assert.ok(hidden(await call(tool)), tool);
});

test("a page showing a filled card number isn't captured, and passwords go only into password fields", async () => {
  const { page, tools, call } = fakePage([[1, "Card number", "text"], [2, "Email", "email"], [3, "Password", "password"]]);
  await call("snapshot");
  assert.match(await call("screenshot"), /^data:image\/jpeg/);
  await tools.fillSecret("chat-1", { ref: "e1", value: "4242424242424242", agent: { name: "Orbit" } });
  assert.match(await call("screenshot"), /filled from the vault/);
  page.elements.get(1).value = "";
  assert.match(await call("screenshot"), /^data:image\/jpeg/, "Captured again once the field is cleared");
  await assert.rejects(tools.fillSecret("chat-1", { ref: "e2", value: "correct-horse", agent: { name: "Orbit" }, field: "password" }), /isn't a password field/);
  assert.equal(page.elements.get(2).value, "");
  await tools.fillSecret("chat-1", { ref: "e2", value: "ada@example.com", agent: { name: "Orbit" }, field: "username" });
  await tools.fillSecret("chat-1", { ref: "e3", value: "correct-horse", agent: { name: "Orbit" }, field: "password" });
  assert.equal(page.elements.get(3).value, "correct-horse");
  assert.match(await call("screenshot"), /^data:image\/jpeg/, "Password fields show dots");
  // A page that turns the password field into a text field shows the password.
  page.elements.get(3).type = "text";
  assert.match(await call("screenshot"), /filled from the vault/);
});

test("a short vault value (a PIN) doesn't show through the text in its field or a field the page copies it to", async () => {
  const { page, tools, call } = fakePage([[1, "PIN", "text"], [2, "Repeat PIN", "text"], [3, "Order number", "text"]]);
  assert.match(await call("snapshot"), /textbox "PIN"/);
  await tools.fillSecret("chat-1", { ref: "e1", value: "4821", agent: { name: "Orbit" } });
  page.elements.get(2).value = "4821";
  page.elements.get(3).value = "1007";
  const outline = await call("snapshot");
  assert.ok(!outline.includes("4821"), outline);
  assert.match(outline, /textbox "PIN" value="\[filled from vault\]"/);
  assert.match(outline, /textbox "Repeat PIN" value="\[filled from vault\]"/);
  assert.match(outline, /textbox "Order number" value="1007"/, "Other fields read as before");
  assert.match(outline, /- text "1007"/);
});

test("a page showing a filled value again isn't captured, and needs the window to be captured", async () => {
  const { page, tools, call } = fakePage([[1, "Card number", "text"], [2, "PIN", "text"], [3, "Notes", "text"]]);
  await call("snapshot");
  await tools.fillSecret("chat-1", { ref: "e1", value: "4242424242424242", agent: { name: "Orbit" } });
  await tools.fillSecret("chat-1", { ref: "e2", value: "4821", agent: { name: "Orbit" } });
  // The form was sent, or the page drew its fields anew.
  page.elements.get(1).isConnected = false;
  page.elements.get(2).isConnected = false;
  page.text = "Review your order: card 4242 4242 4242 4242";
  assert.match(await call("screenshot"), /filled from the vault/, "Echoed in the page's text");
  page.text = "Order 4821 is on its way";
  assert.match(await call("screenshot"), /^data:image\/jpeg/, "A short value is looked for in fields only");
  page.elements.get(3).value = "4821";
  assert.match(await call("screenshot"), /filled from the vault/, "Copied into another field");
  page.elements.get(3).value = "card 4242-4242-4242-4242";
  assert.match(await call("screenshot"), /filled from the vault/);
  page.elements.get(3).value = "";
  assert.match(await call("screenshot"), /^data:image\/jpeg/);
  // A page whose window has closed (macOS) is read, not captured.
  page.inWindow = false;
  assert.match(await call("screenshot"), /window to be open/);
});

test("values sent by a form are hidden however the form encodes them", async () => {
  const { page, tools, call } = fakePage([[1, "Recovery phrase", "text"]]);
  await call("snapshot");
  const secret = "it's (mine)! ~ok now";
  await tools.fillSecret("chat-1", { ref: "e1", value: secret, agent: { name: "Orbit" } });
  // Forms escape ' ( ) ! ~, which encodeURIComponent leaves, and send spaces as + or %20.
  for (const query of [new URLSearchParams({ q: secret }).toString(), "q=" + new URLSearchParams({ q: secret }).toString().slice(2).replace(/\+/g, "%20"), "q=" + encodeURIComponent(secret)]) {
    page.url = "https://shop.example/search?" + query;
    const listed = await call("tabs");
    assert.ok(!listed.includes(query.slice(2, 14)), listed);
    assert.match(listed, /\[filled from vault\]/);
  }
});

test("the agent is told where its downloads went", async () => {
  const { page, call } = fakePage([[1, "Search", "search"]]);
  // A path of this platform: the report names the file by its base name.
  const downloads = require("node:path").join(require("node:os").tmpdir(), "agent", "downloads");
  const file = require("node:path").join(downloads, "report.pdf");
  page.downloads.push({ file, state: "progressing" });
  setTimeout(() => page.downloads.push({ file, state: "completed" }), 300);
  assert.ok((await call("snapshot")).endsWith("Downloaded " + file));
  page.downloads.push({ file: require("node:path").join(downloads, "big.zip"), state: "interrupted" });
  assert.match(await call("read"), /download of big\.zip didn't finish \(interrupted\)/);
  assert.doesNotMatch(await call("read"), /download/i, "Each download is reported once");
});

// A checkout page with a card form from another site (its own process, reached
// through its own debugger session "S1") and a help frame from the same site.
// The page's email field and the frame's card field have the same node id, as
// node ids are only unique within one process.
function framedPage() {
  const { createBrowserTools } = require("../app/main/browser-tools.cjs");
  const field = (name, extra = {}) => ({ tagName: "INPUT", type: "text", name, value: "", isConnected: true, scrollIntoView() {}, dispatchEvent() {}, focus() { page.focused = this; }, ...extra });
  const page = { focused: null, onScreen: false, clicks: [], echo: [], email: field("Email"), card: field("Card number") };
  const elements = { "main:7": page.email, "S1:7": page.card };
  const listeners = [];
  const textbox = (element, id) => [
    { nodeId: "f" + id, role: { value: "textbox" }, name: { value: element.name }, value: { value: element.value }, backendDOMNodeId: 7, childIds: ["s" + id] },
    { nodeId: "s" + id, parentId: "f" + id, role: { value: "StaticText" }, name: { value: element.value } },
  ];
  const run = (declaration, element, args = []) => new Function("return (" + declaration + ")")().apply(element, args.map(arg => arg.value));
  const contents = {
    debugger: { isAttached: () => true, attach() {}, on(event, handler) { if (event === "message") listeners.push(handler); }, sendCommand: async (method, params = {}, session) => {
      if (method === "Target.setAutoAttach") {
        // Chromium reports the frames already there before it answers.
        if (!session) for (const handler of listeners) handler({}, "Target.attachedToTarget", { sessionId: "S1", targetInfo: { type: "iframe", targetId: "F1", url: "https://js.stripe.example/v3/elements" } });
        return {};
      }
      if (method === "Accessibility.enable" || method === "DOM.scrollIntoViewIfNeeded") return {};
      if (method === "Accessibility.getFullAXTree") {
        if (session === "S1") return { nodes: [{ nodeId: "r", role: { value: "RootWebArea" }, name: { value: "Secure card form" }, childIds: ["f1"] }, ...textbox(page.card, 1)] };
        if (params.frameId === "F2") return { nodes: [{ nodeId: "r", role: { value: "RootWebArea" }, childIds: ["b"] }, { nodeId: "b", role: { value: "button" }, name: { value: "Chat with us" }, backendDOMNodeId: 9 }] };
        return { nodes: [
          { nodeId: "r", role: { value: "RootWebArea" }, name: { value: "Checkout" }, childIds: ["h", "f0", "i1", "i2"] },
          { nodeId: "h", role: { value: "heading" }, name: { value: "Checkout" } },
          ...textbox(page.email, 0),
          { nodeId: "i1", role: { value: "Iframe" }, backendDOMNodeId: 50 },
          { nodeId: "i2", role: { value: "Iframe" }, backendDOMNodeId: 51 },
        ] };
      }
      if (method === "Page.getFrameTree") return session === "S1" ? { frameTree: { frame: { id: "F1" } } } : { frameTree: { frame: { id: "main" }, childFrames: [{ frame: { id: "F2", url: "https://shop.example/help" } }] } };
      if (method === "DOM.getFrameOwner") return { backendNodeId: params.frameId === "F1" ? 50 : 51 };
      if (method === "DOM.getBoxModel") {
        // The card field measures inside its frame; the frame sits at (200, 400) on the page.
        if (session === "S1") return { model: { border: [10, 10, 110, 10, 110, 30, 10, 30] } };
        if (params.backendNodeId === 50) return { model: { content: [200, 400, 600, 400, 600, 500, 200, 500] } };
        return { model: { border: [0, 0, 100, 0, 100, 20, 0, 20] } };
      }
      if (method === "DOM.resolveNode") {
        const element = elements[(session || "main") + ":" + params.backendNodeId];
        if (!element?.isConnected) throw new Error("No node with that id.");
        return { object: { objectId: (session || "main") + ":" + params.backendNodeId } };
      }
      if (method === "Runtime.callFunctionOn") return { result: { value: run(params.functionDeclaration, elements[params.objectId], params.arguments) } };
      if (method === "Input.insertText") { page.focused.value += params.text; return {}; }
      if (method === "Input.dispatchMouseEvent") { page.clicks.push([params.type, params.x, params.y]); return {}; }
      if (method === "Page.createIsolatedWorld") return { executionContextId: session === "S1" ? 11 : 12 };
      if (method === "Runtime.evaluate") return { result: { value: { text: "", values: params.contextId === 11 ? page.echo : [] } } };
      throw new Error("Unexpected " + method);
    } },
    getURL: () => "https://shop.example/checkout", getTitle: () => "Checkout", isLoading: () => false,
    executeJavaScript: async () => ({ title: "Checkout", url: "https://shop.example/checkout", text: "Checkout" }),
    executeJavaScriptInIsolatedWorld: async (_world, [{ code }]) => /innerText/.test(code) ? { text: "Checkout", values: [page.email.value] } : undefined,
    capturePage: async () => ({ getSize: () => ({ width: 800 }), toJPEG: () => Buffer.from("picture") }),
  };
  const browser = {
    webContents: () => ({ tab: { id: "tab-1" }, contents, onScreen: page.onScreen, inWindow: true }), markAgent() {}, userInControl: () => false,
    state: () => ({ tabs: [{ id: "tab-1", url: "https://shop.example/checkout", title: "Checkout" }], active: "tab-1" }),
  };
  const tools = createBrowserTools({ browser });
  const call = async (tool, args = {}) => (await tools.call("chat-1", { tool, arguments: args }, { name: "Orbit" })).contentItems.map(item => item.text || item.imageUrl).join("\n");
  return { page, tools, call };
}

test("the agent sees and fills fields in frames, including a card form from another site", async () => {
  const { page, tools, call } = framedPage();
  const outline = await call("snapshot");
  const refOf = name => outline.match(new RegExp(`"${name}"[^\\n]*\\[ref=(e\\d+)\\]`))[1];
  // Each frame's outline is where the frame is on the page, under its site.
  assert.match(outline, /\n- textbox "Email" \[ref=e1\]\n- frame "js\.stripe\.example"\n {2}- textbox "Card number" \[ref=e2\]\n- frame "shop\.example"\n {2}- button "Chat with us" \[ref=e3\]$/, outline);
  assert.equal(tools.fieldUrl("chat-1", { ref: refOf("Card number") }), "https://js.stripe.example/v3/elements", "Vault tools see which site's frame a field is in");
  assert.equal(tools.fieldUrl("chat-1", { ref: refOf("Email") }), "https://shop.example/checkout");
  await call("type", { ref: refOf("Email"), text: "ada@example.com" });
  await tools.fillSecret("chat-1", { ref: refOf("Card number"), value: "4242424242424242", agent: { name: "Orbit" } });
  assert.deepEqual([page.card.value, page.email.value], ["4242424242424242", "ada@example.com"], "Typed into the frame's field, not the page's field with the same node id");
  const after = await call("snapshot");
  assert.match(after, /textbox "Card number" value="\[filled from vault\]"/);
  assert.match(after, /textbox "Email" value="ada@example\.com"/);
  assert.ok(!after.includes("4242"), after);
  assert.match(await call("screenshot"), /filled from the vault/, "The frame's field shows the number");
  // The frame drew its field anew: the number shows in the frame, not in the remembered field.
  page.card.isConnected = false;
  page.echo = ["4242 4242 4242 4242"];
  assert.match(await call("screenshot"), /filled from the vault/);
  page.echo = [];
  assert.match(await call("screenshot"), /^data:image\/jpeg/);
  // A click on a page on screen lands where the frame's field is on the page.
  page.card.isConnected = true;
  page.onScreen = true;
  await call("click", { ref: refOf("Card number") });
  assert.deepEqual(page.clicks.at(-1), ["mouseReleased", 260, 420]);
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

test("keys and combinations are read as the agent writes them", () => {
  const { parseKey } = require("../app/main/browser-tools.cjs");
  const pick = name => { const spec = parseKey(name); return [spec.key, spec.code, spec.keyCode, spec.modifiers, spec.text]; };
  assert.deepEqual(pick("Control+A"), ["a", "KeyA", 65, 2, undefined], "A shortcut types nothing");
  assert.deepEqual(pick("Shift+Tab"), ["Tab", "Tab", 9, 8, undefined]);
  assert.deepEqual(pick("Meta+K"), ["k", "KeyK", 75, 4, undefined]);
  assert.deepEqual(pick("ctrl+shift+z"), ["Z", "KeyZ", 90, 10, undefined]);
  assert.deepEqual(pick("Shift+a"), ["A", "KeyA", 65, 8, "A"]);
  assert.deepEqual(pick("Enter"), ["Enter", "Enter", 13, 0, "\r"]);
  assert.deepEqual(pick("esc"), ["Escape", "Escape", 27, 0, undefined]);
  assert.deepEqual(pick("Control++").slice(0, 2), ["+", undefined]);
  assert.deepEqual(pick("F5"), ["F5", "F5", 116, 0, undefined]);
  assert.throws(() => parseKey("Hyper+Q"), /Unsupported key/);
});

test("key presses reach the page as key presses, or as page events when Chromium drops them", async () => {
  const { createBrowserTools } = require("../app/main/browser-tools.cjs");
  const sent = [], scripts = [];
  let delivered = true, count = 0, input = 0;
  const contents = {
    debugger: { isAttached: () => true, attach() {}, on() {}, sendCommand: async (method, params) => { sent.push([method, params]); if (method === "Input.dispatchKeyEvent" && params.type !== "keyUp" && delivered) count++; return {}; } },
    getURL: () => "https://example.com/", getTitle: () => "Example", isLoading: () => false,
    executeJavaScriptInIsolatedWorld: async (_world, [{ code }]) => { scripts.push(code); return /__timewarpKeys/.test(code) ? { count, frame: false } : true; },
  };
  const browser = { webContents: () => ({ tab: { id: "tab-1" }, contents, onScreen: false, inWindow: true }), keyInput: () => input, markAgent() {}, userInControl: () => false, state: () => ({ tabs: [], active: "tab-1" }) };
  const tools = createBrowserTools({ browser });
  const press = async key => (await tools.call("chat-1", { tool: "press", arguments: { key } }, { name: "Orbit" })).contentItems[0].text;
  const keys = () => sent.filter(([method]) => method === "Input.dispatchKeyEvent").map(([, params]) => [params.type, params.key, params.modifiers]);
  const pageEvents = () => scripts.filter(code => code.includes("(spec =>"));
  assert.equal(await press("Control+A"), "Pressed Control+A.");
  assert.deepEqual(keys(), [["rawKeyDown", "a", 2], ["keyUp", "a", 2]]);
  assert.equal(pageEvents().length, 0, "It reached the page");
  // Chromium dropped it (the page isn't drawn): the page gets the key as events.
  delivered = false;
  sent.length = 0;
  await press("Shift+Tab");
  assert.equal(keys().length, 2);
  assert.match(pageEvents().at(-1), /"key":"Tab".*"modifiers":8/);
  // No window, or it's minimized: page events only.
  input = -1;
  sent.length = 0;
  await press("Enter");
  assert.deepEqual([keys().length, pageEvents().length], [0, 2]);
  await assert.rejects(press("Hyper+Q"), /Unsupported key/);
});

test("a dialog the page opens interrupts the agent's action, and the dialog tool answers it", async () => {
  const { createBrowserTools } = require("../app/main/browser-tools.cjs");
  const listeners = new Set(), answers = [], notes = [];
  let pending = null, release = () => {};
  const contents = {
    getURL: () => "https://shop.example/", getTitle: () => "Shop", isLoading: () => false,
    // Reading the page opens a confirm; the page waits until it's answered.
    executeJavaScript: () => new Promise(resolve => {
      release = () => resolve({ title: "Shop", url: "https://shop.example/", text: "Order placed" });
      pending = { type: "confirm", message: "Place the order?", site: "shop.example", forAgent: true, value: "" };
      for (const listener of listeners) listener("chat-1", "tab-1");
    }),
  };
  const browser = {
    webContents: () => ({ tab: { id: "tab-1" }, contents, onScreen: false, inWindow: true }), markAgent() {}, userInControl: () => false,
    state: () => ({ tabs: [{ id: "tab-1", url: "https://shop.example/", title: "Shop" }], active: "tab-1" }),
    dialogs: () => pending ? [{ tabId: "tab-1", ...pending }] : [],
    onDialog(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    answerDialog(_conversationId, tabId, answer) { answers.push([tabId, answer]); pending = null; release(); },
    notes: () => notes.splice(0),
  };
  const tools = createBrowserTools({ browser });
  const call = async (tool, args = {}) => { const result = await tools.call("chat-1", { tool, arguments: args }, { name: "Orbit" }); return [result.success, result.contentItems.map(item => item.text).join("\n")]; };
  let [ok, said] = await call("read");
  assert.equal(ok, true);
  assert.match(said, /^The page \(shop\.example\) is showing a confirm: "Place the order\?"\. It waits for an answer: use the dialog tool/);
  [ok, said] = await call("snapshot");
  assert.equal(ok, false, "The page can't be read while it waits");
  assert.match(said, /showing a confirm/);
  [ok, said] = await call("dialog", { accept: true });
  assert.deepEqual(answers, [["tab-1", { accept: true, text: undefined }]]);
  assert.equal(said, "Accepted the confirm. Now on https://shop.example/: Shop");
  [ok, said] = await call("dialog", { accept: false });
  assert.deepEqual([ok, said], [false, "No dialog is open on this page."]);
  // A dialog the user is answering isn't the agent's to answer.
  pending = { type: "alert", message: "Session ends soon", site: "shop.example", forAgent: false, value: "" };
  [ok, said] = await call("dialog", { accept: true });
  assert.equal(ok, false);
  assert.match(said, /asking the user something/);
  pending = null;
  // What happened meanwhile comes with the next result.
  notes.push('The page showed an alert: "Saved"');
  [ok, said] = await call("tabs");
  assert.match(said, /\nThe page showed an alert: "Saved"$/);
});

test("the agent clicks to a checked state, reads one element, types where the focus is and waits for an address", async t => {
  // The page's click runs here, with the browser's event classes standing in.
  const globals = { window: globalThis, MouseEvent: class extends Event {}, PointerEvent: class extends Event {} };
  for (const [name, value] of Object.entries(globals)) if (!(name in globalThis)) { globalThis[name] = value; t.after(() => { delete globalThis[name]; }); }
  const { page, call } = fakePage([[1, "Subscribe", "checkbox"], [2, "Password", "password"], [3, "Notes", "text"]]);
  await call("snapshot");
  assert.equal(await call("click", { ref: "e1", checked: true }), "Checked e1.");
  assert.equal(page.elements.get(1).checked, true);
  assert.equal(await call("click", { ref: "e1", checked: true }), "e1 is already checked.");
  page.elements.get(2).value = "hunter22";
  assert.equal(await call("read", { ref: "e2" }), "Text: \nValue: [password hidden]");
  assert.equal(await call("read", { ref: "e2", attribute: "value" }), "value: [password hidden]");
  assert.equal(await call("read", { ref: "e3", attribute: "data-kind" }), "data-kind: field");
  assert.equal(await call("read", { ref: "e3", attribute: "title" }), "e3 has no title.");
  page.focused = page.elements.get(3);
  page.elements.get(3).value = "Hello";
  assert.equal(await call("type", { text: " there" }), "Typed into the focused element.");
  assert.equal(page.elements.get(3).value, "Hello there", "Added where the focus is, without clearing");
  setTimeout(() => { page.url = "https://shop.example/thanks"; }, 300);
  assert.match(await call("wait", { url: "/thanks", seconds: 5 }), /^Done waiting: an address with "\/thanks"\. Now on https:\/\/shop\.example\/thanks/);
});

test("snapshots show where links go and which element has focus", async () => {
  const { createBrowserTools } = require("../app/main/browser-tools.cjs");
  const nodes = [
    { nodeId: "r", role: { value: "RootWebArea" }, childIds: ["a", "b", "c"] },
    { nodeId: "a", parentId: "r", role: { value: "link" }, name: { value: "Pricing" }, backendDOMNodeId: 5, properties: [{ name: "url", value: { type: "string", value: "https://example.com/pricing" } }] },
    { nodeId: "b", parentId: "r", role: { value: "link" }, name: { value: "Run" }, backendDOMNodeId: 6, properties: [{ name: "url", value: { type: "string", value: "javascript:void(0)" } }] },
    { nodeId: "c", parentId: "r", role: { value: "textbox" }, name: { value: "Search" }, backendDOMNodeId: 7, properties: [{ name: "focused", value: { type: "booleanOrUndefined", value: true } }] },
  ];
  const contents = {
    debugger: { isAttached: () => true, attach() {}, on() {}, sendCommand: async method => method === "Accessibility.getFullAXTree" ? { nodes } : method === "Page.getFrameTree" ? { frameTree: { frame: { id: "main" } } } : {} },
    getURL: () => "https://example.com/", getTitle: () => "Example", isLoading: () => false,
  };
  const browser = { webContents: () => ({ tab: { id: "tab-1" }, contents, onScreen: false, inWindow: true }), markAgent() {}, userInControl: () => false, state: () => ({ tabs: [], active: "tab-1" }) };
  const outline = (await createBrowserTools({ browser }).call("chat-1", { tool: "snapshot", arguments: {} }, { name: "Orbit" })).contentItems[0].text;
  assert.match(outline, /\n- link "Pricing" url="https:\/\/example\.com\/pricing" \[ref=e1\]\n- link "Run" \[ref=e2\]\n- textbox "Search" \(focused\) \[ref=e3\]$/);
});
