"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {bindExecutionGuard}=require('../desktop/execution-guard.cjs');
function fixture(options={}) {
  let owner='owner',clock=1000;const calls=[],client=new EventEmitter();
  client.request=async(method,params)=>{calls.push({method,params});return method==='turn/start'?{turn:{id:'turn-'+params.threadId,status:'inProgress'}}:{thread:{id:params.threadId||'root'}};};
  const guard=bindExecutionGuard(client,{userId:()=>owner,now:()=>clock,...options});
  const event=(method,params)=>client.emit('notification',{method,params});
  const start=(threadId='root',text='Do the work')=>client.request('turn/start',{threadId,input:[{type:'text',text}]});
  const child=(id='worker')=>{event('item/started',{threadId:'root',item:{type:'subAgentActivity',kind:'started',agentThreadId:id,agentTurnId:null}});event('turn/started',{threadId:id,turn:{id:'turn-'+id}});};
  const item=(id,extra={},threadId='root')=>event('item/toolCall/completed',{threadId,callId:id,tool:'exec_command',argument:extra.command||'run fixture',success:!extra.exitCode});
  return {client,calls,guard,event,start,child,item,setOwner:value=>owner=value,tick:()=>clock+=100,snapshot:()=>guard.snapshot(['root'])[0]};
}
test('a direct first-error constraint stops the entire tree, including a late worker',async t=>{
  const f=fixture();t.after(f.guard.stop);await f.start('root','Stop after the first tool error. Create a file.');f.child();
  f.item('error',{exitCode:1},'worker');f.child('late');
  assert.equal(f.snapshot().stopped,true);assert.match(f.snapshot().reason,/as requested/);assert.equal(f.snapshot().usagePartial,true);
  assert.deepEqual(f.calls.filter(c=>c.method==='turn/interrupt').map(c=>c.params.threadId).sort(),['late','root','worker']);
});
test('a negative instruction does not accidentally opt into first-error stop',async t=>{
  const f=fixture();t.after(f.guard.stop);await f.start('root',"Do not stop after the first tool error. Retry once.");f.item('error',{exitCode:1});assert.equal(f.snapshot().stopped,false);
});

test('native approval denial or review failure stops the tree before alternate tool attempts',async t=>{
  for(const event of [{method:'guardianWarning',params:{message:'Automatic approval review failed: Service unavailable'}},{method:'item/autoApprovalReview/completed',params:{review:{status:'denied',rationale:'Not authorized'}}}]){
    const f=fixture();t.after(f.guard.stop);await f.start();f.child();
    // Ordinary page output mentioning a review does not control the harness.
    f.event('item/completed',{threadId:'worker',item:{type:'agentMessage',text:'Automatic approval review failed: quoted example'}});assert.equal(f.snapshot().stopped,false);
    f.event(event.method,{threadId:'worker',...event.params});
    assert.equal(f.snapshot().stopped,true);assert.match(f.snapshot().reason,/approval review/);
    assert.deepEqual(f.calls.filter(c=>c.method==='turn/interrupt').map(c=>c.params.threadId).sort(),['root','worker']);
    assert.equal(JSON.stringify(f.snapshot()).includes('Service unavailable'),false);
  }
});

