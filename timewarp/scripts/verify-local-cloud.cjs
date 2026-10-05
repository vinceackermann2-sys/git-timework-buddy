"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),config=require('../config.json'),fixtures=JSON.parse(fs.readFileSync(path.join(root,'reports/local-fixtures.private.json'),'utf8')),checks={};
const pass=(name,value)=>{checks[name]=!!value;assert.ok(value,name);};
async function login(user){const r=await fetch(config.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.publishableKey,'content-type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})});const b=await r.json();pass('realAuth'+user.id,r.ok&&!!b.access_token);return b.access_token;}
async function request(token,route,body,method='POST'){const r=await fetch(config.supabaseUrl+route,{method,headers:{apikey:config.publishableKey,authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});return{status:r.status,data:await r.json()};}
(async()=>{
  const [owner,other]=await Promise.all(fixtures.users.map(login)),base='/functions/v1/timewarp-energy';
  const own=await request(owner,base+'/history',{operation:'list'}),foreign=await request(other,base+'/history',{operation:'list'});pass('historyOwnerCanRead',own.status===200&&own.data.chats.length>0);pass('otherAccountHistoryEmpty',foreign.status===200&&foreign.data.chats.length===0);
  const snapshot=own.data.chats.find(c=>c.entries.length>0)||own.data.chats[0];
  pass('cannotWriteOtherOwner',(await request(other,base+'/history',{operation:'save',snapshot})).status===403);
  const n=snapshot.entries.length;for(let i=0;i<2;i++)pass('idempotentSave'+i,(await request(owner,base+'/history',{operation:'save',snapshot})).status===200);
  const again=await request(owner,base+'/history',{operation:'list'});pass('historyMergeDoesNotDuplicateMessages',again.data.chats.find(c=>c.conversation.id===snapshot.conversation.id).entries.length===n);
  const raw=await request(other,'/rest/v1/timewarp_energy_desktop_history?select=id',undefined,'GET');pass('directHistoryReadIsOwnerScoped',raw.status===200&&raw.data.length===0);
  const direct=await request(owner,'/rest/v1/timewarp_energy_desktop_history',{user_id:fixtures.users[0].id,id:snapshot.conversation.id,conversation:snapshot.conversation});pass('directHistoryWritesDenied',[401,403].includes(direct.status));
  for(const route of ['/document','/memory','/enqueue','/internal/worker'])pass('retired'+route,(await request(owner,base+route,{})).status===410);
  const model=await request(owner,base+'/v1/models',undefined,'GET');pass('realSolLunaCatalog',model.status===200&&model.data.models.some(m=>m.slug==='gpt-5.6-sol')&&model.data.models.some(m=>m.slug==='gpt-5.6-luna'));
  pass('unauthenticatedHistoryDenied',(await request(config.publishableKey,base+'/history',{})).status===401);
  const bill=await request(owner,base+'/billing',{});pass('realPlanAndCredits',bill.status===200&&bill.data.purchased>0);
  fs.writeFileSync(path.join(root,'reports/local-cloud-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
})().catch(error=>{fs.writeFileSync(path.join(root,'reports/local-cloud-verification.json'),JSON.stringify({passed:false,checks,error:error.message},null,2));console.error(error.message);process.exitCode=1;});
