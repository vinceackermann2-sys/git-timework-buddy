// Getting an Agent ID without an account. An agent (the CLI's `attach`) or a
// person (the website) starts a claim and gets a link. Whoever opens it
// confirms their email with a code, accepts the terms and verifies their
// identity; that makes their Timewarp account (or joins the one they have).
// Once they're verified the agent is created for them, and its key goes once
// to whoever holds the claim's secret: the CLI that asked, or the command the
// website shows. Nothing here needs a sign-in; the link, the email code and
// the claim session stand in for it.
import { base64url, checked, EMAIL, fail, handleFor, agentId as newAgentId, newSecret, randomBytes, randomId, sameText, sha256Hex, str } from './util.ts';
import type { AgentRow, Ctx } from './context.ts';
import type { Owner } from './app.ts';
import { APPS, appOf } from './origin.ts';
import { audit, personOf, resourcesOf } from './shared.ts';
import { personView, startVerification } from './verification.ts';
import { autoGive } from './provisioning.ts';

const CLAIM_MINUTES = 60;          // An unanswered claim link works for an hour,
const VERIFYING_DAYS = 7;          // and for a week once an identity check is running.
const CODE_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5, MAX_CODE_SENDS = 5, RESEND_SECONDS = 30, CLAIMS_PER_HOUR = 20;

const iso = (ctx: Ctx, plus = 0) => new Date(ctx.now() + plus).toISOString();
const expired = (ctx: Ctx, row: any) => Date.parse(row.expires_at) <= ctx.now();
const MATCH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const matchCode = () => { const bytes = randomBytes(8); let out = ''; for (let i = 0; i < 8; i++) { out += MATCH[bytes[i] % MATCH.length]; if (i === 3) out += '-'; } return out; };
const maskEmail = (email: string | null) => email ? email.replace(/^(.)(.*)(@.*)$/, (_m, first, rest, domain) => first + '•'.repeat(Math.min(6, Math.max(2, rest.length))) + domain) : null;
const appView = (app: string | null) => app ? { app, label: APPS[app] || app.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) } : null;

async function clientIpHash(ctx: Ctx, req: Request) {
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim();
  return ip ? sha256Hex(`${ctx.config.webhookSecret}:${ip}`) : null;
}

// The step the person is on: confirm an email, verify who they are, or done.
function stepOf(row: any, person: any) {
  if (row.status === 'claimed') return 'done';
  if (!row.email_verified_at) return 'email';
  if (person?.status === 'pending') return 'checking';
  return 'identity';
}

async function claimView(ctx: Ctx, row: any, full: boolean) {
  const person = full && row.user_id ? await personOf(ctx, row.user_id) : null;
  const agent = full && row.agent_id ? checked(await ctx.admin.from('agent_id_agents').select('id,name,handle').eq('id', row.agent_id).maybeSingle()) as any : null;
  const resources = agent ? await resourcesOf(ctx, [agent.id]) : [];
  return {
    code: row.code, name: row.name, app: appView(row.app), device: row.device || null, startedBy: row.started_by, matchCode: row.match_code,
    status: row.status !== 'claimed' && expired(ctx, row) ? 'expired' : row.status,
    email: full ? row.email : maskEmail(row.email), emailConfirmed: !!row.email_verified_at,
    expiresAt: row.expires_at, createdAt: row.created_at,
    ...(full ? {
      step: stepOf(row, person),
      person: personView(person),
      terms: { accepted: person?.terms_version === ctx.config.termsVersion && !!person?.terms_accepted_at, current: ctx.config.termsVersion },
      agent: agent ? { id: agent.id, name: agent.name, handle: agent.handle, resources: Object.fromEntries(resources.map(r => [r.kind, { status: r.status, address: r.address, mode: r.mode }])) } : null,
      keyCollected: !!row.key_delivered_at,
    } : {}),
  };
}

