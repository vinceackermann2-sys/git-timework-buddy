'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),config=require('../mac-release.json');
const run=(tool,args)=>cp.execFileSync(tool,args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
function verify(){
  if(process.platform!=='darwin')throw new Error('Mac signature and native architecture checks require macOS.');
  const index=process.argv.indexOf('--app-dir');if(index<0)throw new Error('Supply --app-dir.');
  const app=fs.realpathSync(process.argv[index+1]),build=fs.realpathSync(path.join(root,'build'));
  if(!app.startsWith(build+path.sep)||!app.endsWith('.app'))throw new Error('Verify an isolated build app.');
  const draft=process.argv.includes('--draft'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources');
  const plist=JSON.parse(run('/usr/bin/plutil',['-convert','json','-o','-',path.join(contents,'Info.plist')]));
  assert.equal(plist.CFBundleIdentifier,draft?'com.timewarp.desktop.preview':config.appId);
  assert.equal(plist.LSMinimumSystemVersion,config.minimumSystemVersion);
  if(!draft)assert.equal(plist.CFBundleShortVersionString,config.version);
  assert.ok(!fs.existsSync(path.join(resources,'app-update.yml')),'Mac packages cannot inherit an upstream updater');
  const critical=['agent-browser/bin/agent-browser-darwin-arm64','openai-codex/bin/codex-app-server','openai-codex/bin/codex-code-mode-host','openai-codex/codex-path/rg','openai-codex/codex-resources/zsh/bin/zsh'];
  for(const name of [...critical,'energy-git/simple-git.darwin-arm64.node']){
    const file=path.join(resources,name);assert.ok(fs.statSync(file).isFile(),name);
    assert.ok(run('/usr/bin/lipo',['-archs',file]).trim().split(/\s+/).includes('arm64'),'Native arm64 tool: '+name);
    if(critical.includes(name))assert.ok(fs.statSync(file).mode&0o111,'Executable mode preserved: '+name);
  }
  // Load the shipped Node-API Git binding under the native Mac Node runtime.
  const git=require(path.join(resources,'energy-git'));assert.ok(git);
  run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app]);
  const signature=cp.spawnSync('/usr/bin/codesign',['-d','--verbose=4',app],{encoding:'utf8'});
  if(signature.status!==0)throw new Error('Unable to read Mac code signature.');
  if(!draft){
    assert.ok(signature.stderr.includes('Authority='+config.identity),'Configured Developer ID identity');
    assert.ok(signature.stderr.includes('TeamIdentifier='+config.teamId),'Configured Apple team');
    assert.match(signature.stderr,/flags=.*runtime/,'Hardened runtime is signed');
  }
  const entitlements=cp.spawnSync('/usr/bin/codesign',['-d','--entitlements',':-',app],{encoding:'utf8'});
  if(entitlements.status!==0)throw new Error('Unable to read Mac entitlements.');
  assert.ok(entitlements.stdout.includes('com.apple.security.cs.allow-jit'),'Apple Silicon Electron JIT entitlement');
  assert.ok(!entitlements.stdout.includes('get-task-allow'),'No debugger entitlement in distributed apps');
  assert.ok(!entitlements.stdout.includes('disable-library-validation'),'Signed native dependencies retain library validation');
  fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,'reports/mac-package.json'),JSON.stringify({verifiedAt:new Date().toISOString(),app,arch:'arm64',nativeTools:true,gitBinding:true,deepSignature:true,hardenedRuntime:!draft,developerId:!draft,teamId:draft?null:config.teamId,notarized:false,liveAcceptance:false},null,2));
  console.log('Verified Mac bundle, native arm64 tools, Git binding, deep signature and entitlements.');
}
try{verify();}catch(error){console.error(error.message);process.exitCode=1;}
