// Saving into an agent's vault from the computer it works on: the secret is
// sealed here, before it goes anywhere, exactly as the owner's browser seals
// one (src/lib/agent-id/vault.ts): an AES-256-GCM key encrypts the item, and
// the vault's public key on the agent's own computer (RSA-OAEP with SHA-256)
// wraps that key. Agent ID passes it on sealed; only that vault opens it.
import crypto from 'node:crypto';
import { UsageError } from './errors.js';

export function seal(publicKey, item) {
  const aes = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aes, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(item), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const key = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes);
  return { v: 1, key: key.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') };
}

const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const NAME = /^[A-Za-z0-9-]{1,64}$/;

// "https://api.resend.com/emails, *.example.com" → ["api.resend.com", "*.example.com"]
export function hostsOf(value) {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map(h => String(h).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:?#].*$/, ''))
    .filter(Boolean);
  if (!list.length) throw new UsageError('Name the sites the key may be sent to, like api.resend.com.');
  if (list.length > 20) throw new UsageError('A key can go to at most 20 sites.');
  for (const host of list) if (!HOST.test(host)) throw new UsageError(`"${host}" isn't a website's address, like api.resend.com.`);
  return [...new Set(list)];
}

// How a key is sent: bearer (default), header:<Name>, query:<name> or basic:<user>.
export function sendOf(as, name, username) {
  const [how, rest] = String(as || 'bearer').split(/:(.*)/s);
  const kind = how.trim().toLowerCase();
  if (kind === 'bearer') return { as: 'bearer' };
  if (kind === 'header' || kind === 'query') {
    const field = String(rest ?? name ?? '').trim();
    if (!NAME.test(field)) throw new UsageError(`A key sent as a ${kind === 'header' ? 'header' : 'parameter'} needs its name, like ${kind === 'header' ? 'header:X-Api-Key' : 'query:api_key'}.`);
    return { as: kind, name: field };
  }
  if (kind === 'basic') return { as: 'basic', username: String(rest ?? username ?? '') };
  throw new UsageError('A key is sent as bearer, header:<Name>, query:<name> or basic:<user>.');
}

// What's saved: a key for some sites, or a sign-in for a website.
export function vaultItem({ kind, secret, hosts, as, name, username, site, totp }) {
  if (typeof secret !== 'string' || !secret.trim()) throw new UsageError('There is nothing to save: the key or password is empty.');
  if (secret.length > 16000) throw new UsageError('That is too long for a key or password.');
  if (kind === 'login') {
    let url;
    try { url = new URL(String(site ?? '')); } catch { throw new UsageError('A sign-in needs its website, like https://github.com/login.'); }
    if (url.protocol !== 'https:') throw new UsageError('Sign-ins are for https websites.');
    return { kind: 'login', site: url.origin, username: String(username ?? ''), password: secret, ...(totp ? { totp: String(totp) } : {}) };
  }
  if (kind === 'key' || kind === undefined) return { kind: 'key', value: secret, hosts: hostsOf(hosts), send: sendOf(as, name, username) };
  throw new UsageError('Save a key or a sign-in (login).');
}
