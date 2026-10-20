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

const verify: Route<RelyingParty>[2] = async (ctx, caller, input) => {
  const rp = caller.rp;
  const token = str(input.passport ?? input.token, 8000, 'passport', { required: true });
  let claims: Record<string, any>;
  try { ({ claims } = await verifyJwt(ctx.config, token, rp.audience, ctx.now())); }
  catch (error) { return { valid: false, reason: (error as any).code || 'invalid', message: (error as Error).message }; }
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', claims.sub).maybeSingle()) as AgentRow | null;
  if (!agent) return { valid: false, reason: 'unknown_agent', message: 'This agent no longer exists.' };
  const policy = await checkPolicy(ctx, rp, agent);
  await audit(ctx, agent.owner_user_id, agent.id, 'relying_party', 'passport.checked', { company: rp.name, audience: rp.audience, allowed: policy.allowed, jti: claims.jti });
  return {
    valid: agent.status === 'active',
    allowed: policy.allowed,
    ...(policy.reasons.length ? { reasons: policy.reasons } : {}),
    agent: { id: agent.id, name: agent.name, runtime: agent.runtime, status: agent.status, principal: principalOf(ctx, agent), organizationId: policy.verification.organizationId },
    owner: { ref: claims.owner?.ref, verified: policy.verification.verified, level: policy.verification.level, ...(policy.verification.business ? { business: policy.verification.business.legalName } : {}) },
    passport: { id: claims.jti, issuedAt: new Date(claims.iat * 1000).toISOString(), expiresAt: new Date(claims.exp * 1000).toISOString() },
  };
};

// Git's allowed_signers file: every active signing key of the company's
// organization's agents that meet its policy. Revoking an agent or a key
// takes it off the list at once.
const allowedSigners: Route<RelyingParty>[2] = async (ctx, caller, input) => {
  const rp = caller.rp;
  if (!rp.workspace_id) throw fail(409, 'no_organization', 'Register this company for an organization to list its agents\' signing keys.');
  const agents = (checked(await ctx.admin.from('agent_id_agents').select('*').eq('workspace_id', rp.workspace_id).eq('status', 'active')) || []) as AgentRow[];
  const lines: string[] = [], skipped: { agent: string; reasons: string[] }[] = [];
  const keys = agents.length ? (checked(await ctx.admin.from('agent_id_signing_keys').select('*').in('agent_id', agents.map(a => a.id)).is('revoked_at', null)) || []) as any[] : [];
  for (const agent of agents) {
    const own = keys.filter(key => key.agent_id === agent.id);
    if (!own.length) continue;
    const policy = await checkPolicy(ctx, { ...rp, policy: { ...rp.policy, organizations: [rp.workspace_id] } }, agent);
    if (!policy.allowed) { skipped.push({ agent: agent.id, reasons: policy.reasons }); continue; }
    for (const key of own) lines.push(allowedSignersLine(principalOf(ctx, agent), key.public_key, `${agent.name} (${agent.id}, ${key.fingerprint})`));
  }
  if (input.format === 'json') return { signers: lines, skipped, generatedAt: new Date(ctx.now()).toISOString() };
  return text(`# Agent ID allowed signers for ${rp.name}, ${new Date(ctx.now()).toISOString()}\n${lines.join('\n')}${lines.length ? '\n' : ''}`);
};

const whoami: Route<RelyingParty>[2] = async (_ctx, caller) => ({ relyingParty: { id: caller.rp.id, name: caller.rp.name, audience: caller.rp.audience, organizationId: caller.rp.workspace_id, policy: caller.rp.policy } });

export const relyingPartyRoutes: Route<RelyingParty>[] = [
  ['GET', '/v1/relying-party', whoami],
  ['POST', '/v1/verify', verify],
  ['GET', '/v1/allowed-signers', allowedSigners],
];
