// Agent passports: short-lived ES256 JWTs that say which agent is calling,
// for which audience, and how its owner is verified. Anyone can check one
// offline with the public keys at /.well-known/jwks.json; a company with a
// secret can also check it online, which catches a revoked agent at once.
import { base64url, fail, fromBase64url, hmac, utf8 } from './util.ts';
import type { Config } from './config.ts';

type Jwk = JsonWebKey & { kid?: string };
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

let cached: { source: string; key: CryptoKey; kid: string; publicJwk: Jwk } | null = null;
async function signingKey(config: Config) {
  if (!config.signingKey) throw fail(503, 'passports_unavailable', 'Agent passports are not set up on this deployment yet.');
  if (cached?.source === config.signingKey) return cached;
  let jwk: Jwk;
  try { jwk = JSON.parse(config.signingKey); } catch { throw fail(503, 'passports_unavailable', 'The passport signing key is not valid JSON.'); }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.kid) throw fail(503, 'passports_unavailable', 'The passport signing key must be a P-256 private JWK with a kid.');
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true }, ALG, false, ['sign']);
  const publicJwk: Jwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: jwk.kid, alg: 'ES256', use: 'sig' };
  cached = { source: config.signingKey, key, kid: jwk.kid, publicJwk };
  return cached;
}

// The current key and any previous ones still checking passports they signed.
export async function jwks(config: Config) {
  const keys: Jwk[] = [];
  if (config.signingKey) keys.push((await signingKey(config)).publicJwk);
  if (config.previousSigningKeys) {
    try {
      for (const key of JSON.parse(config.previousSigningKeys)) {
        if (key?.kty === 'EC' && key.crv === 'P-256' && key.kid && !keys.some(k => k.kid === key.kid)) keys.push({ kty: 'EC', crv: 'P-256', x: key.x, y: key.y, kid: key.kid, alg: 'ES256', use: 'sig' });
      }
    } catch { /* A malformed list publishes the current key only. */ }
  }
  return { keys };
}

const encode = (value: unknown) => base64url(utf8(JSON.stringify(value)));

export async function signJwt(config: Config, claims: Record<string, unknown>) {
  const { key, kid } = await signingKey(config);
  const input = `${encode({ alg: 'ES256', typ: 'JWT', kid })}.${encode(claims)}`;
  const signature = new Uint8Array(await crypto.subtle.sign(SIGN, key, utf8(input)));
  return `${input}.${base64url(signature)}`;
}

export type VerifiedPassport = { header: Record<string, any>; claims: Record<string, any> };
// Checks the signature, issuer, audience and time. `audience` null skips the
// audience check (the caller then compares it itself).
export async function verifyJwt(config: Config, token: string, audience: string | null, now = Date.now()): Promise<VerifiedPassport> {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw fail(400, 'malformed', 'This is not an agent passport.');
  let header: any, claims: any;
  try { header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0]))); claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))); }
  catch { throw fail(400, 'malformed', 'This is not an agent passport.'); }
  if (header?.alg !== 'ES256' || typeof header.kid !== 'string') throw fail(401, 'bad_signature', 'The passport is not signed with ES256.');
  const jwk = (await jwks(config)).keys.find(key => key.kid === header.kid);
  if (!jwk) throw fail(401, 'unknown_key', 'The passport was signed with a key Agent ID no longer uses.');
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, ALG, false, ['verify']);
  const ok = await crypto.subtle.verify(SIGN, key, fromBase64url(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
  if (!ok) throw fail(401, 'bad_signature', 'The passport signature is not valid.');
  const seconds = Math.floor(now / 1000);
  if (claims.iss !== config.issuer) throw fail(401, 'wrong_issuer', 'The passport was not issued by this Agent ID.');
  if (typeof claims.exp !== 'number' || claims.exp + 30 < seconds) throw fail(401, 'expired', 'The passport has expired.');
  if (typeof claims.nbf === 'number' && claims.nbf - 30 > seconds) throw fail(401, 'not_yet_valid', 'The passport is not valid yet.');
  if (audience !== null && claims.aud !== audience) throw fail(401, 'wrong_audience', 'The passport was issued for another audience.');
  return { header, claims };
}

// An owner reference that is stable for one audience but differs between
// audiences, so companies can't link an owner across sites. Timewarp can map
// it back to the person when someone has to be held responsible.
export async function pairwiseOwner(config: Config, ownerId: string, audience: string) {
  const secret = config.webhookSecret || config.signingKey || 'agent-id';
  return 'own_' + base64url(await hmac(secret, `owner|${ownerId}|${audience}`)).slice(0, 22);
}
