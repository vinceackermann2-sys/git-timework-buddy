"use strict";
// Speed of a preview build as a user meets it, with every cloud call as slow
// as a round trip to the real cloud (the preview otherwise answers at once):
// launch to the main screen, a new chat sent from Home and a follow-up to its
// first streamed word, the cloud calls each one waited for, how much work the
// window does while a long reply streams into a long chat, and a short browser
// task. The interface is driven as a user would, through its composer.
//
//   node scripts/perf-engine.cjs <app> [--runs 5] [--latency 280] [--json file]
//   node scripts/perf-engine.cjs compare <before app> <after app> [same options]
//
// <app> is a preview build (node scripts/build-engine.cjs --dev --fixture).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const cp = require("node:child_process");

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf("--" + name); return at >= 0 ? args[at + 1] : fallback; };
const RUNS = Math.max(1, Number(option("runs", 5)) || 5);
const LATENCY = Math.max(0, Number(option("latency", 280)) || 0);
const STREAM_MS = option("stream", "10");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
const round = value => value == null ? null : Math.round(value);

const PAGE = `<!doctype html><title>Timewarp speed page</title><h1>Order form</h1>
  <button id="go" onclick="document.getElementById('out').textContent='Ordered'">Order</button><p id="out"></p>
  <label>Name <input id="name"></label><a href="/done">Next page</a>`;

async function launch(appDir) {
  if (!fs.existsSync(path.join(appDir, "main", "fixture.cjs"))) throw new Error("Not a preview build: " + appDir);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-perf-"));
  const port = await freePort();
  const started = Date.now();
  const child = cp.spawn(require("electron"), [appDir, "--remote-debugging-port=" + port], {
    env: { ...process.env, TIMEWARP_USER_DATA_DIR: profile, TIMEWARP_FIXTURE_CONFIRM: "allow", TIMEWARP_FIXTURE_COUNT: "1", TIMEWARP_FIXTURE_CLOUD_LATENCY_MS: String(LATENCY), TIMEWARP_FIXTURE_STREAM_MS: STREAM_MS },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const lines = []; // [ms since launch, line]
  let rest = "";
  const read = chunk => { rest += chunk; const parts = rest.split(/\r?\n/); rest = parts.pop(); for (const line of parts) lines.push([Date.now() - started, line]); };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  let target;
  for (const deadline = Date.now() + 60000; !target && Date.now() < deadline;) {
    if (child.exitCode !== null) throw new Error("The app exited: " + lines.slice(-20).map(line => line[1]).join("\n"));
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => []);
    target = list.find(item => item.type === "page" && item.url.startsWith("app://app/"));
    if (!target) await pause(50);
  }
  if (!target) throw new Error("The window never loaded.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
  const send = (method, params = {}) => new Promise(resolve => { const next = ++id; pending.set(next, resolve); socket.send(JSON.stringify({ id: next, method, params })); });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const evaluate = async expression => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  // The main screen: Home's composer, ready to type in.
  for (const deadline = Date.now() + 60000; Date.now() < deadline; await pause(25)) if (await evaluate("!!document.querySelector('.tw-window textarea[aria-label=Message]')").catch(() => false)) break;
  const ready = Date.now() - started;
  const call = async (method, input = {}) => {
    const value = await evaluate(`window.tw.call(${JSON.stringify(method)}, ${JSON.stringify(input)}).then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message }))`);
    if (!value?.ok) throw new Error(`${method}: ${value?.error}`);
    return value.value;
  };
  // Streamed words and finished turns of each chat, timed in the window.
  await evaluate(`window.__perf = []; window.tw.on("conversation.event", event => {
    if (event.params?.subAgent) return;
    if (event.method === "item/agentMessage/delta") window.__perf.push({ id: event.conversationId, kind: "word", t: performance.now() });
    if (event.method === "turn/completed") window.__perf.push({ id: event.conversationId, kind: "done", t: performance.now() });
  }); true`);
  const close = async () => {
    socket.close();
    try { cp.execFileSync(process.platform === "win32" ? "taskkill" : "kill", process.platform === "win32" ? ["/pid", String(child.pid), "/T", "/F"] : ["-TERM", String(child.pid)], { stdio: "ignore" }); } catch {}
    await pause(1500);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); } catch {}
  };
  return { send, evaluate, call, close, ready, lines, started };
}

