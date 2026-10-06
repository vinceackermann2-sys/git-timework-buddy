'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {verifyMacRelease}=require('../scripts/verify-mac-release.cjs');
const config=require('../mac-release.json');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'timewarp-mac-acceptance-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'reports'));fs.mkdirSync(path.join(root,'build/mac-release'),{recursive:true});
  const artifact=path.join(root,'build/mac-release',`Timewarp-${config.version}-${config.arch}.dmg`);
  fs.writeFileSync(artifact,'fixture final stapled bytes');
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  const id='3acbade8-b9b3-4bb3-88c9-165332b0fab5';
  const write=(name,value)=>fs.writeFileSync(path.join(root,'reports',name),JSON.stringify(value));
  write('mac-notary.json',{id,status:'Accepted'});
  write('mac-release.json',{artifact,sha256,submissionId:id,status:'Accepted',stapled:true,gatekeeperAccepted:true});
  write('mac-package.json',{arch:'arm64',teamId:'6XD78664VT',nativeTools:true,gitBinding:true,deepSignature:true,hardenedRuntime:true,developerId:true});
  write('mac-startup.json',{authScreen:true,preloadBridge:true,emptyProfile:true,version:config.version});
  return {root,artifact,sha256,id,write};
}
test('release acceptance binds Apple proof to the exact final stapled DMG',t=>{
  const f=fixture(t);assert.equal(verifyMacRelease(f.root).sha256,f.sha256);
  fs.appendFileSync(f.artifact,'tampered');assert.throws(()=>verifyMacRelease(f.root),/final stapled DMG/);
});
test('a green packaging job cannot approve missing, pending or mismatched Apple evidence',t=>{
  const f=fixture(t);
  fs.unlinkSync(path.join(f.root,'reports/mac-notary.json'));assert.throws(()=>verifyMacRelease(f.root),/ENOENT/);
  f.write('mac-notary.json',{id:f.id,status:'In Progress'});assert.throws(()=>verifyMacRelease(f.root),/Apple must accept/);
  f.write('mac-notary.json',{id:'other-submission',status:'Accepted'});assert.throws(()=>verifyMacRelease(f.root));
  f.write('mac-notary.json',{id:f.id,status:'Accepted'});
  f.write('mac-release.json',{artifact:f.artifact,sha256:f.sha256,submissionId:f.id,status:'Accepted',stapled:false,gatekeeperAccepted:true});assert.throws(()=>verifyMacRelease(f.root));
});
