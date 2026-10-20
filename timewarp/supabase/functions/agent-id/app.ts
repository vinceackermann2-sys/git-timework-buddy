// Agent ID's HTTP service: the API behind the dashboard, the CLI, the MCP
// server and companies checking agents. index.ts serves it on Supabase.
//
// Who is calling decides what they can do:
//   - a signed-in Timewarp account (its session) or an owner key (two_…):
//     the account's agents, their resources, verification and companies;
//   - an agent key (twa_…): that one agent acting for itself, headless;
//   - an owner credential with a `Timewarp-Agent: agt_…` header: the owner
//     acting as one of their agents (the dashboard and the desktop app);
//   - a company secret (twrp_…): checking passports and signing keys.
import { ApiError, CORS, checked, fail, json, keyKind, sha256Hex, text } from './util.ts';
import { loadConfig, publicConfig, type Env } from './config.ts';
import { jwks } from './passport.ts';
import type { AgentRow, Ctx } from './context.ts';
import { ownerRoutes } from './owner.ts';
import { agentRoutes, RAW_ROUTES } from './agent.ts';
import { publicAllowedSigners, publicVerify, relyingPartyRoutes } from './relying.ts';
import { handleMcp } from './mcp.ts';
import { handleWebhook } from './webhooks.ts';

export type Owner = { kind: 'owner'; userId: string; email: string | null; via: 'session' | 'key'; keyId?: string };
export type AgentCaller = { kind: 'agent'; userId: string; agent: AgentRow; via: 'key' | 'owner'; keyId?: string };
export type RelyingParty = { kind: 'relyingParty'; rp: Record<string, any> };
export type Caller = Owner | AgentCaller | RelyingParty;

export type Route<C> = [method: string, pattern: string, handler: (ctx: Ctx, caller: C, input: any, params: Record<string, string>, req: Request) => Promise<unknown>];

const MAX_BODY = 1024 * 1024;
async function readBody(req: Request) {
  if (req.method === 'GET' || req.method === 'DELETE') return {};
  if (Number(req.headers.get('content-length')) > MAX_BODY) throw fail(413, 'too_large', 'The request is too large.');
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw fail(413, 'too_large', 'The request is too large.');
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw fail(400, 'invalid_json', 'The request body must be a JSON object.'); }
}

function match(pattern: string, path: string) {
  const want = pattern.split('/'), have = path.split('/');
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) { if (!have[i]) return null; params[want[i].slice(1)] = decodeURIComponent(have[i]); }
    else if (want[i] !== have[i]) return null;
  }
  return params;
}

const bearer = (req: Request) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

async function touchKey(ctx: Ctx, key: { id: string; last_used_at: string | null }) {
  if (key.last_used_at && ctx.now() - Date.parse(key.last_used_at) < 60_000) return;
  await ctx.admin.from('agent_id_keys').update({ last_used_at: new Date(ctx.now()).toISOString() }).eq('id', key.id);
}

export async function loadAgent(ctx: Ctx, id: string) {
  if (!/^agt_[a-z0-9]{24}$/.test(id)) return null;
  return checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', id).maybeSingle()) as AgentRow | null;
}

function actingAgent(agent: AgentRow | null) {
  if (!agent) throw fail(404, 'not_found', 'This agent does not exist.');
  if (agent.status === 'revoked') throw fail(401, 'agent_revoked', 'This agent has been revoked by its owner.');
  if (agent.status === 'suspended') throw fail(403, 'agent_suspended', 'This agent is paused by its owner.');
  return agent;
}

