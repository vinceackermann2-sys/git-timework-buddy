// @timewarp/agent-id-verify: check Timewarp Agent ID passports.
//
// An agent proves who it is with a short-lived passport: an ES256 JWT that
// names the agent, the audience it was issued for, and how its owner is
// verified. This module checks one offline against Agent ID's public keys
// (verifyPassport), online against Agent ID itself, which also catches an
// agent revoked a second ago (checkPassport), and wraps both as middleware.
// WebCrypto and fetch only: Node 20+, Deno, Bun and Cloudflare Workers.

export const DEFAULT_API = 'https://mrqoeywofslgnquvzhuf.supabase.co/functions/v1/agent-id';
export const PASSPORT_HEADER = 'Agent-Passport';

const LEVELS = ['any', 'verified', 'kyc', 'kyb'];
const CONFIG_TTL_MS = 60 * 60 * 1000;
const DEFAULT_JWKS_TTL_S = 300;
const MIN_REFETCH_MS = 60 * 1000;

export class AgentIdError extends Error {
  constructor(code, message, status = 401, details = undefined) {
    super(message);
    this.name = 'AgentIdError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, status = 401, details) => new AgentIdError(code, message, status, details);
const trimSlash = value => String(value).replace(/\/+$/, '');
// No environment lookups: Deno asks for permission, Workers have none.
const apiOf = options => trimSlash(options?.api || DEFAULT_API);
const fetchOf = options => options?.fetch || globalThis.fetch;

function decodeBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('not base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
const decodeJson = part => JSON.parse(new TextDecoder().decode(decodeBase64url(part)));

// --- Where to find the issuer and keys -----------------------------------------
const configCache = new Map();
async function deploymentConfig(api, fetchImpl) {
  const cached = configCache.get(api);
  if (cached && cached.expires > Date.now()) return cached.value;
  let response, body;
  try {
    response = await fetchImpl(`${api}/v1/config`, { headers: { accept: 'application/json' } });
    body = await response.json();
  } catch (error) {
    if (cached) return cached.value;
    throw fail('config_unavailable', `Could not read Agent ID's configuration from ${api}/v1/config: ${error?.message || error}`, 503);
  }
  if (!response.ok || typeof body?.issuer !== 'string' || typeof body?.jwks !== 'string') {
    if (cached) return cached.value;
    throw fail('config_unavailable', `Agent ID at ${api} did not return its issuer and key set (HTTP ${response.status}).`, 503);
  }
  const value = { issuer: body.issuer, jwks: body.jwks };
  configCache.set(api, { value, expires: Date.now() + CONFIG_TTL_MS });
  return value;
}

// Explicit options win; otherwise the deployment says (GET <api>/v1/config).
async function issuerAndJwks(options) {
  const api = apiOf(options);
  if (options.issuer) return { issuer: options.issuer, jwks: options.jwksUrl || `${api}/.well-known/jwks.json` };
  const config = await deploymentConfig(api, fetchOf(options));
  return { issuer: config.issuer, jwks: options.jwksUrl || config.jwks };
}

// --- Public keys, cached -------------------------------------------------------
// One entry per JWKS address: the keys, when they go stale (the response's
// max-age), and when they were last fetched, so a passport with an unknown
// key id refetches at most once a minute.
const jwksCache = new Map();

function maxAgeOf(response) {
  const header = response.headers?.get?.('cache-control') || '';
  if (/no-store|no-cache/i.test(header)) return 0;
  const match = /max-age=(\d+)/i.exec(header);
  const seconds = match ? Number(match[1]) : DEFAULT_JWKS_TTL_S;
  return Math.min(Math.max(seconds, 0), 24 * 60 * 60);
}

async function loadJwks(url, fetchImpl, previous) {
  const fetchedAt = Date.now();
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.keys)) throw new Error('no keys in the response');
    const keys = new Map();
    for (const jwk of body.keys) {
      if (jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.kid === 'string' && jwk.x && jwk.y) keys.set(jwk.kid, { jwk, key: null });
    }
    return { keys, fetchedAt, expires: fetchedAt + maxAgeOf(response) * 1000 };
  } catch (error) {
    // Keep checking with the keys we had rather than failing every request.
    if (previous) return { ...previous, fetchedAt, expires: fetchedAt + MIN_REFETCH_MS };
    throw fail('jwks_unavailable', `Could not load Agent ID's public keys from ${url}: ${error?.message || error}`, 503);
  }
}