async function claimByCode(ctx: Ctx, code: string) {
  const row = /^[a-z0-9]{20,40}$/.test(code) ? checked(await ctx.admin.from('agent_id_claims').select('*').eq('code', code).maybeSingle()) : null;
  if (!row || row.status === 'canceled') throw fail(404, 'not_found', 'This link isn\'t valid. Ask your agent for a new one.');
  return row as any;
}
// The claim, opened by the browser that confirmed its email.
async function sessionClaim(ctx: Ctx, code: string, session: unknown) {
  const row = await claimByCode(ctx, code);
  if (typeof session !== 'string' || !row.session_hash || !sameText(await sha256Hex(session), row.session_hash)) throw fail(401, 'claim_session', 'Confirm your email again to continue.');
  return row;
}
const open = (ctx: Ctx, row: any) => {
  if (row.status === 'claimed') throw fail(409, 'already_claimed', 'This Agent ID is already set up.');
  if (expired(ctx, row)) throw fail(410, 'expired', 'This link has expired. Ask your agent for a new one.');
  return row;
};

// --- Start -------------------------------------------------------------------
export async function startClaim(ctx: Ctx, req: Request, input: any) {
  const name = str(input.name, 60, 'name') || 'My agent';
  const app = input.app ? appOf(input.app, 'app') : null;
  const startedBy = input.startedBy === 'person' ? 'person' : 'agent';
  const ipHash = await clientIpHash(ctx, req);
  if (ipHash) {
    const recent = (checked(await ctx.admin.from('agent_id_claims').select('id').eq('ip_hash', ipHash).gt('created_at', iso(ctx, -3_600_000))) || []) as any[];
    if (recent.length >= CLAIMS_PER_HOUR) throw fail(429, 'rate_limited', 'Too many Agent IDs asked for from this network. Try again in an hour.', { retryAfterSeconds: 3600 });
  }
  const { secret } = newSecret('agent');
  const claimSecret = 'twc_' + secret.slice(4);
  const row = checked(await ctx.admin.from('agent_id_claims').insert({
    code: randomId(24), match_code: matchCode(), secret_hash: await sha256Hex(claimSecret), started_by: startedBy,
    name, app, client_name: str(input.clientName, 100, 'clientName') || null, device: str(input.device, 100, 'device') || null,
    ip_hash: ipHash, expires_at: iso(ctx, CLAIM_MINUTES * 60_000),
  }).select('*').single());
  return { claim: await claimView(ctx, row, false), url: `${ctx.config.siteUrl}/agent-id/claim/${row.code}`, secret: claimSecret };
}

export async function getClaim(ctx: Ctx, req: Request, code: string) {
  let row = await claimByCode(ctx, code);
  const session = req.headers.get('timewarp-claim-session');
  if (!session) return { claim: await claimView(ctx, row, false) };
  row = await sessionClaim(ctx, code, session);
  if (row.status !== 'claimed' && row.user_id) row = (await completeClaims(ctx, row.user_id, row.id)) || row;
  return { claim: await claimView(ctx, row, true) };
}

