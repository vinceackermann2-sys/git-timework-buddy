"use strict";
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {validateStore}=require('../shared/store.cjs');
const root=path.resolve(__dirname,'..');
async function storePackage(){
  if(process.platform!=='win32')throw new Error('Build the Windows Store package on Windows.');
  if(process.env.TIMEWARP_RELEASE_CONFIG)throw new Error('Store updates are managed by Microsoft; remove TIMEWARP_RELEASE_CONFIG.');
  const store=validateStore(JSON.parse(fs.readFileSync(process.env.TIMEWARP_STORE_CONFIG||path.join(root,'store.json'),'utf8')));
  const env={...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'};
  for(const key of ['CSC_LINK','CSC_KEY_PASSWORD','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','TIMEWARP_CERT_SHA1','TIMEWARP_SIGN_SCRIPT'])delete env[key];
  const run=(name,args=[])=>cp.execFileSync(process.execPath,[path.join(__dirname,name),...args],{env,stdio:'inherit',windowsHide:true});
  run('build.cjs',['--stage','--store']);run('verify-build.cjs',['--staged']);run('audit-runtime.cjs');
  const output=path.join(root,'build/store'),assets=path.join(root,'build/store-resources/appx');
  await require('./store-icons.cjs').buildStoreIcons(path.join(root,'assets/app-icon.png'),assets);
  // The Store signs this container after certification. No new listing, install,
  // self-signed certificate, external updater, upload or publication occurs here.
  const {build,Platform,Arch}=require('electron-builder');
  const signingEnv={};
  for(const key of ['CSC_LINK','CSC_KEY_PASSWORD','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','CSC_IDENTITY_AUTO_DISCOVERY']){signingEnv[key]=process.env[key];if(key==='CSC_IDENTITY_AUTO_DISCOVERY')process.env[key]='false';else delete process.env[key];}
  try{
    await build({projectDir:root,prepackaged:path.join(root,'build/native'),publish:'never',targets:Platform.WINDOWS.createTarget(['appx'],Arch.x64),config:{
      appId:store.appUserModelId,productName:'Timewarp',executableName:'Timewarp',electronVersion:require('electron/package.json').version,
      forceCodeSigning:false,npmRebuild:false,publish:null,
      directories:{output,buildResources:path.dirname(assets)},
      extraMetadata:{name:'timewarp-desktop',version:store.version,description:'Timewarp desktop with a local agent harness',author:'Timewarp'},
      win:{target:'appx',icon:path.join(root,'assets/app-icon.ico'),signExecutable:false},
      appx:{identityName:store.identityName,publisher:store.publisher,publisherDisplayName:store.publisherDisplayName,applicationId:store.applicationId,
        displayName:store.displayName,backgroundColor:'transparent',artifactName:'Timewarp-Store-${version}-${arch}.msix',setBuildNumber:false,addAutoLaunchExtension:false,electronUpdaterAware:false,
        languages:['en-US'],capabilities:['runFullTrust'],minVersion:store.minimumWindowsVersion,maxVersionTested:'10.0.26100.0'}
    }});
  }finally{for(const[key,value]of Object.entries(signingEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  run('verify-store.cjs');
  console.log('Verified unsigned Store update: '+path.join(output,'Timewarp-Store-'+store.version+'-x64.msix')+'. Microsoft signing and certification are pending.');
}
if(require.main===module)storePackage().catch(error=>{console.error(error.message);process.exitCode=1;process.once('exit',()=>{process.exitCode=1;});});
module.exports={storePackage};