async function refresh(url, fetchImpl, previous) {
  const current = jwksCache.get(url);
  if (current?.pending) return current.pending;
  const pending = loadJwks(url, fetchImpl, previous).then(
    entry => { jwksCache.set(url, entry); return entry; },
    error => { if (previous) jwksCache.set(url, previous); else jwksCache.delete(url); throw error; },
  );
  jwksCache.set(url, { ...(previous || {}), pending });
  return pending;
}

async function publicKey(url, kid, fetchImpl) {
  let entry = jwksCache.get(url);
  if (entry?.pending) entry = await entry.pending;
  if (!entry || Date.now() >= entry.expires) entry = await refresh(url, fetchImpl, entry);
  let found = entry.keys.get(kid);
  if (!found && Date.now() - entry.fetchedAt >= MIN_REFETCH_MS) {
    entry = await refresh(url, fetchImpl, entry);
    found = entry.keys.get(kid);
  }
  if (!found) throw fail('unknown_key', 'The passport was signed with a key Agent ID does not publish.');
  if (!found.key) {
    const { x, y } = found.jwk;
    found.key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
  return found.key;
}

// --- Policy --------------------------------------------------------------------
function meets(require, level) {
  if (require === 'any') return true;
  if (require === 'kyb') return level === 'kyb';
  if (require === 'kyc') return level === 'kyc' || level === 'kyb';
  return level === 'kyc' || level === 'kyb'; // 'verified'
}

const list = value => value === undefined || value === null ? null : Array.isArray(value) ? value : [value];

function checkPolicy(claims, options) {
  const require = options.require ?? 'verified';
  const level = claims.owner?.level || 'none';
  if (!meets(require, level)) {
    throw fail('owner_not_verified', require === 'kyb'
      ? 'This service only accepts agents of a verified business.'
      : 'This service only accepts agents whose owner has verified their identity.', 403, { require, level });
  }
  const organizations = list(options.organizations);
  if (organizations && organizations.length && !organizations.includes(claims.org?.id)) {
    throw fail('organization_not_allowed', 'This service only accepts agents of certain organizations.', 403);
  }
  const agents = list(options.agents);
  if (agents && agents.length && !agents.includes(claims.sub)) {
    throw fail('agent_not_allowed', 'This service does not accept this agent.', 403);
  }
}

// --- Offline check ---------------------------------------------------------------
export async function verifyPassport(token, options = {}) {
  const audiences = list(options.audience);
  if (!audiences || !audiences.length || audiences.some(a => typeof a !== 'string' || !a)) throw new TypeError('verifyPassport needs options.audience: the audience your service accepts passports for.');
  if (options.require !== undefined && !LEVELS.includes(options.require)) throw new TypeError(`options.require is one of ${LEVELS.join(', ')}.`);
  if (typeof token !== 'string' || !token.trim()) throw fail('passport_required', 'Send an agent passport in the Agent-Passport header.');
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw fail('malformed', 'This is not an agent passport.');
  let header, claims, signature;
  try { header = decodeJson(parts[0]); claims = decodeJson(parts[1]); signature = decodeBase64url(parts[2]); }
  catch { throw fail('malformed', 'This is not an agent passport.'); }
  if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') throw fail('malformed', 'This is not an agent passport.');
  if (header.alg !== 'ES256' || typeof header.kid !== 'string') throw fail('bad_signature', 'The passport is not signed with ES256.');
  if (signature.length !== 64) throw fail('bad_signature', 'The passport signature is not valid.');

  const { issuer, jwks } = await issuerAndJwks(options);
  const key = await publicKey(jwks, header.kid, fetchOf(options));
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw fail('bad_signature', 'The passport signature is not valid.');

  const tolerance = Number.isFinite(options.clockToleranceSeconds) ? Math.max(0, options.clockToleranceSeconds) : 30;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer) throw fail('wrong_issuer', 'The passport was not issued by this Agent ID.');
  if (typeof claims.exp !== 'number' || claims.exp + tolerance < now) throw fail('expired', 'The passport has expired.');
  if (typeof claims.nbf === 'number' && claims.nbf - tolerance > now) throw fail('not_yet_valid', 'The passport is not valid yet.');
  const issuedFor = list(claims.aud) || [];
  if (!issuedFor.some(aud => audiences.includes(aud))) throw fail('wrong_audience', 'The passport was issued for another audience.');
  if (typeof claims.sub !== 'string' || !claims.sub) throw fail('malformed', 'The passport does not name an agent.');

  checkPolicy(claims, options);
  return {
    agent: { id: claims.sub, ...(claims.agent || {}) },
    owner: claims.owner || null,
    org: claims.org || null,
    claims,
  };
}

