"use strict";
// Rebuild native indexes in a disposable home using saved transcripts only.
// No credentials, live database writes, model turns, or external services.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sourceArg=process.argv.indexOf('--source');
if(sourceArg<0||!process.argv[sourceArg+1])throw Error('Pass --source with a stopped-process profile backup. Never inspect live SQLite files through a different Windows package context.');
const home=path.resolve(process.argv[sourceArg+1]);
const trial=fs.mkdtempSync(path.join(root,'.temp/history-recovery-'));
for(const name of ['sessions','archived_sessions','agents'])if(fs.existsSync(path.join(home,name)))fs.cpSync(path.join(home,name),path.join(trial,name),{recursive:true});
fs.writeFileSync(path.join(trial,'config.toml'),'model_provider = "openai"\n');
const child=cp.spawn(path.join(root,'build/native/resources/openai-codex/bin/codex-app-server.exe'),[],{env:{...process.env,CODEX_HOME:trial},cwd:trial,windowsHide:true,stdio:['pipe','pipe','pipe']});
let sequence=0,buffer='';const waiting=new Map();child.stderr.resume();
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let response;try{response=JSON.parse(line);}catch{continue;}if(waiting.has(response.id)){const task=waiting.get(response.id);waiting.delete(response.id);response.error?task.reject(Error(JSON.stringify(response.error))):task.resolve(response.result);}}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(Error(method+' timed out'));},30000);waiting.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
child.on('error',error=>{for(const task of waiting.values())task.reject(error);waiting.clear();});
(async()=>{
  await request('initialize',{clientInfo:{name:'timewarp_history_acceptance',version:'1.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'initialized'})+'\n');
  const ids=[];
  for(const name of ['sessions','archived_sessions'])for(const entry of fs.readdirSync(path.join(trial,name),{recursive:true,withFileTypes:true})){
    if(!entry.isFile()||!entry.name.endsWith('.jsonl'))continue;
    const first=fs.readFileSync(path.join(entry.parentPath,entry.name),'utf8').split('\n',1)[0];
    const metadata=JSON.parse(first);if(metadata.type!=='session_meta'||!metadata.payload.id)throw Error('Invalid saved transcript');
    ids.push({id:metadata.payload.id,archived:name==='archived_sessions'});
  }
  const checks=[];
  for(const {id,archived} of ids){try{await request('thread/read',{threadId:id,includeTurns:false});if(archived){checks.push({id,read:true,archived:true});continue;}const resumed=await request('thread/resume',{threadId:id,modelProvider:'openai',excludeTurns:false});const turns=await request('thread/turns/list',{threadId:id,cursor:null,limit:100,sortDirection:'desc',itemsView:'full'});checks.push({id,read:true,resumedTurns:resumed.thread?.turns?.length,turns:turns.data?.length,itemCount:turns.data?.reduce((sum,turn)=>sum+(turn.items?.length||0),0)});}catch(error){checks.push({id,read:false,error:error.message});}}
  const list=await request('thread/list',{limit:100});
  const report={verifiedAt:new Date().toISOString(),source:home,trial,checks,listed:list.data?.length,nextCursor:list.nextCursor};
  console.log(JSON.stringify({...report,checks:undefined,recovered:checks.filter(check=>check.read).length,failures:checks.filter(check=>!check.read),turns:checks.reduce((sum,check)=>sum+(check.turns||0),0),items:checks.reduce((sum,check)=>sum+(check.itemCount||0),0)},null,2));fs.writeFileSync(path.join(root,'reports/history-recovery.json'),JSON.stringify(report,null,2));
  if(checks.some(check=>!check.read))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{child.stdin.end();setTimeout(()=>{if(child.pid)cp.spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});},1500);});
