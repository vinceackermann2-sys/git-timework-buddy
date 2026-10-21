// Help text, per command. `bin` is how the person started it: `timewarp-id`,
// or `npx @timewarp/agent-id` (what they type to run it again).

export const WELCOME = 'Timewarp Agent ID gives your AI agent its own email, wallet, phone number and computer.';

// With no command and no terminal to ask in (a pipe, a script, an agent's shell).
export const quickHelp = bin => `${WELCOME}

Get started: run \`${bin}\` in a terminal and follow the steps.
Without a terminal, name the apps: \`${bin} attach claude codex\`
(\`${bin} agents scan\` lists what it can find here).

All commands: ${bin} help`;

const aligned = rows => {
  const width = Math.max(...rows.map(([command]) => command.length)) + 3;
  return rows.map(([command, what]) => `  ${command.padEnd(width)}${what}`).join('\n');
};

// `timewarp-id help`: what a person needs first, then everything else.
export const fullHelp = (bin = 'timewarp-id') => `${WELCOME}

Get started: run \`${bin}\` and follow the steps.
It finds the AI apps on this computer and gives them an Agent ID.

Also useful:
${aligned([
  [`${bin} me`, 'What your agent has'],
  [`${bin} approvals`, 'Payments waiting for your OK'],
  [`${bin} detach`, 'Undoes the setup (your Agent ID stays)'],
  [`${bin} help <command>`, 'More about one command'],
])}

Works with Claude Code (and its subagents), Codex, Cursor, Claude Desktop,
Gemini CLI, Antigravity, Windsurf, opencode, Grok, Kiro, Qwen Code, Factory,
Copilot CLI, Amazon Q, Continue, Cline, Roo, Kilo, Timewarp and OpenClaw
agents, and your own agent in any folder (\`${bin} attach --here\`
in that folder).

Advanced and developer commands
-------------------------------
Usage: timewarp-id <command> [options]

Agents on this computer:
  attach [what…] [--give mail,wallet]  Give them an Agent ID, wired in
  detach [what…]                   Undo exactly what attach wrote
  agents scan                      What attach can find here

Your account (owner key from the Agent ID dashboard):
  login --owner-key two_…          Save your owner key on this computer
  terms                            Read and accept Agent ID's terms (needed once)
  logout [--all]                   Forget it (--all: and every agent key)
  whoami                           Your account and the agent you act as
  agents list|create|show|key|pause|resume|revoke
  give <mail|phone|wallet|vm>      Give an agent a mail inbox, number, wallet or machine
  card apply                       Apply for a virtual card for an agent
  take <kind>                      Take it away again
  limits <wallet|card>             Spending limits, in dollars
  approvals | approve <id> | deny <id>
  use <agent> [--project]          Default agent (or this project's agent)

Act as the agent:
  me, mail, sms, call, contacts, wallet, card, vm
  passport --audience <aud>        Prints a passport for a service

Connect tools:
  mcp                              Agent ID as a stdio MCP server
  connect <claude|codex|claude-desktop|cursor>
  git setup                        Sign this repo's commits as the agent

Options for every command:
  --agent <agent>   Act as / manage this agent (handle, id or name)
  --api <url>       Agent ID API (default: AGENT_ID_API, or production)
  --json            Print Agent ID's answer as JSON
  --help            Help for a command

The agent is chosen by TIMEWARP_AGENT_KEY, else --agent, else the nearest
.timewarp-id.json ({ "agent": "<handle>" }) above the current folder, else the
default set with \`timewarp-id use\`.

Developing locally: \`give --test\` and \`attach --give … --test\` give test
resources that work only inside Agent ID; \`fund <dollars>\` adds test money and
\`card test-charge\` tries a test card; AGENT_ID_API points at a local Agent ID.`;
export const MAIN = fullHelp();

// A command's usage lines (its help's first paragraph), shown after a mistyped command.
export const usageOf = command => COMMANDS[command]?.split(/\n\s*\n/)[0] || null;

