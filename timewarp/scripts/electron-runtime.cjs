"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function prepareExecutable(destination,archive){
  fs.copyFileSync(require('electron'),destination);
  const {NtExecutable,NtExecutableResource}=await import('resedit');
  const exe=NtExecutable.from(fs.readFileSync(destination),{ignoreCert:true}),resources=NtExecutableResource.from(exe);
  const bytes=fs.readFileSync(archive),headerLength=bytes.readUInt32LE(12);
  const integrity=Buffer.from(JSON.stringify([{file:'resources\\app.asar',alg:'SHA256',value:crypto.createHash('sha256').update(bytes.subarray(16,16+headerLength)).digest('hex')}])) ;
  resources.entries=resources.entries.filter(item=>!(item.type==='INTEGRITY'&&item.id==='ELECTRONASAR'));
  resources.entries.push({type:'INTEGRITY',id:'ELECTRONASAR',lang:1033,codepage:1200,bin:integrity.buffer.slice(integrity.byteOffset,integrity.byteOffset+integrity.byteLength)});
  resources.outputResource(exe);fs.writeFileSync(destination,Buffer.from(exe.generate()));
  const {flipFuses,FuseVersion,FuseV1Options}=await import('@electron/fuses');
  await flipFuses(destination,{version:FuseVersion.V1,[FuseV1Options.RunAsNode]:false,[FuseV1Options.EnableCookieEncryption]:true,[FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,[FuseV1Options.EnableNodeCliInspectArguments]:false,[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:true,[FuseV1Options.OnlyLoadAppFromAsar]:true,[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]:false,[FuseV1Options.GrantFileProtocolExtraPrivileges]:false,[FuseV1Options.WasmTrapHandlers]:true});
}
function copyElectronCore(destination){
  const source=path.dirname(require('electron'));
  for(const item of fs.readdirSync(source,{withFileTypes:true})){
    if(item.name==='electron.exe'||item.name==='resources'||item.name==='version')continue;
    fs.cpSync(path.join(source,item.name),path.join(destination,item.name),{recursive:true});
  }
}
module.exports={prepareExecutable,copyElectronCore};
