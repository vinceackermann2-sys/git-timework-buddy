'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function notarize(){
  if(process.platform!=='darwin')throw new Error('Notarization and Gatekeeper checks require macOS.');
  const profile=process.env.TIMEWARP_NOTARY_KEYCHAIN_PROFILE;if(!profile)throw new Error('Configure TIMEWARP_NOTARY_KEYCHAIN_PROFILE in the build Mac keychain.');
  const file=fs.realpathSync(process.argv[2]||''),build=fs.realpathSync(path.join(root,'build/mac-release'));
  if(!file.startsWith(build+path.sep)||!file.endsWith('.dmg'))throw new Error('Submit only the isolated signed release DMG.');
  const credentials=['--keychain-profile',profile,...(process.env.TIMEWARP_NOTARY_KEYCHAIN?['--keychain',process.env.TIMEWARP_NOTARY_KEYCHAIN]:[])];
  const reports=path.join(root,'reports');fs.mkdirSync(reports,{recursive:true});
  const save=response=>fs.writeFileSync(path.join(reports,'mac-notary.json'),JSON.stringify(response,null,2));
  const json=args=>{
    const result=cp.spawnSync('/usr/bin/xcrun',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    let response;try{response=JSON.parse(result.stdout);}catch{throw new Error('Apple notarization returned no usable response.');}
    if(response.id)save(response);
    if(result.status!==0)throw new Error('Apple notarization did not finish successfully; retained submission '+(response.id||'unknown')+' for recovery.');
    return response;
  };
  let id=process.env.TIMEWARP_NOTARY_SUBMISSION_ID;
  if(id){
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw new Error('Invalid Apple submission ID.');
    const expected=process.env.TIMEWARP_NOTARY_CANDIDATE_SHA256;
    if(!/^[a-f0-9]{64}$/i.test(expected||'')||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected.toLowerCase())throw new Error('Recovery requires the exact DMG originally submitted to Apple.');
  }else{
    const submission=json(['notarytool','submit',file,...credentials,'--output-format','json']);
    id=submission.id;if(!id)throw new Error('Apple did not return a notarization submission ID.');
    save({...submission,status:'In Progress'});
  }
  // Persist the submission before waiting, so a runner timeout can resume the
  // original bytes without creating another Apple submission.
  let response=json(['notarytool','info',id,...credentials,'--output-format','json']);
  if(response.status==='In Progress')response=json(['notarytool','wait',id,...credentials,'--timeout','45m','--output-format','json']);
  if(response.id!==id||response.status!=='Accepted')throw new Error('Apple notarization was not accepted; inspect retained submission '+id);
  save(response);
  const run=args=>cp.execFileSync('/usr/bin/xcrun',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  run(['stapler','staple',file]);run(['stapler','validate',file]);
  cp.execFileSync('/usr/sbin/spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=2',file],{stdio:'pipe'});
  const report={verifiedAt:new Date().toISOString(),artifact:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),submissionId:id,status:response.status,stapled:true,gatekeeperAccepted:true,published:false};
  fs.writeFileSync(path.join(root,'reports/mac-release.json'),JSON.stringify(report,null,2));console.log('Apple accepted the DMG; stapling and Gatekeeper verification passed.');
}
try{notarize();}catch(error){console.error(error.message);process.exit(1);}