// --- Email -------------------------------------------------------------------
async function sendCode(ctx: Ctx, email: string, code: string, name: string) {
  const key = ctx.config.env('RESEND_API_KEY');
  if (!key) {
    if (ctx.config.testMode) return { devCode: code };
    throw fail(503, 'provider_unavailable', 'Email codes can\'t be sent right now. Try again later.');
  }
  const safeName = name.replace(/[<>&"]/g, '');
  const response = await ctx.fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Timewarp Agent ID <no-reply@${ctx.config.mailDomain}>`, to: [email],
      subject: `${code} is your Timewarp code`,
      text: `Your code to set up ${safeName}'s Agent ID is ${code}.\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1c1b22"><p style="font-size:15px">Your code to set up <b>${safeName}</b>'s Agent ID:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p><p style="font-size:13px;color:#6b6878">It works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.</p></div>`,
      tags: [{ name: 'agent_id', value: 'claim_code' }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as any;
    console.error('[agent-id] claim code mail', response.status, payload?.message);
    throw fail(502, 'mail_failed', 'The code couldn\'t be sent. Check the address and try again.');
  }
  return {};
}

export async function sendClaimCode(ctx: Ctx, code: string, input: any) {
  const row = open(ctx, await claimByCode(ctx, code));
  const email = str(input.email, 320, 'email', { required: true }).toLowerCase();
  if (!EMAIL.test(email)) throw fail(400, 'invalid', 'Enter a valid email address.');
  if (email.endsWith(`@${ctx.config.mailDomain}`)) throw fail(400, 'invalid', 'Use your own email, not an agent\'s address.');
  if (row.email_sends >= MAX_CODE_SENDS) throw fail(429, 'rate_limited', 'Too many codes for this link. Ask your agent for a new one.');
  if (row.email_code_sent_at && ctx.now() - Date.parse(row.email_code_sent_at) < RESEND_SECONDS * 1000) throw fail(429, 'rate_limited', 'Wait a few seconds before asking for another code.', { retryAfterSeconds: RESEND_SECONDS });
  const digits = String(Number(new DataView(randomBytes(4).buffer).getUint32(0) % 1_000_000)).padStart(6, '0');
  checked(await ctx.admin.from('agent_id_claims').update({
    email, email_code_hash: await sha256Hex(`${row.id}:${digits}`), email_code_sent_at: iso(ctx), email_code_expires_at: iso(ctx, CODE_MINUTES * 60_000),
    email_attempts: 0, email_sends: row.email_sends + 1, email_verified_at: null, session_hash: null, user_id: null, updated_at: iso(ctx),
  }).eq('id', row.id).select('id'));
  const sent = await sendCode(ctx, email, digits, row.name);
  return { sent: true, email, ...sent };
}

// The account behind an email: the one that exists, or a new one (its email
// confirmed by the code just entered).
async function accountFor(ctx: Ctx, email: string) {
  const existing = checked(await ctx.admin.rpc('agent_id_user_by_email', { p_email: email }));
  if (existing) return { userId: String(existing), created: false };
  const { data, error } = await ctx.admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { source: 'agent_id_claim' } });
  if (error || !data?.user?.id) {
    // Made a moment ago by another request: use it.
    const again = checked(await ctx.admin.rpc('agent_id_user_by_email', { p_email: email }));
    if (again) return { userId: String(again), created: false };
    console.error('[agent-id] create account', error?.message);
    throw fail(503, 'unavailable', 'Your account couldn\'t be created right now. Try again.');
  }
  return { userId: String(data.user.id), created: true };
}

export async function confirmClaimEmail(ctx: Ctx, code: string, input: any) {
  const row = open(ctx, await claimByCode(ctx, code));
  const digits = str(input.code, 10, 'code', { required: true }).replace(/\s+/g, '');
  if (!row.email || !row.email_code_hash) throw fail(400, 'invalid', 'Ask for a code first.');
  if (row.email_attempts >= MAX_CODE_ATTEMPTS) throw fail(429, 'rate_limited', 'Too many wrong codes. Ask for a new one.');
  if (Date.parse(row.email_code_expires_at) <= ctx.now()) throw fail(410, 'code_expired', 'This code has expired. Ask for a new one.');
  if (!sameText(await sha256Hex(`${row.id}:${digits}`), row.email_code_hash)) {
    await ctx.admin.from('agent_id_claims').update({ email_attempts: row.email_attempts + 1 }).eq('id', row.id);
    throw fail(400, 'wrong_code', 'That code isn\'t right. Check the email and try again.');
  }
  const account = await accountFor(ctx, row.email);
  const session = 'twcs_' + base64url(randomBytes(32));
  const updated = checked(await ctx.admin.from('agent_id_claims').update({
    user_id: account.userId, email_verified_at: iso(ctx), email_code_hash: null, session_hash: await sha256Hex(session), updated_at: iso(ctx),
  }).eq('id', row.id).select('*').single());
  await audit(ctx, account.userId, null, 'owner', account.created ? 'account.create_by_claim' : 'claim.email_confirmed', { claim: row.id });
  // Signed in on the website from here on, like a magic link would.
  const auth = ctx.signIn ? await ctx.signIn(row.email).catch(error => { console.error('[agent-id] claim sign-in', error?.message); return null; }) : null;
  const done = (await completeClaims(ctx, account.userId, row.id)) || updated;
  return { session, auth, claim: await claimView(ctx, done, true) };
}

// --- Identity ------------------------------------------------------------------
export async function verifyClaimIdentity(ctx: Ctx, req: Request, code: string, input: any) {
  const row = open(ctx, await sessionClaim(ctx, code, req.headers.get('timewarp-claim-session')));
  if (!row.user_id) throw fail(400, 'invalid', 'Confirm your email first.');
  const person = await personOf(ctx, row.user_id);
  if (!(person?.terms_version === ctx.config.termsVersion && person?.terms_accepted_at)) {
    if (input.terms !== ctx.config.termsVersion) throw fail(400, 'terms_required', 'Accept the Agent ID Terms to continue.', { current: ctx.config.termsVersion });
    checked(await ctx.admin.from('agent_id_people').upsert({ user_id: row.user_id, terms_version: ctx.config.termsVersion, terms_accepted_at: iso(ctx), updated_at: iso(ctx) }, { onConflict: 'user_id' }).select('user_id'));
    await audit(ctx, row.user_id, null, 'owner', 'terms.accept', { version: ctx.config.termsVersion, via: 'claim' });
  }
  await ctx.admin.from('agent_id_claims').update({ status: 'verifying', expires_at: iso(ctx, VERIFYING_DAYS * 86_400_000), updated_at: iso(ctx) }).eq('id', row.id);
  const owner: Owner = { kind: 'owner', userId: row.user_id, email: row.email, via: 'session' };
  const result: any = await startVerification(ctx, owner, { ...input, kind: 'person' }, { returnUrl: `${ctx.config.siteUrl}/agent-id/claim/${row.code}?checked=1` });
  const done = await completeClaims(ctx, row.user_id, row.id);
  return { ...(result.url ? { url: result.url } : {}), claim: await claimView(ctx, done || { ...row, status: 'verifying' }, true) };
}

// --- Finishing -------------------------------------------------------------------
// Creates the agents of an account's claims once its owner is verified (from
// the identity webhook, a review, or someone looking at the claim). Returns
// the claim `onlyId` names, as it is now.
export async function completeClaims(ctx: Ctx, userId: string, onlyId?: string) {
  const person = await personOf(ctx, userId);
  const termsAccepted = person?.terms_version === ctx.config.termsVersion && !!person?.terms_accepted_at;
  if (person?.status !== 'verified' || (ctx.config.termsRequired && !termsAccepted)) return onlyId ? checked(await ctx.admin.from('agent_id_claims').select('*').eq('id', onlyId).maybeSingle()) : null;
  const rows = (checked(await ctx.admin.from('agent_id_claims').select('*').eq('user_id', userId).in('status', ['pending', 'verifying'])) || []) as any[];
  let result: any = null;
  for (const row of rows) {
    if (!row.email_verified_at || expired(ctx, row)) continue;
    // Claimed only once, even when two requests finish it together.
    const taken = checked(await ctx.admin.from('agent_id_claims').update({ status: 'claimed', updated_at: iso(ctx) }).eq('id', row.id).in('status', ['pending', 'verifying']).select('*')) as any[];
    if (!taken?.length) continue;
    try {
      const agent = await createClaimedAgent(ctx, userId, row);
      const finished = checked(await ctx.admin.from('agent_id_claims').update({ agent_id: agent.id, updated_at: iso(ctx) }).eq('id', row.id).select('*').single());
      if (row.id === onlyId) result = finished;
    } catch (error) {
      await ctx.admin.from('agent_id_claims').update({ status: row.status, updated_at: iso(ctx) }).eq('id', row.id);
      throw error;
    }
  }
  return result || (onlyId ? checked(await ctx.admin.from('agent_id_claims').select('*').eq('id', onlyId).maybeSingle()) : null);
}

async function createClaimedAgent(ctx: Ctx, userId: string, claim: any) {
  const active = (checked(await ctx.admin.from('agent_id_agents').select('id').eq('owner_user_id', userId).neq('status', 'revoked')) || []) as any[];
  if (active.length >= ctx.config.maxAgents) throw fail(409, 'too_many', `An account can have at most ${ctx.config.maxAgents} agents. Revoke one in Agent ID first.`);
  let agent: AgentRow | null = null;
  for (let attempt = 0; attempt < 3 && !agent; attempt++) {
    const { data, error } = await ctx.admin.from('agent_id_agents').insert({ id: newAgentId(), owner_user_id: userId, name: claim.name, handle: handleFor(claim.name), runtime: claim.app || 'custom' }).select('*').single();
    if (error?.code === '23505') continue;
    agent = checked({ data, error });
  }
  if (!agent) throw fail(503, 'unavailable', 'The agent couldn\'t be created. Try again.');
  if (claim.app) await ctx.admin.from('agent_id_agent_clients').upsert({ agent_id: agent.id, app: claim.app, client_name: claim.client_name, last_seen_at: iso(ctx) }, { onConflict: 'agent_id,app' });
  await audit(ctx, userId, agent.id, 'owner', 'agent.create', { name: agent.name, runtime: agent.runtime, via: 'claim', claim: claim.id });
  await autoGive(ctx, agent).catch(error => console.error('[agent-id] claim setup', (error as Error)?.message));
  return agent;
}

// The agent's key, once, to the holder of the claim's secret.
export async function collectClaim(ctx: Ctx, input: any) {
  const secret = str(input.secret, 100, 'secret', { required: true });
  if (!secret.startsWith('twc_')) throw fail(400, 'invalid', 'This isn\'t a claim secret.');
  let row = checked(await ctx.admin.from('agent_id_claims').select('*').eq('secret_hash', await sha256Hex(secret)).maybeSingle()) as any;
  if (!row || row.status === 'canceled') throw fail(404, 'not_found', 'No claim with this secret.');
  if (row.status !== 'claimed' && row.user_id) row = (await completeClaims(ctx, row.user_id, row.id)) || row;
  if (row.status !== 'claimed' || !row.agent_id) {
    if (expired(ctx, row)) throw fail(410, 'expired', 'The link expired before it was used. Run the command again for a new one.');
    return { status: row.email_verified_at ? 'verifying' : 'waiting', claim: await claimView(ctx, row, false) };
  }
  // Marked first, so two requests can't both take the key.
  const taken = checked(await ctx.admin.from('agent_id_claims').update({ key_delivered_at: iso(ctx) }).eq('id', row.id).is('key_delivered_at', null).select('id')) as any[];
  if (!taken?.length) throw fail(409, 'already_collected', 'This Agent ID\'s key was already collected. Make a new key in Agent ID if you need one.');
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', row.agent_id).single()) as AgentRow;
  const { secret: key, prefix } = newSecret('agent');
  checked(await ctx.admin.from('agent_id_keys').insert({ owner_user_id: agent.owner_user_id, agent_id: agent.id, name: 'Set up by link', prefix, hash: await sha256Hex(key) }).select('id'));
  await audit(ctx, agent.owner_user_id, agent.id, 'owner', 'agent_key.create', { prefix, via: 'claim' });
  const resources = await resourcesOf(ctx, [agent.id]);
  return {
    status: 'claimed',
    agent: { id: agent.id, name: agent.name, handle: agent.handle, resources: Object.fromEntries(resources.map(r => [r.kind, { status: r.status, address: r.address }])) },
    key, api: ctx.config.publicUrl, mcp: `${ctx.config.publicUrl}/mcp`,
  };
}
