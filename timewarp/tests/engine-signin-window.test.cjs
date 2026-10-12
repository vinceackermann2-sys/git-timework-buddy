"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { createSigninWindows, callbackOf } = require("../app/main/signin-window.cjs");

const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check, what) {
  for (let i = 0; i < 200; i++) { if (check()) return; await tick(); }
  assert.fail("Timed out waiting for " + what);
}

function fixture() {
  const windows = [], closed = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options; this.loaded = []; this.destroyed = false; this.title = options.title;
      const contents = new EventEmitter();
      contents.getURL = () => this.loaded.at(-1) || "";
      contents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      this.webContents = contents;
      windows.push(this);
    }
    loadURL(url) { this.loaded.push(url); return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    close() { if (this.destroyed) return; this.destroyed = true; this.emit("closed"); }
    setTitle(title) { this.title = title; }
    show() {}
  }
  const signin = createSigninWindows({ BrowserWindow: FakeWindow, session: () => ({ id: "default-profile" }), logo: "data:image/png;base64,AA==", css: ".timewarp-auth-page{}", closeDelay: 0 });
  // A navigation the page or the provider starts; prevented tells whether the window stopped it.
  const navigate = (window, name, url) => {
    const event = { url, isMainFrame: true, prevented: false, preventDefault() { this.prevented = true; } };
    window.webContents.emit(name, event, url, false, true);
    return event.prevented;
  };
  const pages = window => window.loaded.filter(url => url.startsWith("data:")).map(url => Buffer.from(url.split(",")[1], "base64").toString("utf8"));
  return { signin, windows, closed, navigate, pages };
}

// Codex's ChatGPT login server: the callback sends the browser on to /success,
// whose page opens the ChatGPT app (codex://threads/new).
async function codexServer(t, callback = (request, response, port) => { response.writeHead(302, { location: `http://127.0.0.1:${port}/success?id_token=secret` }); response.end(); }) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith("/auth/callback")) return callback(request, response, server.address().port);
    if (request.url.startsWith("/success")) { response.writeHead(200, { "content-type": "text/html" }); return response.end('<title>Signed in to Codex</title><script>location.href="codex://threads/new"</script>'); }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { port: server.address().port, requests };
}

const chatgpt = {
  done: answer => answer.status === 200 && answer.path === "/success",
  pending: { title: "Connecting ChatGPT", message: "Finishing your ChatGPT sign-in…" },
  success: { title: "ChatGPT is connected", message: "Your ChatGPT plan now powers AI in Timewarp.", hint: "This window closes by itself." },
  failure: { title: "ChatGPT couldn't connect", message: "The sign-in didn't finish." },
};

test("the ChatGPT callback goes to Codex from Timewarp, and the window shows Timewarp's page, not Codex's", async t => {
  const codex = await codexServer(t), f = fixture();
  let closedWith = null;
  const link = `https://auth.openai.com/oauth/authorize?client_id=codex&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${codex.port}/auth/callback`)}&state=abc`;
  f.signin.open(link, { title: "Connect ChatGPT", finish: chatgpt, onClose: value => { closedWith = value; } });
  const [window] = f.windows;
  assert.deepEqual(window.loaded, [link]);
  assert.equal(window.options.webPreferences.session.id, "default-profile");
  assert.equal(f.navigate(window, "will-navigate", "https://auth.openai.com/log-in"), false);

  // auth.openai.com redirects to Codex's callback on this computer.
  assert.equal(f.navigate(window, "will-redirect", `http://127.0.0.1:${codex.port}/auth/callback?code=c&state=abc`), true);
  await until(() => window.destroyed, "the window to close");
  assert.deepEqual(codex.requests, ["/auth/callback?code=c&state=abc", "/success?id_token=secret"]);
  // The window never loaded Codex's pages, so nothing could open the ChatGPT app.
  assert.ok(window.loaded.every(url => !url.startsWith("http://127.0.0.1")));
  const pages = f.pages(window);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Connecting ChatGPT/);
  assert.match(pages[1], /ChatGPT is connected/);
  for (const page of pages) { assert.match(page, /<span>Timewarp<\/span>/); assert.doesNotMatch(page, /codex:\/\/|Signed in to Codex|secret/); }
  assert.deepEqual(closedWith, { returned: true });
});

