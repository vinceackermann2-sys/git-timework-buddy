# Timewarp Agent ID developer tools

Agent ID gives each AI agent its own identity, plus a mail inbox, phone
number, wallet, virtual card and virtual machine, and traces every agent back
to a verified person (KYC) or business (KYB). Agents prove who they are with
short-lived signed **passports**; companies check them and accept only the
agents they want.

| Folder | Package | For |
|---|---|---|
| [`cli/`](cli/README.md) | `@timewarp/agent-id` (`timewarp-id`) | People and their agents: create agents, give them resources, act as them, connect them to Claude Code, Codex, Claude Desktop and Cursor over MCP, sign Git commits |
| [`sdk/`](sdk/README.md) | `@timewarp/agent-id-verify` | Developers: let only verified agents call your API or MCP server (Node, Deno, Bun, Workers, Next.js) |
| [`action/`](action/README.md) | GitHub Action | Companies: only their organization's verified agents (and people signing with keys they list) may change the codebase |
| [`hooks/pre-receive.sh`](hooks/pre-receive.sh) | Git hook | The same for self-hosted Git servers |

## For a person with agents

Give the agents you already have (Claude Code and its subagents, Codex,
Cursor, Claude Desktop, Gemini CLI, Antigravity, Windsurf, opencode, Grok,
Kiro, Qwen Code, Factory, Copilot CLI, Amazon Q, Continue, Cline, Roo, Kilo,
Timewarp and OpenClaw agents, any folder) an Agent ID in one step; `attach`
writes the wiring into each of them and tells Agent ID where each agent
comes from, so the dashboard can show it:

```sh
npx @timewarp/agent-id login --owner-key two_…   # from the Agent ID dashboard
npx @timewarp/agent-id terms                     # accept Agent ID's terms of service, once
npx @timewarp/agent-id attach                    # lists what it finds and asks
npx @timewarp/agent-id approvals                 # answer transfers waiting for you
```

Or build one up by hand:

```sh
timewarp-id agents create "Coder" --origin claude-code
timewarp-id give mail && timewarp-id give wallet
timewarp-id connect claude                            # or codex, claude-desktop, cursor
timewarp-id use coder-xxxx --project                  # this project's chats act as Coder
timewarp-id git setup                                 # Coder signs this repo's commits
```

## For developers

Let only verified agents call your API or MCP server, with the SDK in your
own code: no app to register, no account, no secret. Pick an **audience**
for your service (usually its URL); agents send a passport for it in an
`Agent-Passport` header, which they get with
`timewarp-id passport --audience https://api.acme.com` or the
`passport_issue` MCP tool.

**Protect an API.**

```js
import { agentIdMiddleware } from '@timewarp/agent-id-verify';
app.use(agentIdMiddleware({ audience: 'https://api.acme.com', require: 'verified', online: true }));
// req.agent = { agent: { id, name, … }, owner: { level, … }, org, claims }
```

Offline checks need no round trip; `online: true` also asks Agent ID, which
catches an agent revoked seconds ago. Fetch-style handlers (Next.js route
handlers, Workers, Hono, Deno, Bun) use `withAgentId`.

**Protect an MCP server.** Put `agentIdMiddleware` or `withAgentId` in front
of your Streamable HTTP endpoint, with your MCP server's URL as the
audience. Passports last five minutes, so agents connect through the CLI,
which attaches a fresh one to every request and never sends the agent's key:

```sh
claude mcp add acme -- npx -y @timewarp/agent-id mcp --remote https://mcp.acme.com/mcp
```

**Protect a repository.** Add the GitHub Action with your **organization id**
and make it a required check. Every commit must be signed, either by an
active agent of your organization (set up with `timewarp-id git setup`) or by
a person whose SSH key you list in `human-signers`; author emails count for
nothing, so unsigned commits always fail. Self-hosted servers use
`hooks/pre-receive.sh`.

## Developing locally

Point the tools at a local Agent ID (`AGENT_ID_API`, the SDK's `api`, the
Action's `api`). There, `timewarp-id give … --test` gives test resources that
work only inside Agent ID, `timewarp-id fund` adds test money and
`timewarp-id card test-charge` tries a test card.

```sh
cd agent-id
npm test        # node --test: the CLI, SDK and Action against the real Agent ID service on embedded Postgres
```

The tests start `timewarp/scripts/agent-id-local.cjs` over HTTP on a random
port (it needs `timewarp/node_modules`), run the CLI as separate processes
with their own config, Codex and home folders, and sign commits with
`ssh-keygen`; the Action tests skip themselves if SSH signing isn't available.
