"use strict";
// After an action, the browser tools wait for what it set off (a page
// loading, requests, the document changing) instead of fixed pauses, never
// longer than those pauses were.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createBrowserTools } = require("../app/main/browser-tools.cjs");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// A page whose document goes quiet `quietAfter` ms after it's watched (null:
// never; "fail": it can't be watched), and whose button runs `onClick`.
function fakePage({ quietAfter = 150, onScreen = false, cursor = { moved: 0, appeared: false } } = {}) {
  const page = new EventEmitter();
  Object.assign(page, { url: "https://shop.example/", loading: false, quietAfter, clicks: [], mouse: [], scripts: [], onClick: () => {}, textAfter: null, read: 0 });
  const network = new EventEmitter();
  // A request the page makes, finished after ms (never for Infinity).
  page.request = (id, ms, type = "Fetch") => {
    network.emit("message", {}, "Network.requestWillBeSent", { requestId: id, type }, "");
    if (ms !== Infinity) setTimeout(() => network.emit("message", {}, "Network.loadingFinished", { requestId: id }, ""), ms);
  };
  // A navigation the page starts: it loads for ms, then shows `url`.
  page.navigate = (url, ms) => {
    page.loading = true;
    page.emit("did-start-loading");
    page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false, url });
    setTimeout(() => { page.url = url; page.emit("did-navigate"); page.loading = false; page.emit("did-stop-loading"); }, ms);
  };
  const contents = Object.assign(page, {
    debugger: { isAttached: () => true, attach() {}, on: (event, handler) => network.on(event, handler), sendCommand: async (method, params = {}) => {
      if (method === "Network.enable" || method === "Accessibility.enable" || method === "DOM.scrollIntoViewIfNeeded") return {};
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "DOM.getBoxModel") return { model: { border: [0, 0, 10, 0, 10, 10, 0, 10] } };
      if (method === "DOM.resolveNode") return { object: { objectId: "button" } };
      if (method === "Accessibility.getFullAXTree") return { nodes: [{ nodeId: "r", role: { value: "RootWebArea" }, childIds: ["b"] }, { nodeId: "b", role: { value: "button" }, name: { value: "Buy" }, backendDOMNodeId: 5 }] };
      if (method === "Runtime.callFunctionOn") { page.clicks.push(Date.now()); page.onClick(); return { result: {} }; }
      if (method === "Input.dispatchMouseEvent") { page.mouse.push([params.type, Date.now()]); if (params.type === "mouseReleased") page.onClick(); return {}; }
      if (method === "Runtime.evaluate" && params.expression === "document.visibilityState") return { result: { value: "visible" } };
      if (method === "Runtime.evaluate") {
        page.scripts.push(params.expression);
        // The page looks for text itself (TEXT_IN_PAGE), or says when it's quiet (QUIET_IN_PAGE).
        if (params.expression.includes("__timewarpWait")) {
          const wanted = JSON.parse(/\.includes\(("(?:[^"\\]|\\.)*")\)/.exec(params.expression)[1]), within = Number(/finish\(false\), (\d+)\)/.exec(params.expression)[1]);
          const shows = () => page.textAfter !== null && Date.now() >= page.textAfter && wanted === "Order placed";
          for (const started = Date.now(); !shows() && Date.now() - started < within;) await pause(10);
          return { result: { value: shows() } };
        }
        if (page.quietAfter === "fail") throw new Error("Cannot find context with specified id");
        const limit = Number(/finish, (\d+), false\)/.exec(params.expression)[1]);
        await pause(page.quietAfter === null ? limit : Math.min(limit, page.quietAfter));
        return { result: { value: page.quietAfter !== null && page.quietAfter <= limit } };
      }
      throw new Error("Unexpected " + method);
    } },
    getURL: () => page.url, getTitle: () => "Shop", isLoading: () => page.loading,
    executeJavaScript: async () => { page.read++; return { title: "Shop", url: page.url, text: page.textAfter !== null && Date.now() >= page.textAfter ? "Order placed" : "Cart" }; },
    executeJavaScriptInIsolatedWorld: async () => cursor,
  });
  const browser = {
    webContents: () => ({ tab: { id: "tab-1" }, contents, onScreen, inWindow: true }), markAgent() {}, userInControl: () => false,
    state: () => ({ tabs: [{ id: "tab-1", url: page.url, title: "Shop" }], active: "tab-1" }),
    back: () => page.navigate("https://shop.example/cart", 100), forward() {},
  };
  const tools = createBrowserTools({ browser });
  const call = async (tool, args = {}) => {
    const started = Date.now();
    const result = await tools.call("chat-1", { tool, arguments: args }, { name: "Orbit" });
    return { ms: Date.now() - started, text: result.contentItems.map(item => item.text).join("\n"), success: result.success };
  };
  return { page, call, tools };
}

