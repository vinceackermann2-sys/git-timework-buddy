'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash,inputFile}=require('./upstream.cjs');
const root=path.resolve(__dirname,'..');
function verifyMacInputs(base=process.env.TIMEWARP_MAC_RESOURCES,lock=require('../mac-upstream-lock.json')) {
  if(!base) throw new Error('Set TIMEWARP_MAC_RESOURCES to the pinned upstream Mac app Contents/Resources directory.');
  base=fs.realpathSync(base);
  if(lock.format!==1||lock.platform!=='darwin'||lock.arch!=='arm64'||lock.productVersion!=='0.8.20'||!Array.isArray(lock.files)||!lock.files.length||! /^[a-f0-9]{64}$/.test(lock.archiveSha256)) throw new Error('Invalid Mac upstream lock.');
  const archive=inputFile(base,'app.asar');
  if(hash(archive)!==lock.archiveSha256) throw new Error('Mac application archive differs from the reviewed input.');
  const seen=new Set();
  for(const entry of lock.files){
    if(!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||seen.has(entry.path)) throw new Error('Invalid Mac resource hash entry.');
    seen.add(entry.path);
    const file=inputFile(base,entry.path);
    if(fs.statSync(file).size!==entry.bytes||hash(file)!==entry.sha256) throw new Error('Mac upstream integrity check failed: '+entry.path);
  }
  return {base,archive,lock};
}
function copyMacResources(inputs,destination){
  for(const entry of inputs.lock.files){
    if(entry.path.startsWith('app.asar.unpacked/'))continue; // Rebuilt alongside the patched ASAR, rather than overwriting its unpacked modules.
    const source=inputFile(inputs.base,entry.path),target=path.join(destination,entry.path);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);fs.chmodSync(target,fs.statSync(source).mode&0o777);
  }
}
module.exports={verifyMacInputs,copyMacResources};
if(require.main===module){const inputs=verifyMacInputs();console.log('Verified macOS '+inputs.lock.arch+' 0.8.20: archive and '+inputs.lock.files.length+' native resource files.');}
