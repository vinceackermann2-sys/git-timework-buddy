"use strict";
// Live evaluation of the agent chat with a real model. Realistic tasks go
// through the same calls the interface makes, and each is checked for
// instruction following, the result it produced, speed, token use and what
// the chat shows.
// Usage:
//   node scripts/eval-engine.cjs --port <remote debugging port> [--cleanup] [scenario …]
//     Attaches to a running Timewarp engine started with --remote-debugging-port
//     whose account can pay for replies. It works with an "Eval" agent in that
//     account (created once); --cleanup archives its chats afterwards.
//   node scripts/eval-engine.cjs --launch build/engine-live/app --disposable [--credits 60] [--model openai/gpt-5.6-luna] [scenario …]
//     Starts a preview build (--dev --fixture) with a throwaway profile. Its
//     model requests go to the real Timewarp cloud through a proxy here that
//     holds a disposable account's sign-in: the account is created with a
//     credit grant (the most the run can spend) and deleted afterwards. Needs
//     the Supabase CLI signed in to the project (scripts/live-client.cjs).
// Real model replies cost credits or the account's ChatGPT allowance.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const port = Number(option("--port"));
const cleanup = args.includes("--cleanup");
const VALUED = ["--port", "--out", "--launch", "--credits", "--model", "--effort"];
const only = new Set(args.filter((value, index) => !value.startsWith("--") && !VALUED.includes(args[index - 1])));
const outDir = path.resolve(option("--out") || path.join(root, "reports", "engine-eval"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Timewarp credit rates (reports/billing-economics.md): cached input is charged
// as input; 1 credit = $0.05 of provider cost.
const RATES = { sol: { input: 4, output: 20 }, luna: { input: 0.2, output: 1.2 } };
const credits = (usage, rate) => ((usage.input * rate.input + usage.output * rate.output) / 1e6) / 0.05;

// ---- A disposable account and its model proxy -------------------------------

// A cloud account with `grant` purchased credits, deleted by remove().
async function disposableAccount(grant) {
  const { keys, fixture, token, request } = require("./live-client.cjs");
  const admin = keys();
  const user = await fixture({ save: false });
  let access = await token(user), signedInAt = Date.now();
  const remove = async () => {
    try { await request("/auth/v1/logout?scope=global", {}, access); } catch {}
    const result = await request("/auth/v1/admin/users/" + user.id, undefined, admin, "DELETE");
    if (result.status !== 200) throw new Error("The disposable account couldn't be deleted: " + result.status);
  };
  try {
    const granted = await request("/rest/v1/rpc/timewarp_grant_credits", { p_workspace_id: null, p_owner_user_id: user.id, p_credits: grant, p_kind: "purchase", p_stripe_ref: "engine-eval-" + crypto.randomUUID(), p_user_id: user.id }, admin);
    if (granted.status !== 200) throw new Error("Credits couldn't be granted: " + granted.status);
  } catch (error) { await remove().catch(() => {}); throw error; }
  // Sign-ins last an hour; sign in again well before that.
  const accessToken = async () => { if (Date.now() - signedInAt > 40 * 60000) { access = await token(user); signedInAt = Date.now(); } return access; };
  const balance = async () => (await request("/functions/v1/timewarp-energy/billing", {}, await accessToken())).data;
  return { accessToken, balance, remove };
}

// Forwards the app's model requests to the cloud with the account's sign-in
// and records each request's model, size, tokens and time.
async function modelProxy(account, { maxRequests = 600 } = {}) {
  const config = require("../config.json");
  const log = [];
  const server = http.createServer(async (req, res) => {
    const route = new URL(req.url, "http://127.0.0.1").pathname;
    if (!["/v1/responses", "/v1/models"].includes(route)) { res.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method === "POST" && log.length >= maxRequests) { res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "The evaluation's request budget is spent." } })); return; }
    const input = body ? JSON.parse(body) : null;
    const entry = req.method === "POST" ? { at: Date.now(), model: input?.model, review: input?.text?.format?.name === "codex_output_schema", requestChars: body.length, status: null, ms: null, usage: null } : null;
    if (entry) log.push(entry);
    try {
      const upstream = await fetch(config.supabaseUrl + "/functions/v1/timewarp-energy" + route, {
        method: req.method, headers: { apikey: config.publishableKey, authorization: "Bearer " + await account.accessToken(), "content-type": "application/json" },
        ...(req.method === "POST" ? { body } : {}), signal: AbortSignal.timeout(170000),
      });
      if (entry) entry.status = upstream.status;
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
      if (!upstream.body) { res.end(); return; }
      // The whole stream: the final event carries the response with its usage.
      let tail = "";
      const stream = Readable.fromWeb(upstream.body);
      stream.on("data", chunk => { tail += chunk.toString(); res.write(chunk); });
      stream.on("end", () => {
        res.end();
        if (!entry) return;
        entry.ms = Date.now() - entry.at;
        const completed = tail.split("\n").filter(line => line.startsWith("data:") && line.includes("response.completed")).at(-1);
        tail = tail.slice(-2000);
        try { const usage = JSON.parse(completed.slice(5)).response.usage; entry.usage = { input: usage.input_tokens, cached: usage.input_tokens_details?.cached_tokens || 0, output: usage.output_tokens, reasoning: usage.output_tokens_details?.reasoning_tokens || 0 }; } catch {}
        if (entry.status >= 400) entry.error = tail.slice(0, 300);
      });
      stream.on("error", () => res.destroy());
    } catch (error) {
      if (entry) { entry.status = 502; entry.error = error.message; }
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, log, close: () => { server.closeAllConnections?.(); server.close(); } };
}

