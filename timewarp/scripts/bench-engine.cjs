"use strict";
// Speed comparison of the Timewarp engine with the previous (Energy-based) app.
// Everything runs on this computer with throwaway profiles; no account, no
// cloud and no credits are used, so model inference itself (the same cloud
// models for both apps) is not part of it. Windows only.
//
//   node scripts/bench-engine.cjs compare [--runs 5]
//     needs the previous app staged in build/native (npm run build:staged)
//     and the engine staged in build/engine/stage (npm run engine:package:draft -- --stage)
//
// Measures, per app: launch to window, launch to the sign-in screen and memory
// after settling; and for each app's agent engine (its Codex binary) against
// one local fake model: start-up, opening a chat, time to the first streamed
// word, a whole reply, and the same for a follow-up message.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Math.max(1, Number(process.argv[runsArg + 1]) || 5) : 5;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
function scratch(prefix) { return fs.mkdtempSync(path.join(os.homedir(), prefix)); }
async function remove(directory) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { fs.rmSync(directory, { recursive: true, force: true }); return; } catch { await pause(500); }
  }
}
// Every running process with its parent and memory, on Windows or macOS.
function processes() {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress";
    return JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 }));
  }
  return cp.execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" }).trim().split("\n").map(line => line.trim().split(/\s+/).map(Number))
    .map(([pid, ppid, rss]) => ({ ProcessId: pid, ParentProcessId: ppid, WorkingSetSize: rss * 1024, PrivatePageCount: rss * 1024 }));
}
function descendants(pid) {
  const all = processes(), tree = [], queue = [pid];
  while (queue.length) { const id = queue.shift(); for (const item of all) if (item.ParentProcessId === id) { tree.push(item.ProcessId); queue.push(item.ProcessId); } }
  return tree;
}
function killTree(pid) {
  if (process.platform === "win32") { try { cp.execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {} return; }
  for (const id of [pid, ...descendants(pid)]) { try { process.kill(id, "SIGKILL"); } catch {} }
}
// Working set and private memory of a process and all its descendants.
function memoryOf(pid) {
  const all = processes();
  const children = new Map();
  for (const item of all) { if (!children.has(item.ParentProcessId)) children.set(item.ParentProcessId, []); children.get(item.ParentProcessId).push(item); }
  const tree = [], queue = [all.find(item => item.ProcessId === pid)].filter(Boolean);
  while (queue.length) { const item = queue.shift(); tree.push(item); queue.push(...(children.get(item.ProcessId) || [])); }
  return { processes: tree.length, workingSetMb: Math.round(tree.reduce((sum, item) => sum + Number(item.WorkingSetSize || 0), 0) / 1048576), privateMb: Math.round(tree.reduce((sum, item) => sum + Number(item.PrivatePageCount || 0), 0) / 1048576) };
}

// --- App start-up -----------------------------------------------------------
async function startup(exe) {
  const profile = scratch(".tw-bench-profile-"), port = await freePort(), started = now();
  const child = cp.spawn(exe, ["--remote-debugging-port=" + port], { env: { ...process.env, TIMEWARP_USER_DATA_DIR: profile }, stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
  const result = { windowMs: null, signInMs: null };
  try {
    let target;
    while (!target && now() - started < 60000) {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => []);
      target = list.find(item => item.type === "page" && item.url.startsWith("app://"));
      if (!target) await pause(25);
    }
    if (!target) throw new Error("The app window never appeared.");
    result.windowMs = Math.round(now() - started);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const evaluate = expression => new Promise(resolve => { const request = ++id; socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id === request) resolve(message.result?.result?.value); }; socket.send(JSON.stringify({ id: request, method: "Runtime.evaluate", params: { expression, returnByValue: true } })); });
    while (now() - started < 60000) {
      if (await evaluate("!!document.body && /Sign in|Continue with Google/.test(document.body.innerText)")) { result.signInMs = Math.round(now() - started); break; }
      await pause(25);
    }
    socket.close();
    await pause(8000);
    Object.assign(result, memoryOf(child.pid));
  } finally {
    killTree(child.pid);
    await pause(1500);
    await remove(profile);
  }
  return result;
}

