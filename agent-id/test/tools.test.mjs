// attach / detach for every agent tool beyond Claude Code and Codex: their
// MCP config formats (JSON with mirrors, JSONC, TOML, YAML blocks), their
// instructions files, OpenClaw workspaces, tools set up by hand, the origin
// sent to Agent ID, and the user-agent and clientInfo the CLI passes on.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CLI, cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';
import { parseJsonc } from '../cli/src/jsonc.js';

const START = '<!-- timewarp-agent-id:start -->';
const read = file => fs.readFileSync(file, 'utf8');
const json = file => JSON.parse(read(file));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

describe('attach for Gemini, Antigravity, Windsurf, opencode, Grok, Kiro, Qwen, Factory, Copilot, Amazon Q, Continue, Cline and OpenClaw', () => {
  let api, home, work, env, h, session;
  const files = {}, originals = {};
  const cli = (args, options = {}) => runCli(args, { env: options.env || env, cwd: work, input: options.input });
  const ok = async (args, options) => {
    const result = await cli(args, options);
    assert.equal(result.code, 0, `timewarp-id ${args.join(' ')} failed (${result.code}):\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const appData = () => process.platform === 'win32' ? env.APPDATA : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME;

  before(async () => {
    api = await startApi();
    const owner = await api.local.user({ email: 'owner@example.test', plan: 'pro' });
    session = owner.session;
    home = tempDir('tools');
    work = path.join(home, 'work');
    fs.mkdirSync(work, { recursive: true });
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, 'no-codex'), home }, { TIMEWARP_PROFILE_DIR: path.join(home, 'no-timewarp') });
    const at = (...parts) => path.join(home, ...parts);
    Object.assign(files, {
      gemini: at('.gemini', 'settings.json'), geminiMd: at('.gemini', 'GEMINI.md'),
      antigravity: at('.gemini', 'antigravity', 'mcp_config.json'), antigravityConfig: at('.gemini', 'config', 'mcp_config.json'),
      windsurf: at('.codeium', 'windsurf', 'mcp_config.json'), windsurfRules: at('.codeium', 'windsurf', 'memories', 'global_rules.md'),
      opencode: path.join(env.XDG_CONFIG_HOME, 'opencode', 'opencode.jsonc'), opencodeMd: path.join(env.XDG_CONFIG_HOME, 'opencode', 'AGENTS.md'),
      grok: at('.grok', 'config.toml'), grokMd: at('.grok', 'AGENTS.md'),
      kiro: at('.kiro', 'settings', 'mcp.json'), kiroRule: at('.kiro', 'steering', 'timewarp-agent-id.md'),
      qwen: at('.qwen', 'settings.json'), qwenMd: at('.qwen', 'QWEN.md'),
      factory: at('.factory', 'mcp.json'), copilot: at('.copilot', 'mcp-config.json'), amazonq: at('.aws', 'amazonq', 'mcp.json'),
      continue: at('.continue', 'mcpServers', 'timewarp-id.yaml'), continueRule: at('.continue', 'rules', 'timewarp-agent-id.md'),
      openclaw: at('.openclaw', 'workspace', 'AGENTS.md'), openclawProject: at('.openclaw', 'workspace', '.timewarp-id.json'),
    });
    const fixtures = {
      gemini: '{\n  "theme": "dark",\n  "mcpServers": {\n    "other": { "command": "x" }\n  }\n}\n',
      geminiMd: '# My Gemini notes\n',
      antigravity: '{\n  "mcpServers": {\n    "figma": { "url": "https://figma.example", "type": "http" }\n  },\n  "servers": {\n    "figma": { "url": "https://figma.example", "type": "http" }\n  }\n}\n',
      antigravityConfig: '{\n  "mcpServers": {},\n  "servers": {}\n}\n',
      opencode: '{\n  "$schema": "https://opencode.ai/config.json",\n  // My servers\n  "mcp": {\n    "blender": { "type": "local", "command": ["uvx", "blender-mcp"], "enabled": true }\n  },\n  "provider": {}\n}\n',
      grok: '[models]\ndefault = "grok-4"\n\n[ui]\nyolo = false\n',
      qwen: '{}\n',
      factory: '{\n  "mcpServers": {}\n}\n',
      openclaw: '# Workspace rules\n\nBe careful.\n',
    };
    for (const [name, text] of Object.entries(fixtures)) { write(files[name], text); originals[name] = text; }
    fs.mkdirSync(path.dirname(files.windsurf), { recursive: true });
    write(path.join(path.dirname(files.windsurf), 'installation_id'), 'x');
    fs.mkdirSync(path.dirname(files.kiro), { recursive: true });
    write(at('.copilot', 'config.json'), '{}\n');
    fs.mkdirSync(path.dirname(files.amazonq), { recursive: true });
    write(at('.continue', 'config.yaml'), 'name: Local\nversion: 1.0.0\nschema: v1\n');
    files.cline = path.join(appData(), 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
    fs.mkdirSync(path.dirname(files.cline), { recursive: true });
    write(at('.openclaw', 'openclaw.json'), '{}\n');
    write(at('.grokbot', 'settings.json'), '{ "version": 1, "mcpBoxServers": [] }\n');
    write(at('.hermes', 'skills', 'video', 'SKILL.md'), '# A skill\n');
    assert.equal((await runCli(['login', '--owner-key', await api.ownerKey(owner)], { env, cwd: work })).code, 0);
  });
  after(async () => {
    await api?.close();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it('finds the installed tools, and lists the ones it can\'t wire up as manual setup', async () => {
    const { targets } = JSON.parse((await ok(['agents', 'scan', '--json'])).stdout);
    const refs = targets.map(t => t.ref);
    for (const ref of ['gemini', 'antigravity', 'windsurf', 'opencode', 'grok', 'kiro', 'qwen', 'factory', 'copilot', 'amazonq', 'continue', 'cline', 'openclaw', 'grokbot']) assert.ok(refs.includes(ref), `${ref} in ${refs.join(', ')}`);
    assert.ok(!refs.includes('hermes'), 'a folder with only skills is not an installed tool');
    const grokbot = targets.find(t => t.ref === 'grokbot');
    assert.equal(grokbot.manual, true);
    assert.match(grokbot.snippet, /"timewarp-id"/);
    assert.equal(targets.find(t => t.ref === 'cline').agent, 'in VS Code');
    assert.match((await ok(['agents', 'scan'])).stdout, /Found, manual setup: Grok Bot/);
    const manual = await cli(['attach', 'grokbot']);
    assert.equal(manual.code, 1);
    assert.match(manual.stderr, /Grok Bot is here, but attach can't write its MCP setup/);
    assert.match(manual.stderr, /"mcpServers"/);
  });

  it('creates the agent with its origin (falling back for an older server) and wires up Gemini CLI', async () => {
    const [result] = JSON.parse((await ok(['attach', 'gemini', '--give', 'mail', '--json'])).stdout).attached;
    h = result.agent.handle;
    assert.deepEqual(result.origin, { app: 'gemini', detail: 'every project' });
    const posts = api.requests.filter(r => r.method === 'POST' && r.path === '/v1/agents');
    assert.deepEqual(posts[0].body.origin, { app: 'gemini', detail: 'every project' });
    assert.equal(posts[0].body.runtime, 'gemini');
    if (posts[0].status === 400) {
      assert.equal(posts[1].body.runtime, 'other', 'an older server gets an older runtime');
      assert.equal(posts[1].status, 200);
    }
    const settings = json(files.gemini);
    assert.equal(settings.theme, 'dark');
    assert.deepEqual(settings.mcpServers.other, { command: 'x' });
    assert.deepEqual(settings.mcpServers['timewarp-id'].args.slice(-3), ['mcp', '--default-agent', h]);
    assert.equal(settings.mcpServers['timewarp-id'].env.TIMEWARP_ID_TOOL, 'gemini');
    const { agent } = await api.call('GET', `/v1/agents/${result.agent.id}`, { token: session });
    assert.deepEqual({ app: agent.origin.app, detail: agent.origin.detail }, { app: 'gemini', detail: 'every project' }, 'Agent ID stores where it comes from');
    assert.ok(read(files.geminiMd).startsWith(`${originals.geminiMd}\n${START}`));
    assert.match(read(files.geminiMd), /takes precedence/);
  });

  it('writes each tool\'s own format, and sends each origin', async () => {
    const refs = ['antigravity', 'windsurf', 'opencode', 'grok', 'kiro', 'qwen', 'factory', 'copilot', 'amazonq', 'continue', 'cline', 'openclaw'];
    const { attached } = JSON.parse((await ok(['attach', ...refs, '--agent', h, '--json'])).stdout);
    assert.equal(attached.length, refs.length);
    assert.ok(attached.every(a => a.agent.handle === h && !a.agent.created));

    for (const file of [files.antigravity, files.antigravityConfig]) {
      const config = json(file);
      for (const key of ['mcpServers', 'servers']) assert.deepEqual(config[key]['timewarp-id'].args.slice(-3), ['mcp', '--default-agent', h], `${file} ${key}`);
    }
    assert.deepEqual(json(files.antigravity).servers.figma, { url: 'https://figma.example', type: 'http' });
    assert.ok(json(files.windsurf).mcpServers['timewarp-id']);
    assert.ok(read(files.windsurfRules).startsWith(START));

    const opencode = read(files.opencode);
    assert.match(opencode, /\/\/ My servers/, 'comments stay');
    const parsed = parseJsonc(opencode);
    assert.deepEqual(parsed.mcp.blender, { type: 'local', command: ['uvx', 'blender-mcp'], enabled: true });
    assert.equal(parsed.mcp['timewarp-id'].type, 'local');
    assert.equal(parsed.mcp['timewarp-id'].enabled, true);
    assert.deepEqual(parsed.mcp['timewarp-id'].command.slice(-3), ['mcp', '--default-agent', h]);
    assert.equal(parsed.mcp['timewarp-id'].environment.TIMEWARP_ID_TOOL, 'opencode');
    assert.ok(read(files.opencodeMd).startsWith(START));

    const grok = read(files.grok);
    assert.ok(grok.startsWith(originals.grok.trimEnd()));
    assert.match(grok, new RegExp(`\\[mcp_servers\\.timewarp-id\\]\\ncommand = "npx"\\nargs = \\["-y", "@timewarp/agent-id", "mcp", "--default-agent", "${h}"\\]`));
    assert.ok(read(files.grokMd).startsWith(START));

    assert.ok(json(files.kiro).mcpServers['timewarp-id']);
    assert.ok(read(files.kiroRule).startsWith(`---\ninclusion: always\n---\n${START}`));
    assert.ok(json(files.qwen).mcpServers['timewarp-id']);
    assert.ok(read(files.qwenMd).startsWith(START));
    assert.equal(json(files.factory).mcpServers['timewarp-id'].type, 'stdio');
    const copilot = json(files.copilot).mcpServers['timewarp-id'];
    assert.equal(copilot.type, 'local');
    assert.deepEqual(copilot.tools, ['*']);
    assert.ok(json(files.amazonq).mcpServers['timewarp-id']);
    const block = read(files.continue);
    assert.match(block, /^name: Timewarp Agent ID\nversion: 1\.0\.0\nschema: v1\nmcpServers:\n {2}- name: "timewarp-id"\n {4}command: "npx"\n {4}args:\n/);
    assert.match(block, new RegExp(` {6}- "--default-agent"\\n {6}- "${h}"`));
    assert.ok(read(files.continueRule).startsWith(START));
    assert.ok(json(files.cline).mcpServers['timewarp-id']);

    assert.ok(read(files.openclaw).startsWith(`${originals.openclaw}\n${START}`));
    assert.match(read(files.openclaw), /`timewarp-id` command run in this folder/);
    assert.deepEqual(json(files.openclawProject), { agent: h });
    assert.match(attached.find(a => a.ref === 'openclaw').notes.join('\n'), /"mcpServers"/);

    const origins = api.requests.filter(r => r.method === 'PATCH' && r.path.startsWith('/v1/agents/')).map(r => r.body.origin);
    for (const origin of [{ app: 'gemini', detail: 'Antigravity' }, { app: 'windsurf', detail: 'every project' }, { app: 'opencode', detail: 'every project' }, { app: 'grok', detail: 'every project' }, { app: 'cline', detail: 'VS Code' }, { app: 'openclaw', detail: 'workspace workspace' }]) {
      assert.ok(origins.some(o => JSON.stringify(o) === JSON.stringify(origin)), `PATCH origin ${JSON.stringify(origin)}`);
    }

    // Again: nothing changes.
    const snapshot = Object.fromEntries(Object.entries(files).filter(([, file]) => fs.existsSync(file)).map(([name, file]) => [name, read(file)]));
    await ok(['attach', ...refs, 'gemini', '--agent', h]);
    for (const [name, text] of Object.entries(snapshot)) assert.equal(read(files[name]), text, `${name} unchanged on a second attach`);
  });

  it('sends the tool in the user-agent, and passes the MCP client\'s clientInfo through', async () => {
    await ok(['me', '--agent', h], { env: { ...env, CLAUDECODE: '1' } });
    const me = api.requests.filter(r => r.path === '/v1/me').pop();
    assert.match(me.headers['user-agent'], /^timewarp-id\/\S+ \(claude-code\)$/);

    const clientInfo = { name: 'cursor-vscode', version: '1.7.2' };
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ].map(line => JSON.stringify(line)).join('\n');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, 'mcp', '--agent', h], { env, cwd: work, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, out }));
      child.stdin.end(`${lines}\n`);
    });
    assert.equal(result.code, 0);
    assert.equal(result.out.trim().split('\n').length, 2);
    const mcp = api.requests.filter(r => r.path === '/mcp');
    const init = mcp.find(r => r.body?.method === 'initialize');
    assert.deepEqual(init.body.params.clientInfo, clientInfo, 'clientInfo goes through unchanged');
    assert.match(init.headers['user-agent'], /\(cursor\)$/);
    assert.match(mcp.find(r => r.body?.method === 'tools/list').headers['user-agent'], /\(cursor\)$/);
    const agentId = json(path.join(home, 'id', 'config.json')).profiles[h].agentId;
    const { agent } = await api.call('GET', `/v1/agents/${agentId}`, { token: session });
    assert.equal(agent.origin.client?.name, 'cursor-vscode', 'Agent ID records the client');
  });

  it('detaches every tool back to how it was', async () => {
    const { detached } = JSON.parse((await ok(['detach', '--all', '--json'])).stdout);
    assert.ok(detached.length >= 13);
    for (const name of ['gemini', 'geminiMd', 'opencode', 'grok', 'qwen', 'factory', 'openclaw']) assert.equal(read(files[name]), originals[name], `${name} is back as it was`);
    assert.deepEqual(json(files.antigravity), JSON.parse(originals.antigravity));
    assert.deepEqual(json(files.antigravityConfig), JSON.parse(originals.antigravityConfig));
    for (const name of ['windsurf', 'windsurfRules', 'opencodeMd', 'grokMd', 'kiro', 'kiroRule', 'qwenMd', 'copilot', 'amazonq', 'continue', 'continueRule', 'cline', 'openclawProject']) {
      assert.ok(!fs.existsSync(files[name]), `${name}, which attach created, is gone`);
    }
    assert.deepEqual(json(path.join(home, 'id', 'attachments.json')), {});
  });
});