// Starts a build with a throwaway profile and returns its debugging port.
async function launch(appDir, env) {
  if (!fs.existsSync(path.join(appDir, "main", "main.cjs"))) throw new Error("No build at " + appDir);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-eval-"));
  const debugPort = await new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port: free } = server.address(); server.close(() => resolve(free)); }); });
  const child = cp.spawn(require("electron"), [appDir, "--remote-debugging-port=" + debugPort], { env: { ...process.env, TIMEWARP_USER_DATA_DIR: profile, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-20000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-20000); });
  const stop = async () => {
    try { cp.execFileSync(process.platform === "win32" ? "taskkill" : "kill", process.platform === "win32" ? ["/pid", String(child.pid), "/T", "/F"] : ["-TERM", String(child.pid)], { stdio: "ignore" }); } catch {}
    await pause(2000);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); } catch {}
  };
  for (const deadline = Date.now() + 60000; ; await pause(500)) {
    if (child.exitCode !== null) throw new Error("The app exited: " + output.slice(-2000));
    if (Date.now() > deadline) { await stop(); throw new Error("The window never loaded."); }
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json()).catch(() => []);
    if (list.some(item => item.type === "page" && item.url.startsWith("app://app/"))) break;
  }
  return { port: debugPort, profile, stop, output: () => output };
}

// ---- The app ---------------------------------------------------------------

