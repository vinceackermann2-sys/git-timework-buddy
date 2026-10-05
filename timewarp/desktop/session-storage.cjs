"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function sessionStorage(profile,safeStorage){
  const sessionFile=path.join(profile,'timewarp-cloud-session.enc'),identityFile=path.join(profile,'timewarp-device-token.enc'),flowFile=path.join(profile,'timewarp-auth-flow.enc');
  const nativeFiles=[path.join(profile,'account-session.json'),path.join(profile,'runtime/account-session.json')];
  function encrypt(value){if(!safeStorage.isEncryptionAvailable())throw new Error('OS credential encryption is unavailable.');return safeStorage.encryptString(JSON.stringify(value));}
  function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,data,{mode:0o600});fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}}
  function read(file){if(!fs.existsSync(file))return null;if(!safeStorage.isEncryptionAvailable())throw new Error('OS credential encryption is unavailable.');try{return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch{fs.renameSync(file,file+'.unreadable-'+Date.now());console.error('[timewarp] An unreadable encrypted account file was preserved; sign in again.');return null;}}
  return {
    load(){return{session:read(sessionFile),capability:read(identityFile)?.token};},
    save(session,capability){
      const next=new Map([[identityFile,encrypt({token:capability})],[sessionFile,session?encrypt(session):null]]);
      const native=session?Buffer.from(JSON.stringify({encryptedToken:safeStorage.encryptString(capability).toString('base64'),version:1})):null;
      for(const file of nativeFiles)next.set(file,native);
      const previous=new Map([...next.keys()].map(file=>[file,fs.existsSync(file)?fs.readFileSync(file):null]));
      try{for(const[file,data]of next)if(data)write(file,data);else fs.rmSync(file,{force:true});}catch(error){for(const[file,data]of previous)try{if(data)write(file,data);else fs.rmSync(file,{force:true});}catch{}throw error;}
    },
    loadFlow:()=>read(flowFile),saveFlow(value){if(value)write(flowFile,encrypt(value));else fs.rmSync(flowFile,{force:true});},
  };
}
module.exports={sessionStorage};
