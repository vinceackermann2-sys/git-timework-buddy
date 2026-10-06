"use strict";
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {validateStore}=require('../shared/store.cjs');
const root=path.resolve(__dirname,'..');
async function verifyStore(){
  if(process.platform!=='win32')throw new Error('Verify MSIX on Windows.');
  const configPath=path.resolve(process.env.TIMEWARP_STORE_CONFIG||path.join(root,'store.json'));
  const store=validateStore(JSON.parse(fs.readFileSync(configPath,'utf8')));
  const file=path.join(root,'build/store/Timewarp-Store-'+store.version+'-x64.msix');
  const stage=path.join(root,'build/native');
  const asar=await import('@electron/asar');
  const archive=path.join(stage,'resources/app.asar');
  const read=name=>asar.extractFile(archive,name.split('/').join(path.sep)).toString('utf8');
  if(JSON.parse(read('package.json')).version!==store.version||JSON.parse(read('out/main/timewarp/release.json')).enabled!==false)throw new Error('Store version or update policy is incorrect.');
  const boot=read('out/main/bootstrap.js');
  if(!boot.includes(JSON.stringify(store.appUserModelId))||!boot.includes('Timewarp Energy')||boot.includes('Timewarp Preview'))throw new Error('Store application/profile identity is incorrect.');
  const {shellPath}=require('../shared/authenticode.cjs');
  const env={...process.env,TIMEWARP_STORE_CONFIG:configPath,TIMEWARP_STORE_PACKAGE:file,TIMEWARP_STORE_STAGE:stage};delete env.PSModulePath;
  const result=JSON.parse(cp.execFileSync(shellPath(),['-NoProfile','-NonInteractive','-File',path.join(__dirname,'verify-store.ps1')],{env,encoding:'utf8',windowsHide:true,timeout:180000}));
  const report={verifiedAt:new Date().toISOString(),file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),...result};
  fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,'reports/store-package.json'),JSON.stringify(report,null,2));
  console.log('Verified Store identity, version, disabled external updates and '+result.verifiedPayloadFiles+' payload hashes.');
  return report;
}
module.exports={verifyStore};
if(require.main===module)verifyStore().catch(error=>{console.error(error.message);process.exitCode=1;});