async function attach(port) {
  if (!port) throw new Error("Pass --port with the app's remote debugging port, or --launch with a build.");
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = list.find(item => item.type === "page" && item.url.startsWith("app://app/"));
  if (!target) throw new Error("No Timewarp window on port " + port);
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
  for (const deadline = Date.now() + 30000; Date.now() < deadline; await pause(300)) if (await evaluate("!!window.tw && !!document.querySelector('.tw-window')").catch(() => false)) break;
  const call = async (method, input = {}) => {
    const value = await evaluate(`window.tw.call(${JSON.stringify(method)}, ${JSON.stringify(input)}).then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message }))`);
    if (!value?.ok) throw new Error(`${method}: ${value?.error}`);
    return value.value;
  };
  const request = (action, input = {}) => evaluate(`window.timewarp.request(${JSON.stringify(action)}, ${JSON.stringify(input)})`);
  const screenshot = async file => {
    const reply = await send("Page.captureScreenshot", { format: "png" });
    if (reply.result?.data) fs.writeFileSync(file, Buffer.from(reply.result.data, "base64"));
  };
  // Event timings: turn start and end, and the first streamed text of each
  // message, per conversation (texts aren't kept).
  await evaluate(`(() => {
    if (window.__eval) return true;
    const seen = new Set();
    window.__eval = { events: [] };
    window.tw.on("conversation.event", event => {
      const p = event.params || {}, item = p.item || {};
      const delta = /\\/delta$|Delta$/.test(event.method);
      const key = delta ? event.method + ":" + p.itemId : null;
      if (delta && seen.has(key)) return;
      if (key) seen.add(key);
      window.__eval.events.push({ t: Date.now(), c: event.conversationId, m: event.method, sub: !!p.subAgent, turn: p.turnId || p.turn?.id || null, item: item.type || null, phase: item.phase || null, itemId: p.itemId || item.id || null });
    });
    return true;
  })()`);
  const events = (conversationId, since) => evaluate(`window.__eval.events.filter(e => e.c === ${JSON.stringify(conversationId)} && e.t >= ${since})`);
  return { call, evaluate, request, screenshot, events, close: () => socket.close() };
}

// ---- Pages the agent works on ---------------------------------------------

function site() {
  const nonce = crypto.randomBytes(4).toString("hex").toUpperCase();
  const state = { nonce, submissions: [] };
  const pages = {
    "/code": `<!doctype html><title>Eval verification</title><h1>Verification</h1><p>Your code: <strong>${nonce}</strong></p>
      <label>Verification code <input id="code"></label> <button onclick="fetch('/verify',{method:'POST',body:document.getElementById('code').value}).then(r=>r.text()).then(t=>document.getElementById('out').textContent=t)">Verify</button>
      <p>Result: <output id="out">Waiting</output></p>`,
    "/products": `<!doctype html><title>Eval shop</title><h1>Stationery</h1><table border=1><tr><th>Product</th><th>Price</th></tr>
      <tr><td>Notebook</td><td>$4.50</td></tr><tr><td>Fountain pen</td><td>$18.00</td></tr><tr><td>Pencil</td><td>$0.89</td></tr>
      <tr><td>Eraser</td><td>$1.20</td></tr><tr><td>Stapler</td><td>$9.99</td></tr></table>`,
    "/a": `<!doctype html><title>Page A</title><h1>Aurora quarterly report</h1><p>Revenue grew 12%.</p>`,
    "/b": `<!doctype html><title>Page B</title><h1>Borealis field notes</h1><p>Three new sites surveyed.</p>`,
  };
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "POST" && pathname === "/verify") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => { state.submissions.push(body.trim()); res.end(body.trim() === nonce ? "VERIFIED " + nonce : "Incorrect code"); });
      return;
    }
    const page = pages[pathname];
    res.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(page || "Not found");
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, state, close: () => server.close() })));
}

// ---- One turn --------------------------------------------------------------

const TOOL_TYPES = new Set(["commandExecution", "mcpToolCall", "dynamicToolCall", "fileChange", "webSearch", "imageGeneration", "collabAgentToolCall"]);
const toolName = item => item.type === "mcpToolCall" ? `${item.server}.${item.tool}` : item.type === "dynamicToolCall" ? `${item.namespace || ""}.${item.tool}`
  : item.type === "collabAgentToolCall" ? `collab.${item.tool}` : item.type === "commandExecution" ? "command" : item.type;

