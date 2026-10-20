// The real Agent ID service on embedded Postgres (timewarp/scripts/agent-id-
// local.cjs), served over HTTP on a random port, plus helpers to run the CLI
// against it. Kept out of test/ so `node --test` doesn't run it as a test.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'cli', 'bin', 'timewarp-id.js');
const LOCAL = process.env.AGENT_ID_LOCAL || path.join(ROOT, '..', 'timewarp', 'scripts', 'agent-id-local.cjs');

export async function startApi({ env = {} } = {}) {
  const { startLocal } = createRequire(import.meta.url)(LOCAL);
  let local = null;
  // Every request, for tests to check what the CLI sent.
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    let parsed = null;
    try { parsed = body.length ? JSON.parse(body.toString('utf8')) : null; } catch { /* not JSON */ }
    const entry = { method: req.method, path: new URL(req.url, 'http://x').pathname.replace(/^\/agent-id/, ''), headers: req.headers, body: parsed, status: null };
    requests.push(entry);
    try {
      const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
        ...(body.length && !['GET', 'HEAD'].includes(req.method) ? { body } : {}),
      });
      const response = await local.handle(request);
      entry.status = response.status;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'internal', message: error.message } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/agent-id`;
  local = await startLocal({ publicUrl: base, env: { SUPABASE_URL: `http://127.0.0.1:${port}`, ...env } });

  // A JSON request; throws on an error answer unless `expect` says otherwise.
  async function call(method, url, { token, body, expect } = {}) {
    const result = await local.call(method, url, { token, body });
    if (expect === undefined ? result.status >= 400 : result.status !== expect) {
      throw new Error(`${method} ${url} → ${result.status} ${JSON.stringify(result.body)}`);
    }
    return result.body;
  }

  return {
    local, base, port, call, requests,
    async ownerKey(user) { return (await call('POST', '/v1/keys', { token: user.session, body: { name: 'test' } })).secret; },
    async close() {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
      await local.close();
    },
  };
}

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-id-${prefix}-`));
}

// An environment that keeps the CLI away from the real home folder and tools.
export function cliEnv(base, dirs, extra = {}) {
  const env = { ...process.env };
  // Including what says which tool the CLI runs in (these tests may run inside one).
  for (const name of ['TIMEWARP_AGENT_KEY', 'TIMEWARP_OWNER_KEY', 'AGENT_ID_API', 'TIMEWARP_ID_HOME', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'TIMEWARP_PROFILE_DIR',
    'TIMEWARP_ID_TOOL', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'GEMINI_CLI', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED']) delete env[name];
  return {
    ...env,
    AGENT_ID_API: base,
    TIMEWARP_ID_HOME: dirs.idHome,
    CODEX_HOME: dirs.codexHome,
    HOME: dirs.home, USERPROFILE: dirs.home,
    APPDATA: path.join(dirs.home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(dirs.home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(dirs.home, '.config'),
    GIT_CONFIG_GLOBAL: path.join(dirs.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  };
}

// Runs the CLI as a separate process (asynchronously: the API answers from
// this process's event loop).
export function runCli(args, { env, cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr, json() { return JSON.parse(stdout); } }));
    child.stdin.end(input ?? '');
  });
}

// Runs any program asynchronously.
export function run(program, args, { env, cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}
