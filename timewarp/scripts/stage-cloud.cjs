"use strict";
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),target=path.join(root,'supabase/functions/timewarp-energy');
fs.mkdirSync(target,{recursive:true});
for(const file of fs.readdirSync(path.join(root,'cloud')).filter(name=>name.endsWith('.ts')||name==='deno.json'))fs.copyFileSync(path.join(root,'cloud',file),path.join(target,file));
fs.writeFileSync(path.join(root,'supabase/config.toml'),'project_id = "mrqoeywofslgnquvzhuf"\n\n[functions.timewarp-energy]\nverify_jwt = false\n\n[functions.stripe-billing]\nverify_jwt = false\n\n[functions.stripe-webhook]\nverify_jwt = false\n');
