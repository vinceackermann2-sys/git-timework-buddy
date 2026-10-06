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
