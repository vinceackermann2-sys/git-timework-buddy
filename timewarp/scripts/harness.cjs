"use strict";
function patchHarnessPath(source) {
  const before = 'const s=k.join(t.packageRoot,"codex-path");return we.existsSync(s)&&(n.PATH=';
  if (source.split(before).length !== 2) throw Error('Harness launcher PATH contract changed.');
  return source.replace(before, 'const s=require("./timewarp/desktop/harness-path.cjs").prepareHarnessPath(t.packageRoot,t.home);return we.existsSync(s)&&(n.PATH=');
}
function patchBrowserInstructions(source) {
  const role='const n=await T.readFile(k.join(e,"plugins/energy-defaults/skills/browser-use/SKILL.md"),"utf8"),r=';
  if(source.split(role).length!==2)throw Error('Browser role instruction contract changed.');
  source=source.replace(role,'const n=require("./timewarp/desktop/harness-instructions.cjs").browserInstructions(await T.readFile(k.join(e,"plugins/energy-defaults/skills/browser-use/SKILL.md"),"utf8")),r=');
  const start=source.indexOf('Delegate all browser work to a subagent');
  const end=source.indexOf('Put the complete task, relevant user constraints',start);
  if(start<0||end<start||end-start>1200)throw Error('Browser delegation instruction contract changed.');
  return source.slice(0,start)+'For short browser tasks, read the browser-use skill and operate the browser directly. Delegate substantial independent browser research to the browser role when useful, or when the user asks for delegation. Never delegate when the user explicitly says not to. Reuse an existing browser worker for related steps. Read the returned evidence before reporting success.\\r\\n\\r\\n'+source.slice(end);
}
function patchHarnessPolicy(source) {
  const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Harness policy contract changed: '+before);source=source.replace(before,after);};
  replace('max_concurrent_threads_per_session:10','max_concurrent_threads_per_session:4');
  replace('wait_agent_enabled:!1','wait_agent_enabled:!0');
  replace('Ap={name:"energy/lite",reasoningEffort:"high",serviceTier:null}','Ap={name:"timewarp/background",reasoningEffort:"low",serviceTier:null}');
  // Read-only trace inspection uses the same signed-in and conversation ownership
  // checks as before. Export/debug endpoints keep their separate feature gate.
  replace('Sre=({entitiesStore:t,threads:e,connect:n})=>{const r=Se.use(Fu("thread_debug_actions"))','Sre=({entitiesStore:t,threads:e,connect:n})=>{const r=Se');
  const start=source.indexOf('<subagents>'),end=source.indexOf('</subagents>',start);
  if(start<0||end<start||end-start>1800)throw Error('Subagent instructions contract changed.');
  source=source.slice(0,start)+'<subagents>\\r\\nDelegate when independent work justifies it or the user requests it. Prefer a small number of focused workers and reuse them for related steps. After spawning, continue independent work, then use wait_agent to await completion. Do not poll list_agents or use shell sleeps. Inspect worker evidence and finish the parent task before sending the user a completion message. Respect explicit no-delegation and stop-on-error constraints.\\r\\n'+source.slice(end);
  return source;
}
module.exports = { patchHarnessPath, patchBrowserInstructions, patchHarnessPolicy };
