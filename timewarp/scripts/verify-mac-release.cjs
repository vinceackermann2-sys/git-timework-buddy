'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
function verifyMacRelease(root){
  const config=require('../mac-release.json');
  const read=name=>JSON.parse(fs.readFileSync(path.join(root,'reports',name),'utf8'));
  const notarization=read('mac-notary.json'),release=read('mac-release.json'),bundle=read('mac-package.json'),startup=read('mac-startup.json');
  assert.equal(notarization.status,'Accepted','Apple must accept notarization');
  assert.equal(release.status,'Accepted');assert.equal(release.submissionId,notarization.id);
  assert.match(release.submissionId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.equal(release.stapled,true);assert.equal(release.gatekeeperAccepted,true);
  for(const field of ['nativeTools','gitBinding','deepSignature','hardenedRuntime','developerId'])assert.equal(bundle[field],true,field);
  assert.equal(bundle.teamId,config.teamId);assert.equal(bundle.arch,config.arch);
  assert.equal(startup.authScreen,true);assert.equal(startup.preloadBridge,true);assert.equal(startup.emptyProfile,true);assert.equal(startup.version,config.version);
  const artifact=path.join(root,'build/mac-release',`Timewarp-${config.version}-${config.arch}.dmg`);
  assert.equal(path.basename(release.artifact),path.basename(artifact));
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  assert.equal(release.sha256,sha256,'Release proof must bind the final stapled DMG');
  return {artifact,sha256,submissionId:release.submissionId};
}
if(require.main===module){try{const result=verifyMacRelease(path.resolve(__dirname,'..'));console.log('Verified accepted, stapled Mac release: '+result.sha256);}catch(error){console.error('Mac release acceptance failed: '+error.message);process.exit(1);}}
module.exports={verifyMacRelease};