// Types into the visible composer over about a second, as a person would, and
// sends with Enter. Returns the window's clock at Enter.
async function typeAndSend(app, text) {
  await app.evaluate(`(() => { const area = document.querySelector('textarea[aria-label=Message]'); area.focus(); return true; })()`);
  const chunks = text.match(/[\s\S]{1,6}/g);
  for (const chunk of chunks) { await app.send("Input.insertText", { text: chunk }); await pause(1000 / chunks.length); }
  await pause(150);
  const at = await app.evaluate("performance.now()");
  await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  return at;
}
const currentChat = async app => /#\/conversation\/([^/?]+)/.exec(await app.evaluate("location.hash"))?.[1] || null;
async function waitFor(app, predicate, timeout = 60000) {
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await pause(20)) { const value = await predicate(); if (value) return value; }
  throw new Error("Timed out.");
}
const eventsOf = async (app, id) => (await app.evaluate("window.__perf")).filter(event => event.id === id);
// Cloud calls the app waited for between two log positions, by route.
function cloudCalls(lines, from, to = lines.length) {
  const counts = {};
  for (const [, line] of lines.slice(from, to)) { const match = /\[timewarp\] fixture cloud (\S+(?: [\w-]+)?)/.exec(line); if (match) counts[match[1]] = (counts[match[1]] || 0) + 1; }
  return counts;
}
const total = counts => Object.values(counts).reduce((sum, count) => sum + count, 0);

async function measure(appDir) {
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(req.url === "/done" ? "<!doctype html><title>Done</title><h1>Done</h1>" : PAGE); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  const result = { app: appDir, latency: LATENCY, launches: [], newChat: [], followUp: [], newChatCalls: [], followUpCalls: [], stream: null, browser: [] };
  const app = await launch(appDir);
  result.launches.push(app.ready);
  try {
    await pause(4000); // start-up work (history, catalogs) settles
    for (let run = 0; run < RUNS; run++) {
      await app.evaluate(`location.hash = "#/"; true`);
      await waitFor(app, () => app.evaluate("!!document.querySelector('.tw-window textarea[aria-label=Message]') && !location.hash.includes('conversation')"));
      await pause(1500);
      const mark = app.lines.length;
      const sent = await typeAndSend(app, `Hello number ${run + 1}, what can you do?`);
      const id = await waitFor(app, () => currentChat(app));
      const first = await waitFor(app, async () => (await eventsOf(app, id)).find(event => event.kind === "word"));
      result.newChat.push(first.t - sent);
      result.newChatCalls.push(cloudCalls(app.lines, mark));
      await waitFor(app, async () => (await eventsOf(app, id)).some(event => event.kind === "done"));
      // A follow-up in the same chat, after the reply and its title settle.
      await pause(2500);
      const before = (await eventsOf(app, id)).length, followMark = app.lines.length;
      const again = await typeAndSend(app, "Thanks, and one more thing?");
      const next = await waitFor(app, async () => (await eventsOf(app, id)).slice(before).find(event => event.kind === "word"));
      result.followUp.push(next.t - again);
      result.followUpCalls.push(cloudCalls(app.lines, followMark));
      await waitFor(app, async () => (await eventsOf(app, id)).slice(before).some(event => event.kind === "done"));
    }

    // A long chat: twelve long replies, then the work the window does while one more streams.
    const agent = (await app.call("agents.list"))[0];
    const chat = (await app.call("conversations.create", { agentId: agent.id })).id;
    await app.evaluate(`location.hash = "#/conversation/${chat}"; true`);
    await pause(1500);
    for (let index = 0; index < 12; index++) {
      const count = (await eventsOf(app, chat)).filter(event => event.kind === "done").length;
      await app.call("conversations.send", { id: chat, text: `Please write a long reply, part ${index + 1}.`, images: [], files: [], clientId: crypto.randomUUID() });
      await waitFor(app, async () => (await eventsOf(app, chat)).filter(event => event.kind === "done").length > count, 120000);
      await pause(300);
    }
    await pause(2000);
    await app.send("Performance.enable", { timeDomain: "threadTicks" });
    await app.evaluate(`window.__long = []; new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__long.push(entry.duration); }).observe({ type: "longtask" }); true`);
    const metrics = async () => Object.fromEntries((await app.send("Performance.getMetrics")).result.metrics.map(item => [item.name, item.value]));
    const done = (await eventsOf(app, chat)).filter(event => event.kind === "done").length;
    const start = await metrics();
    const sent = await typeAndSend(app, "One more long reply please.");
    await waitFor(app, async () => (await eventsOf(app, chat)).filter(event => event.kind === "done").length > done, 120000);
    const finished = await app.evaluate("performance.now()");
    await pause(500);
    const end = await metrics();
    const long = await app.evaluate("window.__long");
    const delta = name => round((end[name] - start[name]) * 1000);
    result.stream = { ms: round(finished - sent), script: delta("ScriptDuration"), layout: delta("LayoutDuration"), style: delta("RecalcStyleDuration"), task: delta("TaskDuration"), longTasks: long.length, longTaskMs: round(long.reduce((sum, value) => sum + value, 0)), rows: await app.evaluate("document.querySelectorAll('.tw-messages [data-message-time], .tw-messages article, .tw-messages .tw-message').length") };

    // A short browser task: open a page, read it and click its first control.
    for (let run = 0; run < Math.min(RUNS, 3); run++) {
      const id = (await app.call("conversations.create", { agentId: agent.id })).id;
      await app.evaluate(`location.hash = "#/conversation/${id}"; true`);
      await pause(1500);
      const t0 = await app.evaluate("performance.now()");
      await app.call("conversations.send", { id, text: `Please browse and click ${site}/`, images: [], files: [], clientId: crypto.randomUUID() });
      const end = await waitFor(app, async () => (await eventsOf(app, id)).find(event => event.kind === "done"), 120000);
      result.browser.push(end.t - t0);
    }
  } finally {
    await app.close();
    server.close();
  }
  // Two more cold launches for the launch time.
  for (let run = 0; run < 2; run++) { const again = await launch(appDir); result.launches.push(again.ready); await again.close(); }
  return result;
}

