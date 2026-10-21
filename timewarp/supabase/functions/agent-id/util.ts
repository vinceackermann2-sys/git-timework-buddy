// Small shared pieces: errors, JSON responses, ids and keys, hashing, money.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => new ApiError(status, code, message, extra);

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,timewarp-agent,timewarp-claim-session,x-filename,mcp-protocol-version,mcp-session-id',
  'Access-Control-Expose-Headers': 'content-disposition',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
export const text = (body: string, status = 200, type = 'text/plain; charset=utf-8') =>
  new Response(body, { status, headers: { ...CORS, 'content-type': type, 'cache-control': 'no-store' } });

// A database result, or a 503 when storage is unavailable.
export function checked(result: { data: any; error: any }, what = 'Agent ID storage'): any {
  if (result.error) {
    console.error('[agent-id] database error', result.error?.code, result.error?.message);
    throw fail(503, 'unavailable', `${what} is temporarily unavailable.`);
  }
  return result.data;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
// Lowercase letters and digits, 5 random bits each.
export function randomId(length: number) {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte & 31];
  return out;
}
export const agentId = () => 'agt_' + randomId(24);
export const relyingPartyId = () => 'rp_' + randomId(24);

export function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
}
export const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
export const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export const utf8 = (value: string) => new TextEncoder().encode(value);

export async function sha256(value: string | Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', (typeof value === 'string' ? utf8(value) : value) as BufferSource));
}
export const sha256Hex = async (value: string | Uint8Array) => hex(await sha256(value));
export async function hmac(secret: string | Uint8Array, message: string, hash = 'SHA-256') {
  const key = await crypto.subtle.importKey('raw', (typeof secret === 'string' ? utf8(secret) : secret) as BufferSource, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(message)));
}
export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Secrets handed out once: agent keys (twa_), owner keys (two_) and company
// secrets (twrp_). The stored part is a SHA-256 hash and a short prefix.
export const KEY_KINDS = { agent: 'twa_', owner: 'two_', relyingParty: 'twrp_' } as const;
export function newSecret(kind: keyof typeof KEY_KINDS) {
  const secret = KEY_KINDS[kind] + base64url(randomBytes(32));
  return { secret, prefix: secret.slice(0, 12) };
}
export const keyKind = (token: string) =>
  token.startsWith(KEY_KINDS.agent) ? 'agent' : token.startsWith(KEY_KINDS.owner) ? 'owner' : token.startsWith(KEY_KINDS.relyingParty) ? 'relyingParty' : null;

// Plain, bounded text from input.
export function str(value: unknown, max: number, field: string, { required = false, multiline = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw fail(400, 'invalid', `${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw fail(400, 'invalid', `${field} must be text.`);
  const cleaned = multiline ? value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ');
  const trimmed = cleaned.trim();
  if (required && !trimmed) throw fail(400, 'invalid', `${field} is required.`);
  if (trimmed.length > max) throw fail(400, 'invalid', `${field} is longer than ${max} characters.`);
  return trimmed;
}
export function int(value: unknown, field: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) throw fail(400, 'invalid', `${field} must be a whole number between ${min} and ${max}.`);
  return n;
}

// Money in minor units (cents). Input may be cents (`amount`) or a decimal in
// whole units ("12.50" as `value`), which is what agents find natural.
export function cents(input: { amount?: unknown; value?: unknown }, field = 'amount') {
  if (input.amount !== undefined && input.amount !== null && input.amount !== '') return int(input.amount, field, { min: 1, max: 100_000_000_00 });
  const raw = typeof input.value === 'number' ? String(input.value) : input.value;
  if (typeof raw !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(raw.trim())) throw fail(400, 'invalid', `${field} must be an amount like 12.50.`);
  const [whole, fraction = ''] = raw.trim().split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (result <= 0) throw fail(400, 'invalid', `${field} must be more than zero.`);
  return result;
}
export const money = (amount: number | null | undefined, currency: string | null | undefined) =>
  amount === null || amount === undefined ? null : { amount, currency: currency || 'USD', display: `${(amount / 100).toFixed(2)} ${currency || 'USD'}` };

export const EMAIL = /^[^\s@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
export const E164 = /^\+[1-9][0-9]{6,14}$/;
export function phoneNumber(value: unknown, field = 'to') {
  const raw = str(value, 40, field, { required: true }).replace(/[\s().-]/g, '');
  if (!E164.test(raw)) throw fail(400, 'invalid', `${field} must be a phone number in international form, like +14155550123.`);
  return raw;
}
export function emailAddress(value: unknown, field = 'to') {
  const raw = str(value, 320, field, { required: true }).toLowerCase();
  const inner = /<([^<>]+)>\s*$/.exec(raw)?.[1] || raw;
  if (!EMAIL.test(inner)) throw fail(400, 'invalid', `${field} must be an email address.`);
  return inner;
}

// A handle for an agent's mail address: its name in lowercase with a short
// random tail, so two agents called "Research" don't collide.
export function handleFor(name: string) {
  const base = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'agent';
  return `${base}-${randomId(4)}`;
}
