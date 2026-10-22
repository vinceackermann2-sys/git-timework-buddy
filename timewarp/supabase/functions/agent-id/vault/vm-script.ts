// The vault program that runs on an agent's computer, as the locked "vault"
// account: only that account can read its folder, which holds the private key
// and the sealed items. Items are sealed in the owner's browser to this
// computer's public key (RSA-OAEP-256 wrapping an AES-256-GCM key), so neither
// Timewarp nor the agent ever has them in the clear. The program never prints a
// secret: it checks and stores sealed items, and uses a key in a request to the
// sites the owner bound to it, removing the key from what comes back.
// Plain Node (18 or later), no dependencies. Usage: node vault.js <op> <base64 JSON>.
export const VAULT_VM_SCRIPT = String.raw`'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HOME = process.env.AGENT_ID_VAULT_HOME || '/var/lib/agent-id-vault';
const KEY = path.join(HOME, 'key.pem');
const ITEMS = path.join(HOME, 'items');
const HIDDEN = '[hidden by vault]';

const print = value => process.stdout.write(JSON.stringify(value));
function stop(code, message) { print({ error: { code, message } }); process.exit(2); }

const ID = /^vlt_[a-z0-9]{24}$/;
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;

function privateKey() {
  if (!fs.existsSync(KEY)) stop('not_set_up', 'The vault is not set up on this computer.');
  return fs.readFileSync(KEY, 'utf8');
}

function init() {
  fs.mkdirSync(ITEMS, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(KEY)) {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    fs.writeFileSync(KEY, pair.privateKey, { mode: 0o600 });
  }
  print({ publicKey: crypto.createPublicKey(privateKey()).export({ type: 'spki', format: 'pem' }) });
}

// A sealed item opened in memory; what's inside is checked before it's used.
function open(envelope) {
  let plain;
  try {
    const e = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
    if (!e || e.v !== 1) throw new Error('version');
    const key = crypto.privateDecrypt({ key: privateKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(String(e.key), 'base64'));
    const data = Buffer.from(String(e.data), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(e.iv), 'base64'));
    decipher.setAuthTag(data.subarray(data.length - 16));
    plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    stop('sealed_wrong', 'The item could not be opened on this computer. Add it again.');
  }
  const item = JSON.parse(plain);
  if (item.kind === 'login') {
    let site;
    try { site = new URL(String(item.site)); } catch { stop('invalid', 'A sign-in needs the website it is for.'); }
    if (site.protocol !== 'https:') stop('invalid', 'Sign-ins are for https websites.');
    if (typeof item.password !== 'string' || !item.password) stop('invalid', 'A sign-in needs a password.');
    return { kind: 'login', site: site.origin, username: String(item.username || ''), password: item.password, totp: item.totp ? String(item.totp) : null };
  }
  if (item.kind === 'key') {
    const hosts = Array.isArray(item.hosts) ? item.hosts.map(h => String(h).trim().toLowerCase()).filter(Boolean) : [];
    if (!hosts.length || hosts.length > 20 || !hosts.every(h => HOST.test(h))) stop('invalid', 'A key needs the websites it may be sent to.');
    if (typeof item.value !== 'string' || !item.value || item.value.length > 16000) stop('invalid', 'A key needs its value.');
    const send = item.send || { as: 'bearer' };
    if (!['bearer', 'header', 'query', 'basic'].includes(send.as)) stop('invalid', 'How the key is sent is not valid.');
    if ((send.as === 'header' || send.as === 'query') && !HEADER.test(String(send.name || ''))) stop('invalid', 'The key needs the name of its header or parameter.');
    return { kind: 'key', value: item.value, hosts, send: { as: send.as, ...(send.name ? { name: String(send.name) } : {}), ...(send.as === 'basic' ? { username: String(send.username || '') } : {}) } };
  }
  stop('invalid', 'A vault item is a sign-in or a key.');
}

// What may be shown about an item: never its secret, nor a sign-in's username.
const describe = item => item.kind === 'login' ? { kind: 'login', site: item.site, totp: !!item.totp } : { kind: 'key', hosts: item.hosts, send: item.send.as };

function itemPath(id) {
  if (!ID.test(String(id))) stop('invalid', 'Not a vault item.');
  return path.join(ITEMS, id + '.json');
}
function load(id) {
  const file = itemPath(id);
  if (!fs.existsSync(file)) stop('not_found', 'That item is not in the vault on this computer.');
  return open(JSON.parse(fs.readFileSync(file, 'utf8')).envelope);
}

function put(input) {
  const item = open(input.envelope);
  fs.mkdirSync(ITEMS, { recursive: true, mode: 0o700 });
  fs.writeFileSync(itemPath(input.id), JSON.stringify({ envelope: input.envelope }), { mode: 0o600 });
  print(describe(item));
}

function remove(input) {
  fs.rmSync(itemPath(input.id), { force: true });
  print({ removed: true });
}

const allowed = (host, hosts) => hosts.some(h => h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h);

// Every way the secret could come back in a reply, replaced.
function scrub(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    const forms = new Set([secret, encodeURIComponent(secret), new URLSearchParams({ s: secret }).toString().slice(2), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)]);
    for (const form of forms) out = out.split(form).join(HIDDEN);
  }
  return out;
}

async function request(input) {
  const item = load(input.id);
  if (item.kind !== 'key') stop('wrong_kind', 'That item is a sign-in: it signs in through the browser, not in requests.');
  let url;
  try { url = new URL(String(input.url)); } catch { stop('invalid', 'url is not a web address.'); }
  const local = process.env.AGENT_ID_VAULT_TEST_HTTP === '1' && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) stop('https_only', 'Keys are only sent over https.');
  if (!local && !allowed(url.hostname.toLowerCase(), item.hosts)) stop('host_not_allowed', 'This key can only be sent to ' + item.hosts.join(', ') + '.');
  const method = String(input.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) stop('invalid', 'method is not valid.');
  const injected = item.send.as === 'bearer' || item.send.as === 'basic' ? 'authorization' : item.send.as === 'header' ? item.send.name.toLowerCase() : null;
  const headers = {};
  for (const [name, value] of Object.entries(input.headers || {})) {
    if (!HEADER.test(name)) continue;
    const lower = name.toLowerCase();
    if (lower === injected || ['authorization', 'proxy-authorization', 'cookie', 'host'].includes(lower)) continue;
    headers[name] = String(value).slice(0, 4000);
  }
  const secrets = [item.value];
  if (item.send.as === 'bearer') headers.Authorization = 'Bearer ' + item.value;
  else if (item.send.as === 'header') headers[item.send.name] = item.value;
  else if (item.send.as === 'query') url.searchParams.set(item.send.name, item.value);
  else {
    const pair = item.send.username + ':' + item.value;
    headers.Authorization = 'Basic ' + Buffer.from(pair).toString('base64');
    secrets.push(pair);
  }
  const body = input.body === undefined || input.body === null || method === 'GET' || method === 'HEAD' ? undefined : String(input.body).slice(0, 1000000);
  let response;
  try {
    response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  } catch (error) {
    stop('request_failed', scrub('The request did not go through: ' + (error && error.message || 'no answer'), secrets));
  }
  const text = method === 'HEAD' ? '' : await response.text();
  const limit = 200000;
  const location = response.headers.get('location');
  print({
    status: response.status,
    contentType: response.headers.get('content-type'),
    ...(location ? { location: scrub(location, secrets) } : {}),
    body: scrub(text.slice(0, limit), secrets),
    truncated: text.length > limit,
  });
}

const ops = { init, put, remove, request };
const op = ops[process.argv[2]];
if (!op) stop('invalid', 'Unknown vault operation.');
let input = {};
try { input = process.argv[3] ? JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8')) : {}; } catch { stop('invalid', 'The input is not valid.'); }
Promise.resolve(op(input)).catch(() => stop('failed', 'The vault could not do that.'));
`;
