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

// --- For developers: let only verified agents in (the SDK, no keys) ----------

export const SDK_INSTALL = "npm install @timewarp/agent-id-verify";
export const EXAMPLE_AUDIENCE = "https://api.your-app.com";

export type SdkFramework = "express" | "next" | "workers" | "fetch";

export function sdkSnippet(framework: SdkFramework, audience = EXAMPLE_AUDIENCE): string {
  const options = `{ audience: "${audience}", require: "verified" }`;
  switch (framework) {
    case "express":
      return [
        'import express from "express";',
        'import { agentIdMiddleware } from "@timewarp/agent-id-verify";',
        "",
        "const app = express();",
        `app.use("/api", agentIdMiddleware(${options}));`,
        "",
        'app.get("/api/hello", (req, res) => {',
        "  res.json({ hello: req.agent.agent.name }); // a verified agent",
        "});",
      ].join("\n");
    case "next":
      return [
        "// app/api/hello/route.ts",
        'import { withAgentId } from "@timewarp/agent-id-verify";',
        "",
        "export const GET = withAgentId(",
        "  async (request, agent) => Response.json({ hello: agent.agent.name }),",
        `  ${options},`,
        ");",
      ].join("\n");
    case "workers":
      return [
        "// Cloudflare Workers, Hono, Deno, Bun",
        'import { withAgentId } from "@timewarp/agent-id-verify";',
        "",
        "export default {",
        "  fetch: withAgentId(",
        "    async (request, agent) => new Response(`Hello, ${agent.agent.name}`),",
        `    ${options},`,
        "  ),",
        "};",
      ].join("\n");
    case "fetch":
      return [
        'import { passportFrom, verifyPassport } from "@timewarp/agent-id-verify";',
        "",
        "export async function handle(request: Request) {",
        "  try {",
        `    const { agent, owner } = await verifyPassport(passportFrom(request) ?? "", ${options});`,
        "    return Response.json({ hello: agent.name, owner: owner.level });",
        "  } catch (error) {",
        '    return new Response("Only verified agents can call this API", { status: 401 });',
        "  }",
        "}",
      ].join("\n");
  }
}

export function mcpSnippet(audience = "https://mcp.your-app.com"): string {
  return [
    'import { agentIdMiddleware } from "@timewarp/agent-id-verify";',
    "",
    "// Agents send their passport in the Agent-Passport header.",
    `app.post("/mcp", agentIdMiddleware({ audience: "${audience}", require: "verified" }), handleMcp);`,
  ].join("\n");
}

export const MCP_CLIENT_COMMAND = "timewarp-id mcp --remote https://mcp.your-app.com";

export function onlineCheckSnippet(audience = EXAMPLE_AUDIENCE): string {
  return [
    'import { checkPassport, passportFrom } from "@timewarp/agent-id-verify";',
    "",
    `const result = await checkPassport(passportFrom(request) ?? "", { audience: "${audience}" });`,
    "if (!result.allowed) {",
    `  return new Response("This agent was revoked or isn't verified", { status: 403 });`,
    "}",
  ].join("\n");
}

// The commit check lives in Timewarp's public repository.
export const ACTION_REF = "vinceackermann2-sys/git-timework-buddy/agent-id/action@main";

export function githubActionSnippet(organization = "<your organization id>"): string {
  return [
    "# .github/workflows/agent-commits.yml",
    "name: Verified agent commits",
    "on: [push, pull_request]",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    `      - uses: ${ACTION_REF}`,
    "        with:",
    `          organization: ${organization}`,
  ].join("\n");
}