export async function authenticate(ctx: Ctx, req: Request): Promise<Caller> {
  const token = bearer(req);
  if (!token) throw fail(401, 'unauthenticated', 'Send an Agent ID key or a Timewarp session as a Bearer token.');
  const kind = keyKind(token);
  let owner: Owner | null = null;
  if (kind) {
    const hash = await sha256Hex(token);
    if (kind === 'relyingParty') {
      const rp = checked(await ctx.admin.from('agent_id_relying_parties').select('*').eq('secret_hash', hash).maybeSingle()) as any;
      if (!rp || rp.revoked_at) throw fail(401, 'invalid_key', 'This company secret is not valid.');
      return { kind: 'relyingParty', rp };
    }
    const key = checked(await ctx.admin.from('agent_id_keys').select('id,owner_user_id,agent_id,revoked_at,last_used_at').eq('hash', hash).maybeSingle()) as any;
    if (!key || key.revoked_at || (kind === 'agent') !== !!key.agent_id) throw fail(401, 'invalid_key', 'This key is not valid. It may have been revoked.');
    touchKey(ctx, key).catch(() => {});
    if (kind === 'agent') {
      const agent = actingAgent(await loadAgent(ctx, key.agent_id));
      if (agent.owner_user_id !== key.owner_user_id) throw fail(401, 'invalid_key', 'This key is not valid.');
      return { kind: 'agent', userId: agent.owner_user_id, agent, via: 'key', keyId: key.id };
    }
    owner = { kind: 'owner', userId: key.owner_user_id, email: null, via: 'key', keyId: key.id };
  } else {
    const { data, error } = await ctx.admin.auth.getUser(token);
    if (error || !data?.user) throw fail(401, 'unauthenticated', 'Your Timewarp session has expired. Sign in again.');
    owner = { kind: 'owner', userId: data.user.id, email: data.user.email || null, via: 'session' };
  }
  const as = (req.headers.get('timewarp-agent') || '').trim();
  if (as) {
    const agent = actingAgent(await loadAgent(ctx, as));
    if (agent.owner_user_id !== owner.userId) throw fail(404, 'not_found', 'This agent does not exist.');
    return { kind: 'agent', userId: owner.userId, agent, via: 'owner' };
  }
  return owner;
}

export function createHandler(deps: { admin: any; env: Env; fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> }) {
  const config = loadConfig(deps.env);
  const ctx: Ctx = { admin: deps.admin, config, fetch: deps.fetch || fetch, now: deps.now || Date.now, sleep: deps.sleep || (ms => new Promise(r => setTimeout(r, ms))) };
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const path = (url.pathname.split('/agent-id')[1] ?? url.pathname).replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && (path === '/' || path === '/healthz')) return json({ ok: true, service: 'agent-id' });
      if (req.method === 'GET' && path === '/.well-known/jwks.json') return json(await jwks(config), 200, { 'cache-control': 'public, max-age=300' });
      if (req.method === 'GET' && path === '/v1/config') return json(publicConfig(config));
      if (path.startsWith('/webhooks/')) return await handleWebhook(ctx, req, path);
      // Open to every service and repository, no account needed: checking a
      // passport shown to you, and an organization's Git signers.
      if (path === '/v1/verify' && req.method === 'POST' && !bearer(req)) return json(await publicVerify(ctx, await readBody(req)));
      const signers = /^\/v1\/orgs\/([0-9a-f-]{36})\/allowed-signers$/.exec(path);
      if (signers && req.method === 'GET') { const result = await publicAllowedSigners(ctx, signers[1], Object.fromEntries(url.searchParams)); return result instanceof Response ? result : json(result); }
      if (path === '/mcp') {
        if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Use POST for MCP.' } }, 405, { allow: 'POST' });
        const caller = await authenticate(ctx, req);
        if (caller.kind !== 'agent') throw fail(403, 'agent_only', 'The MCP server acts as an agent: use an agent key, or name the agent in a Timewarp-Agent header.');
        return await handleMcp(ctx, caller, req);
      }
      const caller = await authenticate(ctx, req);
      const routes: Route<any>[] = caller.kind === 'agent' ? agentRoutes : caller.kind === 'owner' ? ownerRoutes : relyingPartyRoutes;
      for (const [method, pattern, handler] of routes) {
        if (method !== req.method) continue;
        const params = match(pattern, path);
        if (!params) continue;
        const input = req.method === 'GET' ? Object.fromEntries(url.searchParams) : RAW_ROUTES.has(`${method} ${pattern}`) ? {} : await readBody(req);
        const result = await handler(ctx, caller, input, params, req);
        return result instanceof Response ? result : json(result);
      }
      const other = [ownerRoutes, agentRoutes, relyingPartyRoutes].some(list => list.some(([, pattern]) => match(pattern, path)));
      throw other ? fail(403, 'wrong_credential', caller.kind === 'agent' ? 'Agents can\'t use this endpoint; it needs the owner.' : caller.kind === 'owner' ? 'This endpoint acts as an agent: use an agent key or a Timewarp-Agent header.' : 'Company secrets can only check passports and signing keys.') : fail(404, 'not_found', 'This endpoint does not exist.');
    } catch (error) {
      if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status);
      console.error('[agent-id] unexpected', error);
      return json({ error: { code: 'internal', message: 'Agent ID could not complete the request.' } }, 500);
    }
  };
}

export { text };