export const COMMANDS = {
  attach: `Usage: timewarp-id attach [what…] [--agent <handle>] [--give mail,phone,wallet,vm]
                          [--name "…"] [--origin <app>] [--here] [--yes] [--claim twc_…]

Gives agents you already have an Agent ID and wires it into them. Without
[what], lists what it finds here and asks (in a terminal; Enter, or --yes,
takes each app's main agent, not projects or subagents). [what] is a number
or ref from \`timewarp-id agents scan\`, a subagent or Timewarp agent's name, or
a folder:
  claude            Claude Code, every project (~/.claude.json, ~/.claude/CLAUDE.md)
  claude:project    Claude Code in this project (.mcp.json, CLAUDE.md)
  claude-agent:<n>  a Claude Code subagent (~/.claude/agents, .claude/agents)
  codex             Codex, every project (~/.codex/config.toml, ~/.codex/AGENTS.md)
  codex:project     Codex in this project (AGENTS.md)
  cursor, cursor:project, claude-desktop
  gemini, antigravity, windsurf, opencode, grok, kiro, qwen, factory, copilot,
  amazonq, continue, cline, roo, kilo     those tools, every project
  timewarp:<id>     a Timewarp desktop agent (its workspace folder)
  openclaw          an OpenClaw workspace
  <folder>, --here  any folder, for a custom agent (AGENTS.md)

Signed in, each gets a new Agent ID named after it (or --agent, an existing
one, which gets a key here if it has none; an agent attached before keeps its
own), and attach writes: a short identity block in its instructions,
.timewarp-id.json in its folder, and the timewarp-id MCP server in the tool's
config (a subagent gets its own, timewarp-id-<handle>, and its tools: list).
Agent ID is told where the agent comes from (--origin overrides the app);
Timewarp agents are linked to their desktop agent. Tools it sees but can't
wire up are listed by \`agents scan\` as manual setup, with the MCP entry to
paste.

Not signed in here? attach uses the Agent ID already set up on this computer,
or prints a link (and opens it) where you confirm your email, which makes your
account; the Agent ID then comes back here. Everything you attach in one go
shares that one Agent ID. --claim twc_… finishes one started on the Agent ID
website.

Running it again updates in place. Config files are edited in place and
backed up once, as <file>.timewarp-id.bak.`,
  detach: `Usage: timewarp-id detach [what…|<agent handle>] [--all]

Removes exactly what attach wrote (the identity block, .timewarp-id.json, the
MCP server, subagent tools) and leaves everything else as it is. Without
[what], lists what is attached and asks (Enter for all of it). The Agent ID
itself stays; end it on the Agent ID dashboard, or with
\`timewarp-id agents revoke\`.`,
  login: `Usage: timewarp-id login --owner-key two_… [--api <url>]

Saves your owner key (create one on the Agent ID dashboard, under Keys) in
~/.timewarp-id/config.json, readable only by you. With --api, also remembers
which Agent ID to use. TIMEWARP_OWNER_KEY overrides the saved key.`,
  terms: `Usage: timewarp-id terms [--yes]

Shows Agent ID's terms of service and asks whether you accept them; --yes
accepts without asking. Creating agents needs them accepted once (again when
they change).`,
  logout: `Usage: timewarp-id logout [--all]

Forgets the owner key. --all also forgets every agent key on this computer.`,
  whoami: 'Usage: timewarp-id whoami [--json]\n\nShows the account you are signed in as and the agent commands act as.',
  agents: `Usage:
  timewarp-id agents list [--all]                 Your agents (--all: with revoked ones)
  timewarp-id agents scan                         Agents on this computer that attach can wire up
  timewarp-id agents create <name> [--origin <app>] [--origin-detail "…"] [--org <id>]
                                                  Creates an agent and saves its key here; --origin
                                                  is the app it lives in (claude-code, codex, cursor,
                                                  gemini, grok, openclaw, strawberry, custom, …)
  timewarp-id agents show <agent>                 Everything about one agent
  timewarp-id agents key <agent>                  A new key for an agent (e.g. on another computer)
  timewarp-id agents pause|resume <agent>         Stop or allow everything it does
  timewarp-id agents revoke <agent> [--yes]       Final: keys, signing keys and resources go`,
  give: `Usage: timewarp-id give <mail|phone|wallet|vm> [--agent <agent>]
         [--size small|medium] [--country US] [--area-code 415]

Gives the agent its own mail inbox, phone number (texts and calls), wallet
(USDC/USDT on Base) or Linux machine (it also gets one the first time it uses
one). Cards are applied for instead: \`timewarp-id card apply\`. While
developing locally, --test gives a test one.`,
  take: 'Usage: timewarp-id take <mail|phone|wallet|card|vm> [--agent <agent>]\n\nReleases it (a phone number or machine goes back to the provider).',
  limits: `Usage:
  timewarp-id limits wallet [--agent <agent>] [--per-transfer 50] [--daily 100] [--approval-above 25]
  timewarp-id limits card [--agent <agent>] [--per-transaction 50] [--daily 100] [--monthly 500]
                          [--blocked-categories a,b] [--allowed-categories a,b]

Amounts are dollars; "none" removes a limit. Without options, shows the limits.
Transfers above --approval-above wait for you: see \`timewarp-id approvals\`.`,
  fund: 'Usage: timewarp-id fund [--agent <agent>] <dollars>\n\nDeveloping locally: adds test money to a test wallet (at most $1,000 at a time, $10,000 held).\nA real wallet is funded by sending USDC or USDT on Base to its address (`timewarp-id wallet show`).',
  approvals: 'Usage: timewarp-id approvals [--all]\n\nTransfers waiting for your OK (agent, amount, to, memo, expiry). In a terminal it asks about\neach one; otherwise answer with `timewarp-id approve <id>` or `timewarp-id deny <id>`.',
  approve: 'Usage: timewarp-id approve <approval id>\n\nApproves a waiting transfer; it is sent at once.',
  deny: 'Usage: timewarp-id deny <approval id>',
  use: `Usage: timewarp-id use <agent> [--project]

Makes <agent> the default for commands, \`mcp\` and \`connect\`. With --project,
writes .timewarp-id.json in the current folder instead, so everything started
in this project (a new Claude Code or Codex chat, say) acts as that agent.`,
  me: 'Usage: timewarp-id me [--agent <agent>]\n\nThe agent\'s identity: id, Git identity, its owner\'s verification and everything it has.',
  mail: `Usage:
  timewarp-id mail list [--folder inbox|sent|trash|all] [--unread] [--limit 25]
  timewarp-id mail read <id>
  timewarp-id mail send --to a@x.com[,b@y.com] --subject "…" --text "…" (or --text - for stdin)
                        [--cc …] [--attach file]…   (each --attach uploads a file, 10 MB at most)
  timewarp-id mail reply <id> --text "…" [--attach file]…
  timewarp-id mail trash <id>      Move it to the trash
  timewarp-id mail restore <id>    Bring it back`,
  sms: 'Usage:\n  timewarp-id sms list\n  timewarp-id sms send <+14155550123> <text…>',
  call: 'Usage:\n  timewarp-id call list\n  timewarp-id call place <+14155550123> --say "…"',
  contacts: `Usage:
  timewarp-id contacts list [name]
  timewarp-id contacts add <name> [--email …] [--phone …] [--wallet …] [--note …]
  timewarp-id contacts rm <id>`,
  wallet: `Usage:
  timewarp-id wallet show              Balance in USD ($12.34 USD · USDC/USDT on Base)
  timewarp-id wallet history
  timewarp-id wallet send <agent handle|agent id|address|contact> <dollars> [--asset usdc|usdt] [--memo "…"]`,
  card: `Usage:
  timewarp-id card show
  timewarp-id card reveal            Full number and code (logged; never paste them in chat)
  timewarp-id card transactions
The owner applies for a virtual card for an agent:
  timewarp-id card apply [--agent <agent>] --use-case "…" --monthly 200 --country US
  timewarp-id card application [--agent <agent>]
Developing locally, a test card tries payments against its limits:
  timewarp-id card test-charge <amount> [--merchant "…"] [--category …]`,
  vm: `Usage:
  timewarp-id vm status|start|stop|history
  timewarp-id vm files [path]          What is in a folder on the machine (default: home)
  timewarp-id vm exec [--cwd /dir] [--timeout 120] -- <command…>

The agent's computer starts the first time it is used: there is nothing to
set up first.`,
  passport: `Usage: timewarp-id passport --audience <audience>

Prints only a short-lived signed passport for the service, so you can write
  curl -H "Agent-Passport: $(timewarp-id passport --audience https://api.example.com)" …`,
  mcp: `Usage: timewarp-id mcp [--agent <agent> | --default-agent <agent>]
       timewarp-id mcp --remote <url> [--audience <aud>] [--agent <agent>]

A stdio MCP server (newline-delimited JSON-RPC) that forwards every message to
Agent ID's MCP endpoint with the agent's key. Without --agent it acts as the
agent chosen for the folder it starts in (.timewarp-id.json), else
--default-agent, else the default agent. Logs go to stderr.

With --remote, it forwards to another company's MCP server (Streamable HTTP)
that accepts only verified agents, sending a fresh passport for --audience
(default: the server's origin) in an Agent-Passport header, never the key.`,
  connect: `Usage: timewarp-id connect <claude|codex|claude-desktop|cursor> [--agent <agent>]
         [--scope user|project] [--print] [--local] [--config <file>]

Adds Agent ID as an MCP server to the tool, running \`timewarp-id mcp\`, so keys
stay in this CLI's config. Without --agent, the server acts as the agent
chosen for the project the tool runs in (.timewarp-id.json, else the default).
  claude          runs \`claude mcp add\` (or prints it if \`claude\` isn't installed)
  codex           [mcp_servers.timewarp_id] in ~/.codex/config.toml ($CODEX_HOME)
  claude-desktop  claude_desktop_config.json
  cursor          ~/.cursor/mcp.json (--scope project: .cursor/mcp.json here)
--print only prints what it would do. --local runs this copy of the CLI
instead of \`npx -y @timewarp/agent-id\`.`,
  git: `Usage: timewarp-id git setup [--agent <agent>] [--global]

Makes the agent sign Git commits: creates ~/.timewarp-id/keys/<handle>_ed25519
if needed, registers its public key with Agent ID, and sets gpg.format,
user.signingkey, commit.gpgsign, user.name and user.email in this repository
(or globally). Repositories protected by Agent ID accept these commits while
the agent is active.`,
};
