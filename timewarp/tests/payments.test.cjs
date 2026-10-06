"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
function webhook(){
  const calls=[],grants=new Set();let handler;
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/stripe-webhook/index.ts'),'utf8'),{mode:'strip'}).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm,'');
  const stripe={webhooks:{constructEventAsync:async(payload,signature)=>{if(signature!=='valid-signature')throw Error('Signature rejected');return JSON.parse(payload);}}};
  const context=vm.createContext({Request,Response,Date,console:{log(){},warn(){},error(){}},Deno:{serve:callback=>{handler=callback;},env:{get:()=> 'fixture'}},Stripe:{createSubtleCryptoProvider:()=>({})},getStripe:()=>stripe,createClient:()=>({rpc:async(name,data)=>{calls.push({name,data});if(name==='timewarp_grant_credits')grants.add(data.p_stripe_ref);return{error:null};}})});
  vm.runInContext(source,context);
  const send=(session,type='checkout.session.completed',signature='valid-signature',account)=>handler(new Request('https://fixture.invalid/webhook',{method:'POST',headers:{'Stripe-Signature':signature},body:JSON.stringify({type,account,data:{object:session}})}));
  return{send,calls,grants};
}
const purchase={id:'cs_fixture',metadata:{kind:'credits',pack_credits:'50',supabase_user_id:'fixture-user',workspace_id:''}};
test('completed but unpaid checkout grants nothing; delayed success uses the same idempotent purchase reference',async()=>{
  const w=webhook();assert.equal((await w.send({...purchase,payment_status:'unpaid'})).status,200);assert.equal(w.calls.length,0);
  assert.equal((await w.send({...purchase,payment_status:'paid'},'checkout.session.async_payment_succeeded')).status,200);assert.equal(w.calls[0].name,'timewarp_grant_credits');assert.equal(w.calls[0].data.p_credits,50);assert.equal(w.calls[0].data.p_owner_user_id,'fixture-user');assert.equal(w.calls[0].data.p_workspace_id,null);
  await w.send({...purchase,payment_status:'paid'});assert.equal(w.grants.size,1);assert.ok(w.calls.every(c=>c.data.p_stripe_ref==='cs_fixture'));
});
test('unverified and merchant-account webhooks cannot create platform credits',async()=>{
  const w=webhook();assert.equal((await w.send({...purchase,payment_status:'paid'},undefined,'invalid-signature')).status,400);assert.equal(w.calls.length,0);
  assert.equal((await w.send({...purchase,payment_status:'paid'},undefined,undefined,'acct_merchant')).status,400);assert.equal(w.calls.length,0);
});