test("a click that changes nothing returns once the page is quiet, not after a second", async () => {
  const { call } = fakePage();
  await call("snapshot");
  const { ms, text } = await call("click", { ref: "e1" });
  assert.match(text, /^Clicked e1\. Now on https:\/\/shop\.example\//);
  assert.ok(ms >= 140 && ms < 500, `took ${ms} ms`);
});

test("a click that opens another page waits for it to load, even when the page navigates a moment later", async () => {
  const { page, call } = fakePage();
  await call("snapshot");
  page.onClick = () => setTimeout(() => page.navigate("https://shop.example/thanks", 400), 60);
  const { ms, text } = await call("click", { ref: "e1" });
  assert.match(text, /Now on https:\/\/shop\.example\/thanks/, "The click reports the page it led to");
  assert.ok(ms >= 460 && ms < 1100, `took ${ms} ms`);
});

test("a click waits for the requests it made, up to the old limit", async () => {
  const { page, call } = fakePage();
  await call("snapshot");
  page.onClick = () => page.request("r1", 400);
  let { ms } = await call("click", { ref: "e1" });
  assert.ok(ms >= 400 && ms < 800, `waited for the request: ${ms} ms`);
  // A request that never ends (a stream) holds the click no longer than 750 ms, as before.
  page.onClick = () => page.request("r2", Infinity);
  ({ ms } = await call("click", { ref: "e1" }));
  assert.ok(ms >= 700 && ms < 1000, `capped: ${ms} ms`);
  // Event streams, media and images aren't waited for.
  page.onClick = () => page.request("r3", Infinity, "EventSource");
  ({ ms } = await call("click", { ref: "e1" }));
  assert.ok(ms < 500, `ignored: ${ms} ms`);
});

test("a page that never goes quiet, or can't be watched, gets the old fixed wait and no more", async () => {
  for (const quietAfter of [null, "fail"]) {
    const { call } = fakePage({ quietAfter });
    await call("snapshot");
    const { ms } = await call("click", { ref: "e1" });
    assert.ok(ms >= 740 && ms < 1100, `${quietAfter}: ${ms} ms`);
  }
});

test("back waits for the page it goes to, and scrolling keeps its shorter limit", async () => {
  const { page, call } = fakePage({ quietAfter: null });
  let { ms, text } = await call("back");
  assert.equal(text, "Now on https://shop.example/cart");
  assert.ok(ms >= 100 && ms < 900, `back: ${ms} ms`);
  page.executeJavaScript = async () => true;
  ({ ms } = await call("scroll", { direction: "down" }));
  assert.ok(ms >= 240 && ms < 450, `scroll: ${ms} ms`);
});

test("off screen the cursor doesn't hold the click; on screen it glides to the element first", async () => {
  const away = fakePage({ cursor: { moved: 300, appeared: false } });
  await away.call("snapshot");
  let started = Date.now();
  await away.call("click", { ref: "e1" });
  assert.ok(away.page.clicks[0] - started < 60, `clicked after ${away.page.clicks[0] - started} ms`);
  const shown = fakePage({ onScreen: true, cursor: { moved: 300, appeared: false } });
  await shown.call("snapshot");
  started = Date.now();
  await shown.call("click", { ref: "e1" });
  const pressed = shown.page.mouse.find(([type]) => type === "mousePressed")[1] - started;
  assert.ok(pressed >= 230 && pressed < 400, `pressed after ${pressed} ms`);
  // A short move takes less time to watch.
  const near = fakePage({ onScreen: true, cursor: { moved: 20, appeared: false } });
  await near.call("snapshot");
  started = Date.now();
  await near.call("click", { ref: "e1" });
  const soon = near.page.mouse.find(([type]) => type === "mousePressed")[1] - started;
  assert.ok(soon >= 90 && soon < 200, `pressed after ${soon} ms`);
});

test("waiting for text is answered by the page as the text appears, without reading the whole page each time", async () => {
  const { page, call, tools } = fakePage();
  page.textAfter = Date.now() + 300;
  const { ms, text } = await call("wait", { text: "Order placed", seconds: 5 });
  assert.match(text, /^Done waiting: "Order placed" on the page/);
  assert.ok(ms >= 290 && ms < 700, `took ${ms} ms`);
  assert.equal(page.read, 0, "The page's text wasn't read into the app");
  const missing = await call("wait", { text: "Refund issued", seconds: 1 });
  assert.equal(missing.success, false);
  assert.ok(missing.ms >= 1000 && missing.ms < 1600, `gave up after ${missing.ms} ms`);
  // With vault values filled in this chat, the page is read as the agent reads it (hidden values and all).
  tools.rememberFilled("chat-1", "correct-horse-battery", "password");
  page.textAfter = Date.now() + 200;
  assert.match((await call("wait", { text: "Order placed", seconds: 5 })).text, /^Done waiting/);
  assert.ok(page.read > 0);
});
