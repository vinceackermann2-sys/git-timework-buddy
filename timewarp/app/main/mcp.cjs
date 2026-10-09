"use strict";
// MCP servers the user adds for their agents, kept in the profile's Codex
// config. Timewarp's own servers (named timewarp_*) are managed elsewhere.
const fail = (status, message) => Object.assign(new Error(message), { status });
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const RESERVED = /^timewarp/i;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function serverConfig(input) {
  if (input.transport === "http") {
    let url;
    try { url = new URL(String(input.url || "")); } catch { throw fail(400, "Enter the server's URL."); }
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw fail(400, "Use an HTTPS URL, or HTTP on this computer.");
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

// A server copied from another assistant's settings, limited to the settings
// Codex understands for MCP servers.
function importedConfig(input) {
  const strings = value => Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 50).map(item => item.slice(0, 4000)) : undefined;
  const map = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const out = {};
    for (const [key, item] of Object.entries(value)) if (ENV_KEY.test(key) || /^[A-Za-z0-9-]{1,64}$/.test(key)) { if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") out[key] = String(item).slice(0, 4000); }
    return Object.keys(out).length ? out : undefined;
  };
  const seconds = value => Number.isFinite(value) && value > 0 && value <= 3600 ? value : undefined;
  let config;
  if (typeof input?.url === "string") {
    const http = serverConfig({ transport: "http", url: input.url });
    config = { url: http.url, http_headers: map(input.http_headers), bearer_token_env_var: typeof input.bearer_token_env_var === "string" && ENV_KEY.test(input.bearer_token_env_var) ? input.bearer_token_env_var : undefined };
  } else if (typeof input?.command === "string" && input.command.trim()) {
    config = { command: input.command.trim().slice(0, 500), args: strings(input.args), env: map(input.env), env_vars: strings(input.env_vars)?.filter(name => ENV_KEY.test(name)), cwd: typeof input.cwd === "string" ? input.cwd.slice(0, 1000) : undefined };
  } else throw fail(400, "This server has no command or URL.");
  config.startup_timeout_sec = seconds(input.startup_timeout_sec);
  config.tool_timeout_sec = seconds(input.tool_timeout_sec);
  config.enabled_tools = strings(input.enabled_tools);
  config.disabled_tools = strings(input.disabled_tools);
  config.enabled = true;
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}
// Another assistant's server name as a name Timewarp accepts.
function importedName(name) {
  let value = String(name || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 40);
  if (RESERVED.test(value)) value = ("imported-" + value).slice(0, 40);
  return NAME.test(value) ? value : null;
}

function createMcp({ client, openExternal, notify = () => {} }) {
  const reload = () => client.request("config/mcpServer/reload", undefined);
  async function configured() {
    const read = await client.request("config/read", {});
    return read.config?.mcp_servers || {};
  }
  async function list() {
    const [servers, status] = await Promise.all([configured(), client.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 100 }).catch(() => ({ data: [] }))]);
    const statuses = new Map((status.data || []).map(item => [item.name, item]));
    return Object.entries(servers).filter(([name]) => !RESERVED.test(name)).map(([name, value]) => {
      const state = statuses.get(name);
      return {
        name, transport: value.url ? "http" : "stdio", url: value.url || null, command: value.command || null, args: value.args || [],
        envKeys: Object.keys(value.env || {}), enabled: value.enabled !== false, authStatus: state?.authStatus || "unknown",
        tools: state && !state.toolsError ? Object.keys(state.tools || {}).length : null, error: state?.toolsError || null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function write(keyPath, value) {
    await client.request("config/value/write", { keyPath, value, mergeStrategy: "replace" });
    await reload();
    notify("mcp.changed", {});
  }
  const known = async name => {
    if (!NAME.test(String(name || "")) || RESERVED.test(name)) throw fail(400, "Use 1–40 lowercase letters, numbers, - or _ for the name.");
    return Object.hasOwn(await configured(), name);
  };

  // Codex reports the end of a sign-in; the list refreshes then.
  client.on("notification", ({ method, params }) => {
    if (method === "mcpServer/oauthLogin/completed" && !RESERVED.test(params?.name || "")) notify("mcp.changed", { name: params.name, success: params.success, error: params.error || null });
  });

  return {
    list,
    // Copies servers from another assistant; existing names are left alone.
    async importServers(servers) {
      const current = await configured();
      const imported = [], skipped = [];
      for (const { name, config } of servers) {
        const target = importedName(name);
        if (!target) { skipped.push(`${name}: unsupported name`); continue; }
        if (Object.hasOwn(current, target) || imported.includes(target)) { skipped.push(`${name}: already added`); continue; }
        try {
          await client.request("config/value/write", { keyPath: `mcp_servers.${target}`, value: importedConfig(config), mergeStrategy: "replace" });
          imported.push(target);
        } catch (error) { skipped.push(`${name}: ${error.message}`); }
      }
      if (imported.length) { await reload(); notify("mcp.changed", {}); }
      return { imported, skipped };
    },
    async add(input) {
      if (await known(input.name)) throw fail(409, "A server with this name already exists.");
      await write(`mcp_servers.${input.name}`, serverConfig(input));
      return list();
    },
    async setEnabled(name, enabled) {
      if (!await known(name)) throw fail(404, "That server isn't configured.");
      await write(`mcp_servers.${name}.enabled`, !!enabled);
      return list();
    },
    async remove(name) {
      if (!await known(name)) throw fail(404, "That server isn't configured.");
      await write(`mcp_servers.${name}`, null);
      return list();
    },
    async signIn(name) {
      if (!await known(name)) throw fail(404, "That server isn't configured.");
      const { authorizationUrl } = await client.request("mcpServer/oauth/login", { name });
      await openExternal(authorizationUrl);
      return { opened: true };
    },
  };
}

module.exports = { createMcp, serverConfig, importedConfig, importedName };
