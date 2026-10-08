"use strict";
// JSON-RPC client for the OpenAI Codex app server (newline-delimited JSON over
// stdio). It matches the contract Timewarp's Codex modules use: request(),
// respond(), on('notification'|'request'|'status').
const { EventEmitter } = require("node:events");
const cp = require("node:child_process");
const readline = require("node:readline");

class CodexError extends Error {
  constructor(error, method) {
    super(error?.message || "Codex request failed.");
    this.code = error?.code;
    this.data = error?.data;
    this.rpcMessage = error?.message;
    this.method = method;
  }
}

class CodexClient extends EventEmitter {
  constructor({ executable, args = [], env = {}, cwd, clientInfo, spawn = cp.spawn, requestTimeoutMs = 120000 }) {
    super();
    this.setMaxListeners(100);
    Object.assign(this, { executable, args, env, cwd, clientInfo, spawnProcess: spawn, requestTimeoutMs });
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.starting = null;
    this.status = "stopped";
    this.info = null;
    this.stderr = "";
  }
  setStatus(status, detail = {}) {
    this.status = status;
    this.emit("status", { status, ...detail });
  }
  start() {
    if (this.status === "ready") return Promise.resolve(this.info);
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }
  async launch() {
    this.setStatus("starting");
    const child = this.spawnProcess(this.executable, ["app-server", ...this.args], {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stderr = "";
    child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-8000); });
    readline.createInterface({ input: child.stdout }).on("line", line => this.receive(line));
    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.once("error", error => this.fail(error));
    void exited.then(({ code, signal }) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectAll(new Error("Codex stopped."));
      this.setStatus(this.stopping ? "stopped" : "failed", { code, signal, stderr: this.stderr });
      this.stopping = false;
    });
    try {
      this.info = await this.call("initialize", { clientInfo: this.clientInfo, capabilities: { experimentalApi: true, requestAttestation: false } });
      this.write({ method: "initialized" });
    } catch (error) {
      await this.stop();
      throw error;
    }
    this.setStatus("ready", { info: this.info });
    return this.info;
  }
  fail(error) {
    this.rejectAll(error);
    if (this.status !== "failed") this.setStatus("failed", { error: error.message });
  }
  rejectAll(error) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
  }
  receive(line) {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && message.method) return this.emit("request", message);
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new CodexError(message.error, entry.method));
      else entry.resolve(message.result);
      return;
    }
    if (message.method) this.emit("notification", { method: message.method, params: message.params || {} });
  }
  write(message) {
    if (!this.child?.stdin.writable) throw new Error("Codex is not running.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  call(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`Codex did not answer ${method} in time.`), { status: 504 }));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async request(method, params) {
    await this.start();
    return this.call(method, params);
  }
  respond(id, result) { this.write({ id, result }); }
  respondError(id, message, code = -32000) { this.write({ id, error: { code, message } }); }
  // Codex starts helper processes that inherit its pipes. End the whole tree
  // this client started, then release the pipes so nothing outlives the app.
  stop() {
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = true;
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve));
    try { child.stdin.end(); } catch {}
    const tree = process.platform === "win32" && child.pid
      ? new Promise(resolve => cp.execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()))
      : Promise.resolve(child.kill());
    return Promise.all([exited, tree]).then(() => {
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
    });
  }
}

module.exports = { CodexClient, CodexError };
