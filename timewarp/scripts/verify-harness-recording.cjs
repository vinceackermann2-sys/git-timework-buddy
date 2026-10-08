"use strict";
// Recheck immutable native evidence without purchasing another model run. This
// also accepts the pinned binary's final_answer phase (not just final).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {finalText,delegationChecks}=require('./harness-evidence.cjs');
const root=path.resolve(__dirname,'..'),live=JSON.parse(fs.readFileSync(path.join(root,'reports/harness-live.json'),'utf8'));
const directory=live.fixtureDirectory,events=JSON.parse(fs.readFileSync(path.join(directory,'events.json'),'utf8'));
const native=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8')),browser=live.tasks.find(task=>task.name==='visible browser worker');
const output=events.filter(event=>event.method==='item/completed'&&event.params.item?.type==='commandExecution').map(event=>event.params.item.aggregatedOutput||'').join('\n');
const nonce=native.verificationCode||output.match(/VERIFIED ([a-f0-9]{12})/)?.[1];
const checks={...native.checks,...delegationChecks(events,browser.run.threadId,browser.workerIds,nonce),fixtureAccountRemoved:live.fixtureCleanup===true};
const artifact=live.tasks.find(task=>task.name==='file and no delegation');
if(artifact){
  const target=path.join(directory,'result.txt'),final=finalText(events,artifact.run.threadId);
  checks.artifactExactContents=fs.readFileSync(target,'utf8')==='HARNESS_OK';
  checks.artifactHasAbsoluteLink=[...final.matchAll(/\[[^\]]+\]\((?:<([^>]+)>|([^\)]+))\)/g)].some(match=>{
    try{const value=decodeURIComponent(match[1]||match[2]);return path.isAbsolute(value)&&path.resolve(value)===target;}catch{return false;}
  });
}
const stopped=live.tasks.find(task=>task.name==='stop on first error');
if(stopped){
  const executions=events.filter(event=>event.method==='item/completed'&&event.params.threadId===stopped.run.threadId&&event.params.item?.type==='commandExecution');
  checks.stopAfterActualCommandError=executions.length===1&&executions[0].params.item.exitCode!==0&&stopped.run.stopped===true&&!fs.existsSync(path.join(directory,'forbidden.txt'));
}
const sha=crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,'app.asar'))).digest('hex');
checks.currentStagedBuild=sha===JSON.parse(fs.readFileSync(path.join(root,'reports/staged-build.json'),'utf8')).asarSha256;
checks.noUnexpectedFixtureFailure=!native.error||native.error==='Some native acceptance checks failed';
const report={verifiedAt:new Date().toISOString(),passed:Object.values(checks).every(Boolean),checks,fixtureDirectory:directory,asarSha256:sha,originalRunnerPassed:live.passed,originalRunnerError:live.error||null,creditsDebited:live.creditsDebited,tasks:live.tasks};
fs.writeFileSync(path.join(root,'reports/harness-recording.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
