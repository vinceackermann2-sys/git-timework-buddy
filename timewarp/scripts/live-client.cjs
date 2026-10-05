"use strict";
// CLI credentials stay in process memory. Never print keys or fixture passwords.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const config=require('../config.json'),root=path.resolve(__dirname,'..');
function keys(){
  const data=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-Command','npx --yes supabase projects api-keys --project-ref mrqoeywofslgnquvzhuf --output json'],{encoding:'utf8',windowsHide:true}));
  const key=data.find(row=>row.name==='service_role')?.api_key;
  if(!key)throw Error('Production service credential unavailable.');return key;
}
async function request(route,body,token=config.publishableKey,method='POST'){
  const r=await fetch(config.supabaseUrl+route,{method,headers:{apikey:config.publishableKey,authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
  const data=await r.json().catch(()=>null);return {status:r.status,data};
}
async function fixture({save=true}={}){
  const secret=keys(),email='timewarp-billing-'+crypto.randomUUID()+'@example.invalid',password=crypto.randomBytes(24).toString('base64url');
  const r=await request('/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{full_name:'Billing acceptance'}},secret);
  if(r.status!==200)throw Error('Could not create isolated acceptance account: '+r.status);
  const user={id:r.data.id,email,password};if(save)fs.writeFileSync(path.join(root,'reports/billing-fixture.private.json'),JSON.stringify(user));
  return user;
}
async function token(user){const r=await request('/auth/v1/token?grant_type=password',{email:user.email,password:user.password});if(r.status!==200)throw Error('Acceptance login failed.');return r.data.access_token;}
module.exports={request,keys,fixture,token,root};
