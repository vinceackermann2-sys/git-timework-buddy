// `timewarp-id attach` / `detach` / `agents scan` against existing agents of
// every kind in a temporary home folder, and the approvals flow, with the
// real Agent ID service running locally.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';

const START = '<!-- timewarp-agent-id:start -->', END = '<!-- timewarp-agent-id:end -->';
const read = file => fs.readFileSync(file, 'utf8');
const json = file => JSON.parse(read(file));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const blockOf = text => text.slice(text.indexOf(START), text.indexOf(END) + END.length);
const count = (text, part) => text.split(part).length - 1;

describe('timewarp-id attach and detach', () => {
  let api, home, project, env, ownerKey;
  const files = {}, originals = {}, agents = {};
  const cli = (args, options = {}) => runCli(args, { env, cwd: options.cwd || project, input: options.input });
  const ok = async (args, options) => {
    const result = await cli(args, options);
    assert.equal(result.code, 0, `timewarp-id ${args.join(' ')} failed (${result.code}):\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const attach = async (args, options) => JSON.parse((await ok(['attach', ...args, '--json'], options)).stdout).attached;
  const agentList = async () => (await api.call('GET', '/v1/agents', { token: ownerKey })).agents;

  before(async () => {
    api = await startApi();
    const owner = await api.local.user({ email: 'owner@example.test', plan: 'pro' });
    ownerKey = await api.ownerKey(owner);
    await api.acceptTerms(ownerKey);
    home = tempDir('attach');
    project = path.join(home, 'proj');
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, 'codex'), home }, { TIMEWARP_PROFILE_DIR: path.join(home, 'tw') });

    files.claudeJson = path.join(home, '.claude.json');
    files.reviewer = path.join(home, '.claude', 'agents', 'code-reviewer.md');
    files.writer = path.join(home, '.claude', 'agents', 'writer.md');
    files.tester = path.join(project, '.claude', 'agents', 'tester.md');
    files.claudeMd = path.join(project, 'CLAUDE.md');
    files.mcpJson = path.join(project, '.mcp.json');
    files.agentsMd = path.join(project, 'AGENTS.md');
    files.codexToml = path.join(home, 'codex', 'config.toml');
    files.cursorUser = path.join(home, '.cursor', 'mcp.json');
    files.desktop = process.platform === 'win32' ? path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json')
      : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(env.XDG_CONFIG_HOME, 'Claude', 'claude_desktop_config.json');
    files.workspace = path.join(home, 'tw', 'runtime', 'agents', 'research-assistant-7f3c-22aa');
    files.twAgents = path.join(files.workspace, 'AGENTS.md');

    const fixtures = {
      claudeJson: `${JSON.stringify({ numStartups: 7, mcpServers: { github: { type: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'] } }, projects: { '/x': { allowedTools: [] } } }, null, 2)}\n`,
      reviewer: '---\nname: code-reviewer\ndescription: Reviews code for bugs\ntools: Read, Grep, Glob\n---\nYou review code carefully.\n',
      writer: '---\nname: writer\ndescription: Writes docs\n---\nWrite clearly.\n',
      tester: '---\nname: tester\ndescription: Runs tests\ntools:\n  - Bash\n  - Read\n---\nRun the tests.\n',
      claudeMd: '# Proj\n\nUse pnpm.\n',
      mcpJson: `${JSON.stringify({ mcpServers: { db: { command: 'db-mcp' } } }, null, 2)}\n`,
      agentsMd: '# Proj agents\n\nBe brief.\n',
      codexToml: 'model = "gpt-5"\n\n[mcp_servers.github]\ncommand = "npx"\nargs = ["-y", "gh-mcp"]\n',
      cursorUser: `${JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2)}\n`,
      desktop: `${JSON.stringify({ globalShortcut: 'Ctrl+Space', mcpServers: {} }, null, 2)}\n`,
      twAgents: '# Research Assistant\n\nYou research things.\n',
    };
    for (const [name, text] of Object.entries(fixtures)) { write(files[name], text); originals[name] = text; }
    write(path.join(home, 'tw', 'runtime', 'agents', 'x-123', 'AGENTS.md'), '# Other\n');
    fs.mkdirSync(path.join(project, '.cursor'), { recursive: true });
    await ok(['login', '--owner-key', ownerKey]);
  });
  after(async () => {
    await api?.close();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it('finds Claude Code, its subagents, Codex, Cursor, Claude Desktop and Timewarp agents', async () => {
    const { targets } = JSON.parse((await ok(['agents', 'scan', '--json'])).stdout);
    const refs = targets.map(t => t.ref);
    for (const ref of ['claude', 'claude:project', 'claude-agent:code-reviewer', 'claude-agent:writer', 'claude-agent:tester', 'codex', 'codex:project', 'cursor', 'cursor:project', 'claude-desktop', 'timewarp:7f3c-22aa', 'timewarp:123']) {
      assert.ok(refs.includes(ref), `${ref} in ${refs.join(', ')}`);
    }
    assert.equal(targets.find(t => t.ref === 'claude-agent:code-reviewer').description, 'Reviews code for bugs');
    assert.equal(targets.find(t => t.ref === 'timewarp:7f3c-22aa').agent, 'Research Assistant');
    assert.ok(targets.every(t => t.attached === null));
    const human = await ok(['agents', 'scan']);
    assert.match(human.stdout, /Claude Code\s+subagent code-reviewer/);
    const ask = await cli(['attach']);
    assert.equal(ask.code, 2, 'without a terminal it lists and asks for a name');
    assert.match(ask.stdout, /claude-agent:code-reviewer/);
    assert.match(ask.stderr, /Name what to attach/);
  });

  it('attaches a Claude Code subagent: identity block, its own MCP server and its tools', async () => {
    const [result] = await attach(['claude-agent:code-reviewer', '--give', 'mail,wallet', '--test']);
    assert.equal(result.agent.created, true);
    assert.equal(result.agent.name, 'code-reviewer');
    assert.deepEqual(result.given, ['mail', 'wallet']);
    agents.reviewer = result.agent;
    const h = result.agent.handle, server = `timewarp-id-${h}`;

    const md = read(files.reviewer);
    assert.ok(md.startsWith('---\nname: code-reviewer\ndescription: Reviews code for bugs\ntools: Read, Grep, Glob, '));
    assert.match(md, new RegExp(`mcp__${server}__mail_send`));
    assert.match(md, new RegExp(`mcp__${server}__wallet_send`));
    assert.doesNotMatch(md, /__card_get/, 'only tools for what it has');
    assert.ok(md.includes('You review code carefully.\n\n<!-- timewarp-agent-id:start -->'));
    const block = blockOf(md);
    assert.match(block, new RegExp(`You are code-reviewer \\(${result.agent.id}, handle ${h}\\)`));
    assert.match(block, /@agents\.timewarp\.test/);
    assert.match(block, new RegExp(`\`${server}\` MCP tools`));
    assert.ok(block.replace(START, '').replace(END, '').trim().split(/\s+/).length <= 80, 'the block stays short');

    const claude = json(files.claudeJson);
    assert.equal(claude.numStartups, 7);
    assert.deepEqual(claude.projects, { '/x': { allowedTools: [] } });
    assert.deepEqual(claude.mcpServers.github, { type: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'] });
    const entry = claude.mcpServers[server];
    assert.equal(entry.type, 'stdio');
    assert.deepEqual(entry.args.slice(-3), ['mcp', '--agent', h]);
    assert.equal(read(`${files.claudeJson}.timewarp-id.bak`), originals.claudeJson);
    assert.ok(!fs.existsSync(path.join(project, '.timewarp-id.json')), 'a subagent shares its project, so no project file');

    // Again: the same agent, updated in place, nothing doubled.
    const before = { md: read(files.reviewer), claude: read(files.claudeJson), agents: (await agentList()).length };
    const [again] = await attach(['code-reviewer']);
    assert.equal(again.agent.id, result.agent.id);
    assert.equal(again.agent.created, false);
    assert.equal(read(files.reviewer), before.md);
    assert.equal(read(files.claudeJson), before.claude);
    assert.equal((await agentList()).length, before.agents);

    // More resources: the block and the tools follow.
    await attach(['claude-agent:code-reviewer', '--give', 'card', '--test']);
    const updated = read(files.reviewer);
    assert.equal(count(updated, START), 1);
    assert.equal(count(updated, `mcp__${server}__mail_send`), 1);
    assert.match(updated, new RegExp(`mcp__${server}__card_get`));
    assert.match(blockOf(updated), /a card/);
  });

  it('attaches a project subagent with a YAML tools list, and Claude Code itself', async () => {
    const [tester] = await attach(['tester']);
    agents.tester = tester.agent;
    const md = read(files.tester);
    assert.match(md, new RegExp(`tools:\\n  - Bash\\n  - Read\\n  - mcp__timewarp-id-${tester.agent.handle}__whoami\\n`));
    const mcp = json(files.mcpJson);
    assert.deepEqual(mcp.mcpServers.db, { command: 'db-mcp' });
    assert.ok(mcp.mcpServers[`timewarp-id-${tester.agent.handle}`]);

    const [main] = await attach(['claude', '--yes']);
    agents.claude = main.agent;
    assert.equal(main.agent.name, 'Claude Code');
    const userMd = read(path.join(home, '.claude', 'CLAUDE.md'));
    assert.match(userMd, /takes precedence/);
    assert.deepEqual(json(files.claudeJson).mcpServers['timewarp-id'].args.slice(-3), ['mcp', '--default-agent', main.agent.handle]);

    const [proj] = await attach(['claude:project']);
    agents.project = proj.agent;
    assert.equal(proj.agent.name, 'proj (Claude Code)');
    assert.ok(read(files.claudeMd).startsWith(`${originals.claudeMd}\n${START}`));
    assert.deepEqual(json(files.mcpJson).mcpServers['timewarp-id'].args.slice(-3), ['mcp', '--agent', proj.agent.handle]);
    assert.deepEqual(json(path.join(project, '.timewarp-id.json')), { agent: proj.agent.handle });
    assert.equal(JSON.parse((await ok(['me', '--json'])).stdout).agent.id, proj.agent.id, 'commands in the project act as its agent');
  });

  it('attaches Codex globally and in the project, sharing the project agent', async () => {
    const [codex] = await attach(['codex']);
    agents.codex = codex.agent;
    const toml = read(files.codexToml);
    assert.ok(toml.startsWith(originals.codexToml.trimEnd()), 'the other tables stay');
    assert.match(toml, new RegExp(`\\[mcp_servers\\.timewarp_id\\]\\ncommand = .*\\nargs = \\[.*"mcp", "--default-agent", "${codex.agent.handle}"\\]`));
    assert.match(read(path.join(home, 'codex', 'AGENTS.md')), new RegExp(codex.agent.id));

    const [proj] = await attach(['codex:project']);
    assert.equal(proj.agent.id, agents.project.id, 'the folder already has an agent');
    assert.equal(read(files.codexToml), toml, 'the global entry is kept: it follows .timewarp-id.json');
    assert.ok(read(files.agentsMd).startsWith(`${originals.agentsMd}\n${START}`));
    assert.match(blockOf(read(files.agentsMd)), /`timewarp_id` MCP tools/);
  });

  it('attaches Cursor, a Cursor project and Claude Desktop', async () => {
    const [cursor] = await attach(['cursor', '--agent', agents.claude.handle]);
    assert.equal(cursor.agent.id, agents.claude.id);
    const user = json(files.cursorUser);
    assert.deepEqual(user.mcpServers.other, { command: 'x' });
    assert.equal(user.mcpServers['timewarp-id'].command, 'npx');
    const [cursorProject] = await attach(['cursor:project']);
    assert.equal(cursorProject.agent.id, agents.project.id);
    assert.match(read(path.join(project, '.cursor', 'rules', 'timewarp-agent-id.mdc')), /^---\ndescription: Timewarp Agent ID identity\nalwaysApply: true\n---\n<!-- timewarp-agent-id:start -->/);
    assert.deepEqual(json(path.join(project, '.cursor', 'mcp.json')).mcpServers['timewarp-id'].args.slice(-3), ['mcp', '--agent', agents.project.handle]);
    await attach(['claude-desktop', '--agent', agents.claude.handle]);
    const desktop = json(files.desktop);
    assert.equal(desktop.globalShortcut, 'Ctrl+Space');
    assert.deepEqual(desktop.mcpServers['timewarp-id'].args.slice(-3), ['mcp', '--default-agent', agents.claude.handle]);
  });

  it('attaches a Timewarp desktop agent and links it to its desktop id', async () => {
    const result = await ok(['attach', 'timewarp:Research Assistant', '--give', 'mail,wallet', '--test']);
    assert.match(result.stdout, /timewarp-id` command in their workspace/);
    const config = json(path.join(home, 'id', 'config.json'));
    const handle = json(path.join(files.workspace, '.timewarp-id.json')).agent;
    agents.research = { handle, id: config.profiles[handle].agentId };
    const { agent } = await api.call('GET', `/v1/agents/${agents.research.id}`, { token: ownerKey });
    assert.equal(agent.name, 'Research Assistant');
    assert.equal(agent.desktopAgentId, '7f3c-22aa');
    assert.equal(agent.runtime, 'timewarp');
    const block = blockOf(read(files.twAgents));
    assert.match(block, /`timewarp-id` command run in this folder/);
    assert.doesNotMatch(block, /MCP tools/);
    assert.equal(JSON.parse((await ok(['me', '--json'], { cwd: files.workspace })).stdout).agent.id, agents.research.id);
  });

  it('attaches any folder, for a custom agent', async () => {
    const custom = path.join(home, 'custom');
    fs.mkdirSync(custom);
    const [result] = await attach([custom, '--name', 'Custom bot']);
    assert.equal(result.agent.name, 'Custom bot');
    assert.ok(read(path.join(custom, 'AGENTS.md')).startsWith(START));
    assert.deepEqual(json(path.join(custom, '.timewarp-id.json')), { agent: result.agent.handle });
    const here = await attach(['--here'], { cwd: custom });
    assert.equal(here[0].agent.id, result.agent.id, '--here is the same folder');
    const { targets } = JSON.parse((await ok(['agents', 'scan', '--json'])).stdout);
    assert.equal(targets.find(t => t.ref === 'claude-agent:code-reviewer').attached, agents.reviewer.handle);
    assert.equal(targets.find(t => t.ref === 'timewarp:7f3c-22aa').attached, agents.research.handle);
  });

  it('lists approvals there, with a notice after owner commands, and approves them', async () => {
    await ok(['fund', '--agent', agents.reviewer.handle, '100']);
    const waiting = JSON.parse((await ok(['wallet', 'send', agents.research.handle, '30', '--memo', 'datasets', '--agent', agents.reviewer.handle, '--json'])).stdout);
    assert.equal(waiting.status, 'needs_approval');
    const notice = await ok(['agents', 'list']);
    assert.match(notice.stderr, /1 approval waiting — run `timewarp-id approvals`/);
    const afterAttach = await ok(['attach', 'code-reviewer']);
    assert.match(afterAttach.stderr, /1 approval waiting/);
    const list = await ok(['approvals']);
    assert.match(list.stdout, /1 waiting for your approval/);
    assert.match(list.stdout, /code-reviewer\s+\$30\.00 to Research Assistant \(.*datasets/);
    assert.doesNotMatch(list.stderr, /approval waiting/, 'no notice on the list itself');
    assert.equal((await cli(['approve', waiting.approval])).code, 1, 'Approving needs a person at a terminal (or the website).');
    assert.equal((await api.call('POST', `/v1/approvals/${waiting.approval}`, { token: ownerKey, body: { decision: 'approve' } })).status, 'completed');
    assert.doesNotMatch((await ok(['agents', 'list'])).stderr, /approval waiting/);
    assert.match((await ok(['approvals'])).stdout, /Nothing is waiting/);
  });

  it('detaches exactly what attach wrote, leaving everything else', async () => {
    const reviewer = await ok(['detach', 'claude-agent:code-reviewer']);
    assert.match(reviewer.stdout, /detached from/);
    assert.equal(read(files.reviewer), originals.reviewer);
    let claude = json(files.claudeJson);
    assert.equal(claude.mcpServers[`timewarp-id-${agents.reviewer.handle}`], undefined);
    assert.ok(claude.mcpServers['timewarp-id'], 'Claude Code\'s own entry stays');

    await ok(['detach', 'tester']);
    assert.equal(read(files.tester), originals.tester);
    await ok(['detach', 'codex:project']);
    assert.equal(read(files.agentsMd), originals.agentsMd);
    assert.ok(fs.existsSync(path.join(project, '.timewarp-id.json')), 'Claude Code in this project still uses it');
    await ok(['detach', 'codex']);
    assert.equal(read(files.codexToml), originals.codexToml);
    assert.ok(!fs.existsSync(path.join(home, 'codex', 'AGENTS.md')), 'a file only the block was in goes');
    await ok(['detach', 'claude:project']);
    assert.equal(read(files.claudeMd), originals.claudeMd);
    assert.deepEqual(json(files.mcpJson).mcpServers, { db: { command: 'db-mcp' } });
    assert.ok(fs.existsSync(path.join(project, '.timewarp-id.json')), 'Cursor in this project still uses it');

    await ok(['detach', agents.research.handle]);
    assert.equal(read(files.twAgents), originals.twAgents);
    assert.ok(!fs.existsSync(path.join(files.workspace, '.timewarp-id.json')));

    const rest = JSON.parse((await ok(['detach', '--all', '--json'])).stdout).detached;
    assert.ok(rest.length >= 5);
    assert.deepEqual(json(files.claudeJson), json(`${files.claudeJson}.timewarp-id.bak`));
    assert.deepEqual(json(files.claudeJson), JSON.parse(originals.claudeJson));
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')));
    assert.deepEqual(json(files.cursorUser), JSON.parse(originals.cursorUser));
    assert.deepEqual(json(files.desktop), JSON.parse(originals.desktop));
    assert.ok(!fs.existsSync(path.join(project, '.cursor', 'rules', 'timewarp-agent-id.mdc')));
    assert.ok(!fs.existsSync(path.join(project, '.cursor', 'mcp.json')), 'a config file attach created goes');
    assert.ok(!fs.existsSync(path.join(project, '.timewarp-id.json')));
    assert.deepEqual(fs.readdirSync(path.join(home, 'custom')), []);
    assert.deepEqual(json(path.join(home, 'id', 'attachments.json')), {});
    const { targets } = JSON.parse((await ok(['agents', 'scan', '--json'])).stdout);
    assert.ok(targets.every(t => t.attached === null), JSON.stringify(targets.filter(t => t.attached)));
    assert.ok((await agentList()).some(a => a.id === agents.reviewer.id), 'the Agent IDs themselves stay');
  });
});
