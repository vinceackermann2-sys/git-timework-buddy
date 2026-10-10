"use strict";
// Codex settings that make the official app server work as the previous app's
// harness did.

// Agents use Timewarp's own tools and the user's connected apps and plugins,
// as before: not ChatGPT apps, Codex's remote plugins or plugin suggestions,
// Codex's own browser and computer use, or goals. Image generation stays on.
// Workers, as before: at most 4 at once, on the chat's model (so they stay
// within its funding source), and they don't start workers of their own.
// Also off, as before: the tool that asks for extra permissions mid-turn
// (approval reviews cover that), fan-out of one task to many workers, and the
// free-form patch tool (where the Codex version still has those switches).
const CODEX_FEATURES = [
  "features.apps=false", "features.tool_suggest=false", "features.remote_plugin=false", "features.goals=false",
  "features.browser_use=false", "features.browser_use_external=false", "features.in_app_browser=false", "features.computer_use=false",
  "features.image_generation=true",
  "features.request_permissions_tool=false", "features.enable_fanout=false", "features.apply_patch_freeform=false",
  "features.multi_agent_v2.max_concurrent_threads_per_session=4", "features.multi_agent_v2.expose_spawn_agent_model_overrides=false",
  "agents.max_depth=1",
];

// On Windows, commands run in Windows' own app container sandbox (MXC)
// wherever Windows offers it, as in Codex's own app; it needs no setup.
// Elsewhere Codex uses its unelevated sandbox, which onboarding sets up as the
// previous app did (sandbox.cjs). Left out once the sandbox has been turned off
// on a PC where it couldn't run commands.
const WINDOWS_SANDBOX_FEATURES = ["features.prefer_mxc=true"];

// Each chat's permissions, as the previous app started them: its workspace
// profile (write access to the agent's folder; this Codex treats the older
// workspace-write sandbox setting as read-only) with network access for
// commands, defined in THREAD_CONFIG.
const PERMISSIONS = "timewarp";

// Each chat's settings, as before: the permission profile, skills described
// to the agent, reasoning summarised in detail and concise replies.
const THREAD_CONFIG = Object.freeze({
  [`permissions.${PERMISSIONS}.extends`]: ":workspace",
  [`permissions.${PERMISSIONS}.network.enabled`]: true,
  // Codex reloads the config (for example to refresh MCP servers) only when
  // the profile is also the default.
  default_permissions: PERMISSIONS,
  "skills.include_instructions": true,
  model_reasoning_summary: "detailed",
  model_verbosity: "low",
});

// A chat's settings for one agent: its workers learn the agent they work for
// (Codex gives a thread's subagent instructions to the workers it starts).
function agentThreadConfig(workerText) {
  return { ...THREAD_CONFIG, ...(workerText ? { "features.multi_agent_v2.subagent_developer_instructions": workerText } : {}) };
}

// The folders a chat's commands may write without an approval review, as the
// previous app gave them: the agent's workspace, Codex's skills folder, and the
// memory folder while memory may be written (Settings → General → Memory).
function workspaceRoots(workspace, { skills = null, memories = null, memoryWrite = false } = {}) {
  return [...new Set([workspace, skills, memoryWrite ? memories : null].filter(Boolean))];
}

// Timewarp's MCP servers on the local bridge (model-bridge.cjs): connected
// apps, and the browser, vault, automation and chat tools (tool-server.cjs). Their
// tools are described to the agent in full rather than left for it to look
// up (omit_tools_from "deferred"). Timewarp's own tools run without an
// approval review, as they did as dynamic tools; the vault asks the user
// itself, so its calls may wait for an answer. They are required: a chat
// starts once they are connected, so its first message has them.
function toolServers(port) {
  const base = `http://127.0.0.1:${port}/mcp/`;
  const own = (name, timeout) => ({ url: base + name, enabled: true, required: true, bearer_token_env_var: "TIMEWARP_TOOLS_TOKEN", default_tools_approval_mode: "approve", tool_timeout_sec: timeout, omit_tools_from: ["deferred"] });
  return {
    timewarp_composio: { url: base + "composio", enabled: true, bearer_token_env_var: "TIMEWARP_COMPOSIO_TOKEN", omit_tools_from: ["deferred"] },
    timewarp_browser: own("timewarp_browser", 180),
    timewarp_vault: own("timewarp_vault", 900),
    timewarp_automations: own("timewarp_automations", 120),
    timewarp_chats: own("timewarp_chats", 60),
  };
}

// Skills of the previous app's built-in plugin, still installed in profiles it
// used, that drive its browser command, vault and memory writer. Timewarp's own
// browser and vault tools and memory instructions replace them.
const REPLACED_SKILLS = ["browser-use", "vault", "memory-write-skill"];

module.exports = { CODEX_FEATURES, WINDOWS_SANDBOX_FEATURES, PERMISSIONS, THREAD_CONFIG, agentThreadConfig, workspaceRoots, toolServers, REPLACED_SKILLS };
