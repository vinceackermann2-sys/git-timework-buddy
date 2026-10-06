'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function notarize(){
  if(process.platform!=='darwin')throw new Error('Notarization and Gatekeeper checks require macOS.');
  const profile=process.env.TIMEWARP_NOTARY_KEYCHAIN_PROFILE;if(!profile)throw new Error('Configure TIMEWARP_NOTARY_KEYCHAIN_PROFILE in the build Mac keychain.');
  const file=fs.realpathSync(process.argv[2]||''),build=fs.realpathSync(path.join(root,'build/mac-release'));
  if(!file.startsWith(build+path.sep)||!file.endsWith('.dmg'))throw new Error('Submit only the isolated signed release DMG.');
  const run=(args)=>cp.execFileSync('/usr/bin/xcrun',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const response=JSON.parse(run(['notarytool','submit',file,'--keychain-profile',profile,...(process.env.TIMEWARP_NOTARY_KEYCHAIN?['--keychain',process.env.TIMEWARP_NOTARY_KEYCHAIN]:[]),'--wait','--timeout','20m','--output-format','json']));
  fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,'reports/mac-notary.json'),JSON.stringify(response,null,2));
  if(response.status!=='Accepted')throw new Error('Apple notarization was not accepted; inspect the submission log for '+response.id);
  run(['stapler','staple',file]);run(['stapler','validate',file]);
  cp.execFileSync('/usr/sbin/spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=2',file],{stdio:'pipe'});
  const report={verifiedAt:new Date().toISOString(),artifact:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),submissionId:response.id,status:response.status,stapled:true,gatekeeperAccepted:true,published:false};
  fs.writeFileSync(path.join(root,'reports/mac-release.json'),JSON.stringify(report,null,2));console.log('Apple accepted the DMG; stapling and Gatekeeper verification passed.');
}
try{notarize();}catch(error){console.error(error.message);process.exitCode=1;}
