"use strict";
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),target=path.join(root,'supabase/functions/timewarp-energy');
fs.mkdirSync(target,{recursive:true});
for(const file of fs.readdirSync(path.join(root,'cloud')).filter(name=>name.endsWith('.ts')||name==='deno.json'))fs.copyFileSync(path.join(root,'cloud',file),path.join(target,file));
// Staging source must never reset a deployment's chosen project or function
// settings. Maintain supabase/config.toml explicitly for each environment.
