// Companies that accept only verified agents. With their secret they can:
//   - check a passport online (POST /v1/verify): its signature and audience,
//     whether the agent is still active, and whether its owner meets the
//     company's policy right now;
//   - get the SSH keys their organization's agents sign Git commits with
//     (GET /v1/allowed-signers), so a repository accepts commits only from
//     the company's own verified agents.
import { checked, fail, str, text } from './util.ts';
import type { RelyingParty, Route } from './app.ts';
import type { AgentRow, Ctx } from './context.ts';
import { verifyJwt } from './passport.ts';
import { audit, principalOf, verificationOf } from './shared.ts';
import { allowedSignersLine } from './ssh.ts';
import { passportModel } from './origin.ts';

type Level = 'kyb' | 'kyc' | 'none';
// Whether an owner's verification meets a policy's `require`.
export function meets(require: string, level: Level) {
  if (require === 'any') return true;
  if (require === 'kyb') return level === 'kyb';
  if (require === 'kyc') return level === 'kyc' || level === 'kyb';
  return level !== 'none'; // 'verified'
}

export async function checkPolicy(ctx: Ctx, rp: Record<string, any>, agent: AgentRow) {
  const policy = rp.policy || {};
  const verification = await verificationOf(ctx, agent);
  const reasons: string[] = [];
  if (agent.status !== 'active') reasons.push(`agent_${agent.status}`);
  if (!meets(String(policy.require || 'verified'), verification.level)) reasons.push('owner_not_verified');
  if (Array.isArray(policy.organizations) && policy.organizations.length && !policy.organizations.includes(verification.organizationId)) reasons.push('organization_not_allowed');
  if (Array.isArray(policy.agents) && policy.agents.length && !policy.agents.includes(agent.id)) reasons.push('agent_not_allowed');
  return { allowed: !reasons.length, reasons, verification };
}

// A passport checked against the agent as it is right now: signature and
// audience, whether the agent is still active, and whether its owner meets the
// policy. `checker` names who asked, for the owner's activity log.
async function checkPassport(ctx: Ctx, token: string, audience: string, rp: Record<string, any>, checker: string) {
  let claims: Record<string, any>;
  try { ({ claims } = await verifyJwt(ctx.config, token, audience, ctx.now())); }
  catch (error) { return { valid: false, reason: (error as any).code || 'invalid', message: (error as Error).message }; }
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', claims.sub).maybeSingle()) as AgentRow | null;
  if (!agent) return { valid: false, reason: 'unknown_agent', message: 'This agent no longer exists.' };
  const policy = await checkPolicy(ctx, rp, agent);
  await audit(ctx, agent.owner_user_id, agent.id, 'relying_party', 'passport.checked', { company: checker, audience, allowed: policy.allowed, jti: claims.jti });
  return {
    valid: agent.status === 'active',
    allowed: policy.allowed,
    ...(policy.reasons.length ? { reasons: policy.reasons } : {}),
    agent: { id: agent.id, name: agent.name, runtime: agent.runtime, status: agent.status, principal: principalOf(ctx, agent), organizationId: policy.verification.organizationId, model: passportModel(agent) },
    owner: { ref: claims.owner?.ref, verified: policy.verification.verified, level: policy.verification.level, ...(policy.verification.business ? { business: policy.verification.business.legalName } : {}) },
    passport: { id: claims.jti, issuedAt: new Date(claims.iat * 1000).toISOString(), expiresAt: new Date(claims.exp * 1000).toISOString() },
  };
}

const verify: Route<RelyingParty>[2] = async (ctx, caller, input) =>
  checkPassport(ctx, str(input.passport ?? input.token, 8000, 'passport', { required: true }), caller.rp.audience, caller.rp, caller.rp.name);

// Anyone can check a passport for their own audience, with no account: the
// agent showed it to them. The default policy asks for a verified owner.
export async function publicVerify(ctx: Ctx, input: any) {
  const token = str(input.passport ?? input.token, 8000, 'passport', { required: true });
  const audience = str(input.audience, 300, 'audience', { required: true });
  const require = ['any', 'verified', 'kyc', 'kyb'].includes(input.require) ? input.require : 'verified';
  const organizations = Array.isArray(input.organizations) ? input.organizations.slice(0, 100).map((id: unknown) => str(id, 60, 'organizations')) : undefined;
  return checkPassport(ctx, token, audience, { policy: { require, ...(organizations?.length ? { organizations } : {}) } }, 'a service checking passports');
}

// Git's allowed_signers file: every active signing key of an organization's
// agents that meet the policy. Revoking an agent or a key, or its owner
// leaving the organization, takes it off the list at once.
async function signersOf(ctx: Ctx, workspaceId: string, rpPolicy: Record<string, any>, label: string, format: unknown) {
  const rp = { workspace_id: workspaceId, policy: rpPolicy };
  const agents = (checked(await ctx.admin.from('agent_id_agents').select('*').eq('workspace_id', workspaceId).eq('status', 'active')) || []) as AgentRow[];
  const lines: string[] = [], skipped: { agent: string; reasons: string[] }[] = [];
  const keys = agents.length ? (checked(await ctx.admin.from('agent_id_signing_keys').select('*').in('agent_id', agents.map(a => a.id)).is('revoked_at', null)) || []) as any[] : [];
  for (const agent of agents) {
    const own = keys.filter(key => key.agent_id === agent.id);
    if (!own.length) continue;
    const policy = await checkPolicy(ctx, { ...rp, policy: { ...rp.policy, organizations: [rp.workspace_id] } }, agent);
    if (!policy.allowed) { skipped.push({ agent: agent.id, reasons: policy.reasons }); continue; }
    for (const key of own) lines.push(allowedSignersLine(principalOf(ctx, agent), key.public_key, `${agent.id} ${key.fingerprint}`));
  }
  if (format === 'json') return { signers: lines, skipped, generatedAt: new Date(ctx.now()).toISOString() };
  return text(`# Agent ID allowed signers for ${label}, ${new Date(ctx.now()).toISOString()}\n${lines.join('\n')}${lines.length ? '\n' : ''}`);
}

const allowedSigners: Route<RelyingParty>[2] = async (ctx, caller, input) => {
  if (!caller.rp.workspace_id) throw fail(409, 'no_organization', 'Register this company for an organization to list its agents\' signing keys.');
  return signersOf(ctx, caller.rp.workspace_id, caller.rp.policy || {}, caller.rp.name, input.format);
};

// The same list for any repository, with no account: public keys and agent
// ids only. `require` is verified (default), kyc or kyb.
export async function publicAllowedSigners(ctx: Ctx, workspaceId: string, input: any) {
  const org = checked(await ctx.admin.from('timewarp_workspaces').select('id').eq('id', workspaceId).maybeSingle()) as any;
  if (!org) throw fail(404, 'not_found', 'No organization with that id.');
  const require = ['verified', 'kyc', 'kyb'].includes(input.require) ? input.require : 'verified';
  return signersOf(ctx, workspaceId, { require }, `organization ${workspaceId}`, input.format);
}

const whoami: Route<RelyingParty>[2] = async (_ctx, caller) => ({ relyingParty: { id: caller.rp.id, name: caller.rp.name, audience: caller.rp.audience, organizationId: caller.rp.workspace_id, policy: caller.rp.policy } });

export const relyingPartyRoutes: Route<RelyingParty>[] = [
  ['GET', '/v1/relying-party', whoami],
  ['POST', '/v1/verify', verify],
  ['GET', '/v1/allowed-signers', allowedSigners],
];
