"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {delegationChecks}=require('../scripts/harness-evidence.cjs');
test('acceptance uses native final_answer and requires worker completion before a verified parent result',()=>{
  const end=id=>({method:'turn/completed',params:{threadId:id,turn:{status:'completed'}}});
  const answer={method:'item/completed',params:{threadId:'parent',item:{type:'agentMessage',phase:'final_answer',text:'VERIFIED abc123'}}};
  const wait={method:'rawResponseItem/completed',params:{item:{type:'function_call',name:'wait_agent'}}};
  const events=[wait,end('worker'),answer,end('parent')];
  assert.ok(Object.values(delegationChecks(events,'parent',['worker'],'abc123')).every(Boolean));
  assert.equal(delegationChecks([wait,answer,end('parent'),end('worker')],'parent',['worker'],'abc123').parentFinishedAfterWorker,false);
  assert.equal(delegationChecks([wait,answer,end('parent')],'parent',[],'abc123').parentFinishedAfterWorker,false);
  assert.equal(delegationChecks(events,'parent',['worker'],'wrong-code').parentReportsVerifiedEvidence,false);
  assert.equal(delegationChecks([...events,{...wait,params:{item:{type:'function_call',name:'list_agents'}}}],'parent',['worker'],'abc123').waitsWithoutAgentPolling,false);
});
