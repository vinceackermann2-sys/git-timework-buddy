"use strict";
const marker = '<timewarp_task_execution>';
const windowsShell = 'On Windows the default shell may be Windows PowerShell 5. Do not use &&, ||, or bash backslash line continuations there. PowerShell treats unquoted @e1 selectors as splatting: quote every browser ref, for example browser click "@e2" and browser fill "@e1" "text". Issue one browser command per shell call, or use an explicit if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } guard between sequential commands. Use exact profile IDs from the current browser context. When you need page text, use a text-inclusive snapshot or browser get text body; snapshot -i omits noninteractive text.';
// Stable text belongs in developer instructions, never a changing per-turn
// preamble: repeated tool turns can reuse the same prompt prefix.
const instructions = `${marker}
Follow the user's task, scope, output format, and explicit stop conditions. A request to stop on the first error overrides general persistence or recovery advice. Preserve all these constraints verbatim when assigning work to another agent.
Do simple browser operations directly after reading the browser-use skill. Delegate substantial independent research, or when the user requests delegation. Reuse an existing worker for related work. For an independent worker use fork_turns: "none" and give it the assignment, relevant context, exact constraints, and required evidence. Copy conversation history only when the assignment requires that history. Never delegate when the user says not to.
After dispatching work, do independent work, then use wait_agent for completion. Do not loop over list_agents, create shell sleeps, or spend model turns printing that you are waiting. A worker must return: outcome (completed, blocked, or failed), verified evidence, result links, and any unfinished steps. Keep failures visible to the parent. A completed worker turn alone does not prove a successful task.
${process.platform === 'win32' ? windowsShell : ''}
Complete actions with the available tools and verify the resulting state before reporting success. A requested action, dispatched worker, successful process launch, or delivered click is not evidence that the task completed. Wait for outstanding workers and inspect their evidence. Never announce success while the result is pending or failed.
Use progress messages for meaningful changes only. Keep the final answer consistent with the latest verified state, explicitly identify partial results, and do not send a premature completion message followed by a correction. Do not repeatedly ask for authorization already provided by the user.
For browser changes, read back the relevant tab URL and resulting page state. For file changes, read back the saved content and show a clickable absolute file link. For connectors, distinguish an available connector card from a connected account and a successful tool action.
After a tool error, honor the user's retry limit. Otherwise use one evidence-based recovery; if still blocked, report the actual error and unfinished step. A denied or failed approval review requires stopping: do not try alternate commands, selectors, or keyboard actions to achieve that action. Report the review failure and unfinished step. Do not repeatedly probe protocols, inspect credentials, change security settings, or invent capabilities. Shell/file access does not imply native desktop GUI control. Keep tool output narrow and avoid repeated full-page snapshots or unrelated tool discovery.
</timewarp_task_execution>`;
function appendInstructions(value = '') {
  if (typeof value !== 'string' || value.includes(marker)) return value;
  return value ? value + '\n\n' + instructions : instructions;
}
function browserInstructions(value, platform=process.platform) {
  const browserMarker = '<timewarp_browser_shell>';
  if(platform !== 'win32' || value.includes(browserMarker))return value;
  return value + '\n\n' + browserMarker + '\n' + windowsShell + '\nThis Windows guidance takes precedence over generic bash chaining examples above.\n</timewarp_browser_shell>';
}
function bindHarnessClient(client) {
  const request = client.request.bind(client);
  client.request = (method, params) => {
    // This pinned runtime ignores the legacy sandbox mode at thread boundaries.
    // Select the equivalent named workspace profile, retaining approval policy.
    if (['thread/start','thread/resume','thread/fork'].includes(method) && params?.sandbox === 'workspace-write' && !params.permissions) {
      const {sandbox,...rest}=params;
      params={...rest,permissions:':workspace'};
      const extra=params.config?.['sandbox_workspace_write.writable_roots'];
      if(!params.runtimeWorkspaceRoots&&params.cwd&&Array.isArray(extra)&&extra.length)params.runtimeWorkspaceRoots=[...new Set([params.cwd,...extra])];
    }
    // A fresh base-instructions-only thread still needs the execution contract.
    // Resume/turn calls without instructions preserve the thread's existing text.
    if (method === 'thread/start' || ['thread/resume','thread/fork','turn/start'].includes(method) && typeof params?.developerInstructions === 'string') {
      params = { ...params, developerInstructions: appendInstructions(params.developerInstructions) };
    }
    return request(method, params);
  };
  return client;
}
module.exports = { appendInstructions, bindHarnessClient, browserInstructions, instructions };
