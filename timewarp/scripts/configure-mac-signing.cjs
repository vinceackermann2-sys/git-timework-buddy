'use strict';
// Called only by the protected signing job. Never prints credential values or
// raw subprocess errors, which can include command-line arguments.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const config=require('../mac-release.json');
async function configure(){
  if(process.platform!=='darwin'||!process.env.RUNNER_TEMP||!process.env.GITHUB_ENV)throw new Error('Use this helper only on the isolated macOS Actions runner.');
  const temporary=fs.realpathSync(process.env.RUNNER_TEMP);
  const p12=path.join(temporary,'timewarp-developer-id.p12'),pem=path.join(temporary,'timewarp-developer-id-leaf.pem'),keychain=path.join(temporary,'timewarp-notary.keychain-db'),chain=path.join(temporary,'timewarp-developer-id-g2.cer');
  const run=(tool,args,options={})=>{const result=cp.spawnSync(tool,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],...options});if(result.status!==0)throw new Error('Temporary Apple credential setup failed ('+path.basename(tool)+'/'+args[0]+').');return result.stdout;};
  if(process.argv.includes('--cleanup')){
    if(fs.existsSync(keychain))run('/usr/bin/security',['delete-keychain',keychain]);
    for(const file of [p12,pem,chain])if(fs.existsSync(file))fs.unlinkSync(file);
    console.log('Temporary Apple signing material removed.');return;
  }
  for(const name of ['APPLE_P12_BASE64','APPLE_P12_PASSWORD','APPLE_ID','APPLE_APP_PASSWORD'])if(!process.env[name])throw new Error('Configure the protected Apple identity and notarization secrets first.');
  for(const name of ['APPLE_P12_BASE64','APPLE_P12_PASSWORD','APPLE_ID','APPLE_APP_PASSWORD'])if(/[\r\n]/.test(process.env[name]))throw new Error('The '+name+' secret must be stored without trailing line breaks.');
  fs.writeFileSync(p12,Buffer.from(process.env.APPLE_P12_BASE64,'base64'),{mode:0o600});
  run('/usr/bin/openssl',['pkcs12','-in',p12,'-passin','env:APPLE_P12_PASSWORD','-clcerts','-nokeys','-out',pem]);
  const fingerprint=run('/usr/bin/openssl',['x509','-in',pem,'-noout','-fingerprint','-sha256']).split('=').pop().trim().replaceAll(':','').toLowerCase();
  if(fingerprint!==config.certificateSha256)throw new Error('The supplied identity differs from the approved Apple certificate.');
  const keychainPassword=crypto.randomBytes(32).toString('base64url');
  run('/usr/bin/security',['create-keychain','-p',keychainPassword,keychain]);
  run('/usr/bin/security',['set-keychain-settings','-lut','21600',keychain]);
  run('/usr/bin/security',['unlock-keychain','-p',keychainPassword,keychain]);
  // This is the intermediary selected in the approved Apple certificate flow.
  const response=await fetch('https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer');if(!response.ok)throw new Error('Apple G2 certificate download failed.');
  fs.writeFileSync(chain,Buffer.from(await response.arrayBuffer()),{mode:0o600});
  run('/usr/bin/security',['import',chain,'-k',keychain]);
  run('/usr/bin/security',['import',p12,'-k',keychain,'-P',process.env.APPLE_P12_PASSWORD,'-T','/usr/bin/codesign','-T','/usr/bin/security']);
  run('/usr/bin/security',['set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',keychainPassword,keychain]);
  const profile='timewarp-notary';
  run('/usr/bin/xcrun',['notarytool','store-credentials',profile,'--keychain',keychain,'--apple-id',process.env.APPLE_ID,'--team-id',config.teamId,'--password',process.env.APPLE_APP_PASSWORD]);
  fs.appendFileSync(process.env.GITHUB_ENV,[`CSC_LINK=${p12}`,`CSC_KEY_PASSWORD=${process.env.APPLE_P12_PASSWORD}`,`CSC_KEYCHAIN=${keychain}`,`TIMEWARP_NOTARY_KEYCHAIN_PROFILE=${profile}`,`TIMEWARP_NOTARY_KEYCHAIN=${keychain}`].join('\n')+'\n');
  console.log('Approved Developer ID identity and Apple notarization credentials verified in a temporary keychain.');
}
configure().catch(error=>{console.error(error.message);process.exitCode=1;});
