'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {hash}=require('./upstream.cjs');
const {verifyMacInputs}=require('./mac-inputs.cjs');
const root=path.resolve(__dirname,'..'),lock=require('../mac-upstream-lock.json');
// The pinned DMG comes from Timewarp-controlled storage, never the vendor's
// servers. Its SHA256, not the host, proves it is the reviewed input.
function inputSource(env=process.env){
  if(!env.TIMEWARP_MAC_UPSTREAM_URL)throw new Error('Set TIMEWARP_MAC_UPSTREAM_URL to Timewarp\'s copy of the pinned Mac input, or place it at build/upstream-mac.dmg.');
  let url;try{url=new URL(env.TIMEWARP_MAC_UPSTREAM_URL);}catch{throw new Error('Invalid Mac input location.');}
  if(url.protocol!=='https:'||url.username||url.password||/(?:^|\.)getenergy\.com$/i.test(url.hostname))throw new Error('Invalid Mac input location.');
  const headers={accept:'application/octet-stream'};
  if(env.TIMEWARP_MAC_UPSTREAM_TOKEN)headers.authorization='Bearer '+env.TIMEWARP_MAC_UPSTREAM_TOKEN;
  return {url,headers};
}
async function prepare(){
  if(process.platform!=='darwin')throw new Error('Extract the pinned DMG on macOS to preserve native file modes and links.');
  if(!/^[a-f0-9]{64}$/.test(lock.dmgSha256))throw new Error('Invalid reviewed Mac input provenance.');
  const build=path.join(root,'build');fs.mkdirSync(build,{recursive:true});
  const dmg=path.join(build,'upstream-mac.dmg'),destination=path.join(build,'mac-upstream-resources');
  let source='build/upstream-mac.dmg';
  if(!fs.existsSync(dmg)){const {url,headers}=inputSource();source=url.hostname;const response=await fetch(url,{headers,signal:AbortSignal.timeout(300000)});if(!response.ok)throw new Error('Mac input download failed: '+response.status);fs.writeFileSync(dmg,Buffer.from(await response.arrayBuffer()));}
  if(hash(dmg)!==lock.dmgSha256)throw new Error('Pinned Mac DMG SHA256 verification failed.');
  const mount=fs.mkdtempSync(path.join(build,'mac-mount-'));let mounted=false;
  try{
    cp.execFileSync('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-noautoopen','-mountpoint',mount],{stdio:'pipe'});mounted=true;
    const app=path.join(mount,'Energy.app'),resources=path.join(app,'Contents/Resources');
    // The DMG hash pins the whole original distribution, including permissions.
    // Only the reviewed archive and resource inventory enter the patched build.
    verifyMacInputs(resources);
    fs.mkdirSync(destination,{recursive:true});
    const folders=new Set(lock.files.map(entry=>entry.path.includes('/')?entry.path.split('/')[0]:entry.path));
    for(const name of ['app.asar',...folders])cp.execFileSync('/usr/bin/ditto',[path.join(resources,name),path.join(destination,name)]);
    verifyMacInputs(destination);
    const result={resources:destination,source,dmgSha256:lock.dmgSha256,platform:'darwin',arch:lock.arch,upstreamVersion:lock.productVersion};
    fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,'reports/mac-inputs.json'),JSON.stringify(result,null,2));
    if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,'TIMEWARP_MAC_RESOURCES='+destination+'\n');
    console.log('Pinned Mac inputs verified at '+destination);
  }finally{if(mounted)cp.execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'pipe'});fs.rmdirSync(mount);}
}
module.exports={inputSource};
if(require.main===module)prepare().catch(error=>{console.error(error.message);process.exitCode=1;});
