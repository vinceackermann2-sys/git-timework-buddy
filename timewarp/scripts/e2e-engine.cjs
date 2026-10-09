"use strict";
// End-to-end check of the agent harness in a preview build: the real app and
// Codex runtime with the preview account and its scripted model. Each scenario
// goes through the same calls the interface makes.
// Usage: node scripts/build-engine.cjs --dev --fixture && node scripts/e2e-engine.cjs [scenario …]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appDir = path.join(root, "build", "engine", "app");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

// Pages the agent works on, served on this computer.
const PAGES = {
  "/form": `<!doctype html><title>Timewarp test form</title><h1>Greeting form</h1>
    <label>Name <input id="name"></label><button id="go" onclick="document.getElementById('out').textContent='Hello '+document.getElementById('name').value">Greet</button>
    <p id="out"></p><div style="height:4000px"></div><p>Bottom of the page</p>`,
  "/login": `<!doctype html><title>Timewarp test sign-in</title><h1>Sign in</h1>
    <form onsubmit="event.preventDefault()"><label>Email <input name="username" type="email" autocomplete="username"></label>
    <label>Password <input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>
    <p id="state">empty</p><script>setInterval(()=>{const u=document.querySelector('[name=username]').value,p=document.querySelector('[name=password]').value;document.getElementById('state').textContent=p?'filled as '+u+' with a '+p.length+'-character password':'empty'},200)</script>`,
};

// A minimal MCP server on stdin/stdout with one echo tool.
const MCP_SERVER = `const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", line => { let m; try { m = JSON.parse(line); } catch { return; } if (m.id === undefined) return;
  const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  if (m.method === "initialize") return reply({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1.0.0" } });
  if (m.method === "tools/list") return reply({ tools: [{ name: "echo", description: "Echo text back.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] });
  if (m.method === "tools/call") return reply({ content: [{ type: "text", text: "echo: " + m.params.arguments.text }] });
  reply({}); });`;

