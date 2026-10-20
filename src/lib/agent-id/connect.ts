// What to run or paste to give agents their Agent ID. The CLI's `attach`
// finds agents in Claude Code, Codex, Cursor, Claude Desktop, Timewarp and
// project folders and wires them up; the MCP config is the manual fallback.

export const ATTACH_COMMAND = "npx @timewarp/agent-id attach";
export const LOGIN_COMMAND = "npx @timewarp/agent-id login";

export const attachAgentCommand = (handle: string) => `${ATTACH_COMMAND} --agent ${handle}`;
export const loginWithKey = (key: string) => `${LOGIN_COMMAND} --owner-key ${key}`;

// On an agent's page: attach that Agent ID, not a new one.
export const attachCommand = (handle?: string | null) =>
  handle ? `${ATTACH_COMMAND} --agent ${handle}` : ATTACH_COMMAND;
export const KEY_PLACEHOLDER = "twa_…";
export const KEY_ENV = "TIMEWARP_AGENT_KEY";
export const SERVER_NAME = "timewarp-id";

export function claudeCodeCommand(mcpUrl: string, key?: string | null): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${mcpUrl} --header "Authorization: Bearer ${key || KEY_PLACEHOLDER}"`;
}

export function codexConfig(mcpUrl: string): string {
  return [
    "[mcp_servers.timewarp_id]",
    `url = "${mcpUrl}"`,
    `bearer_token_env_var = "${KEY_ENV}"`,
  ].join("\n");
}

export function envExport(key?: string | null): string {
  return `export ${KEY_ENV}="${key || KEY_PLACEHOLDER}"`;
}

// --- For companies ------------------------------------------------------------

export function verifySdkSnippet(audience: string): string {
  return [
    'import { AgentIdError, verifyPassport } from "@timewarp/agent-id-verify";',
    "",
    'const passport = request.headers.get("Agent-Passport") ?? "";',
    "try {",
    `  const { agent, owner } = await verifyPassport(passport, { audience: "${audience}" });`,
    "} catch (error) {",
    "  if (error instanceof AgentIdError) {",
    "    return new Response(error.message, { status: error.status });",
    "  }",
    "  throw error;",
    "}",
  ].join("\n");
}

export function githubActionSnippet(): string {
  return [
    "name: Verified agent commits",
    "on: [push, pull_request]",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: timewarp/agent-id/action@v1",
    "        with:",
    "          secret: ${{ secrets.AGENT_ID_SECRET }}",
  ].join("\n");
}

export function allowedSignersSnippet(apiUrl: string): string {
  return [
    `curl ${apiUrl}/v1/allowed-signers \\`,
    '  -H "Authorization: Bearer $AGENT_ID_SECRET" > .git/allowed_signers',
    "git config gpg.ssh.allowedSignersFile .git/allowed_signers",
  ].join("\n");
}