// --- Online check ----------------------------------------------------------------
async function companyRequest(options, method, path, body) {
  if (!options?.secret) throw new TypeError('Pass your company secret (twrp_…) as options.secret.');
  const api = apiOf(options);
  let response;
  try {
    response = await fetchOf(options)(`${api}${path}`, {
      method,
      headers: { authorization: `Bearer ${options.secret}`, ...(body ? { 'content-type': 'application/json' } : {}), accept: 'application/json, text/plain' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw fail('unavailable', `Could not reach Agent ID at ${api}: ${error?.message || error}`, 503);
  }
  if (!response.ok) {
    let error = null;
    try { error = (await response.json())?.error; } catch { /* not JSON */ }
    throw fail(error?.code || 'unavailable', error?.message || `Agent ID answered HTTP ${response.status}.`, response.status === 401 || response.status === 403 ? 500 : 503);
  }
  return response;
}

export async function checkPassport(token, options = {}) {
  const response = await companyRequest(options, 'POST', '/v1/verify', { passport: String(token || '') });
  return response.json();
}

export async function fetchAllowedSigners(options = {}) {
  const response = await companyRequest(options, 'GET', '/v1/allowed-signers');
  return response.text();
}

// --- Reading the passport from a request -------------------------------------------
function headerOf(source, name) {
  const headers = source?.headers ?? source;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  let value = headers[name];
  if (value === undefined) {
    const key = Object.keys(headers).find(k => k.toLowerCase() === name);
    value = key === undefined ? undefined : headers[key];
  }
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' ? value : null;
}

export function passportFrom(request) {
  const direct = headerOf(request, 'agent-passport');
  if (direct && direct.trim()) return direct.trim();
  const match = /^\s*AgentPassport\s+(\S+)\s*$/i.exec(headerOf(request, 'authorization') || '');
  return match ? match[1] : null;
}

// --- Middleware ----------------------------------------------------------------------
async function authenticate(token, options) {
  if (!token) throw fail('passport_required', 'This service only accepts verified AI agents: send an Agent ID passport in the Agent-Passport header.');
  const agent = await verifyPassport(token, options);
  if (options.online) {
    const online = await checkPassport(token, { api: options.api, fetch: options.fetch, ...options.online });
    agent.online = online;
    if (!online.valid) throw fail(online.reason || (online.agent?.status ? `agent_${online.agent.status}` : 'invalid'), online.message || 'Agent ID no longer vouches for this agent.', 401);
    if (online.allowed === false) throw fail(online.reasons?.[0] || 'not_allowed', 'This agent does not meet this service\'s policy right now.', 403, { reasons: online.reasons || [] });
  }
  return agent;
}

const errorBody = error => JSON.stringify({ error: { code: error.code, message: error.message, ...(error.details && typeof error.details === 'object' ? error.details : {}) } });
const errorHeaders = error => ({ 'content-type': 'application/json', ...(error.status === 401 ? { 'www-authenticate': 'AgentPassport' } : {}) });

export function agentIdMiddleware(options = {}) {
  if (!list(options.audience)?.length) throw new TypeError('agentIdMiddleware needs options.audience.');
  return async function agentId(req, res, next) {
    try {
      req.agent = await authenticate(passportFrom(req), options);
    } catch (error) {
      if (!(error instanceof AgentIdError)) return next ? next(error) : (res.statusCode = 500, res.end());
      res.statusCode = error.status;
      for (const [name, value] of Object.entries(errorHeaders(error))) res.setHeader(name, value);
      return res.end(errorBody(error));
    }
    return next ? next() : undefined;
  };
}

export function withAgentId(handler, options = {}) {
  if (typeof handler !== 'function') throw new TypeError('withAgentId(handler, options) needs a handler.');
  if (!list(options.audience)?.length) throw new TypeError('withAgentId needs options.audience.');
  return async function agentIdHandler(request, ...rest) {
    let agent;
    try {
      agent = await authenticate(passportFrom(request), options);
    } catch (error) {
      if (!(error instanceof AgentIdError)) throw error;
      return new Response(errorBody(error), { status: error.status, headers: errorHeaders(error) });
    }
    return handler(request, agent, ...rest);
  };
}