// --- Agent engine (Codex) against one local fake model -----------------------
function fakeModel() {
  const requests = [];
  const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const words = "Here is a short reply from the local test model, streamed word by word so both engines get the same work.".split(" ");
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      requests.push({ url: req.url, at: now() });
      if (req.method === "POST" && req.url.endsWith("/responses")) {
        const id = "resp_" + requests.length, item = "msg_" + requests.length;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse([
          { type: "response.created", response: { id } },
          { type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant", id: item, content: [] } },
          ...words.map((word, index) => ({ type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: (index ? " " : "") + word })),
          { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id: item, content: [{ type: "output_text", text: words.join(" ") }] } },
          { type: "response.completed", response: { id, usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens: words.length, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 50 + words.length } } },
        ]));
        return;
      }
      if (req.url.endsWith("/models")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ object: "list", data: [{ id: "bench-model", object: "model" }] })); return; }
      res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
    });
  });
  return { server, requests };
}

async function engine({ exe, leadingArgs, resources }) {
  const fake = fakeModel();
  await new Promise(resolve => fake.server.listen(0, "127.0.0.1", resolve));
  const home = scratch(".tw-bench-codex-"), workspace = path.join(home, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const extra = ["codex-path", "codex-resources"].map(name => path.join(resources, name)).filter(fs.existsSync);
  const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === "PATH") || "PATH";
  const args = [...leadingArgs,
    "-c", `model_providers.bench={name="Bench",base_url="http://127.0.0.1:${fake.server.address().port}/v1",wire_api="responses",env_key="TIMEWARP_BENCH_TOKEN"}`,
    "-c", 'model_provider="bench"', "-c", 'model="bench-model"'];
  const started = now();
  const child = cp.spawn(exe, args, { cwd: workspace, env: { ...process.env, CODEX_HOME: home, TIMEWARP_BENCH_TOKEN: "bench", [pathKey]: [...extra, process.env[pathKey] || ""].join(path.delimiter) }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  let buffer = "", nextId = 0;
  const pending = new Map(), listeners = new Set();
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.id !== undefined && pending.has(message.id) && !message.method) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
      else if (message.method && message.id !== undefined) child.stdin.write(JSON.stringify({ id: message.id, result: { decision: "accept" } }) + "\n");
      else if (message.method) for (const listener of listeners) listener(message);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + "\n"); });
  const turn = async (threadId, text) => {
    const sent = now();
    let firstWord = null;
    const done = new Promise(resolve => {
      const listener = message => {
        if (message.method === "item/agentMessage/delta" && firstWord === null) firstWord = now();
        if (message.method === "turn/completed") { listeners.delete(listener); resolve(); }
      };
      listeners.add(listener);
    });
    await request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }] });
    await done;
    const reachedModel = fake.requests.filter(item => item.url.endsWith("/responses")).at(-1)?.at;
    return { toModelMs: Math.round(reachedModel - sent), firstWordMs: Math.round(firstWord - sent), replyMs: Math.round(now() - sent) };
  };
  try {
    await request("initialize", { clientInfo: { name: "timewarp-bench", title: "Timewarp benchmark", version: "0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const startMs = Math.round(now() - started);
    const opening = now();
    const thread = await request("thread/start", { cwd: workspace, approvalPolicy: "never", sandbox: "workspace-write", model: "bench-model" });
    const openChatMs = Math.round(now() - opening);
    const first = await turn(thread.thread.id, "Say hello.");
    const followUp = await turn(thread.thread.id, "And once more.");
    const memory = memoryOf(child.pid);
    return { startMs, openChatMs, first, followUp, memoryMb: memory.workingSetMb };
  } finally {
    killTree(child.pid);
    fake.server.closeAllConnections(); fake.server.close();
    await pause(800);
    await remove(home);
  }
}

function summarize(runs) {
  const pick = getter => median(runs.map(run => { try { return getter(run); } catch { return NaN; } }));
  const first = runs[0];
  if (first.windowMs !== undefined) return { runs: runs.length, windowMs: pick(run => run.windowMs), signInMs: pick(run => run.signInMs), workingSetMb: pick(run => run.workingSetMb), privateMb: pick(run => run.privateMb), processes: pick(run => run.processes) };
  return {
    runs: runs.length, startMs: pick(run => run.startMs), openChatMs: pick(run => run.openChatMs),
    firstMessage: { toModelMs: pick(run => run.first.toModelMs), firstWordMs: pick(run => run.first.firstWordMs), replyMs: pick(run => run.first.replyMs) },
    followUp: { toModelMs: pick(run => run.followUp.toModelMs), firstWordMs: pick(run => run.followUp.firstWordMs), replyMs: pick(run => run.followUp.replyMs) },
    memoryMb: pick(run => run.memoryMb),
  };
}
const size = directory => { let total = 0; const walk = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const full = path.join(folder, entry.name); if (entry.isDirectory()) walk(full); else total += fs.statSync(full).size; } }; walk(directory); return Math.round(total / 1048576); };

