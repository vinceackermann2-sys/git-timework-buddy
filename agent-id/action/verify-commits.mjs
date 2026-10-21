#!/usr/bin/env node
// Agent ID commit check: every commit in base..head (merge commits too) must
// carry a valid SSH signature by a key that is either
//   - an active, allowed agent of the company's organization, as Agent ID
//     lists it right now, or
//   - a human signer the company listed itself (human-signers).
// Nothing passes on who a commit claims to be from: author and committer
// emails are self-asserted, so an unsigned commit always fails. Fails closed:
// if Agent ID can't be asked, nothing passes.
//
// Inputs (environment): AGENT_ID_ORGANIZATION (the organization's id; or
// AGENT_ID_SECRET, a company secret from older setups), AGENT_ID_API,
// AGENT_ID_BASE, AGENT_ID_HEAD, AGENT_ID_HUMAN_SIGNERS (allowed_signers lines,
// or the path of such a file in the repository, read as it is in the base
// commit); base and head default from the GitHub event (pull_request, push,
// merge_group).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_API = 'https://mrqoeywofslgnquvzhuf.supabase.co/functions/v1/agent-id';
const ZERO = /^0+$/;
const KEY_TYPE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;
const env = process.env;
const input = name => String(env[`AGENT_ID_${name}`] ?? env[`INPUT_${name}`] ?? '').trim();
const github = !!env.GITHUB_ACTIONS;

const log = text => process.stdout.write(`${text}\n`);
const escapeData = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const annotate = (level, text, title) => { if (github) log(`::${level}${title ? ` title=${escapeData(title).replace(/[,:]/g, ' ')}` : ''}::${escapeData(text)}`); };
const warn = text => { annotate('warning', text, 'Agent ID'); process.stderr.write(`Agent ID: warning: ${text}\n`); };
// Stops the check. No process.exit(): on Windows and macOS, output to a pipe
// is written asynchronously and exiting would cut it off.
class Fatal extends Error {}
function fatal(text) {
  annotate('error', text, 'Agent ID');
  process.stderr.write(`Agent ID: ${text}\n`);
  throw new Fatal(text);
}

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
  if (result.error) fatal(`git could not run: ${result.error.message}`);
  return result;
}
const gitOk = args => git(args).status === 0;
const gitOut = args => {
  const result = git(args);
  if (result.status !== 0) fatal(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout.trim();
};

// --- What to check -------------------------------------------------------------------
function readEvent() {
  if (!env.GITHUB_EVENT_PATH) return {};
  try { return JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); } catch { return {}; }
}

