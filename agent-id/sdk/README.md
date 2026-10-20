# @timewarp/agent-id-verify

Accept only verified AI agents. Agents with a Timewarp Agent ID prove who
they are with a short-lived **passport**: an ES256 JWT saying which agent is
calling, for which audience (your service), and how its owner is verified
(a person, KYC, or a business, KYB). This package checks passports offline
with Agent ID's public keys, or online with Agent ID itself, and wraps both as
middleware.

Zero dependencies; WebCrypto and fetch only, so it runs on Node 20+, Deno,
Bun and Cloudflare Workers. ESM with TypeScript types.

```sh
npm install @timewarp/agent-id-verify
```

## Express / Connect

```js
import express from 'express';
import { agentIdMiddleware } from '@timewarp/agent-id-verify';

const app = express();
app.use('/api', agentIdMiddleware({
  audience: 'https://api.acme.com',             // what your agents ask passports for
  require: 'verified',                           // the default: KYC or KYB
  organizations: ['<your organization id>'],     // optional: only your own agents
  online: { secret: process.env.AGENT_ID_SECRET } // optional: also ask Agent ID (catches revoked agents)
}));
app.post('/api/orders', (req, res) => res.json({ by: req.agent.agent.name, owner: req.agent.owner.level }));
```

Requests without a valid passport get `401` (`WWW-Authenticate: AgentPassport`),
passports that don't meet your policy get `403`, both as
`{ "error": { "code", "message" } }`.

## Workers, Hono, Next.js, Deno, Bun

```js
import { withAgentId } from '@timewarp/agent-id-verify';

export default {
  fetch: withAgentId(async (request, agent, env, ctx) => {
    return Response.json({ hello: agent.agent.name });
  }, { audience: 'https://api.acme.com' }),
};
```

The verified agent is the handler's second argument; the others follow
(Workers' `env, ctx`, Next's `context`). With Hono:
`app.post('/orders', c => withAgentId(handler, options)(c.req.raw))`.

## Checking a passport yourself

```js
import { verifyPassport, AgentIdError } from '@timewarp/agent-id-verify';

try {
  const { agent, owner, org, claims } = await verifyPassport(token, { audience: 'https://api.acme.com' });
  // agent: { id: 'agt_…', name, handle, runtime, principal }
  // owner: { ref, type: 'person' | 'business', verified, level: 'none' | 'kyc' | 'kyb', name?, country? }
  // org:   { id, name, verified } | null
} catch (error) {
  if (error instanceof AgentIdError) console.log(error.code, error.status);
}
```

`verifyPassport(token, options)`:

| Option | |
|---|---|
| `audience` (required) | The audience, or a list of audiences, you accept. Usually your API's URL. |
| `require` | `'verified'` (default: a verified person or business), `'kyc'` (same), `'kyb'` (a verified business), or `'any'`. |
| `organizations` | Only agents of these organization ids. |
| `agents` | Only these agent ids. |
| `api` | Agent ID's API base (default: production). |
| `issuer`, `jwksUrl` | Default: read once an hour from `<api>/v1/config`. |
| `clockToleranceSeconds` | Default 30. |
| `fetch` | Your own fetch. |

The public keys are cached for as long as the JWKS response's `max-age` says;
a passport signed with an unknown key id triggers a refetch, at most once a
minute.

Error codes: `passport_required`, `malformed`, `bad_signature`, `unknown_key`,
`wrong_issuer`, `expired`, `not_yet_valid`, `wrong_audience` (status 401);
`owner_not_verified`, `organization_not_allowed`, `agent_not_allowed` (403);
`config_unavailable`, `jwks_unavailable`, `unavailable` (503).

## Online checks

```js
import { checkPassport } from '@timewarp/agent-id-verify';
const result = await checkPassport(token, { secret: process.env.AGENT_ID_SECRET });
// { valid, allowed, reasons?, agent: { id, name, status, principal, organizationId }, owner, passport }
```

An offline check trusts a passport until it expires (5 minutes). The online
check (`POST /v1/verify` with your company secret, `twrp_…`) also knows
whether the agent was revoked or paused a moment ago and applies the policy
you set for your company in the dashboard. It returns the answer rather than
throwing for an invalid passport. Register your company (audience, policy,
organization) in the Agent ID dashboard to get a secret.

## Other helpers

- `passportFrom(request)`: the token from `Agent-Passport: <jwt>` or
  `Authorization: AgentPassport <jwt>`, for a Fetch `Request`, a Node request, or headers.
- `fetchAllowedSigners({ secret })`: Git's `allowed_signers` file for your
  organization's agents (what the GitHub Action uses).
