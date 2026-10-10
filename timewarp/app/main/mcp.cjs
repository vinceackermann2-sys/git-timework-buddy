"use strict";
// MCP servers the user adds for their agents, kept in the profile's Codex
// config. Timewarp's own servers (named timewarp_*) are managed elsewhere.
const fail = (status, message) => Object.assign(new Error(message), { status });
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const RESERVED = /^timewarp/i;
// Timewarp's browser, vault, automation and chat tools reach agents as MCP servers
// too (tool-server.cjs); they are part of the app, not servers to manage.
const INTERNAL = new Set(["timewarp_browser", "timewarp_vault", "timewarp_automations", "timewarp_chats"]);
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// Plain HTTP is fine for a server on this computer or the local network, as
// in the previous app: loopback and private addresses, and names without a dot
// or under .local, .lan, .home, .internal and the like.
const LOCAL_SUFFIXES = ["localhost", "local", "internal", "lan", "home", "home.arpa", "test", "invalid"];
function privateV4(host) {
  const [a, b] = host.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}
function localHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const kind = require("node:net").isIP(host);
  if (kind === 4) return privateV4(host);
  if (kind === 6) {
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host), hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (dotted) return privateV4(dotted[1]);
    if (hex) { const high = parseInt(hex[1], 16), low = parseInt(hex[2], 16); return privateV4([high >> 8, high & 255, low >> 8, low & 255].join(".")); }
    return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  return !!host && (!host.includes(".") || LOCAL_SUFFIXES.some(suffix => host === suffix || host.endsWith("." + suffix)));
}

function serverConfig(input) {
  if (input.transport === "http") {
    let url;
    try { url = new URL(String(input.url || "")); } catch { throw fail(400, "Enter the server's URL."); }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost(url.hostname))) throw fail(400, "Use an HTTPS URL, or HTTP on this computer or your local network.");
    if (url.username || url.password) throw fail(400, "Don't put credentials in the URL. Sign in after adding the server.");
    return { url: url.href, enabled: true };
  }
  if (input.transport === "stdio") {
    const command = String(input.command || "").trim();
    if (!command || command.length > 500) throw fail(400, "Enter the command that starts the server.");
    const args = (Array.isArray(input.args) ? input.args : []).map(String).filter(Boolean).slice(0, 50);
    const env = {};
    for (const [key, value] of Object.entries(input.env || {})) {
      if (!ENV_KEY.test(key)) throw fail(400, `"${key}" isn't a valid environment variable name.`);
      env[key] = String(value).slice(0, 4000);
    }
    return { command, args, ...(Object.keys(env).length ? { env } : {}), enabled: true };
  }
  throw fail(400, "Choose how Timewarp connects to the server.");
}

// ${NAME}, ${NAME:-fallback} and ${env:NAME} in another assistant's settings
// refer to environment variables; they aren't copied as text.
const PLACEHOLDER = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const ONLY_PLACEHOLDER = /^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$/;
// The text with its placeholders filled from env; missing lists those that aren't set.
function expand(text, env, missing) {
  return String(text).replace(PLACEHOLDER, (match, name, fallback) => {
    if (typeof env[name] === "string") return env[name];
    if (fallback !== undefined) return fallback;
    missing.push(name);
    return match;
  });
}

