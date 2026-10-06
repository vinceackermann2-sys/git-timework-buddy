'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {build,Platform,Arch}=require('electron-builder');
const {verifyMacInputs,copyMacResources}=require('./mac-inputs.cjs');
const root=path.resolve(__dirname,'..');
async function installer(){
  if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Build this release on an Apple Silicon macOS runner.');
  const draft=process.argv.includes('--draft'),config=require('../mac-release.json');
  if(!draft && (!process.env.CSC_LINK||!process.env.CSC_KEY_PASSWORD))throw new Error('Supply the protected Developer ID Application signing identity.');
  if(!draft && !process.env.TIMEWARP_NOTARY_KEYCHAIN_PROFILE)throw new Error('Configure a notarization keychain profile before building a signed release.');
  if(!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(config.version)||config.arch!=='arm64'||!/^com\.[a-z0-9.]+$/.test(config.appId)||!/^[A-Z0-9]{10}$/.test(config.teamId))throw new Error('Invalid Mac release configuration.');
  const run=(script,args=[],env=process.env)=>cp.execFileSync(process.execPath,[path.join(__dirname,script),...args],{env,stdio:'inherit'});
  run('build.cjs',['--mac'],{...process.env,TIMEWARP_MAC_RELEASE:draft?'0':'1'});
  run('verify-build.cjs',['--mac','--archive-only']);
  run('audit-runtime.cjs');
  const inputs=verifyMacInputs(),resources=path.join(root,'build/mac-resources');
  fs.mkdirSync(resources,{recursive:true});copyMacResources(inputs,resources);
  const output=path.join(root,draft?'build/mac-preview':'build/mac-release');
  const artifacts=await build({projectDir:root,publish:'never',targets:Platform.MAC.createTarget(['dmg'],Arch.arm64),config:{
    appId:draft?'com.timewarp.desktop.preview':config.appId,
    productName:draft?'Timewarp Preview':'Timewarp',
    electronVersion:require('electron/package.json').version,
    directories:{app:path.join(root,'build/app'),output,buildResources:path.join(root,'assets')},
    npmRebuild:false,forceCodeSigning:!draft,asar:true,asarUnpack:['**/*.node','**/*.dylib'],
    files:['**/*'],extraResources:inputs.lock.files.filter(entry=>!entry.path.startsWith('app.asar.unpacked/')).map(entry=>({from:path.join(resources,entry.path),to:entry.path})),
    publish:null,
    electronFuses:{runAsNode:false,enableCookieEncryption:true,enableNodeOptionsEnvironmentVariable:false,enableNodeCliInspectArguments:false,enableEmbeddedAsarIntegrityValidation:true,onlyLoadAppFromAsar:true,grantFileProtocolExtraPrivileges:false},
    mac:{target:'dmg',icon:path.join(root,'assets/app-icon.icns'),category:'public.app-category.productivity',
      identity:draft?'-':config.identity.replace(/^Developer ID Application: /,''),hardenedRuntime:true,notarize:false,gatekeeperAssess:false,
      entitlements:path.join(root,'assets/entitlements.mac.plist'),entitlementsInherit:path.join(root,'assets/entitlements.mac.plist'),
      minimumSystemVersion:config.minimumSystemVersion,
      extendInfo:{NSMicrophoneUsageDescription:'Timewarp uses the microphone when you dictate messages.',NSCameraUsageDescription:'Timewarp uses the camera when an authorized browser website requests it.',NSAudioCaptureUsageDescription:'Timewarp captures audio when you authorize a browser capture request.',NSAppDataUsageDescription:'Timewarp imports browser sign-in data only when you request it.',NSAppTransportSecurity:{NSAllowsLocalNetworking:true}}},
    dmg:{sign:!draft,artifactName:draft?'Timewarp-Preview-${version}-${arch}.${ext}':'Timewarp-${version}-${arch}.${ext}'}
  }});
  const app=path.join(output,'mac-arm64',draft?'Timewarp Preview.app':'Timewarp.app');
  run('verify-build.cjs',['--mac','--app-dir',app]);
  run('verify-native-startup.cjs',['--mac','--app-dir',app]);
  run('verify-mac.cjs',['--app-dir',app,...(draft?['--draft']:[])]);
  if(!draft)run('notarize-mac.cjs',[artifacts.find(file=>file.endsWith('.dmg'))]);
  console.log((draft?'Local acceptance DMG (ad hoc signed): ':'Signed and notarized DMG: ')+output);
}
// electron-builder registers shutdown handlers; terminate explicitly so a
// failed post-build acceptance step cannot be reset to a successful exit.
installer().catch(error=>{console.error(error.message);process.exit(1);});
