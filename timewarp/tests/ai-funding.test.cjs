"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createAiFunding}=require('../desktop/ai-funding.cjs');
test('subscription approval is available only on the current Free plan and credits remain an explicit alternative',async()=>{
  let plan='free',connection='available',usable=true;
  const service=createAiFunding({userId:()=> 'owner',cloud:async()=>Response.json({plan,included:0,purchased:10}),chatgpt:{connection:()=>({status:connection}),canUse:()=>usable}});
  assert.equal((await service.requireFree()).source,'chatgpt');assert.equal((await service.current()).timewarpCredits,0);
  for(plan of ['pro','max','ultra']){await assert.rejects(service.requireFree(),error=>error.status===403);assert.equal((await service.current()).source,'timewarp');assert.equal((await service.current()).timewarpCredits,10);}
  plan='free';connection='reauth_required';usable=false;assert.equal((await service.current()).canFundUsage,false);assert.equal((await service.current()).source,'chatgpt');
  connection='disconnected';assert.equal((await service.current()).source,'timewarp');assert.equal((await service.current()).canFundUsage,true);
});
test('plan lookup rejects signed-out owners and account changes while the cloud response is pending',async()=>{
  let owner=null,resolve,calls=0;
  const service=createAiFunding({userId:()=>owner,cloud:()=>{calls++;return new Promise(r=>{resolve=r;});},chatgpt:{connection:()=>({status:'available'}),canUse:()=>true}});
  await assert.rejects(service.current(),error=>error.status===401);assert.equal(calls,0);
  owner='first';const reading=service.current();owner='second';resolve(Response.json({plan:'free',included:0,purchased:0}));await assert.rejects(reading,/account changed/);
});

// The engine keeps the balance for a moment (cacheMs): one cloud request per
// window, shared by callers arriving meanwhile, and never a kept refusal.
function cached({plan='pro',included=0,purchased=10,owner='owner',connection='disconnected'}={}){
  const state={plan,included,purchased,owner,connection,time:1000,calls:0,hold:null};
  const service=createAiFunding({userId:()=>state.owner,cacheMs:30000,now:()=>state.time,
    cloud:async()=>{state.calls++;if(state.hold)await state.hold;return Response.json({plan:state.plan,included:state.included,purchased:state.purchased});},
    chatgpt:{refresh:async()=>{},connection:()=>({status:state.connection}),canUse:()=>state.connection==='available'}});
  return {service,state};
}
test('the balance is read once per window and shared by callers arriving meanwhile',async()=>{
  const {service,state}=cached();
  let release;state.hold=new Promise(r=>{release=r;});
  const reads=[service.current(),service.current(),service.current()];
  release();state.hold=null;
  assert.deepEqual((await Promise.all(reads)).map(item=>item.timewarpCredits),[10,10,10]);assert.equal(state.calls,1);
  await service.current();assert.equal(state.calls,1,'Kept for the window');
  state.time+=30001;await service.current();assert.equal(state.calls,2,'Read again once the window ends');
  // What the interface shows reads fresh, and shares a request already on its way.
  const shown=[service.current({fresh:true}),service.current({fresh:true})];await Promise.all(shown);assert.equal(state.calls,3);
});
test('a kept balance is dropped on invalidate, an account change or a different owner',async()=>{
  const {service,state}=cached();
  await service.current();state.plan='max';service.invalidate();
  assert.equal((await service.current()).plan,'max');assert.equal(state.calls,2);
  state.owner='other';await service.current();assert.equal(state.calls,3,'Another account never gets the first one\'s balance');
  // A request started before invalidate() is neither shared nor kept.
  let release;service.invalidate();state.hold=new Promise(r=>{release=r;});
  const early=service.current();service.invalidate();state.plan='ultra';const late=service.current();
  release();state.hold=null;await early;assert.equal((await late).plan,'ultra');assert.equal(state.calls,5);
  assert.equal((await service.current()).plan,'ultra');assert.equal(state.calls,5);
  // An account change while the request is pending keeps nothing.
  service.invalidate();state.hold=new Promise(r=>{release=r;});const pending=service.current();state.owner='third';release();state.hold=null;
  await assert.rejects(pending,/account changed/);await service.current();assert.equal(state.calls,7);
});
test('a kept balance never refuses usage: no credits or a refused plan are read fresh first',async()=>{
  const {service,state}=cached({included:0,purchased:0});
  assert.equal((await service.current()).canFundUsage,false);assert.equal((await service.current()).canFundUsage,false);
  assert.equal(state.calls,2,'A zero balance is never answered from the cache');
  state.purchased=5;assert.equal((await service.current()).canFundUsage,true,'Credits bought meanwhile count at once');assert.equal(state.calls,3);
  await service.current();assert.equal(state.calls,3);
  // Kept credits that ran out: the cloud's refusal (model-bridge) invalidates, and the next check is fresh.
  state.purchased=0;service.invalidate();assert.equal((await service.current()).canFundUsage,false);assert.equal(state.calls,4);
  // A kept paid plan that would refuse the Free plan's ChatGPT connection is checked again.
  state.plan='pro';state.purchased=5;service.invalidate();await service.current();state.plan='free';
  assert.equal((await service.requireFree()).plan,'free');assert.equal(state.calls,6);
});
test('on Free with ChatGPT connected the kept plan is used; the connection is always read live',async()=>{
  const {service,state}=cached({plan:'free',purchased:0,connection:'available'});
  assert.equal((await service.current()).source,'chatgpt');assert.equal((await service.current()).source,'chatgpt');assert.equal(state.calls,1);
  state.connection='disconnected';const state2=await service.current();
  assert.deepEqual([state2.source,state2.canFundUsage],['timewarp',false]);assert.equal(state.calls,2,'A refusal is checked with the cloud');
});
test('the old pipeline keeps reading the balance every time',async()=>{
  let calls=0;const service=createAiFunding({userId:()=>'owner',cloud:async()=>{calls++;return Response.json({plan:'pro',included:1,purchased:1});},chatgpt:{connection:()=>({status:'disconnected'}),canUse:()=>false}});
  await service.current();await service.current();assert.equal(calls,2);
  await assert.rejects(service.requireFree(),error=>error.status===403);assert.equal(calls,3);
});