// A server copied from another assistant's settings, limited to the settings
// Codex understands for MCP servers: { config, notes }. A server turned off
// there comes over turned off. Placeholders stay references where Codex has
// a setting for one (env_vars, env_http_headers, bearer_token_env_var) and
// are filled in from this computer's environment otherwise. Servers that only
// speak SSE, which Codex doesn't, or that need a variable that isn't set for
// their command or URL, aren't imported (the error says why).
function importedServer(input, env = process.env) {
  const strings = value => Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 50).map(item => item.slice(0, 4000)) : undefined;
  const pairs = value => value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value).filter(([key, item]) => (ENV_KEY.test(key) || /^[A-Za-z0-9-]{1,64}$/.test(key)) && ["string", "number", "boolean"].includes(typeof item)).map(([key, item]) => [key, String(item).slice(0, 4000)])
    : [];
  const seconds = value => Number.isFinite(value) && value > 0 && value <= 3600 ? value : undefined;
  const notes = [];
  const required = (text, what) => {
    const missing = [], value = expand(text, env, missing);
    if (missing.length) throw fail(400, `its ${what} uses ${missing.map(name => "${" + name + "}").join(", ")}, which isn't set on this computer`);
    return value;
  };
  const transport = String(input?.type || input?.transport || "").toLowerCase();
  let config;
  if (typeof input?.url === "string") {
    const url = required(input.url, "URL");
    if (transport === "sse" || (!/^(?:http|streamable-?http)$/.test(transport) && /\/sse\/?$/i.test(new URL(url, "http://x").pathname))) throw fail(400, "it uses SSE, which Codex doesn't support; use its streamable HTTP address instead");
    const http = serverConfig({ transport: "http", url });
    const headers = {}, envHeaders = {};
    let bearer = typeof input.bearer_token_env_var === "string" && ENV_KEY.test(input.bearer_token_env_var) ? input.bearer_token_env_var : undefined;
    for (const [header, raw] of pairs(input.http_headers)) {
      const only = ONLY_PLACEHOLDER.exec(raw), bearerOnly = /^Bearer\s+\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$/i.exec(raw);
      if (only) envHeaders[header] = only[1];
      else if (bearerOnly && /^authorization$/i.test(header) && !bearer) bearer = bearerOnly[1];
      else {
        const missing = [], value = expand(raw, env, missing);
        if (missing.length) notes.push(`left out the ${header} header (set ${missing.join(", ")})`);
        else headers[header] = value;
      }
    }
    for (const [header, name] of pairs(input.env_http_headers)) if (ENV_KEY.test(name)) envHeaders[header] = name;
    config = { url: http.url, http_headers: Object.keys(headers).length ? headers : undefined, env_http_headers: Object.keys(envHeaders).length ? envHeaders : undefined, bearer_token_env_var: bearer };
  } else if (typeof input?.command === "string" && input.command.trim()) {
    if (transport === "sse") throw fail(400, "it uses SSE, which Codex doesn't support");
    const vars = new Set(strings(input.env_vars)?.filter(name => ENV_KEY.test(name)) || []), values = {};
    for (const [key, raw] of pairs(input.env)) {
      const only = ONLY_PLACEHOLDER.exec(raw);
      // NAME=${NAME} passes this computer's NAME through.
      if (only && only[1] === key && ENV_KEY.test(key)) { vars.add(key); continue; }
      const missing = [], value = expand(raw, env, missing);
      if (missing.length) notes.push(`left out ${key} (set ${missing.join(", ")})`);
      else if (ENV_KEY.test(key)) values[key] = value;
    }
    config = {
      command: required(input.command.trim(), "command").slice(0, 500), args: strings(input.args)?.map(arg => required(arg, "arguments")),
      env: Object.keys(values).length ? values : undefined, env_vars: vars.size ? [...vars] : undefined,
      cwd: typeof input.cwd === "string" ? required(input.cwd, "folder").slice(0, 1000) : undefined,
    };
  } else throw fail(400, "This server has no command or URL.");
  config.startup_timeout_sec = seconds(input.startup_timeout_sec);
  config.tool_timeout_sec = seconds(input.tool_timeout_sec);
  config.enabled_tools = strings(input.enabled_tools);
  config.disabled_tools = strings(input.disabled_tools);
  config.enabled = !(input.enabled === false || input.disabled === true);
  return { config: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)), notes };
}
const importedConfig = (input, env) => importedServer(input, env).config;
// Another assistant's server name as a name Timewarp accepts.
function importedName(name) {
  let value = String(name || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 40);
  if (RESERVED.test(value)) value = ("imported-" + value).slice(0, 40);
  return NAME.test(value) ? value : null;
}