function range() {
  const event = readEvent();
  let base = input('BASE'), head = input('HEAD');
  if (!base || !head) {
    if (event.pull_request) { base ||= event.pull_request.base?.sha; head ||= event.pull_request.head?.sha; }
    else if (event.merge_group) { base ||= event.merge_group.base_sha; head ||= event.merge_group.head_sha; }
    else if (event.after) { base ||= event.before; head ||= event.after; }
  }
  head ||= env.GITHUB_SHA || 'HEAD';
  if (!base || ZERO.test(base)) {
    // A new branch: check what isn't on the default branch yet.
    const branch = event.repository?.default_branch;
    if (branch && gitOk(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`])) {
      base = gitOut(['merge-base', `refs/remotes/origin/${branch}`, head]);
      log(`New branch: checking the commits not on ${branch} yet.`);
    } else {
      fatal('No base commit to compare with. Set the `base` input (a commit, branch or tag), or run on pull_request or push events.');
    }
  }
  return { base, head };
}

// Makes sure both ends and everything between them are here: a shallow
// clone would silently leave commits unchecked.
function ensureHistory(base, head) {
  const have = rev => gitOk(['cat-file', '-e', `${rev}^{commit}`]);
  if (gitOut(['rev-parse', '--is-shallow-repository']) === 'true') {
    log('This is a shallow clone; fetching the full history (use actions/checkout with fetch-depth: 0 to skip this).');
    git(['fetch', '--no-tags', '--quiet', '--unshallow', 'origin']);
  }
  for (const rev of [base, head]) {
    if (!have(rev)) git(['fetch', '--no-tags', '--quiet', 'origin', rev]);
    if (!have(rev)) fatal(`Commit ${rev} is not in this clone. Use actions/checkout with fetch-depth: 0.`);
  }
  if (gitOut(['rev-parse', '--is-shallow-repository']) === 'true') fatal('The clone is still shallow, so some commits could not be checked. Use actions/checkout with fetch-depth: 0.');
}

// --- Who may sign ----------------------------------------------------------------------
// The organization's list is public; a company secret reads its own.
async function agentSigners(api, { organization, secret }) {
  const url = organization ? `${api}/v1/orgs/${encodeURIComponent(organization)}/allowed-signers` : `${api}/v1/allowed-signers`;
  let response;
  try { response = await fetch(url, { headers: { ...(organization ? {} : { authorization: `Bearer ${secret}` }), accept: 'text/plain' } }); }
  catch (error) { fatal(`could not reach Agent ID at ${api}: ${error?.cause?.code || error.message}`); }
  const body = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { const error = JSON.parse(body).error; message = `${error.message} (${error.code})`; } catch { /* text */ }
    fatal(`Agent ID did not list the allowed signers: ${message}`);
  }
  return body;
}

// An allowed_signers line's key: "principals [options] keytype base64 [comment]".
// Options may hold quoted spaces, so the key is found by its type.
function keyOf(line) {
  const tokens = line.match(/"[^"]*"|\S+/g) || [];
  for (let i = 1; i < tokens.length - 1; i++) {
    if (KEY_TYPE.test(tokens[i]) && /^[A-Za-z0-9+/]+={0,2}$/.test(tokens[i + 1])) {
      return { principals: tokens[0], type: tokens[i], fingerprint: `SHA256:${crypto.createHash('sha256').update(Buffer.from(tokens[i + 1], 'base64')).digest('base64').replace(/=+$/, '')}` };
    }
  }
  return null;
}
const signerLines = text => text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));

// The company's own list of humans who sign with SSH keys: inline lines, or
// a file in the repository read from the BASE commit, so a pull request
// can't add its author's key and approve itself.
function humanSigners(value, base) {
  if (!value) return { lines: [], source: null };
  let text, source;
  if (!/[\r\n]/.test(value) && !keyOf(value)) {
    const file = value.replace(/^\.\//, '').replace(/\\/g, '/');
    const shown = git(['show', `${base}:${file}`]);
    if (shown.status !== 0) {
      warn(`human-signers names ${file}, which is not in the base commit ${base.slice(0, 12)}; no human signers are allowed for this run.`);
      return { lines: [], source: file };
    }
    text = shown.stdout;
    source = `${file} at ${base.slice(0, 12)}`;
  } else {
    text = value;
    source = 'the human-signers input';
  }
  const lines = signerLines(text);
  lines.forEach((line, i) => { if (!keyOf(line)) fatal(`human-signers line ${i + 1} is not an allowed_signers line ("principal [options] ssh-ed25519 AAAA…"): ${line.slice(0, 80)}`); });
  return { lines, source };
}

// --- Checking ---------------------------------------------------------------------------
function checkCommit(sha, signersFile, agentKeys) {
  const [authorName, authorEmail, committerEmail, parents, subject] = gitOut(['show', '-s', '--format=%an%x00%ae%x00%ce%x00%P%x00%s', sha]).split('\0');
  const info = { sha, short: sha.slice(0, 12), authorName, authorEmail, committerEmail, merge: parents.trim().split(/\s+/).length > 1, subject };
  const verified = git(['-c', `gpg.ssh.allowedSignersFile=${signersFile}`, '-c', 'gpg.minTrustLevel=fully', 'verify-commit', sha]);
  const output = `${verified.stderr}\n${verified.stdout}`;
  const good = /Good "git" signature for (\S+) with \S+ key (SHA256:\S+)/.exec(output);
  if (verified.status === 0 && good) {
    const [, principal, fingerprint] = good;
    return agentKeys.has(fingerprint)
      ? { ...info, ok: true, kind: 'agent', principal, how: `signed by agent ${principal}` }
      : { ...info, ok: true, kind: 'human', principal, how: `signed by human signer ${principal}` };
  }
  const raw = gitOut(['cat-file', 'commit', sha]);
  const end = raw.indexOf('\n\n');
  const headers = end === -1 ? raw : raw.slice(0, end);
  const how = !/^gpgsig(-sha256)? /m.test(headers) ? 'not signed'
    : !headers.includes('-----BEGIN SSH SIGNATURE-----') ? 'signed with GPG or X.509, not an SSH key'
    : /No principal matched/i.test(output) ? 'signed with a key that is neither a current agent of this organization nor a listed human signer'
    : 'signature not valid';
  return { ...info, ok: false, kind: null, how };
}

async function main() {
  const organization = input('ORGANIZATION'), secret = input('SECRET');
  if (!organization && !secret) fatal('The `organization` input is required: your organization\'s id, from the Agent ID dashboard.');
  if (!organization && !secret.startsWith('twrp_')) fatal('The `secret` input is not a company secret (they start with twrp_). Use the `organization` input instead.');
  if (organization && !/^[A-Za-z0-9_-]{1,80}$/.test(organization)) fatal('The `organization` input is not an organization id.');
  const api = (input('API') || DEFAULT_API).replace(/\/+$/, '');
  if (input('ALLOW_UNSIGNED_AUTHORS')) warn('allow-unsigned-authors was removed: an author email proves nothing. Humans sign their commits and are listed in human-signers; unsigned commits fail.');

  const asked = range();
  ensureHistory(asked.base, asked.head);
  const base = gitOut(['rev-parse', `${asked.base}^{commit}`]), head = gitOut(['rev-parse', `${asked.head}^{commit}`]);
  const commits = gitOut(['rev-list', '--reverse', `${base}..${head}`]).split('\n').filter(Boolean);
  log(`Agent ID: checking ${commits.length} commit${commits.length === 1 ? '' : 's'} in ${base.slice(0, 12)}..${head.slice(0, 12)}.`);

  const agents = signerLines(await agentSigners(api, { organization, secret }));
  const agentKeys = new Set(agents.map(keyOf).filter(Boolean).map(key => key.fingerprint));
  const humans = humanSigners(input('HUMAN_SIGNERS'), base);
  log(`Agent ID lists ${agents.length} agent signing key${agents.length === 1 ? '' : 's'} for this organization${humans.source ? `; ${humans.lines.length} human signer line${humans.lines.length === 1 ? '' : 's'} from ${humans.source}` : ''}.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-id-'));
  const signersFile = path.join(dir, 'allowed_signers');
  fs.writeFileSync(signersFile, [...agents, ...humans.lines].map(line => `${line}\n`).join(''));

  const results = [];
  try { for (const sha of commits) results.push(checkCommit(sha, signersFile, agentKeys)); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }

  for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'} ${r.short}${r.merge ? ' (merge)' : ''} ${r.subject.slice(0, 72)}: ${r.how}`);
  const failed = results.filter(r => !r.ok);
  if (env.GITHUB_STEP_SUMMARY) {
    const row = r => `| ${r.ok ? 'pass' : '**fail**'} | \`${r.short}\`${r.merge ? ' (merge)' : ''} | ${r.subject.replace(/\|/g, '\\|').slice(0, 80)} | ${r.authorEmail} | ${r.how} |`;
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, [
      `### Agent ID: ${failed.length ? `${failed.length} of ${results.length} commits are not signed by an allowed agent or human` : `all ${results.length} commits are signed by allowed agents or humans`}`,
      '', '| | Commit | Subject | Author (unverified) | Result |', '|---|---|---|---|---|', ...results.map(row), '',
    ].join('\n'));
  }
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, `checked=${results.length}\nfailed=${failed.length}\nfailed-commits=${failed.map(r => r.sha).join(',')}\nagent-commits=${results.filter(r => r.kind === 'agent').length}\nhuman-commits=${results.filter(r => r.kind === 'human').length}\n`);
  }
  if (failed.length) {
    for (const r of failed) annotate('error', `${r.short} "${r.subject}" (author ${r.authorEmail}, unverified): ${r.how}.`, 'Commit not signed by an allowed agent or human');
    process.stderr.write(`\nAgent ID: ${failed.length} commit${failed.length === 1 ? ' is' : 's are'} not signed by a current agent of this organization or a listed human signer:\n${failed.map(r => `  ${r.short} ${r.subject} (author ${r.authorEmail}): ${r.how}`).join('\n')}\n`);
    return 1;
  }
  log(results.length ? 'Every commit is signed by an allowed agent or human.' : 'No new commits to check.');
  return 0;
}

main().then(
  code => { process.exitCode = code; },
  error => {
    if (!(error instanceof Fatal)) {
      annotate('error', String(error?.message || error), 'Agent ID');
      process.stderr.write(`Agent ID: ${error?.stack || error}\n`);
    }
    process.exitCode = 1;
  },
);
