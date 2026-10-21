# Timewarp Agent ID

Timewarp Agent ID gives your AI agent its own email, wallet, phone number and
computer.

```sh
npx @timewarp/agent-id
```

You need [Node.js](https://nodejs.org) 20 or later. Nothing else to install.

## What happens

1. It finds the AI apps on your computer and asks which ones get an Agent ID.
   Press Enter for the usual ones.
2. It opens a link in your browser. Confirm your email with the 6-digit code
   we send you, and accept the terms. That creates your Timewarp account (or
   uses the one you have).
3. Back in the terminal, your apps are set up. Restart them, then ask your
   agent: “What's my Agent ID email address?”

Your agent now has:

- **Email**: its own address, to send and receive mail.
- **Wallet**: add money on the [dashboard](https://timewarpdev.com/agent-id/dashboard).
  Payments over your limits wait for your OK.
- **Phone number**: apply on the dashboard.
- **Computer**: starts the first time your agent uses it.

We check who you are only once, the first time you move money out.

## Works with

Claude Code (and its subagents), Codex, Cursor, Claude Desktop, Gemini CLI,
Antigravity, Windsurf, opencode, Grok, Kiro, Qwen Code, Factory Droid,
Copilot CLI, Amazon Q, Continue, Cline, Roo Code, Kilo Code, and Timewarp and
OpenClaw agents.

Your own agent in a folder? Run this in that folder:

```sh
npx @timewarp/agent-id attach --here
```

## Privacy

Your agent's key stays on your computer, in `~/.timewarp-id/config.json`,
readable only by you. Your apps reach Agent ID through a small local program
(`npx @timewarp/agent-id mcp`) and never see the key. In each app, Agent ID
changes only its own settings entry and a short note that tells the agent who
it is; each file is backed up once (`<file>.timewarp-id.bak`).

## Commands you might need

| | |
|---|---|
| `npx @timewarp/agent-id` | Set up, or give more apps your Agent ID |
| `npx @timewarp/agent-id me` | What your agent has |
| `npx @timewarp/agent-id approvals` | Payments waiting for your OK |
| `npx @timewarp/agent-id help` | Every command |

## Uninstall

```sh
npx @timewarp/agent-id detach
```

This takes Agent ID out of your apps and leaves everything else as it was.
`npx @timewarp/agent-id logout --all` also forgets the agent's key on this
computer. Your Agent ID itself stays until you end it on the
[dashboard](https://timewarpdev.com/agent-id/dashboard).

## For developers

The rest of this page is the full reference: `timewarp-id` (installed with
`npm install -g @timewarp/agent-id`, or run with `npx -y @timewarp/agent-id
<command>`) also manages agents with an owner key, acts as an agent from
scripts, runs the MCP server and signs Git commits.

### attach in detail

`timewarp-id` on its own in a terminal is `attach` with a welcome; without a
terminal (a pipe, a script, an agent's shell) it prints how to start instead.

Not signed in on this computer, `attach` gives everything chosen one Agent ID:
the one already set up here, or a new one through the email link above
(`--claim twc_…` finishes one started on the website). Signed in with an
owner key, each gets an Agent ID of its own:

```sh
npx @timewarp/agent-id login --owner-key two_…   # from the Agent ID dashboard → Keys
npx @timewarp/agent-id terms                     # read and accept Agent ID's terms, once
npx @timewarp/agent-id attach
```

(If you haven't accepted the terms, `attach` and `agents create` offer them
in a terminal, or tell you to run `timewarp-id terms`.)

`attach` finds the agents on this computer and asks which ones to give an
Agent ID (Enter, or `--yes`, takes each app's main agent); it writes the
wiring into each, so the agent can use its own mail, phone, wallet, card and
machine right away. It finds:

| | Where | What `attach` writes |
|---|---|---|
| Claude Code, every project (`claude`) | `~/.claude.json`, `~/.claude/CLAUDE.md` | MCP server `timewarp-id`, identity block |
| Claude Code in this project (`claude:project`) | `.mcp.json`, `CLAUDE.md` | MCP server `timewarp-id`, identity block, `.timewarp-id.json` |
| Claude Code subagents (`claude-agent:<name>`) | `~/.claude/agents/*.md`, `.claude/agents/*.md` | its own MCP server `timewarp-id-<handle>`, its tools added to a `tools:` list, identity block |
| Codex, every project (`codex`) | `~/.codex/config.toml` (`$CODEX_HOME`), `~/.codex/AGENTS.md` | `[mcp_servers.timewarp_id]`, identity block |
| Codex in this project (`codex:project`) | `AGENTS.md` | identity block, `.timewarp-id.json` |
| Cursor (`cursor`, `cursor:project`) | `~/.cursor/mcp.json`, `.cursor/` | MCP server; in a project also `.cursor/rules/timewarp-agent-id.mdc` |
| Claude Desktop (`claude-desktop`) | `claude_desktop_config.json` (including the Microsoft Store app's copy) | MCP server |
| Gemini CLI (`gemini`) | `~/.gemini/settings.json`, `~/.gemini/GEMINI.md` | MCP server, identity block |
| Antigravity (`antigravity`) | `~/.gemini/config/mcp_config.json` and `~/.gemini/antigravity/mcp_config.json` (`mcpServers` and `servers`), `GEMINI.md` | MCP server, identity block |
| Windsurf (`windsurf`) | `~/.codeium/windsurf/mcp_config.json`, `memories/global_rules.md` | MCP server, identity block |
| opencode (`opencode`) | `~/.config/opencode/opencode.json(c)` (`mcp`, comments kept), `AGENTS.md` | MCP server, identity block |
| Grok (`grok`) | `~/.grok/config.toml` (`[mcp_servers.timewarp-id]`), `~/.grok/AGENTS.md` | MCP server, identity block |
| Kiro, Qwen Code, Factory Droid, Copilot CLI, Amazon Q (`kiro`, `qwen`, `factory`, `copilot`, `amazonq`) | `~/.kiro/settings/mcp.json`, `~/.qwen/settings.json`, `~/.factory/mcp.json`, `~/.copilot/mcp-config.json`, `~/.aws/amazonq/mcp.json` | MCP server; Kiro and Qwen also an identity block (Kiro steering file, `QWEN.md`) |
| Continue (`continue`) | `~/.continue/mcpServers/timewarp-id.yaml`, `~/.continue/rules/` | MCP server block, identity rule |
| Cline, Roo Code, Kilo Code (`cline`, `roo`, `kilo`) | the extension's MCP settings in VS Code, Cursor, Windsurf or VSCodium | MCP server; Roo and Kilo also a global rule |
| Timewarp desktop agents (`timewarp:<id>`) | `…/Timewarp Energy/runtime/agents/<slug>-<id>/AGENTS.md` | identity block, `.timewarp-id.json`, and the Agent ID is linked to the desktop agent |
| OpenClaw (`openclaw`) | `~/.openclaw/workspace*/AGENTS.md` | identity block, `.timewarp-id.json` (its agents use the `timewarp-id` command) |
| Any folder (`<path>`, `--here`) | `AGENTS.md` (or `CLAUDE.md`) | identity block, `.timewarp-id.json` |

Agent apps it can see but not wire up yet (Grok Bot, Zed, Augment, Junie,
Hermes, Moltbot) show in `timewarp-id agents scan` as **manual setup**, with
the MCP entry to paste into their settings. A tool's folder that holds only
`skills/` doesn't count as installed.

```sh
timewarp-id agents scan                                   # what attach can find here
timewarp-id attach code-reviewer --give mail,wallet       # a subagent, with its own mail and wallet
timewarp-id attach claude codex --agent research-ab12     # an existing Agent ID for both
timewarp-id attach "timewarp:Research Assistant"          # a Timewarp desktop agent
timewarp-id attach --here --name "Support bot"            # a custom agent in this folder
timewarp-id detach code-reviewer                          # undo exactly what attach wrote
```

- The identity block (between `<!-- timewarp-agent-id:start -->` and
  `<!-- timewarp-agent-id:end -->`) is short, because it is read with every
  request: who the agent is, its addresses, where its tools are, and that
  spending over its limits waits for you.
- Running `attach` again updates everything in place and keeps the agent it
  was attached to. Config files are edited in place (other entries, comments
  and formatting stay) and backed up once (`<file>.timewarp-id.bak`); what
  was written is recorded in `~/.timewarp-id/attachments.json`, and `detach`
  removes exactly that (the Agent ID itself stays).
- Tool-wide entries (every tool's "every project" entry) run
  `timewarp-id mcp --default-agent <handle>`: they act as that agent, except
  in folders whose `.timewarp-id.json` names another.
- Agent ID is told where each agent comes from (`origin: { app, detail }`, e.g.
  `claude-code`, "subagent code-reviewer"), which the dashboard shows. The MCP
  server also passes the tool's own `clientInfo` through, and every request
  names the tool in its user-agent (`timewarp-id/1.0.0 (cursor)`).
- Timewarp desktop agents and OpenClaw get no MCP server of their own yet;
  they use the `timewarp-id` command in their workspace, which acts as them there.
- Options: `--agent <handle>` (use an existing Agent ID; one made on the
  dashboard gets a key here, once you're logged in), `--give mail,phone,wallet,vm`,
  `--name`, `--origin <app>`, `--yes` (no questions).

### Approvals

When an agent wants to send more than you approve automatically, the transfer
waits for you. Owner commands then end with a reminder on stderr, such as
`1 approval waiting — run timewarp-id approvals`.

```sh
timewarp-id approvals          # agent, amount, to, memo, expiry; in a terminal it asks about each
timewarp-id approve <id>       # or: timewarp-id deny <id>
```

### Start from scratch

```sh
npm install -g @timewarp/agent-id    # or: npx -y @timewarp/agent-id <command>

# 1. An owner key from the Agent ID dashboard (https://timewarpdev.com/agent-id → Keys),
#    and Agent ID's terms of service
timewarp-id login --owner-key two_…
timewarp-id terms

# 2. An agent. Its key is saved on this computer; the first one is the default.
timewarp-id agents create "Research agent" --origin claude-code

# 3. Things it can use
timewarp-id give mail
timewarp-id give wallet                    # fund it with USDC or USDT on Base (its address: wallet show)
timewarp-id give phone --country US --area-code 415
timewarp-id card apply --use-case "Paying for API credits" --monthly 200 --country US

# 4. Plug it into your tools
timewarp-id connect claude          # Claude Code
timewarp-id connect codex           # Codex
timewarp-id connect claude-desktop  # Claude Desktop
timewarp-id connect cursor          # Cursor
```

### Commands

| Owner (owner key) | |
|---|---|
| `login --owner-key two_…` / `logout [--all]` | Save or forget the owner key (`--owner-key -` reads it from stdin) |
| `terms [--yes]` | Show Agent ID's terms of service and accept them (needed before the first agent, and when they change) |
| `whoami` | Your account and the agent commands act as |
| `agents list [--all]` | Your agents; `*` marks the default |
| `agents create <name> [--origin <app>] [--origin-detail "…"] [--org <id>]` | Creates an agent and saves its key as a profile; `--origin` is the app it lives in (`claude-code`, `codex`, `cursor`, `gemini`, `grok`, `openclaw`, `strawberry`, `custom`, …) |
| `agents scan` | The agents on this computer `attach` can wire up |
| `agents show\|key\|pause\|resume\|revoke <agent>` | `key` saves a new key here (for an agent made elsewhere); `revoke` is final (`--yes` to skip the question) |
| `give <mail\|phone\|wallet\|vm> [--size small\|medium] [--country US --area-code 415]` | Its own mail inbox, phone number, wallet (USDC/USDT on Base) or Linux machine |
| `card apply --use-case "…" --monthly 200 --country SE`, `card application` | Apply for a virtual card for an agent (monthly spend in dollars), and see the application |
| `take <kind>` | Releases it |
| `limits wallet [--per-transfer 50] [--daily 100] [--approval-above 25]` | Dollars; `none` removes a limit; no options shows them |
| `limits card [--per-transaction 50] [--daily 100] [--monthly 500] [--blocked-categories a,b] [--allowed-categories a,b]` | |
| `approvals` / `approve <id>` / `deny <id>` | Transfers above the approval amount wait for you |

Owner commands take `--agent <agent>` (handle, `agt_…` id, name, or a handle
prefix only one agent has); without it they use the current agent.

| Act as the agent (agent key) | |
|---|---|
| `me` | Identity, Git principal, owner verification, resources |
| `mail list [--folder inbox\|sent\|trash\|all] [--unread]`, `mail read <id>`, `mail send --to … --subject … --text …` (`--text -` = stdin) `[--attach file]…`, `mail reply <id> --text …`, `mail trash\|restore <id>` | `--attach` uploads each file (`POST /v1/me/files`) and sends it with the mail |
| `sms list`, `sms send <+14155550123> <text…>` | |
| `call list`, `call place <number> --say "…"` | |
| `contacts list [name]`, `contacts add <name> [--email --phone --wallet --note]`, `contacts update <id> …`, `contacts rm <id>` | |
| `wallet show`, `wallet history`, `wallet send <to> <dollars> [--asset usdc\|usdt] [--memo …]` | Balances in USD (`$12.34 USD · USDC/USDT on Base`). `<to>`: another agent (handle, id, or a profile name here), a wallet address or a contact. Above the approval amount it prints the approval id and waits for you. |
| `card show`, `card reveal`, `card transactions` | `reveal` is logged; never paste card details into a chat |
| `vm status\|start\|stop\|history`, `vm files [path]`, `vm exec [--cwd] [--timeout 120] -- <command…>` | `exec` prints the output and exits with the command's exit code |
| `passport --audience <aud>` | Prints only the token: `curl -H "Agent-Passport: $(timewarp-id passport --audience https://api.example.com)" …` |

Every command takes `--json` (Agent ID's answer as JSON; errors as
`{ "error": { code, message } }`), `--api <url>` and `--help`. Exit codes: 0
done, 1 failed (the message says why and usually what to do), 2 mistyped.

### Which agent a command acts as

1. `TIMEWARP_AGENT_KEY` (an agent key, `twa_…`) overrides everything, for CI and containers.
2. `--agent <agent>`.
3. The nearest `.timewarp-id.json` above the current folder: `{ "agent": "<handle>" }`.
   `timewarp-id use <agent> --project` writes it. It holds no key, so it can be committed.
4. The default: `timewarp-id use <agent>`.

So with `timewarp-id connect claude` (no `--agent`), every new Claude Code
session acts as the agent of the project it starts in.

### MCP

`timewarp-id mcp [--agent <agent>]` is a stdio MCP server (newline-delimited
JSON-RPC on stdin/stdout, logs on stderr) that forwards each message to Agent
ID's MCP endpoint (`<api>/mcp`) with the agent's key: mail, texts, calls,
contacts, wallet, card, machine, passports and signing keys as tools. Tools
appear only for what the agent has.

`connect` wires it into a tool so the key stays in this CLI's config:

| Tool | What `connect` does |
|---|---|
| `claude` | Runs `claude mcp add timewarp-id -s user\|project -- npx -y @timewarp/agent-id mcp [--agent a]` (prints it when `claude` isn't on PATH) |
| `codex` | Adds or replaces `[mcp_servers.timewarp_id]` in `~/.codex/config.toml` (`$CODEX_HOME`), keeping every other table and comment; the file is backed up once as `config.toml.timewarp-id.bak` |
| `claude-desktop` | Merges `mcpServers["timewarp-id"]` into `claude_desktop_config.json` (`%APPDATA%\Claude`, the Microsoft Store app's own copy if it has one, `~/Library/Application Support/Claude`, `~/.config/Claude`) |
| `cursor` | Merges into `~/.cursor/mcp.json`, or `.cursor/mcp.json` here with `--scope project` |

Options: `--agent` pins an agent (otherwise the project's/default agent is
used each time the server starts), `--print` only prints, `--local` runs this
copy of the CLI instead of `npx`, `--config <file>` picks the JSON file. On
Windows, Claude Code and Codex get `cmd /c npx …`.

**Another company's MCP server.** `timewarp-id mcp --remote https://mcp.acme.com/mcp
[--audience https://mcp.acme.com]` proxies to an MCP server that accepts only
verified agents, attaching a fresh passport (`Agent-Passport` header) instead
of the key. Add it like any stdio server, e.g.
`claude mcp add acme -- npx -y @timewarp/agent-id mcp --remote https://mcp.acme.com/mcp`.

### Signed commits

```sh
cd my-repo
timewarp-id git setup [--agent <agent>] [--global]
```

Creates `~/.timewarp-id/keys/<handle>_ed25519` (once, with `ssh-keygen`),
registers its public key with Agent ID, and sets `gpg.format ssh`,
`user.signingkey`, `commit.gpgsign true`, `user.name` and `user.email` (the
agent's Git principal) for this repository, or globally. Repositories
protected by the Agent ID GitHub Action or pre-receive hook accept these
commits while the agent is active in the company's organization.

### Files and environment

- `~/.timewarp-id/config.json` (`$TIMEWARP_ID_HOME`): `{ api, ownerKey, profiles: { <handle>: { agentId, key, name } }, default }`, written with mode 0600 where the OS supports it.
- `~/.timewarp-id/keys/`: Git signing keys.
- `AGENT_ID_API` or `--api`: the API (default production; `login --api` remembers it).
- `TIMEWARP_OWNER_KEY`: an owner key without logging in. `TIMEWARP_AGENT_KEY`: act as that agent.

### Developing locally

Point the CLI at a local Agent ID with `AGENT_ID_API` (or `login --api`).
There, `give <kind> --test` (and `attach --give … --test`) gives test
resources that work only inside Agent ID: test mail reaches other test
inboxes, `fund <dollars>` adds test money to a test wallet, `give card --test`
gives a test card and `card test-charge <amount>` tries a payment against its
limits.
