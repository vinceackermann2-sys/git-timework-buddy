# @timewarp/agent-id-verify

Let only verified AI agents call your API or MCP server. Agents with a
Timewarp Agent ID prove who they are with a short-lived **passport**: an ES256
JWT saying which agent is calling, for which audience (your service), and how
its owner is verified (a person, KYC, or a business, KYB). This package checks
passports in your own code: offline with Agent ID's public keys, and
optionally online with Agent ID, which also catches an agent revoked a moment
ago. No account, app registration or secret is needed.

Zero dependencies; WebCrypto and fetch only, so it runs on Node 20+, Deno,
Bun and Cloudflare Workers. ESM with TypeScript types.

```sh
npm install @timewarp/agent-id-verify
```

Pick an **audience** for your service, usually its URL
(`https://api.acme.com`). Agents ask Agent ID for a passport for that audience
and send it in an `Agent-Passport` header.

## Express / Connect

```js
import express from 'express';
import { agentIdMiddleware } from '@timewarp/agent-id-verify';

const app = express();
app.use('/api', agentIdMiddleware({
  audience: 'https://api.acme.com',
  require: 'verified',                       // the default: a verified person or business
  organizations: ['<your organization id>'], // optional: only your own agents
  online: true,                              // optional: also ask Agent ID on every request
}));
app.post('/api/orders', (req, res) => res.json({ by: req.agent.agent.name, owner: req.agent.owner.level }));
```

Requests without a valid passport get `401` (`WWW-Authenticate: AgentPassport`),
passports that don't meet your policy get `403`, both as
`{ "error": { "code", "message" } }`.

## Next.js route handlers

```ts
// app/api/orders/route.ts
import { withAgentId } from '@timewarp/agent-id-verify';

export const POST = withAgentId(async (request, agent) => {
  const order = await request.json();
  return Response.json({ received: order.id, by: agent.agent.id });
}, { audience: 'https://acme.com/api/orders', online: true });
```

It works in the Node.js and Edge runtimes. The verified agent is the
handler's second argument, and Next's `context` follows it.

## Workers, Hono, Deno, Bun

```js
import { withAgentId } from '@timewarp/agent-id-verify';

export default {
  fetch: withAgentId(async (request, agent, env, ctx) => {
    return Response.json({ hello: agent.agent.name });
  }, { audience: 'https://api.acme.com' }),
};
```

With Hono: `app.post('/orders', c => withAgentId(handler, options)(c.req.raw))`.

## MCP servers

An MCP server over HTTP (Streamable HTTP) checks the passport on its
endpoint like any API. Every request carries a fresh passport, and the
calling agent is known to your tools.

Express, with the official MCP SDK:

```js
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { agentIdMiddleware } from '@timewarp/agent-id-verify';

const app = express();
app.use(express.json());
app.post('/mcp', agentIdMiddleware({ audience: 'https://mcp.acme.com', online: true }), async (req, res) => {
  const server = new McpServer({ name: 'acme', version: '1.0.0' });
  server.tool('whoami', async () => ({ content: [{ type: 'text', text: `You are ${req.agent.agent.name}` }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.listen(3000);
```

Fetch-style (Workers, Deno, Bun, Next.js), around your MCP handler:

```js
import { withAgentId } from '@timewarp/agent-id-verify';

export default {
  fetch: withAgentId((request, agent) => handleMcp(request, { agent }), { audience: 'https://mcp.acme.com', online: true }),
};
```

Agents connect through the Agent ID CLI, which attaches a fresh passport to
every request (and never sends the agent's key):

```sh
claude mcp add acme -- npx -y @timewarp/agent-id mcp --remote https://mcp.acme.com/mcp
```

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

`verifyPassport(token, options)`, and the middleware, take:

| Option | |
|---|---|
| `audience` (required) | The audience, or a list of audiences, you accept. |
| `require` | `'verified'` (default: a verified person or business), `'kyc'` (same), `'kyb'` (a verified business), or `'any'`. |
| `organizations` | Only agents of these organization ids. |
| `agents` | Only these agent ids. |
| `online` | Middleware only: also ask Agent ID on every request. |
| `api` | Agent ID's API (default: production). |
| `issuer`, `jwksUrl` | Default: read once an hour from `<api>/v1/config`. |
| `clockToleranceSeconds` | Default 30. |
| `fetch` | Your own fetch. |

The public keys are cached for as long as the JWKS response's `max-age` says;
a passport signed with an unknown key id triggers a refetch, at most once a
minute. The owner reference (`owner.ref`) is stable for your audience and
different for every other service, so services can't link an owner across
sites.

Error codes: `passport_required`, `malformed`, `bad_signature`, `unknown_key`,
`wrong_issuer`, `expired`, `not_yet_valid`, `wrong_audience` (status 401);
`owner_not_verified`, `organization_not_allowed`, `agent_not_allowed` (403);
`config_unavailable`, `jwks_unavailable`, `unavailable` (503).

## Online checks

```js
import { checkPassport } from '@timewarp/agent-id-verify';
const result = await checkPassport(token, { audience: 'https://api.acme.com' });
// { valid, allowed, reasons?, agent: { id, name, status, principal, organizationId }, owner, passport }
```

An offline check trusts a passport until it expires (5 minutes). The online
check (`POST /v1/verify`) also knows whether the agent was revoked or paused
a moment ago and how its owner is verified now. `allowed` follows the
`require` and `organizations` you pass (default: a verified owner). It returns
the answer rather than throwing for an invalid passport. With `online: true`,
the middleware does this on every request.

## Other helpers

- `passportFrom(request)`: the token from `Agent-Passport: <jwt>` or
  `Authorization: AgentPassport <jwt>`, for a Fetch `Request`, a Node request, or headers.
- `fetchAllowedSigners({ organization })`: Git's `allowed_signers` file for an
  organization's agents (what the GitHub Action uses); `format: 'json'` gives
  the lines and the agents left out.

## Developing locally

Point `api` at a local Agent ID (for example `api: 'http://127.0.0.1:54329/agent-id'`);
the issuer and keys are then read from it.
