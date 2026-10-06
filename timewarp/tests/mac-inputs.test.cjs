'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {hash}=require('../scripts/upstream.cjs');
const {verifyMacInputs,copyMacResources}=require('../scripts/mac-inputs.cjs');
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'timewarp-mac-input-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  fs.writeFileSync(path.join(base,'app.asar'),'reviewed archive');fs.mkdirSync(path.join(base,'tool'));fs.writeFileSync(path.join(base,'tool/native'),'reviewed native program');
  const lock={format:1,platform:'darwin',arch:'arm64',productVersion:'0.8.20',archiveSha256:hash(path.join(base,'app.asar')),files:[{path:'tool/native',bytes:23,sha256:hash(path.join(base,'tool/native'))}]};
  return {base,lock};
}
test('a changed Mac archive or native tool cannot enter the release',t=>{
  const {base,lock}=fixture(t);assert.doesNotThrow(()=>verifyMacInputs(base,lock));
  fs.writeFileSync(path.join(base,'tool/native'),'modified native program');assert.throws(()=>verifyMacInputs(base,lock),/integrity check failed/);
  fs.writeFileSync(path.join(base,'app.asar'),'modified archive');assert.throws(()=>verifyMacInputs(base,lock),/archive differs/);
});
test('Mac release inputs reject another platform, duplicate inventory and escaping paths',t=>{
  const {base,lock}=fixture(t);assert.throws(()=>verifyMacInputs(base,{...lock,platform:'win32'}),/Invalid Mac upstream/);
  assert.throws(()=>verifyMacInputs(base,{...lock,files:[...lock.files,...lock.files]}),/Invalid Mac resource/);
  assert.throws(()=>verifyMacInputs(base,{...lock,files:[{...lock.files[0],path:'../outside'}]}),/Invalid upstream input path/);
});
test('stray upstream files are excluded and rebuilt unpacked modules are preserved',t=>{
  const {base,lock}=fixture(t);fs.writeFileSync(path.join(base,'unreviewed'),'not a runtime input');
  const destination=path.join(base,'stage');fs.mkdirSync(destination);copyMacResources(verifyMacInputs(base,lock),destination);
  assert.equal(fs.readFileSync(path.join(destination,'tool/native'),'utf8'),'reviewed native program');assert.ok(!fs.existsSync(path.join(destination,'unreviewed')));
  const unpacked=path.join(base,'app.asar.unpacked');fs.mkdirSync(unpacked);fs.writeFileSync(path.join(unpacked,'native.node'),'original native module');
  const staged=path.join(destination,'app.asar.unpacked');fs.mkdirSync(staged);fs.writeFileSync(path.join(staged,'native.node'),'rebuilt native module');
  lock.files.push({path:'app.asar.unpacked/native.node',bytes:22,sha256:hash(path.join(unpacked,'native.node'))});
  copyMacResources(verifyMacInputs(base,lock),destination);assert.equal(fs.readFileSync(path.join(staged,'native.node'),'utf8'),'rebuilt native module');
});