function summary(result) {
  const calls = list => { const routes = {}; for (const counts of list) for (const [route, count] of Object.entries(counts)) routes[route] = (routes[route] || 0) + count; return Object.entries(routes).map(([route, count]) => `${route} ×${Math.round(count / list.length * 10) / 10}`).join(", "); };
  return {
    "launch to main screen (ms)": round(median(result.launches)),
    "new chat from Home: Enter to first word (ms)": round(median(result.newChat)),
    "new chat: cloud calls before first word": round(median(result.newChatCalls.map(total))),
    "new chat calls by route (avg)": calls(result.newChatCalls),
    "follow-up: Enter to first word (ms)": round(median(result.followUp)),
    "follow-up: cloud calls before first word": round(median(result.followUpCalls.map(total))),
    "follow-up calls by route (avg)": calls(result.followUpCalls),
    "long reply in a long chat: total (ms)": result.stream?.ms,
    "  window script time (ms)": result.stream?.script,
    "  layout + style (ms)": result.stream ? result.stream.layout + result.stream.style : null,
    "  busy main thread (ms)": result.stream?.task,
    "  long tasks (count / ms)": result.stream ? `${result.stream.longTasks} / ${result.stream.longTaskMs}` : null,
    "browser task: send to done (ms)": round(median(result.browser)),
  };
}

async function main() {
  const compare = args[0] === "compare";
  const apps = (compare ? args.slice(1, 3) : args.slice(0, 1)).map(dir => path.resolve(dir));
  if (!apps.length || apps.some(dir => !fs.existsSync(dir))) throw new Error("Usage: node scripts/perf-engine.cjs [compare <before>] <app> [--runs 5] [--latency 280] [--json file]");
  const results = [];
  for (const dir of apps) { console.log(`Measuring ${dir} (${RUNS} runs, cloud latency ${LATENCY} ms)…`); results.push(await measure(dir)); }
  const rows = results.map(summary);
  const width = Math.max(...Object.keys(rows[0]).map(key => key.length));
  console.log("");
  for (const key of Object.keys(rows[0])) console.log(key.padEnd(width + 2) + rows.map(row => String(row[key] ?? "—").padEnd(compare ? 34 : 0)).join(""));
  const file = option("json", null);
  if (file) fs.writeFileSync(file, JSON.stringify(results, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