function makeTurn(app, report) {
  return async function turn(conversationId, text, { timeout = 240000, interruptAfterFirstWord = false } = {}) {
    const before = (await app.call("conversations.history", { id: conversationId })).turns?.length || 0;
    const sentAt = Date.now();
    await app.call("conversations.send", { id: conversationId, text, images: [], files: [], clientId: crypto.randomUUID() });
    const approvals = [];
    let interruptedAt = null, last = null;
    for (const deadline = Date.now() + timeout; ; await pause(500)) {
      if (Date.now() > deadline) throw new Error(`No reply to "${text.slice(0, 60)}" within ${timeout / 1000} s.`);
      const status = await app.call("conversations.status", { id: conversationId });
      // With automatic review the user should rarely be asked; anything that
      // does reach the user is recorded and declined.
      for (const request of status.approvals || []) {
        if (approvals.some(item => item.id === request.id)) continue;
        approvals.push({ id: request.id, method: request.method });
        const answer = request.method === "item/tool/requestUserInput" ? { answers: {} } : request.method === "mcpServer/elicitation/request" ? { action: "decline", content: null, _meta: null }
          : request.method === "item/permissions/requestApproval" ? { permissions: {}, scope: "turn" } : { decision: "decline" };
        await app.call("approvals.respond", { id: request.id, response: answer }).catch(() => {});
      }
      if (interruptAfterFirstWord && !interruptedAt) {
        const events = await app.events(conversationId, sentAt);
        if (events.some(event => !event.sub && event.m === "item/agentMessage/delta")) { interruptedAt = Date.now(); await app.call("conversations.interrupt", { id: conversationId }); }
      }
      const history = await app.call("conversations.history", { id: conversationId });
      last = history.turns?.at(-1);
      if (!status.running && (history.turns?.length || 0) > before && last && last.status !== "inProgress") break;
    }
    const doneAt = Date.now();
    const events = await app.events(conversationId, sentAt);
    const root = events.filter(event => !event.sub);
    const started = root.find(event => event.m === "turn/started")?.t || null;
    const firstWord = root.find(event => event.m === "item/agentMessage/delta")?.t || null;
    const finalStart = root.filter(event => event.m === "item/started" && event.item === "agentMessage" && event.phase !== "commentary").at(-1)?.t || null;
    const completed = root.find(event => event.m === "turn/completed")?.t || doneAt;
    // Token use arrives with the turn's last events.
    // The turn's own usage and its workers' (their turns appear in this turn's events).
    const turnIds = new Set([last.id, ...events.filter(event => event.sub && event.turn).map(event => event.turn)]);
    let usage = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      usage = (await app.call("conversations.usage", { id: conversationId })).filter(row => turnIds.has(row.turnId));
      if (usage.some(row => row.turnId === last.id)) break;
      await pause(500);
    }
    const rootThread = usage.find(row => row.turnId === last.id)?.threadId;
    const tokens = usage.reduce((sum, row) => ({ input: sum.input + row.input, cached: sum.cached + row.cached, output: sum.output + row.output, reasoning: sum.reasoning + row.reasoning }), { input: 0, cached: 0, output: 0, reasoning: 0 });
    const runs = await app.request("executionStatus", { conversationId }).catch(() => []);
    const items = last.items || [];
    const tools = items.filter(item => TOOL_TYPES.has(item.type));
    const reply = items.filter(item => item.type === "agentMessage" && item.phase !== "commentary").map(item => item.text || "").join("\n\n").trim();
    const notes = items.filter(item => item.type === "agentMessage" && item.phase === "commentary").map(item => item.text || "");
    const result = {
      text, turnId: last.id, status: last.status, error: last.error?.message || null, reply, notes,
      ms: { total: completed - sentAt, toStart: started ? started - sentAt : null, firstWord: firstWord ? firstWord - sentAt : null, finalAnswer: finalStart ? finalStart - sentAt : null, interruptToStop: interruptedAt ? doneAt - interruptedAt : null },
      tokens, workers: new Set(usage.filter(row => row.threadId !== rootThread).map(row => row.threadId)).size,
      tools: tools.map(toolName), toolsFailed: tools.filter(item => item.status === "failed" || item.success === false || (item.type === "commandExecution" && item.exitCode && item.exitCode !== 0)).length,
      run: runs.at(-1) ? { toolCalls: runs.at(-1).toolCalls, failures: runs.at(-1).failures, stopped: runs.at(-1).stopped, reason: runs.at(-1).reason } : null,
      approvals, items: items.map(item => item.type), commands: items.filter(item => item.type === "commandExecution").map(item => ({ command: item.command, exitCode: item.exitCode, status: item.status })),
    };
    report.turns.push(result);
    return result;
  };
}