async function compare() {
  if (process.platform !== "win32") throw new Error("The comparison runs on Windows.");
  const previous = path.join(root, "build", "native"), current = path.join(root, "build", "engine", "stage");
  for (const [name, directory] of [["previous app (build/native)", previous], ["engine (build/engine/stage)", current]]) if (!fs.existsSync(path.join(directory, "Timewarp.exe"))) throw new Error(`Stage the ${name} first.`);
  const previousCodex = { exe: path.join(previous, "resources", "openai-codex", "bin", "codex-app-server.exe"), leadingArgs: [], resources: path.join(previous, "resources", "openai-codex") };
  const engineCodex = { exe: path.join(current, "resources", "codex", "bin", "codex.exe"), leadingArgs: ["app-server"], resources: path.join(current, "resources", "codex") };
  const results = { measuredAt: new Date().toISOString(), runs: RUNS, machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1e9), windows: os.release() }, previous: {}, engine: {} };
  results.previous.installMb = size(previous); results.engine.installMb = size(current);
  for (const [key, label] of [["startup", "App start-up"], ["agent", "Agent engine"]]) {
    const previousRuns = [], engineRuns = [];
    for (let run = 0; run < RUNS; run++) {
      // Alternate so background load affects both the same way.
      for (const [list, target, codex] of run % 2 ? [[engineRuns, current, engineCodex], [previousRuns, previous, previousCodex]] : [[previousRuns, previous, previousCodex], [engineRuns, current, engineCodex]]) {
        try { list.push(key === "startup" ? await startup(path.join(target, "Timewarp.exe")) : await engine(codex)); }
        catch (error) { console.error(`${label} run failed (${target === current ? "engine" : "previous"}):`, error.message); }
      }
      console.log(`${label}: run ${run + 1}/${RUNS} done`);
    }
    results.previous[key] = previousRuns.length ? summarize(previousRuns) : null;
    results.engine[key] = engineRuns.length ? summarize(engineRuns) : null;
    results.previous[key + "Runs"] = previousRuns; results.engine[key + "Runs"] = engineRuns;
  }
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports", "bench-engine.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ previous: { installMb: results.previous.installMb, startup: results.previous.startup, agent: results.previous.agent }, engine: { installMb: results.engine.installMb, startup: results.engine.startup, agent: results.engine.agent } }, null, 2));
}

// The packaging smoke tests reuse the start-up and agent engine checks.
module.exports = { startup, engine };

if (require.main === module) {
  if (process.argv[2] === "compare") compare().catch(error => { console.error(error.message); process.exitCode = 1; });
  else console.log("Usage: node scripts/bench-engine.cjs compare [--runs 5]");
}