test('nonzero shell exit counts as an error even when the tool transport succeeds',async t=>{
  const f=fixture();t.after(f.guard.stop);await f.start('root','Stop after the first error.');
  f.event('item/completed',{threadId:'root',item:{type:'commandExecution',id:'cmd',status:'completed',exitCode:1}});f.event('item/toolCall/completed',{threadId:'root',tool:'exec_command',success:true,argument:null});
  assert.equal(f.snapshot().stopped,true);assert.equal(f.snapshot().failures,1);
});
test('three identical failures stop retries, success and changed commands do not',async t=>{
  const f=fixture();t.after(f.guard.stop);await f.start();f.item('1',{exitCode:1});f.item('1',{exitCode:1});f.item('2',{exitCode:1,command:'corrected command'});f.item('3');assert.equal(f.snapshot().toolCalls,3);assert.equal(f.snapshot().stopped,false);
  f.item('4',{exitCode:1});f.item('5',{exitCode:1});f.item('6',{exitCode:1});assert.equal(f.snapshot().stopped,true);assert.equal(f.snapshot().failures,5);
  assert.equal(JSON.stringify(f.snapshot()).includes('corrected command'),false);
});
test('parent Stop cancels workers and a tool budget includes all workers',async t=>{
  const f=fixture({maxToolCalls:2});t.after(f.guard.stop);await f.start();f.child();f.item('same');f.item('same',{},'worker');assert.match(f.snapshot().reason,/2-tool-call/);
  await f.start();f.child();await f.client.request('turn/interrupt',{threadId:'root',turnId:'turn-root'});assert.match(f.snapshot().reason,/Stopped by you/);assert.ok(f.calls.some(c=>c.method==='turn/interrupt'&&c.params.threadId==='worker'));
});
test('usage includes worker deltas, excludes previous turns and stays unknown in dollars',async t=>{
  const f=fixture();t.after(f.guard.stop);const usage=(threadId,input,cached,out)=>f.event('thread/tokenUsage/updated',{threadId,tokenUsage:{total:{inputTokens:input,cachedInputTokens:cached,outputTokens:out}}});
  usage('root',100,80,10);await f.start();f.child();usage('root',150,100,20);usage('worker',40,30,5);usage('worker',40,30,5);
  assert.equal(f.snapshot().inputTokens,90);assert.equal(f.snapshot().cachedTokens,50);assert.equal(f.snapshot().outputTokens,15);assert.equal(f.snapshot().cost,null);
});
test('resuming cumulative usage cannot falsely count a historical million tokens',async t=>{
  const f=fixture();t.after(f.guard.stop);await f.client.request('thread/resume',{threadId:'root'});await f.start();
  f.event('thread/tokenUsage/updated',{threadId:'root',tokenUsage:{total:{inputTokens:1000010},last:{inputTokens:10}}});assert.equal(f.snapshot().inputTokens,10);assert.equal(f.snapshot().usagePartial,true);
});
test('finished duration freezes, next turn resets counters, account change hides counters',async t=>{
  const f=fixture();t.after(f.guard.stop);await f.start();f.tick();f.event('turn/completed',{threadId:'root',turn:{id:'turn-root'}});f.tick();assert.equal(f.snapshot().durationMs,100);
  await f.start();assert.equal(f.snapshot().toolCalls,0);f.setOwner('other');assert.equal(f.snapshot(),undefined);
});

test('completed worker announcements and late starts cannot resurrect the worker or leave a task timer running',async t=>{
  const f=fixture({maxDurationMs:15});t.after(f.guard.stop);await f.start();f.child();
  f.event('turn/completed',{threadId:'worker',turn:{id:'turn-worker'}});
  for(const method of ['item/started','item/completed'])f.event(method,{threadId:'root',item:{type:'subAgentActivity',kind:'completed',agentThreadId:'worker',agentTurnId:'turn-worker'}});
  f.event('turn/completed',{threadId:'root',turn:{id:'turn-root'}});
  f.event('turn/started',{threadId:'worker',turn:{id:'turn-worker'}});
  f.event('item/completed',{threadId:'root',item:{type:'subAgentActivity',kind:'started',agentThreadId:'worker',agentTurnId:'turn-worker'}});
  assert.notEqual(f.snapshot().endedAt,null);f.tick();assert.equal(f.snapshot().durationMs,0);
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(f.snapshot().stopped,false);assert.equal(f.calls.some(call=>call.method==='turn/interrupt'),false);
});
test('time budget interrupts a stalled task',async t=>{
  const f=fixture({maxDurationMs:15});t.after(f.guard.stop);await f.start();await new Promise(resolve=>setTimeout(resolve,25));assert.match(f.snapshot().reason,/time budget/);
});
test('completion delivered before the start response cannot resurrect a turn',async t=>{
  const client=new EventEmitter(),calls=[];client.request=async(method,params)=>{calls.push(method);client.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{id:'fast'}}});return {turn:{id:'fast',status:'inProgress'}};};
  const guard=bindExecutionGuard(client,{userId:()=> 'owner',maxDurationMs:15});t.after(guard.stop);await client.request('turn/start',{threadId:'root',input:[]});await new Promise(resolve=>setTimeout(resolve,25));assert.deepEqual(calls,['turn/start']);assert.equal(guard.snapshot(['root'])[0].stopped,false);
});