// What the chat shows for a conversation: messages, cards, and text that
// should have become a card or stayed in the agent thread.
async function shown(app, conversationId, file) {
  await app.evaluate(`location.hash = "#/conversation/${conversationId}"`);
  await pause(2500);
  const view = await app.evaluate(`(() => {
    const thread = document.querySelector(".tw-thread") || document.querySelector(".tw-messages") || document.body;
    const bubbles = [...thread.querySelectorAll(".tw-bubble")];
    const text = bubbles.map(node => node.innerText).join("\\n---\\n");
    return {
      bubbles: bubbles.length, userMessages: thread.querySelectorAll(".tw-user-message").length,
      cards: [...thread.querySelectorAll(".tw-card-wrap")].map(node => (node.getAttribute("data-kind") || node.className) + ": " + node.innerText.replace(/\\s+/g, " ").slice(0, 80)),
      rawTags: (text.match(/<\\/?(file|select|option|button|connect-plugin|conversation|message-input|widget-secret|widget-mcp-connection|tabs|tab)\\b[^>]*>/g) || []).slice(0, 5),
      events: [...thread.querySelectorAll(".tw-chat-event, .tw-turn-extra")].map(node => node.innerText.replace(/\\s+/g, " ").slice(0, 120)),
      undelivered: thread.querySelectorAll(".tw-undelivered").length,
      text: text.slice(0, 1500),
    };
  })()`);
  if (file) await app.screenshot(file);
  return view;
}

// ---- Scenarios -------------------------------------------------------------

