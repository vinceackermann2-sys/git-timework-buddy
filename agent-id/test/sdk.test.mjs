// @timewarp/agent-id-verify against passports from the real Agent ID service
// running locally.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApi } from '../testing/local-api.mjs';
import { AgentIdError, agentIdMiddleware, checkPassport, fetchAllowedSigners, passportFrom, verifyPassport, withAgentId } from '../sdk/index.js';

const AUDIENCE = 'https://api.acme.test';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const parts = token => token.split('.');
const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString());

async function rejects(promise, code, status) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof AgentIdError, `expected AgentIdError, got ${error}`);
    assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
  });
}

describe('@timewarp/agent-id-verify', () => {
  let api, owner, reviewer, ownerKey, org, solo, member, other;
  const passport = async (agent, audience = AUDIENCE) => (await api.call('POST', '/v1/me/passport', { token: agent.secret, body: { audience } })).passport;
  const options = extra => ({ audience: AUDIENCE, api: api.base, ...extra });

  before(async () => {
    api = await startApi();
    owner = await api.local.user({ email: 'owner@acme.test', plan: 'pro' });
    reviewer = await api.local.user({ email: 'reviewer@timewarp.test' });
    ownerKey = await api.ownerKey(owner);
    org = await api.local.organization('Acme', [[owner, 'owner']]);
    const create = async body => api.call('POST', '/v1/agents', { token: ownerKey, body });
    solo = await create({ name: 'Solo' });
    member = await create({ name: 'Member', organizationId: org });
    other = await create({ name: 'Other' });
  });
  after(() => api?.close());

  it('verifies a passport offline, reading the issuer and keys from /v1/config', async () => {
    const token = await passport(solo);
    const result = await verifyPassport(token, options({ require: 'any' }));
    assert.equal(result.agent.id, solo.agent.id);
    assert.equal(result.agent.name, 'Solo');
    assert.equal(result.agent.principal, solo.agent.gitPrincipal);
    assert.equal(result.owner.level, 'none');
    assert.match(result.owner.ref, /^own_/);
    assert.equal(result.org, null);
    assert.equal(result.claims.iss, 'https://timewarpdev.com/agent-id');
    assert.equal(result.claims.aud, AUDIENCE);
    // Several accepted audiences, and explicit issuer and keys.
    await verifyPassport(token, options({ audience: ['https://other.test', AUDIENCE], require: 'any' }));
    await verifyPassport(token, { audience: AUDIENCE, require: 'any', issuer: 'https://timewarpdev.com/agent-id', jwksUrl: `${api.base}/.well-known/jwks.json` });
  });

  it('rejects the wrong audience, the wrong issuer and expired, tampered or malformed passports', async () => {
    const token = await passport(solo);
    await rejects(verifyPassport(token, options({ audience: 'https://elsewhere.test', require: 'any' })), 'wrong_audience', 401);
    await rejects(verifyPassport(token, options({ issuer: 'https://evil.test/agent-id', require: 'any' })), 'wrong_issuer', 401);

    api.local.setClock(() => Date.now() - 2 * 60 * 60 * 1000);
    let old;
    try { old = await passport(solo); } finally { api.local.setClock(null); }
    await rejects(verifyPassport(old, options({ require: 'any' })), 'expired', 401);
    await rejects(verifyPassport(old, options({ require: 'any', clockToleranceSeconds: 60 })), 'expired');

    const [header, payload, signature] = parts(token);
    const forged = b64({ ...decode(payload), sub: other.agent.id });
    await rejects(verifyPassport(`${header}.${forged}.${signature}`, options({ require: 'any' })), 'bad_signature', 401);
    const flipped = signature.slice(0, 10) + (signature[10] === 'A' ? 'B' : 'A') + signature.slice(11);
    await rejects(verifyPassport(`${header}.${payload}.${flipped}`, options({ require: 'any' })), 'bad_signature');
    await rejects(verifyPassport(`${b64({ alg: 'none', kid: 'local-1' })}.${payload}.`, options({ require: 'any' })), 'bad_signature');
    await rejects(verifyPassport('not-a-passport', options({ require: 'any' })), 'malformed', 401);
    await rejects(verifyPassport('', options({ require: 'any' })), 'passport_required', 401);
    await assert.rejects(verifyPassport(token, { api: api.base }), TypeError, 'the audience is required');
  });

  it('caches the public keys and refetches an unknown key id at most once a minute', async () => {
    let jwksFetches = 0;
    const counting = (url, init) => { if (String(url).includes('jwks.json')) jwksFetches++; return fetch(url, init); };
    const jwksUrl = `${api.base}/.well-known/jwks.json?cache-test`;
    const token = await passport(solo);
    await verifyPassport(token, options({ require: 'any', jwksUrl, fetch: counting }));
    await verifyPassport(token, options({ require: 'any', jwksUrl, fetch: counting }));
    assert.equal(jwksFetches, 1, 'the second check uses the cached keys');
    const [, payload, signature] = parts(token);
    const unknown = `${b64({ alg: 'ES256', typ: 'JWT', kid: 'retired-key' })}.${payload}.${signature}`;
    await rejects(verifyPassport(unknown, options({ require: 'any', jwksUrl, fetch: counting })), 'unknown_key', 401);
    await rejects(verifyPassport(unknown, options({ require: 'any', jwksUrl, fetch: counting })), 'unknown_key');
    assert.equal(jwksFetches, 1, 'no refetch within a minute of the last one');
  });

  it("requires a verified owner by default, until the owner's identity is verified", async () => {
    const before = await passport(solo);
    await rejects(verifyPassport(before, options()), 'owner_not_verified', 403);
    await rejects(verifyPassport(before, options({ require: 'kyc' })), 'owner_not_verified', 403);

    api.local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
    await api.call('POST', '/v1/account/verification', { token: ownerKey, body: { kind: 'person', legalName: 'Ada Lovelace', country: 'GB' } });
    const reviews = await api.call('GET', '/v1/reviews', { token: reviewer.session });
    assert.ok(reviews.people.some(p => p.userId === owner.id));
    await api.call('POST', `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: 'approve' } });

    await rejects(verifyPassport(before, options()), 'owner_not_verified', 403); // The old passport still says what was true then.
    const after = await passport(solo);
    const result = await verifyPassport(after, options());
    assert.equal(result.owner.verified, true);
    assert.equal(result.owner.level, 'kyc');
    assert.equal(result.owner.country, 'GB');
    await verifyPassport(after, options({ require: 'kyc' }));
    await rejects(verifyPassport(after, options({ require: 'kyb' })), 'owner_not_verified', 403);
  });

  it('applies organization and agent policies', async () => {
    const token = await passport(member);
    const result = await verifyPassport(token, options({ organizations: [org] }));
    assert.equal(result.org.id, org);
    assert.equal(result.org.name, 'Acme');
    await rejects(verifyPassport(token, options({ organizations: ['00000000-0000-4000-8000-000000000999'] })), 'organization_not_allowed', 403);
    await rejects(verifyPassport(await passport(solo), options({ organizations: [org] })), 'organization_not_allowed', 403);
    await verifyPassport(token, options({ agents: [member.agent.id] }));
    await rejects(verifyPassport(token, options({ agents: [solo.agent.id] })), 'agent_not_allowed', 403);
  });

  it('checks a passport online, which catches a revoked agent at once', async () => {
    const company = await api.call('POST', '/v1/relying-parties', { token: ownerKey, body: { name: 'Acme API', audience: AUDIENCE, organizationId: org, policy: { require: 'verified' } } });
    assert.match(company.secret, /^twrp_/);
    const secret = company.secret;
    const doomed = await api.call('POST', '/v1/agents', { token: ownerKey, body: { name: 'Doomed', organizationId: org } });
    const token = await passport(doomed);
    const online = await checkPassport(token, { secret, api: api.base });
    assert.equal(online.valid, true);
    assert.equal(online.allowed, true);
    assert.equal(online.agent.id, doomed.agent.id);

    await api.call('DELETE', `/v1/agents/${doomed.agent.id}`, { token: ownerKey });
    const revoked = await checkPassport(token, { secret, api: api.base });
    assert.equal(revoked.valid, false);
    assert.equal(revoked.allowed, false);
    assert.deepEqual(revoked.reasons, ['agent_revoked']);
    // Offline, the passport stays valid until it expires (minutes).
    await verifyPassport(token, options());

    const garbage = await checkPassport('nope', { secret, api: api.base });
    assert.equal(garbage.valid, false);
    assert.equal(garbage.reason, 'malformed');
    await rejects(checkPassport(token, { secret: 'twrp_wrong', api: api.base }), 'invalid_key', 500);
    await assert.rejects(checkPassport(token, { api: api.base }), TypeError);

    const signers = await fetchAllowedSigners({ secret, api: api.base });
    assert.match(signers, /^# Agent ID allowed signers for Acme API/);
  });

  it('reads the passport from Agent-Passport or Authorization: AgentPassport', () => {
    assert.equal(passportFrom(new Request('http://x/', { headers: { 'Agent-Passport': ' a.b.c ' } })), 'a.b.c');
    assert.equal(passportFrom(new Request('http://x/', { headers: { authorization: 'AgentPassport a.b.c' } })), 'a.b.c');
    assert.equal(passportFrom({ headers: { 'agent-passport': 'x.y.z' } }), 'x.y.z');
    assert.equal(passportFrom({ headers: { Authorization: ['AgentPassport q.r.s'] } }), 'q.r.s');
    assert.equal(passportFrom(new Headers({ authorization: 'Bearer abc' })), null);
    assert.equal(passportFrom({}), null);
  });

  it('agentIdMiddleware sets req.agent or answers 401/403 JSON', async () => {
    const company = await api.call('POST', '/v1/relying-parties', { token: ownerKey, body: { name: 'Acme Express', audience: 'https://express.acme.test', organizationId: org } });
    const guard = agentIdMiddleware({ audience: 'https://express.acme.test', api: api.base, organizations: [org], online: { secret: company.secret } });
    const server = http.createServer((req, res) => guard(req, res, () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ hello: req.agent.agent.name, online: req.agent.online.allowed })); }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    try {
      const good = await fetch(url, { headers: { 'Agent-Passport': await passport(member, 'https://express.acme.test') } });
      assert.equal(good.status, 200);
      assert.deepEqual(await good.json(), { hello: 'Member', online: true });

      const missing = await fetch(url);
      assert.equal(missing.status, 401);
      assert.equal(missing.headers.get('www-authenticate'), 'AgentPassport');
      assert.equal((await missing.json()).error.code, 'passport_required');

      const wrong = await fetch(url, { headers: { 'Agent-Passport': await passport(member) } });
      assert.equal(wrong.status, 401);
      assert.equal((await wrong.json()).error.code, 'wrong_audience');

      const outsider = await fetch(url, { headers: { authorization: `AgentPassport ${await passport(solo, 'https://express.acme.test')}` } });
      assert.equal(outsider.status, 403);
      assert.equal((await outsider.json()).error.code, 'organization_not_allowed');

      // Revoked a moment ago: only the online check knows.
      const gone = await api.call('POST', '/v1/agents', { token: ownerKey, body: { name: 'Gone', organizationId: org } });
      const token = await passport(gone, 'https://express.acme.test');
      await api.call('DELETE', `/v1/agents/${gone.agent.id}`, { token: ownerKey });
      const revoked = await fetch(url, { headers: { 'Agent-Passport': token } });
      assert.equal(revoked.status, 401);
      assert.equal((await revoked.json()).error.code, 'agent_revoked');
    } finally {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('withAgentId wraps fetch-style handlers', async () => {
    const handler = withAgentId(async (request, agent, env) => Response.json({ id: agent.agent.id, path: new URL(request.url).pathname, env }), { audience: AUDIENCE, api: api.base, require: 'any' });
    const good = await handler(new Request('https://api.acme.test/orders', { headers: { 'Agent-Passport': await passport(solo) } }), 'worker-env');
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { id: solo.agent.id, path: '/orders', env: 'worker-env' });
    const missing = await handler(new Request('https://api.acme.test/orders'));
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error.code, 'passport_required');

    const strict = withAgentId(() => new Response('ok'), { audience: AUDIENCE, api: api.base, require: 'kyb' });
    const notKyb = await strict(new Request('https://api.acme.test/', { headers: { 'Agent-Passport': await passport(solo) } }));
    assert.equal(notKyb.status, 403);
    assert.equal((await notKyb.json()).error.code, 'owner_not_verified');
  });
});
