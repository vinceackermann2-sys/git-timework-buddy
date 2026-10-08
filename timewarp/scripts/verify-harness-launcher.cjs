"use strict";
// No model calls or account access. Probe the launchers through Codex's real
// restricted command executor, not merely an unrestricted parent process.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const argument=process.argv.indexOf('--package-root');
const packageRoot=argument<0?path.join(root,'build/native/resources/openai-codex'):path.resolve(process.argv[argument+1]);
const directory=fs.mkdtempSync(path.join(root,'.temp/launcher-sandbox-'));
const prepared=require('../desktop/harness-path.cjs').prepareHarnessPath(packageRoot,path.join(directory,'home'));
const repairedPath=prepared+';'+(process.env.PATH||'');
fs.writeFileSync(path.join(directory,'home/config.toml'),'[shell_environment_policy.set]\nPATH = '+JSON.stringify(repairedPath)+'\n');
const env={...process.env,CODEX_HOME:path.join(directory,'home'),PATH:path.join(packageRoot,'codex-path')+';'+(process.env.PATH||'')};
delete env.BROWSER_RUNTIME_URL;delete env.BROWSER_RUNTIME_TOKEN;
// Match the desktop's command-line override, which takes precedence over the
// config file. A config-only repair cannot fix an unpatched desktop's PATH.
const child=cp.spawn(path.join(root,'build/native/resources/openai-codex/bin/codex-app-server.exe'),['-c','shell_environment_policy.set.PATH='+JSON.stringify(repairedPath)],{
  env,
  cwd:directory,windowsHide:true,stdio:['pipe','pipe','pipe']
});
let sequence=0,buffer='';const waiting=new Map();
child.stderr.resume();
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const response=JSON.parse(line);if(waiting.has(response.id)){const task=waiting.get(response.id);waiting.delete(response.id);response.error?task.reject(Error(JSON.stringify(response.error))):task.resolve(response.result);}}catch{}}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(Error(method+' timed out'));},30000);waiting.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
child.on('error',error=>{for(const task of waiting.values())task.reject(error);waiting.clear();});
(async()=>{
  await request('initialize',{clientInfo:{name:'timewarp_launcher_acceptance',version:'1.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'initialized'})+'\n');
  const result=await request('command/exec',{command:['powershell.exe','-NoProfile','-Command','browser --help'],cwd:directory,sandboxPolicy:{type:'readOnly'},timeoutMs:10000});
  assert.match(result.stderr,/BROWSER_RUNTIME_URL is required/,'The launcher executes inside the restricted shell and reaches its authenticated gateway boundary.');
  assert.doesNotMatch(result.stderr,/Access.denied|Åtkomst nekad|EPERM/i);
  const adapted=require('../desktop/harness-instructions.cjs').bindHarnessClient({request});
  const writable=await adapted.request('thread/start',{cwd:directory,sandbox:'workspace-write',approvalPolicy:'never'});
  assert.equal(writable.sandbox.type,'workspaceWrite','The requested workspace permission reaches the native runtime.');
  assert.equal(writable.activePermissionProfile?.id,':workspace');
  assert.equal(writable.approvalPolicy,'never');
  fs.writeFileSync(path.join(root,'reports/harness-launcher.json'),JSON.stringify({verifiedAt:new Date().toISOString(),sandbox:'readOnly',launcherStarted:true,gatewayAuthenticationRequired:true,packageRoot},null,2));
  console.log('Verified prepared Windows launcher executes through the real read-only Codex sandbox.');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{if(child.pid)cp.spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});});