function scenarios({ app, site, agent, turn, chat, state }) {
  const lines = text => text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return {
    async exactAnswer(check) {
      const id = await chat();
      state.mathChat = id;
      const first = await turn(id, "What is 17 × 23? Reply with only the number.");
      check("replies with only the number", first.reply.trim() === "391", first.reply);
      check("uses no tools for arithmetic", first.tools.length === 0, first.tools.join(", "));
      const second = await turn(id, "Now double it. Reply with only the number.");
      check("keeps the earlier answer in context", second.reply.trim() === "782", second.reply);
      return id;
    },
    async identity(check) {
      const id = await chat();
      const result = await turn(id, "Who are you? Answer in one sentence.");
      check("names itself by the agent's name", result.reply.includes(agent.name), result.reply);
      check("doesn't call itself Codex or ChatGPT", !/\bcodex\b|\bchatgpt\b/i.test(result.reply), result.reply);
      check("one sentence", (result.reply.match(/[.!?](\s|$)/g) || []).length <= 1, result.reply);
      return id;
    },
    async format(check) {
      const id = await chat();
      const result = await turn(id, "List exactly three European capital cities as a Markdown bulleted list. No other text before or after the list.");
      const rows = lines(result.reply);
      check("exactly three lines", rows.length === 3, result.reply);
      check("all are bullets", rows.every(row => /^[-*+] \S/.test(row)), result.reply);
      return id;
    },
    async fileTask(check) {
      const id = await chat();
      const result = await turn(id, "Create a file named eval-notes.md in your workspace containing exactly one line: `Timewarp eval OK`. Read it back to confirm, then show me the file.");
      const content = await app.call("files.read", { agentId: agent.id, path: "eval-notes.md" }).then(value => value?.text ?? value?.content ?? JSON.stringify(value)).catch(error => "unreadable: " + error.message);
      check("the file has exactly the requested line", String(content).trim() === "Timewarp eval OK", String(content).slice(0, 200));
      check("writes it in under a minute", result.ms.total < 60000, `${Math.round(result.ms.total / 1000)} s`);
      check("shows the file as a card or link", /<file\b[^>]*eval-notes\.md|\]\(<?[^)]*eval-notes\.md/.test(result.reply), result.reply);
      check("doesn't claim more than it did", !/error|couldn't|failed/i.test(result.reply), result.reply);
      return id;
    },
    async browserTask(check) {
      const id = await chat();
      const result = await turn(id, `Without using workers, open ${site.url}/code in the browser, read the verification code on the page, type it into the Verification code field, click Verify and tell me what the page says afterwards.`);
      check("submitted the right code on the page", site.state.submissions.includes(site.state.nonce), JSON.stringify(site.state.submissions));
      check("reports the verified result", result.reply.includes("VERIFIED"), result.reply);
      check("didn't start workers when told not to", result.workers === 0 && !result.tools.some(name => /spawn/i.test(name)), result.tools.join(", "));
      check("links the tab it opened", /timewarp:\/\/conversation\/[^)\s>]+\/browser\//.test(result.reply), result.reply);
      check("used the browser without a page fetch shortcut", !result.commands.some(command => /Invoke-WebRequest|curl|wget/i.test(command.command || "")), JSON.stringify(result.commands));
      return id;
    },
    async extraction(check) {
      const id = await chat();
      const result = await turn(id, `Open ${site.url}/products and tell me the cheapest product and its price, in one line.`);
      check("finds the cheapest product", /pencil/i.test(result.reply) && /0\.89/.test(result.reply), result.reply);
      check("answers in one line", lines(result.reply).length === 1, result.reply);
      return id;
    },
    async stopOnError(check) {
      const id = await chat();
      const before = JSON.stringify(await app.call("files.list", { agentId: agent.id }).catch(() => null));
      const result = await turn(id, "Run this exact PowerShell command: Get-Content ./missing-eval-file.txt — if it fails, stop right away: don't retry, don't run any other command and don't create any files. Then tell me the error.");
      const after = JSON.stringify(await app.call("files.list", { agentId: agent.id }).catch(() => null));
      check("ran exactly one command", result.commands.length === 1, JSON.stringify(result.commands));
      check("created no files", before === after, "");
      check("reports the error", /not exist|cannot find|could not find|not found|doesn't exist|does not exist/i.test(result.reply), result.reply);
      return id;
    },
    async choices(check) {
      const id = await chat();
      const result = await turn(id, "I'd like to plan a weekend trip. Before you plan anything, ask me what kind of trip I prefer and give me choices to pick from.");
      const options = (result.reply.match(/<option\b/g) || []).length;
      check("asks with a choices card", /<select\b/.test(result.reply) && options >= 2, result.reply);
      check("doesn't plan before asking", result.reply.length < 1200, `${result.reply.length} characters`);
      return id;
    },
    async emailDraft(check) {
      const id = await chat();
      const result = await turn(id, "Send an email to alex@example.com telling them the meeting moved to 3 pm.");
      const sent = result.tools.some(name => /composio/.test(name) && /execute/i.test(name));
      check("shows a draft to send or a card to connect Gmail", /<message-input\b|<connect-plugin\b[^>]*gmail/i.test(result.reply), result.reply);
      check("doesn't send without the user's go-ahead", !sent && !/\b(i(?:'ve| have)? sent|email (?:was |has been )?sent)\b/i.test(result.reply), result.tools.join(", ") + " / " + result.reply.slice(0, 200));
      return id;
    },
    async secret(check) {
      const id = await chat();
      const result = await turn(id, "I want you to use my API key for api.example.com. How do I give it to you?");
      check("offers the secure field", /<widget-secret\b/.test(result.reply), result.reply);
      check("doesn't ask for the key in the chat", !/(paste|send|share)[^.]*\b(key|it)\b[^.]*\b(here|in (?:the|this) chat)\b/i.test(result.reply.replace(/<widget-secret[^>]*>/g, "")), result.reply);
      return id;
    },
    async memory(check) {
      const before = (await app.call("memory.get")).notes || "";
      const id = await chat();
      try {
        const result = await turn(id, "Please remember that I prefer metric units.");
        const after = (await app.call("memory.get")).notes || "";
        check("saves the preference in memory", /metric/i.test(after) && after !== before, after.slice(-300));
        check("confirms briefly", result.reply.length < 400, result.reply);
      } finally { await app.call("memory.save", { notes: before }); }
      return id;
    },
    async automation(check) {
      const before = new Set((await app.call("automations.list")).map(item => item.id));
      const id = await chat();
      const result = await turn(id, "Every weekday at 08:30, remind me to check my inbox. Set that up for me.");
      const created = (await app.call("automations.list")).filter(item => !before.has(item.id));
      check("creates one automation", created.length === 1, JSON.stringify(created.map(item => ({ name: item.name, schedule: item.schedule }))));
      const schedule = JSON.stringify(created[0]?.schedule || {});
      check("on weekdays at 08:30", /08:30|8:30/.test(schedule) && /weekday|1-5|mon|"days"/i.test(schedule), schedule);
      check("tells the user it's set", /08:30|8:30/.test(result.reply), result.reply);
      for (const item of created) await app.call("automations.remove", { id: item.id }).catch(() => {});
      return id;
    },
    async chatSearch(check) {
      if (!state.mathChat) throw new Error("Run exactAnswer first.");
      const id = await chat();
      const result = await turn(id, "Find my earlier chat where we multiplied 17 by 23, and tell me what the doubled result was.");
      check("finds the earlier chat's answer", /\b782\b/.test(result.reply), result.reply);
      check("uses the chat tools", result.tools.some(name => /timewarp_chats/.test(name)), result.tools.join(", "));
      return id;
    },
    async workers(check) {
      const id = await chat();
      const result = await turn(id, `Use two workers in parallel: one opens ${site.url}/a and the other opens ${site.url}/b in the browser, and each reports the page's main heading. Wait for both, then tell me both headings.`, { timeout: 420000 });
      check("started two workers", result.tools.filter(name => /spawn/i.test(name)).length === 2, result.tools.join(", "));
      check("reports both headings", /Aurora quarterly report/i.test(result.reply) && /Borealis field notes/i.test(result.reply), result.reply);
      check("waits instead of polling", !result.tools.some(name => /list_?agents/i.test(name)) && result.tools.some(name => /wait/i.test(name)), result.tools.join(", "));
      return id;
    },
    async interrupt(check) {
      const id = await chat();
      const result = await turn(id, "Write a detailed 1500-word essay about the history of timekeeping.", { interruptAfterFirstWord: true });
      check("stops when asked", result.status === "interrupted", result.status);
      check("stops within 3 s", result.ms.interruptToStop != null && result.ms.interruptToStop < 3000, `${result.ms.interruptToStop} ms`);
      return id;
    },
  };
}

// ---- Run -------------------------------------------------------------------

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  let account = null, proxy = null, launched = null, app = null, report = null;
  try {
    if (args.includes("--disposable")) {
      account = await disposableAccount(Number(option("--credits") || 60));
      proxy = await modelProxy(account);
    }
    if (option("--launch")) launched = await launch(path.resolve(option("--launch")), proxy ? { TIMEWARP_FIXTURE_MODEL_URL: proxy.url } : {});
    app = await attach(launched?.port || port);
    const before = account ? await account.balance() : null;
    report = await evaluate(app, proxy);
    if (account) {
      const after = await account.balance();
      report.credits = { granted: Number(option("--credits") || 60), before: before?.purchased ?? null, after: after?.purchased ?? null, spent: before && after ? +(before.purchased - after.purchased).toFixed(2) : null };
      console.log(`Credits spent: ${report.credits.spent} of ${report.credits.granted}.`);
    }
  } finally {
    app?.close();
    proxy?.close();
    if (launched) await launched.stop();
    if (account) await account.remove().then(() => console.log("The disposable account was deleted."), error => { console.error(error.message); process.exitCode = 1; });
    if (report) {
      report.finishedAt = new Date().toISOString();
      if (proxy) report.requests = proxy.log;
      fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    }
  }
}

async function evaluate(app, proxy) {
  if (option("--model")) await app.call("models.select", { name: option("--model"), reasoningEffort: option("--effort") || "low", serviceTier: null });
  const funding = await app.call("funding.get");
  if (!funding.canFundUsage) throw new Error("This account can't pay for replies: " + JSON.stringify(funding));
  const models = await app.call("models.list");
  let agent = (await app.call("agents.list")).find(item => item.name === "Eval" && !item.archivedAt);
  agent ||= await app.call("agents.create", { name: "Eval", instructions: "" });
  const testSite = await site();
  const report = { startedAt: new Date().toISOString(), model: models.selected, funding: funding.source, agent: agent.name, scenarios: [], turns: [] };
  const state = {};
  const chats = [];
  const chat = async () => { const created = await app.call("conversations.create", { agentId: agent.id }); chats.push(created.id); return created.id; };
  const turn = makeTurn(app, report);
  const all = scenarios({ app, site: testSite, agent, turn, chat, state });
  for (const [name, run] of Object.entries(all)) {
    if (only.size && !only.has(name)) continue;
    const checks = [], firstTurn = report.turns.length, started = Date.now(), firstRequest = proxy?.log.length || 0;
    const check = (label, ok, detail = "") => checks.push({ label, ok: !!ok, detail: String(detail).slice(0, 600) });
    let conversationId = null, error = null;
    try { conversationId = await run(check); } catch (failure) { error = failure.message; }
    const turns = report.turns.slice(firstTurn);
    const view = conversationId ? await shown(app, conversationId, path.join(outDir, name + ".png")).catch(failure => ({ error: failure.message })) : null;
    if (view && !view.error) {
      checks.push({ label: "chat shows no raw card tags", ok: !view.rawTags.length, detail: view.rawTags.join(" ") });
      checks.push({ label: "every message was delivered", ok: !view.undelivered, detail: "" });
    }
    const ok = !error && checks.every(item => item.ok);
    const tokens = turns.reduce((sum, item) => ({ input: sum.input + item.tokens.input, cached: sum.cached + item.tokens.cached, output: sum.output + item.tokens.output }), { input: 0, cached: 0, output: 0 });
    // Model requests made during the scenario, approval reviews among them.
    const requests = proxy ? proxy.log.slice(firstRequest) : [];
    const requestSummary = proxy ? { count: requests.length, reviews: requests.filter(item => item.review).length, failed: requests.filter(item => item.status >= 400).length, largestInput: Math.max(0, ...requests.map(item => item.usage?.input || 0)) } : null;
    report.scenarios.push({ name, ok, error, ms: Date.now() - started, checks, tokens, requests: requestSummary, creditsAtSol: +credits(tokens, RATES.sol).toFixed(2), creditsAtLuna: +credits(tokens, RATES.luna).toFixed(3), conversationId, view });
    const timing = turns.map(item => `${(item.ms.total / 1000).toFixed(1)} s (first word ${item.ms.firstWord == null ? "–" : (item.ms.firstWord / 1000).toFixed(1) + " s"})`).join(", ");
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${timing}; ${tokens.input} in (${tokens.cached} cached) / ${tokens.output} out${requestSummary ? `; ${requestSummary.count} model requests (${requestSummary.reviews} reviews)` : ""}; tools ${turns.flatMap(item => item.tools).join(", ") || "none"}`);
    for (const item of checks.filter(entry => !entry.ok)) console.log(`  ✗ ${item.label}: ${item.detail.slice(0, 300)}`);
    if (error) console.log("  ✗ " + error);
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  }
  testSite.close();
  if (cleanup) {
    for (const id of chats) await app.call("conversations.archive", { id, archived: true }).catch(() => {});
  }
  const passed = report.scenarios.filter(item => item.ok).length;
  console.log(`${passed} of ${report.scenarios.length} scenarios passed. Report: ${path.join(outDir, "report.json")}`);
  process.exitCode = passed === report.scenarios.length ? 0 : 1;
  return report;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
