// `timewarp-id git setup`: the agent signs its Git commits with its own SSH
// key, registered with Agent ID, so repositories that accept only verified
// agents (the Agent ID GitHub Action, the pre-receive hook) accept them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ApiError, CliError, UsageError } from '../errors.js';
import { homeDir } from '../config.js';

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error?.code === 'ENOENT') throw new CliError(`${program} is not installed (or not on PATH).`, { hint: program === 'ssh-keygen' ? 'Install OpenSSH (it comes with Git for Windows and macOS).' : 'Install Git.' });
  return result;
}

const keyBody = line => String(line || '').trim().split(/\s+/).slice(0, 2).join(' ');

export async function git(ctx) {
  const action = ctx.args[0] || 'setup';
  if (action !== 'setup') throw new UsageError(`git has no "${action}" command; did you mean \`timewarp-id git setup\`?`);
  const agent = ctx.agent();
  const { agent: me } = await ctx.self.get('/v1/me');
  const handle = agent.handle || me.handle;
  const principal = me.gitPrincipal;

  const scope = ctx.flags.global ? '--global' : '--local';
  if (!ctx.flags.global) {
    const inside = run('git', ['rev-parse', '--git-dir'], { cwd: ctx.cwd });
    if (inside.status !== 0) throw new CliError(`${ctx.cwd} is not inside a Git repository.`, { hint: 'Run it in the repository, or add --global to sign every repository\'s commits as this agent.' });
  }

  // The key pair, made once per agent on this computer.
  const dir = path.join(homeDir(ctx.env), 'keys');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, `${handle}_ed25519`), pubPath = `${keyPath}.pub`;
  let created = false;
  if (!fs.existsSync(keyPath)) {
    const made = run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', principal, '-f', keyPath]);
    if (made.status !== 0 || !fs.existsSync(keyPath)) throw new CliError(`ssh-keygen could not create a key: ${(made.stderr || made.stdout || '').trim()}`);
    created = true;
  }
  if (!fs.existsSync(pubPath)) {
    const derived = run('ssh-keygen', ['-y', '-f', keyPath]);
    if (derived.status !== 0) throw new CliError(`Could not read the public key of ${keyPath}: ${(derived.stderr || '').trim()}`);
    fs.writeFileSync(pubPath, `${derived.stdout.trim()} ${principal}\n`);
  }
  const publicKey = fs.readFileSync(pubPath, 'utf8').trim();
  if (!publicKey.startsWith('ssh-ed25519 ')) throw new CliError(`${pubPath} is not an ssh-ed25519 public key.`);

  // Registered with Agent ID once.
  const { keys } = await ctx.self.get('/v1/me/signing-keys');
  let registered = keys.find(key => keyBody(key.publicKey) === keyBody(publicKey));
  let newlyRegistered = false;
  if (!registered) {
    try {
      registered = (await ctx.self.post('/v1/me/signing-keys', { publicKey, name: ctx.hostname() })).key;
      newlyRegistered = true;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'key_in_use') throw new CliError(`${pubPath} is already registered to another agent.`, { hint: `Move ${keyPath} and its .pub away, then run this again to make a new key.` });
      throw error;
    }
  }

  // The repository (or every repository) signs as the agent.
  const settings = [
    ['gpg.format', 'ssh'],
    ['user.signingkey', pubPath],
    ['commit.gpgsign', 'true'],
    ['user.name', me.name],
    ['user.email', principal],
  ];
  for (const [key, value] of settings) {
    const set = run('git', ['config', scope, key, value], { cwd: ctx.cwd });
    if (set.status !== 0) throw new CliError(`git config ${scope} ${key} failed: ${(set.stderr || '').trim()}`);
  }

  ctx.print({ agent: { id: me.id, handle, name: me.name }, principal, privateKey: keyPath, publicKey: pubPath, fingerprint: registered.fingerprint, created, registered: newlyRegistered, scope: scope.slice(2), settings: Object.fromEntries(settings) }, () => [
    `${created ? 'Created' : 'Using'} the signing key ${keyPath} (${registered.fingerprint}),${newlyRegistered ? ' registered it with Agent ID,' : ' already registered,'}`,
    `and set ${ctx.flags.global ? 'your global Git config' : 'this repository'} to sign commits as ${me.name} <${principal}>.`,
    'Repositories protected by Agent ID accept these commits while the agent is active and allowed there.',
  ].join('\n'));
}