// A command line as the user should see it before it runs.
const commandLine = (command, args = []) => [command, ...args].map(part => /[\s"]/.test(part) ? JSON.stringify(part) : part).join(" ");

// Asks in a native dialog before a command from the interface is added: it
// would run a program on this computer, so the interface alone can't add one.
async function nativeConfirm({ name, command, args, envKeys }) {
  const { dialog, BrowserWindow } = require("electron");
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  const detail = (commandLine(command, args) + (envKeys.length ? "\n\nEnvironment variables: " + envKeys.join(", ") : "")).slice(0, 3000);
  const options = { type: "warning", buttons: ["Add server", "Cancel"], defaultId: 1, cancelId: 1, noLink: true, title: "Add MCP server", message: `Add "${name}"? Timewarp will run this command on your computer:`, detail };
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return response === 0;
}

// Removes a server's saved sign-in with Codex's own command, for Codex
// versions without the app server's mcpServer/oauth/deleteTokens. It reads the
// server from the config, so it runs before the server is removed.
function codexLogout(client) {
  return name => new Promise(resolve => {
    if (!client.executable) return resolve(false);
    let child;
    try { child = require("node:child_process").spawn(client.executable, ["mcp", "logout", name], { env: { ...process.env, ...client.env }, stdio: "ignore", windowsHide: true }); }
    catch { return resolve(false); }
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 15000);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("exit", code => { clearTimeout(timer); resolve(code === 0); });
  });
}

// confirmCommand({ name, command, args, envKeys }) -> boolean: the native
// confirmation for a command added from the interface. logout(name): removes
// a server's sign-in when Codex's app server can't. env: for placeholders in imports.
function createMcp({ client, openExternal, notify = () => {}, confirmCommand = nativeConfirm, logout = codexLogout(client), env = process.env, log = () => {} }) {
  const reload = () => client.request("config/mcpServer/reload", undefined);
  async function configured() {
    const read = await client.request("config/read", {});
    return read.config?.mcp_servers || {};
  }
  // Why each server last failed to start, from Codex's startup reports:
  // { reason, error }. reason "reauthenticationRequired" means its sign-in
  // ran out and the user should sign in again.
  const failures = new Map();
  // Timewarp's own servers (connected apps) are listed only when asked, read-only.
  // Without status the list comes straight from the config; Codex's status can take seconds.
  async function list({ builtIn = false, status: withStatus = true } = {}) {
    const [servers, status] = await Promise.all([configured(), withStatus ? client.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 100 }).catch(() => ({ data: [] })) : { data: [] }]);
    const statuses = new Map((status.data || []).map(item => [item.name, item]));
    return Object.entries(servers).filter(([name]) => !INTERNAL.has(name) && (builtIn || !RESERVED.test(name))).map(([name, value]) => {
      const state = statuses.get(name), failure = failures.get(name) || null;
      return {
        name, builtIn: RESERVED.test(name), transport: value.url ? "http" : "stdio", url: value.url || null, command: value.command || null, args: value.args || [],
        envKeys: Object.keys(value.env || {}), enabled: value.enabled !== false, authStatus: state?.authStatus || "unknown",
        tools: state && !state.toolsError ? Object.keys(state.tools || {}).length : null, error: state?.toolsError || failure?.error || null,
        failureReason: failure?.reason || null, reauthenticationRequired: failure?.reason === "reauthenticationRequired",
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function write(keyPath, value) {
    await client.request("config/value/write", { keyPath, value, mergeStrategy: "replace" });
    await reload();
    notify("mcp.changed", {});
  }
  const taken = async name => {
    if (!NAME.test(String(name || "")) || RESERVED.test(name)) throw fail(400, "Use 1–40 lowercase letters, numbers, - or _ for the name.");
    return Object.hasOwn(await configured(), name);
  };
  // A configured server by its exact name. Servers added elsewhere, such as
  // the previous app's "GitHub" or "Context7", keep names Timewarp wouldn't
  // choose; they can still be turned on or off, signed in to and removed.
  async function existing(name) {
    const key = typeof name === "string" ? name : "";
    if (!key || RESERVED.test(key) || INTERNAL.has(key)) throw fail(400, "Timewarp manages this server.");
    const servers = await configured();
    if (!Object.hasOwn(servers, key)) throw fail(404, "That server isn't configured.");
    // Settings are written by a dotted path, which a dot in the name would break.
    if (key.includes(".")) throw fail(400, "Change this server in Codex's config.toml: its name has a dot.");
    return servers[key];
  }

  client.on("notification", ({ method, params }) => {
    if (method === "mcpServer/startupStatus/updated" && params?.name) {
      if (params.status === "ready") failures.delete(params.name);
      else if (params.status === "failed" || params.failureReason) {
        const before = failures.get(params.name)?.reason;
        failures.set(params.name, { reason: params.failureReason || "failed", error: params.error || null });
        if (before !== (params.failureReason || "failed") && !RESERVED.test(params.name)) notify("mcp.changed", { name: params.name });
      }
    }
    // Codex reports the end of a sign-in; the list refreshes then.
    if (method === "mcpServer/oauthLogin/completed" && params?.name) {
      if (params.success) failures.delete(params.name);
      if (!RESERVED.test(params.name)) notify("mcp.changed", { name: params.name, success: params.success, error: params.error || null });
    }
  });

  return {
    list,
    // Copies servers from another assistant; existing names are left alone.
    // skipped lists servers not imported and settings left out, with the reason.
    async importServers(servers) {
      const current = await configured();
      const imported = [], skipped = [];
      for (const { name, config } of servers) {
        const target = importedName(name);
        if (!target) { skipped.push(`${name}: unsupported name`); continue; }
        if (Object.hasOwn(current, target) || imported.includes(target)) { skipped.push(`${name}: already added`); continue; }
        try {
          const server = importedServer(config, env);
          await client.request("config/value/write", { keyPath: `mcp_servers.${target}`, value: server.config, mergeStrategy: "replace" });
          imported.push(target);
          for (const note of server.notes) skipped.push(`${name}: ${note}`);
        } catch (error) { skipped.push(`${name}: ${error.message}`); }
      }
      if (imported.length) { await reload(); notify("mcp.changed", {}); }
      return { imported, skipped };
    },
    async add(input) {
      if (await taken(input.name)) throw fail(409, "A server with this name already exists.");
      const config = serverConfig(input);
      if (config.command && !await confirmCommand({ name: input.name, command: config.command, args: config.args, envKeys: Object.keys(config.env || {}) })) throw fail(400, "The server wasn't added.");
      await write(`mcp_servers.${input.name}`, config);
      return list();
    },
    async setEnabled(name, enabled) {
      await existing(name);
      await write(`mcp_servers.${name}.enabled`, !!enabled);
      return list();
    },
    // Its saved sign-in goes too, so adding it again starts afresh.
    async remove(name) {
      const server = await existing(name);
      if (server.url) {
        try { await client.request("mcpServer/oauth/deleteTokens", { name, url: server.url }); }
        catch { if (!await logout(name)) log("The server's sign-in could not be removed:", name); }
      }
      await write(`mcp_servers.${name}`, null);
      failures.delete(name);
      return list();
    },
    async signIn(name) {
      const server = await existing(name);
      if (!server.url) throw fail(400, "This server doesn't use a sign-in.");
      const { authorizationUrl } = await client.request("mcpServer/oauth/login", { name });
      await openExternal(authorizationUrl);
      return { opened: true };
    },
  };
}

module.exports = { createMcp, serverConfig, importedConfig, importedServer, importedName, localHost };