test("a ChatGPT sign-in Codex rejects shows Timewarp's failure page and the window stays", async t => {
  // Codex answers a failed callback with its error page, status 200.
  const codex = await codexServer(t, (_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<title>Sign-in failed</title>"); });
  const f = fixture();
  f.signin.open(`https://auth.openai.com/oauth/authorize?redirect_uri=${encodeURIComponent(`http://127.0.0.1:${codex.port}/auth/callback`)}`, { title: "Connect ChatGPT", finish: chatgpt });
  const [window] = f.windows;
  assert.equal(f.navigate(window, "will-navigate", `http://127.0.0.1:${codex.port}/auth/callback?error=access_denied`), true);
  await until(() => f.pages(window).length === 2, "the failure page");
  assert.match(f.pages(window)[1], /ChatGPT couldn(&#39;|')t connect/);
  await tick();
  assert.equal(window.destroyed, false);
  // A second return is stopped but not handed over again.
  assert.equal(f.navigate(window, "will-navigate", `http://127.0.0.1:${codex.port}/auth/callback?code=again`), true);
  await tick();
  assert.deepEqual(codex.requests, ["/auth/callback?error=access_denied"]);
});

test("the window opens no other apps and hands over only the sign-in's own callback", async t => {
  const codex = await codexServer(t), f = fixture();
  f.signin.open(`https://auth.openai.com/oauth/authorize?redirect_uri=${encodeURIComponent(`http://127.0.0.1:${codex.port}/auth/callback`)}`, { finish: chatgpt });
  const [window] = f.windows;
  for (const url of ["codex://threads/new", "chatgpt://open", "file:///C:/Windows/notepad.exe"]) {
    assert.equal(f.navigate(window, "will-navigate", url), true, url);
    assert.deepEqual(window.openHandler({ url }), { action: "deny" });
  }
  assert.equal(window.openHandler({ url: "https://accounts.google.com/signin" }).action, "allow");
  // Another server on this computer is no callback of this sign-in.
  assert.equal(f.navigate(window, "will-redirect", "http://127.0.0.1:1/auth/callback?code=c"), false);
  // A frame's redirect isn't the window's.
  const event = { url: `http://127.0.0.1:${codex.port}/auth/callback`, isMainFrame: false, prevented: false, preventDefault() { this.prevented = true; } };
  window.webContents.emit("will-redirect", event, event.url, false, false);
  assert.equal(event.prevented, false);
  assert.deepEqual(codex.requests, []);
});

test("app connections end on Timewarp's own callback page, and the window closes", async () => {
  const f = fixture();
  let closedWith = null;
  f.signin.open("https://connect.composio.dev/link/abc", { title: "Connect an app", onClose: value => { closedWith = value; } });
  const [window] = f.windows;
  window.loaded.push("http://127.0.0.1:17654/connector-callback?status=success");
  window.webContents.emit("did-navigate", {}, "http://127.0.0.1:17654/connector-callback?status=success");
  await until(() => window.destroyed, "the window to close");
  assert.deepEqual(closedWith, { returned: true });
  assert.equal(window.title, "Connect an app — 127.0.0.1:17654");
});

test("closing the window before the sign-in returns says so; links must be HTTPS", async () => {
  const f = fixture();
  let closedWith = null;
  const handle = f.signin.open("https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback", { finish: chatgpt, onClose: value => { closedWith = value; } });
  handle.close();
  await tick();
  assert.deepEqual(closedWith, { returned: false });
  for (const link of ["http://auth.openai.com/oauth/authorize", "https://user:pass@auth.openai.com/", "codex://threads/new", "not a link"]) assert.throws(() => f.signin.open(link), /isn't valid/);
});

test("the callback is the link's redirect_uri on this computer", () => {
  assert.equal(callbackOf("https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback").port, "1455");
  assert.equal(callbackOf("https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1457%2Fauth%2Fcallback").port, "1457");
  for (const link of ["https://example.com/authorize?redirect_uri=https%3A%2F%2Fexample.com%2Fcallback", "https://example.com/authorize?redirect_uri=http%3A%2F%2F192.168.1.2%3A80%2Fcallback", "https://example.com/authorize"]) assert.equal(callbackOf(link), null);
});
