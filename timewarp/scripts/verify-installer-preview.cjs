"use strict";
// Local, reversible NSIS acceptance. Never use this script for a public installer.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {hash}=require('./upstream.cjs'),{shellPath,options:probeOptions}=require('../shared/authenticode.cjs');
const root=path.resolve(__dirname,'..');
function existing(){
  const script="$ErrorActionPreference='Stop'; $roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); $count=0; foreach($registryRoot in $roots){ if(Test-Path -LiteralPath $registryRoot){ foreach($key in Get-ChildItem -LiteralPath $registryRoot){$item=Get-ItemProperty -LiteralPath $key.PSPath; if($item.DisplayName -like 'Timewarp Preview*'){$count++}}}}; [string]$count";
  return Number(cp.execFileSync(shellPath(),['-NoProfile','-NonInteractive','-Command',script],probeOptions(__filename)).trim());
}
function run(file,args){const result=cp.spawnSync(file,args,{windowsHide:true,windowsVerbatimArguments:true,stdio:'ignore',timeout:120000});if(result.error||result.status!==0)throw new Error('Preview installer lifecycle failed: '+path.basename(file));}
function verifyFiles(stage,destination){
  let count=0,longest=0;
  function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const source=path.join(directory,entry.name),relative=path.relative(stage,source),installed=path.join(destination,relative);if(entry.isDirectory())walk(source);else{assert.ok(entry.isFile(),'The staged installer inputs contain only regular files');assert.equal(hash(installed),hash(source),'Installed file matches staging: '+relative);count++;longest=Math.max(longest,installed.length);}}}
  walk(stage);return{installedFiles:count,longestInstalledPath:longest};
}
async function main(){
  if(existing()!==0)throw new Error('An existing Timewarp Preview installation is present. Its files and registration will not be changed.');
  const previewVersion=require('../package.json').version+'-draft.1',installer=path.join(root,`build/installer-draft/Timewarp-Preview-${previewVersion}-x64.exe`);
  const stage=path.join(root,'build/native'),expected=hash(path.join(stage,'Timewarp Preview.exe'));
  const destination=path.join(root,'build','installer-smoke-'+crypto.randomUUID());
  const base=fs.realpathSync(path.join(root,'build'));assert.equal(path.dirname(destination),base);assert.ok(!fs.existsSync(destination));
  const reportFile=path.join(root,'reports/installer-preview.json');if(fs.existsSync(reportFile))fs.unlinkSync(reportFile);
  let cleanupNeeded=false,report;
  try{
    cleanupNeeded=true;
    run(installer,['/S','/currentuser','/D='+destination]);
    assert.equal(hash(path.join(destination,'Timewarp Preview.exe')),expected,'Installed executable matches the staged app');
    assert.equal(hash(path.join(destination,'resources/app.asar')),hash(path.join(stage,'resources/app.asar')),'Installed archive matches the staged app');
    const installedInventory=verifyFiles(stage,destination);
    cp.execFileSync(process.execPath,[path.join(__dirname,'verify-native-startup.cjs'),'--app-dir',destination],{windowsHide:true,stdio:'inherit',timeout:60000});
    const unsupported=path.join(destination,'x'.repeat(80));assert.ok(unsupported.length>160);
    const rejected=cp.spawnSync(installer,['/S','/currentuser','/D='+unsupported],{windowsHide:true,windowsVerbatimArguments:true,stdio:'ignore',timeout:30000});
    assert.ifError(rejected.error);assert.notEqual(rejected.status,0,'Unsupported installation roots are rejected');
    assert.equal(existing(),1,'Rejecting an unsupported root preserves the existing preview registration');
    assert.deepEqual(verifyFiles(stage,destination),installedInventory,'Rejecting an unsupported root preserves the existing installation');
    // Reinstall the identical preview to exercise NSIS's existing-installation
    // atomic removal/restore path. This is not a signed N-to-N+1 update test.
    run(installer,['/S','/currentuser','/D='+destination]);
    assert.deepEqual(verifyFiles(stage,destination),installedInventory,'Preview reinstall preserves every staged file');
    const uninstaller=path.join(destination,'Uninstall Timewarp Preview.exe');assert.ok(fs.existsSync(uninstaller),'Installer creates an uninstaller');
    run(uninstaller,['/S','/currentuser','_?='+destination]);
    assert.ok(!fs.existsSync(path.join(destination,'Timewarp Preview.exe')),'Uninstall removes the installed application');
    assert.ok(!fs.existsSync(path.join(destination,'resources')),'Uninstall removes bundled resources, including long metadata paths');
    assert.equal(existing(),0,'Uninstall removes preview registration');cleanupNeeded=false;
    report={verifiedAt:new Date().toISOString(),installer:path.basename(installer),sha256:hash(installer),installedMatchesStage:true,...installedInventory,installedStartup:true,unsupportedRootRejected:true,sameVersionReinstall:true,uninstall:true,longPathsRemoved:true,registrationRemoved:true,cleanMachine:false,signed:false};
  }finally{
    if(cleanupNeeded){const uninstaller=path.join(destination,'Uninstall Timewarp Preview.exe');if(fs.existsSync(uninstaller)){try{run(uninstaller,['/S','/currentuser','_?='+destination]);}catch{console.error('Preview cleanup requires attention at '+destination);}}}
    // NSIS's _? option leaves its running uninstaller in place. Remove only
    // this test's checked, temporary directory after its registration is gone.
    if(fs.existsSync(destination)&&existing()===0){assert.equal(fs.realpathSync(destination),destination);assert.equal(path.dirname(destination),base);assert.ok(!fs.lstatSync(destination).isSymbolicLink());fs.rmSync(destination,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
  }
  assert.ok(!fs.existsSync(destination),'The temporary acceptance installation is removed');
  fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify({...report,testDirectoryRemoved:true},null,2));
  console.log('Preview install, installed native startup, same-version reinstall and uninstall pass on this Windows machine. Clean-machine and signed-upgrade acceptance remain.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