async function launch() {
  if (!fs.existsSync(path.join(appDir, "main", "fixture.cjs"))) throw new Error("Build a preview first: node scripts/build-engine.cjs --dev --fixture");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-e2e-"));
  const port = await freePort();
  const electron = require("electron");
  const child = cp.spawn(electron, [appDir, "--remote-debugging-port=" + port], { env: { ...process.env, TIMEWARP_USER_DATA_DIR: profile }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = "";
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { log += chunk; });
  let target;
  for (const deadline = Date.now() + 60000; !target && Date.now() < deadline;) {
    if (child.exitCode !== null) throw new Error("The app exited: " + log.slice(-2000));
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => []);
    target = list.find(item => item.type === "page" && item.url.startsWith("app://app/"));
    if (!target) await pause(300);
  }
  if (!target) throw new Error("The window never loaded.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
  const send = (method, params = {}) => new Promise(resolve => { const next = ++id; pending.set(next, resolve); socket.send(JSON.stringify({ id: next, method, params })); });
  // Keep timers running at full speed while the window is in the background.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const evaluate = async expression => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  for (const deadline = Date.now() + 30000; Date.now() < deadline; await pause(300)) if (await evaluate("!!window.tw && !!document.querySelector('.tw-window')").catch(() => false)) break;
  const call = async (method, input = {}) => {
    const value = await evaluate(`window.tw.call(${JSON.stringify(method)}, ${JSON.stringify(input)}).then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message }))`);
    if (!value?.ok) throw new Error(`${method}: ${value?.error}`);
    return value.value;
  };
  const close = async () => {
    socket.close();
    try { cp.execFileSync(process.platform === "win32" ? "taskkill" : "kill", process.platform === "win32" ? ["/pid", String(child.pid), "/T", "/F"] : ["-TERM", String(child.pid)], { stdio: "ignore" }); } catch {}
    await pause(2000);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); } catch (error) { console.log("Couldn't remove the test profile yet: " + error.message); }
  };
  // Other windows the app opens, such as a connector sign-in.
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => []);
  const evaluateIn = async (target, expression) => {
    const other = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { other.onopen = resolve; other.onerror = reject; });
    other.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
    await pause(300);
    other.close();
  };
  return { call, evaluate, close, log: () => log, profile, targets, evaluateIn };
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const server = http.createServer((req, res) => {
    const page = PAGES[new URL(req.url, "http://localhost").pathname];
    res.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(page || "Not found");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  const app = await launch();
  const { call } = app;
  const agent = (await call("agents.list"))[0];
  const results = [];

  // Sends a message and waits for the reply, approving requests on the way.
  async function turn(conversationId, text, { approve = true, timeout = 90000 } = {}) {
    const before = (await call("conversations.history", { id: conversationId })).turns?.length || 0;
    await call("conversations.send", { id: conversationId, text, images: [], files: [], clientId: crypto.randomUUID() });
    const approvals = [];
    for (const deadline = Date.now() + timeout; Date.now() < deadline; await pause(400)) {
      const status = await call("conversations.status", { id: conversationId });
      for (const request of status.approvals || []) {
        if (approvals.some(item => item.id === request.id)) continue;
        approvals.push(request);
        // The answers the interface's approval card sends for "Allow" / "Continue".
        const answer = request.method === "item/permissions/requestApproval" ? { permissions: request.params?.permissions || {}, scope: "turn" }
          : request.method === "mcpServer/elicitation/request" ? { action: "accept", content: {}, _meta: null }
            : request.method === "item/tool/requestUserInput" ? { answers: {} } : { decision: "accept" };
        if (approve) await call("approvals.respond", { id: request.id, response: answer });
      }
      const history = await call("conversations.history", { id: conversationId });
      const last = history.turns?.at(-1);
      if (!status.running && (history.turns?.length || 0) > before && last && last.status !== "inProgress") {
        const reply = (last.items || []).filter(item => item.type === "agentMessage").map(item => item.text).join("\n");
        return { turn: last, reply, approvals, items: last.items || [] };
      }
    }
    throw new Error(`No reply to "${text.slice(0, 60)}" within ${timeout / 1000} s.`);
  }
  const chat = async () => (await call("conversations.create", { agentId: agent.id })).id;
  const script = code => "Run this check.\n```exec\n" + code.trim() + "\n```";
  const output = reply => { const match = /```\n([\s\S]*?)\n```/.exec(reply); return match ? match[1] : reply; };
  const json = reply => { const text = output(reply), start = text.indexOf("{"); try { return JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)); } catch { throw new Error("The script printed: " + text.slice(0, 600)); } };

  async function declined() {
      const id = await chat();
      const result = await turn(id, "Please run a quick check", { approve: false, timeout: 15000 }).catch(error => ({ error }));
      const status = await call("conversations.status", { id });
      const request = status.approvals?.[0];
      if (!request) throw new Error("No approval was requested: " + (result.error?.message || ""));
      await call("approvals.respond", { id: request.id, response: { decision: "decline" } });
      for (const deadline = Date.now() + 30000; Date.now() < deadline; await pause(500)) if (!(await call("conversations.status", { id })).running) break;
      const history = await call("conversations.history", { id });
      const ran = (history.turns.at(-1).items || []).some(item => item.type === "commandExecution" && item.status === "completed" && /Hello from/.test(item.aggregatedOutput || ""));
      if (ran) throw new Error("A declined command still ran.");
      return "a declined command did not run";
  }
  const scenarios = {
    async chat() {
      const id = await chat();
      const result = await turn(id, "Hello, what can you do?");
      if (!/Preview reply/.test(result.reply)) throw new Error("No streamed reply: " + result.reply.slice(0, 200));
      const usage = await call("conversations.usage", { id });
      if (!usage.some(row => row.turnId === result.turn.id && row.output > 0)) throw new Error("Token usage was not recorded for the turn.");
      return `reply streamed; ${usage[0].input} input and ${usage[0].output} output tokens recorded`;
    },
    async command() {
      const id = await chat();
      const result = await turn(id, "Please run a quick check");
      if (!/Hello from the Timewarp preview/.test(result.reply)) throw new Error("Command output missing: " + result.reply.slice(0, 300));
      if (result.approvals.length) throw new Error("With automatic review, the user shouldn't be asked: " + result.approvals.map(item => item.method).join(", "));
      return "the reviewer allowed the command without asking, and its output reached the reply";
    },
    async reviewDenied() {
      const id = await chat();
      const result = await turn(id, "Please run a risky cleanup", { approve: false });
      const runs = await app.evaluate(`window.timewarp.request("executionStatus", { conversationId: ${JSON.stringify(id)} })`);
      const ran = result.items.some(item => item.type === "commandExecution" && item.status === "completed" && item.exitCode === 0);
      if (ran) throw new Error("A command the reviewer denied still ran.");
      if (!runs.some(run => /approval review/i.test(run.reason || ""))) throw new Error("The run didn't stop with the review reason: " + JSON.stringify(runs));
      return "the reviewer denied a risky command, it didn't run, and the run stopped with the reason shown";
    },
    async browser() {
      const id = await chat();
      if (process.env.E2E_PANE) {
        await app.evaluate(`location.hash = "#/c/${id}"`);
        await pause(2500);
        await app.evaluate(`document.querySelector('[aria-label="Show pane"]')?.click()`);
        await pause(2500);
      } else await call("browser.show", { conversationId: id });
      const result = await turn(id, script(`
        const started = Date.now(); const step = label => text(label + " " + (Date.now() - started) + " ms; ");
        const opened = await tools.timewarp_browser__open({ url: ${JSON.stringify(site + "/form")} }); step("open");
        const outline = String(await tools.timewarp_browser__snapshot({})); step("snapshot");
        const field = (outline.match(/textbox[^\\n]*\\[ref=(e\\d+)\\]/) || [])[1];
        const button = (outline.match(/button "Greet"[^\\n]*\\[ref=(e\\d+)\\]/) || [])[1];
        await tools.timewarp_browser__type({ ref: field, text: "Ada" }); step("type");
        const typed = (String(await tools.timewarp_browser__snapshot({})).match(/textbox[^\\n]*/) || [""])[0];
        await tools.timewarp_browser__click({ ref: button }); step("click");
        await tools.timewarp_browser__wait({ text: "Hello Ada", seconds: 5 }); step("wait");
        const page = String(await tools.timewarp_browser__read({})); step("read");
        await tools.timewarp_browser__scroll({ direction: "down", amount: 2 }); step("scroll");
        await tools.timewarp_browser__press({ key: "End" }); step("press");
        const shot = await tools.timewarp_browser__screenshot({}); step("screenshot");
        await tools.timewarp_browser__open({ url: ${JSON.stringify(site + "/login")}, new_tab: true });
        const tabs = String(await tools.timewarp_browser__tabs({})); step("tabs");
        await tools.timewarp_browser__back({}); step("back");
        text(JSON.stringify({ field, button, typed, greeted: page.includes("Hello Ada"), page: page.slice(0, 200), screenshot: !!shot, tabs: (tabs.match(/127\\.0\\.0\\.1/g) || []).length }));
      `));
      const value = json(result.reply);
      if (!value.field || !value.button || !value.greeted) throw new Error("Typing and clicking failed: " + JSON.stringify(value));
      if (value.tabs < 2) throw new Error("A second tab didn't open: " + JSON.stringify(value));
      const state = await call("browser.state", { conversationId: id });
      if (state.tabs.length < 2) throw new Error("The pane doesn't show the agent's tabs.");
      return "opened, read, typed, clicked, waited, scrolled, pressed keys, took a screenshot and used two tabs";
    },
    async vault() {
      const id = await chat();
      await call("browser.show", { conversationId: id });
      await call("vault.create", { kind: "password", site: site + "/login", username: "ada@example.com", password: "correct-horse", label: "Test site" });
      await call("agents.update", { id: agent.id, vaultAccess: true });
      const result = await turn(id, script(`
        await tools.timewarp_browser__open({ url: ${JSON.stringify(site + "/login")} });
        const outline = String(await tools.timewarp_browser__snapshot({}));
        const refs = [...outline.matchAll(/textbox[^\\n]*\\[ref=(e\\d+)\\]/g)].map(match => match[1]);
        const list = String(await tools.timewarp_vault__list({ site: ${JSON.stringify(site)} }));
        const item = (list.match(/^(\\S+) \\| sign-in/m) || [])[1];
        const filled = await tools.timewarp_vault__fill_sign_in({ item, username_ref: refs[0], password_ref: refs[1] });
        await tools.timewarp_browser__wait({ text: "filled as", seconds: 5 });
        const page = String(await tools.timewarp_browser__read({}));
        text(JSON.stringify({ item: !!item, filled: String(filled).slice(0, 200), page: (page.match(/filled as [^\\n]*/) || [""])[0], leaked: (String(filled) + page + list).includes("correct-horse") }));
      `));
      const value = json(result.reply);
      // The page shows the username it received; the agent sees filled vault
      // values masked, so it reads "[filled from vault]" there.
      if (!/filled as \[filled from vault\] with a 13-character password/.test(value.page)) throw new Error("The sign-in wasn't filled: " + JSON.stringify(value));
      if (value.leaked) throw new Error("The password was shown to the agent.");
      return "the agent filled a saved sign-in without seeing the password";
    },
    async connectors() {
      const id = await chat();
      const result = await turn(id, script(`
        const names = ALL_TOOLS.map(tool => tool.name).filter(name => /composio/i.test(name));
        const find = part => names.find(name => name.includes(part));
        const connections = find("list_connections") ? await tools[find("list_connections")]({ assistantId: ${JSON.stringify(agent.id)} }) : null;
        text(JSON.stringify({ names, connections: JSON.stringify(connections).slice(0, 500) }));
      `));
      const value = json(result.reply);
      if (!value.names.some(name => /list_connections/.test(name)) || !value.names.some(name => /execute/.test(name))) throw new Error("The connected-app tools aren't available to the agent: " + JSON.stringify(value.names));
      if (!/Preview inbox|conn-gmail-1|gmail/i.test(value.connections)) throw new Error("The agent can't see the connected Gmail account: " + value.connections);
      return `the agent sees ${value.names.length} connected-app tools and the connected Gmail account`;
    },
    async mcp() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-e2e-mcp-"));
      fs.writeFileSync(path.join(directory, "server.js"), MCP_SERVER);
      await call("mcp.add", { name: "echo", transport: "stdio", command: process.execPath, args: [path.join(directory, "server.js")], env: { ELECTRON_RUN_AS_NODE: "1" } });
      let listed;
      for (const deadline = Date.now() + 30000; Date.now() < deadline; await pause(1000)) {
        listed = (await call("mcp.list")).find(server => server.name === "echo");
        if (listed?.tools) break;
      }
      if (!listed?.tools) throw new Error("The MCP server didn't start: " + JSON.stringify(listed));
      const id = await chat();
      const result = await turn(id, script(`
        const name = ALL_TOOLS.map(tool => tool.name).find(name => /echo/.test(name) && /mcp/.test(name));
        text(JSON.stringify({ name, result: name ? JSON.stringify(await tools[name]({ text: "ping" })) : null }));
      `));
      const value = json(result.reply);
      if (!/echo: ping/.test(value.result || "")) throw new Error("The agent couldn't call the MCP tool: " + JSON.stringify(value));
      await call("mcp.remove", { name: "echo" });
      fs.rmSync(directory, { recursive: true, force: true });
      return `an added MCP server's tool (${value.name}) was called by the agent`;
    },
    async files() {
      const id = await chat();
      const result = await turn(id, script(`
        const result = await tools.exec_command({ cmd: ${JSON.stringify(process.platform === "win32" ? "Set-Content -Path report.md -Value '# Report'; Get-Content report.md" : "printf '# Report\\n' > report.md && cat report.md")} });
        text(typeof result === "string" ? result : JSON.stringify(result));
      `));
      const listing = await call("files.list", { agentId: agent.id });
      const entries = JSON.stringify(listing);
      if (!entries.includes("report.md")) throw new Error("The file the agent wrote isn't in Files: " + entries.slice(0, 300) + " / " + result.reply.slice(0, 300));
      return "the agent wrote a file in its workspace and it shows in Files";
    },
    async automations() {
      const created = await call("automations.create", { agentId: agent.id, name: "Morning check", instructions: "Hello from an automation", schedule: { kind: "daily", time: "08:00" }, enabled: true });
      await call("automations.run", { id: created.id });
      let runs = [];
      for (const deadline = Date.now() + 60000; Date.now() < deadline; await pause(1000)) {
        runs = await call("automations.runs", { id: created.id });
        if (runs.some(run => run.status === "completed" || run.status === "failed")) break;
      }
      if (!runs.some(run => run.status === "completed")) throw new Error("The automation run didn't complete: " + JSON.stringify(runs));
      await call("automations.remove", { id: created.id });
      return "an automation ran and recorded its run";
    },
    async approvalsDeclined() {
      // With "Ask me", requests come to the user, who can decline them.
      const settings = await call("settings.get");
      await call("settings.set", { key: "preferences", value: { ...settings.preferences, approvals: "ask" } });
      try { return await declined(); } finally { await call("settings.set", { key: "preferences", value: { ...settings.preferences, approvals: "auto" } }); }
    },
    async interruptWhileAsking() {
      const settings = await call("settings.get");
      await call("settings.set", { key: "preferences", value: { ...settings.preferences, approvals: "ask" } });
      try { return (await scenarios.interrupt("Please run a quick check")) + " while an approval was waiting"; } finally { await call("settings.set", { key: "preferences", value: { ...settings.preferences, approvals: "auto" } }); }
    },
    async interrupt(text = "Hello, take your time") {
      const id = await chat();
      await call("conversations.send", { id, text, images: [], files: [], clientId: crypto.randomUUID() });
      for (const deadline = Date.now() + 20000; Date.now() < deadline; await pause(100)) if ((await call("conversations.status", { id })).running) break;
      await call("conversations.interrupt", { id });
      for (const deadline = Date.now() + 20000; Date.now() < deadline; await pause(300)) if (!(await call("conversations.status", { id })).running) return "a running reply stopped when asked";
      throw new Error("The reply didn't stop.");
    },
    async browserVisible() {
      process.env.E2E_PANE = "1";
      try { return (await scenarios.browser()) + " with the pane on screen"; } finally { delete process.env.E2E_PANE; }
    },
    async workers() {
      const id = await chat();
      const result = await turn(id, "Please spawn a worker for this");
      const spawned = result.items.find(item => item.type === "subAgentActivity" && item.agentThreadId) || result.items.find(item => item.type === "collabAgentToolCall" && item.tool === "spawnAgent");
      const threadId = spawned?.agentThreadId || spawned?.receiverThreadIds?.[0];
      if (!threadId) throw new Error("No worker was started: " + JSON.stringify(result.items.map(item => item.type)) + " " + result.reply.slice(0, 300));
      let worker;
      for (const deadline = Date.now() + 60000; Date.now() < deadline; await pause(1000)) {
        worker = await call("conversations.worker", { id, threadId });
        if ((worker.turns || []).some(turn => turn.status === "completed" && (turn.items || []).some(item => item.type === "agentMessage" && item.text))) break;
      }
      const reply = (worker.turns || []).flatMap(turn => turn.items || []).find(item => item.type === "agentMessage")?.text || "";
      if (!/Preview reply/.test(reply)) throw new Error("The worker didn't finish its task: " + JSON.stringify(worker).slice(0, 400));
      const other = await chat();
      const refused = await call("conversations.worker", { id: other, threadId }).then(() => false, () => true);
      if (!refused) throw new Error("Another conversation could read this worker.");
      return `a worker (${worker.name || "unnamed"}) ran its task and can be followed only from its own chat`;
    },
    async connectorSignIn() {
      const slack = (await call("integrations.list", {})).items.find(item => /slack/i.test(item.displayName));
      if (!slack) throw new Error("The preview Slack app is missing.");
      await call("integrations.beginConnect", { integrationId: slack.id });
      let window;
      for (const deadline = Date.now() + 20000; !window && Date.now() < deadline; await pause(500)) window = (await app.targets()).find(item => item.type === "page" && /example\.com\/\?timewarp-connect=1/.test(item.url));
      if (!window) throw new Error("The sign-in window didn't open.");
      // Composio sends the browser back to Timewarp's callback after approval.
      await app.evaluateIn(window, `location.href = "http://127.0.0.1:17654/connector-callback"`);
      for (const deadline = Date.now() + 15000; Date.now() < deadline; await pause(500)) {
        if (!(await app.targets()).some(item => item.id === window.id)) return "the sign-in opened in an app window with the browser profile and closed when it returned to Timewarp";
      }
      throw new Error("The sign-in window didn't close after the callback.");
    },
    async logFile() {
      await turn(await chat(), "A private note for the log check");
      const file = path.join(app.profile, "runtime", "logs", "main.log");
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      const tags = ["startup", "startup-timing", "codex:app-server", "turn"].filter(tag => !text.includes(`[${tag}]`));
      if (tags.length) throw new Error("The log file lacks: " + tags.join(", ") + "\n" + text.slice(-800));
      if (/correct-horse|ada@example\.com|Hello Ada|Hello, what can you do|A private note/.test(text)) throw new Error("The log file contains chat or vault content.");
      return `runtime/logs/main.log has ${text.split("\n").filter(Boolean).length} lines with start-up, Codex and turn records and no chat or vault content`;
    },
    async logs() {
      const diagnostics = await call("debug.diagnostics");
      const text = JSON.stringify(diagnostics);
      if (/correct-horse|ada@example\.com|Hello Ada/.test(text)) throw new Error("Diagnostics contain chat or vault content.");
      if (!diagnostics.log?.length && !diagnostics.state) throw new Error("Diagnostics are empty.");
      return `diagnostics hold ${diagnostics.log?.length || 0} log lines and no chat or vault content`;
    },
  };

  for (const [name, run] of Object.entries(scenarios)) {
    if (only.size && !only.has(name)) continue;
    const started = Date.now();
    try {
      const detail = await run();
      results.push({ name, ok: true, detail, ms: Date.now() - started });
      console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)} s): ${detail}`);
    } catch (error) {
      results.push({ name, ok: false, detail: error.message, ms: Date.now() - started });
      console.log(`FAIL ${name}: ${error.message}`);
    }
  }
  const problems = app.log().split("\n").filter(line => /\[timewarp\]|Error|error/.test(line) && !/DevTools|GPU|gpu|Autofill/.test(line)).slice(-25);
  if (problems.length) console.log("App log:\n" + problems.join("\n"));
  await app.close();
  server.close();
  const failed = results.filter(result => !result.ok);
  console.log(`${results.length - failed.length} of ${results.length} scenarios passed.`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
