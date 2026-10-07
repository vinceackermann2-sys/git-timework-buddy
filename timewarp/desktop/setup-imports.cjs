"use strict";
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function detectCursorMemory(root){
  const files=[];
  async function walk(file,depth=0){
    const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error});
    if(!stat||stat.isSymbolicLink())return;
    if(depth>8||files.length>=500)throw Error('Cursor setup is too large. Choose a smaller rules folder.');
    if(stat.isDirectory()){for(const entry of await fs.readdir(file))if(!entry.startsWith('.')&&entry!=='node_modules')await walk(path.join(file,entry),depth+1);}
    else if(stat.isFile()&&(/\.(md|mdc|txt)$/i.test(file)||path.basename(file)==='.cursorrules')){
      if(stat.size>16*1024*1024)throw Error('A Cursor memory file is larger than 16 MB.');
      files.push({sourcePath:file,relativePath:path.relative(root,file).split(path.sep).join('/')});
    }
  }
  for(const name of ['rules','memories','AGENTS.md','MEMORY.md','.cursorrules'])await walk(path.join(root,name));
  return files;
}
async function rememberName(root,userName,agentName){
  const file=path.join(root,'user.md');await fs.mkdir(root,{recursive:true});
  const old=await fs.readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return '# User\n';throw error});
  const without=old.replace(/\n*<!-- timewarp:onboarding-name -->[\s\S]*?<!-- \/timewarp:onboarding-name -->\n*/g,'\n');
  const text=without.trimEnd()+'\n\n<!-- timewarp:onboarding-name -->\nPreferred name: '+JSON.stringify(userName)+'.\nThe user named their Timewarp agent '+JSON.stringify(agentName)+'.\n<!-- /timewarp:onboarding-name -->\n';
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temporary,text,{mode:0o600});await fs.rename(temporary,file);
}
module.exports={detectCursorMemory,rememberName};
