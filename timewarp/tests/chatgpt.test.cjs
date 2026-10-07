"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createChatgpt}=require('../desktop/chatgpt.cjs');
const {bindCodexFunding}=require('../desktop/codex-funding.cjs');
const {createAiFunding}=require('../desktop/ai-funding.cjs');
const {createBridge}=require('../desktop/bridge.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(saved=null){
  let metadata=saved,owner='timewarp-owner',plan='free',account=null,completed='completed',loginError=null,connected=0,started=0;
  const calls=[],threads=new Map(),client=new EventEmitter();
  let modelPage=null;
  client.start=async()=>{};
  client.request=async(method,params)=>{
    calls.push({method,params:structuredClone(params)});
    if(method==='account/read')return {account};
    if(method==='account/logout'){account=null;return {};}
    if(method==='account/login/start')return {type:'chatgpt',loginId:'login-1',authUrl:'https://auth.openai.com/oauth/authorize?client_id=codex'};
    if(method==='account/login/cancel')return {};
    if(method==='account/rateLimits/read')return {rateLimits:{primary:{usedPercent:10}},rateLimitsByLimitId:{codex:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:1801750000},secondary:{usedPercent:50,windowDurationMins:10080,resetsAt:1801900000}}}};
    if(method==='model/list')return modelPage?modelPage(params):{data:[{id:'model-codex',model:'gpt-codex',displayName:'Codex',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low',description:'Fast'}],defaultReasoningEffort:'low'},{id:'hidden',model:'hidden',hidden:true}]};
    if(['thread/start','thread/resume','thread/fork'].includes(method)){const id=method==='thread/resume'?params.threadId:'thread-'+(++started);threads.set(id,params);return {thread:{id,modelProvider:params.modelProvider}};}
    if(method==='turn/start'){
      const turn={id:'turn-'+calls.length,status:completed,...completed!=='completed'?{error:{message:'Subscription limit reached'}}:{}};
      client.emit('notification',{method:'turn/started',params:{threadId:params.threadId,turn:{id:turn.id,status:'inProgress'}}});
      client.emit('notification',{method:'thread/tokenUsage/updated',params:{threadId:params.threadId,tokenUsage:{last:{inputTokens:3,outputTokens:1}}}});
      client.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn}});
      return {turn};
    }
    if(['turn/interrupt','turn/steer','thread/unsubscribe'].includes(method))return {};
    throw Error('Unexpected RPC '+method);
  };
  const service=createChatgpt({storage:{load:()=>metadata,save:value=>{metadata=structuredClone(value);}},userId:()=>owner,onConnected:()=>{connected++;}});
  const funding=createAiFunding({userId:()=>owner,chatgpt:service,cloud:async()=>Response.json({plan,included:0,purchased:10})});
  bindCodexFunding({client,chatgpt:service,funding,userId:()=>owner});
  async function login(){await service.startBrowserLogin();account={type:'chatgpt',email:'owner@example.test',planType:'plus'};client.emit('notification',{method:'account/login/completed',params:{loginId:'login-1',success:!loginError,error:loginError}});await tick();await tick();}
  return {service,client,funding,calls,threads,login,get metadata(){return metadata;},get connected(){return connected;},set owner(value){owner=value;},set plan(value){plan=value;},set account(value){account=value;},set completed(value){completed=value;},set loginError(value){loginError=value;},set modelPage(value){modelPage=value;}};
}

test('Codex catalog includes later pages once, preserves capabilities and hides internal models',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();
  const sol={id:'sol',model:'gpt-6.1-sol',displayName:'GPT-6.1-Sol',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'ultra',description:'Deepest'}],defaultReasoningEffort:'ultra'};
  f.modelPage=params=>params.cursor?{data:[sol,{id:'luna',model:'gpt-6-luna',inputModalities:['text'],defaultReasoningEffort:'medium'},{id:'internal',hidden:true}],nextCursor:null}:{data:[sol],nextCursor:'page-2'};
  const choices=await f.service.models();assert.deepEqual(choices.map(x=>x.id),['gpt-6.1-sol','gpt-6-luna']);
  assert.deepEqual(choices[0].supportedReasoningEfforts,sol.supportedReasoningEfforts);assert.equal(choices[0].featured,true);
  assert.deepEqual(choices[0].inputModalities,['text','image']);assert.deepEqual(choices[1].inputModalities,['text']);
  assert.deepEqual(choices[1].supportedReasoningEfforts,[{reasoningEffort:'medium',description:'Default'}]);
  assert.deepEqual(f.calls.filter(c=>c.method==='model/list').map(c=>c.params),[{limit:100,includeHidden:false},{limit:100,includeHidden:false,cursor:'page-2'}]);
});

test('a repeated Codex catalog cursor fails instead of looping',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();f.modelPage=()=>({data:[],nextCursor:'same-page'});
  await assert.rejects(f.service.models(),/invalid model catalog page/);assert.equal(f.calls.filter(c=>c.method==='model/list').length,2);
});

test('catalog pages cannot leak across a Timewarp owner change',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();
  f.modelPage=params=>{if(params.cursor)f.owner='different-owner';return {data:[{model:'gpt-6.1-sol'}],nextCursor:params.cursor?null:'next'};};
  await assert.rejects(f.service.models(),/account changed/);
});
test('uses built-in Codex browser login, keeps Timewarp authentication separate and stores no tokens',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();
  assert.deepEqual(f.calls.find(c=>c.method==='account/login/start').params,{type:'chatgpt',useHostedLoginSuccessPage:true,appBrand:'chatgpt'});
  assert.equal(f.service.connection().status,'available');assert.equal(f.connected,1);
  assert.equal(f.service.details().backend,'codex-app-server');
  assert.equal(f.service.details().rateLimits.primary.usedPercent,25);
  assert.equal(f.service.usage().plans[0].limits[0].remainingPercent,75);
  // The sidebar meter and limit banner only read limits whose ids start with codex/.
  assert.equal(f.service.usage().plans[0].limits[0].id,'codex/primary');
  assert.ok(!/access_token|refresh_token|clientId|idToken/.test(JSON.stringify(f.metadata)));
});
test('cancels the pending native login and ignores a late completion',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.service.startBrowserLogin();await f.service.cancelLogin();
  f.client.emit('notification',{method:'account/login/completed',params:{loginId:'login-1',success:true}});
  await tick();assert.equal(f.connected,0);assert.equal(f.service.currentBrowserLogin().status,'idle');
  assert.deepEqual(f.calls.find(c=>c.method==='account/login/cancel').params,{loginId:'login-1'});
});
test('provider login failure is visible and cannot silently switch to purchased credits',async t=>{
  const f=fixture();t.after(()=>f.service.stop());f.loginError='Provider rejected approval';await f.login();
  assert.equal(f.service.currentBrowserLogin().status,'error');
  assert.match(f.service.details().lastConnectionError.message,/Provider rejected/);
  f.account=null;await f.service.refresh(true);
  assert.equal((await f.funding.current()).source,'chatgpt');assert.equal((await f.funding.current()).canFundUsage,false);
});
test('rejects an untrusted approval URL',async t=>{
  const f=fixture();t.after(()=>f.service.stop());
  // Override the raw RPC retained at bind time through an independent client.
  const client=new EventEmitter();client.start=async()=>{};client.request=async method=>method==='account/login/start'?{loginId:'x',authUrl:'https://example.test/steal'}:{account:null};
  const service=createChatgpt({storage:{load:()=>null,save:()=>{}},userId:()=> 'owner'});service.bindClient(client);t.after(()=>service.stop());
  await assert.rejects(service.startBrowserLogin(),/invalid account approval link/);
});
test('Free uses OpenAI native provider while preserving tools, instructions and streamed native turns',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();
  const created=await f.client.request('thread/start',{model:'openai/gpt-codex',dynamicTools:[{name:'local_tool'}],developerInstructions:'Keep me',config:{'skills.include_instructions':true}});
  const params=f.threads.get(created.thread.id);assert.equal(params.modelProvider,'openai');assert.equal(params.model,'gpt-codex');assert.equal(params.config.model_provider,'openai');
  assert.deepEqual(params.dynamicTools,[{name:'local_tool'}]);assert.equal(params.developerInstructions,'Keep me');
  await f.client.request('turn/start',{threadId:created.thread.id,collaborationMode:{mode:'default',settings:{model:'openai/gpt-codex',developer_instructions:'same'}},input:[]});
  const turn=f.calls.find(c=>c.method==='turn/start');assert.equal(turn.params.collaborationMode.settings.model,'gpt-codex');assert.ok(!('modelProvider'in turn.params));
  assert.equal(f.service.details().usage.requests,1);assert.equal(f.service.details().usage.inputTokens,3);
});
test('all paid plans use Timewarp provider and changing plans reroutes an existing chat before its next turn',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();
  const created=await f.client.request('thread/start',{model:'gpt-codex'});
  for(const plan of ['pro','max','ultra']){
    f.plan=plan;await f.client.request('turn/start',{threadId:created.thread.id,model:'gpt-codex',input:[]});
    assert.equal(f.threads.get(created.thread.id).modelProvider,'energy-llm-proxy');
    assert.equal(f.calls.filter(c=>c.method==='turn/start').at(-1).params.model,'openai/gpt-5.6-sol');
    assert.equal((await f.funding.current()).source,'timewarp');
  }
  assert.equal(f.service.details().lastCompletedAt,null);
  f.plan='free';await f.client.request('turn/start',{threadId:created.thread.id,model:'openai/gpt-codex',input:[]});
  assert.equal(f.threads.get(created.thread.id).modelProvider,'openai');
});
test('native subscription test requires a completed turn, handles completion before RPC response and never runs on paid plan',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();
  assert.deepEqual(await f.service.verifyAccess(),{completed:true,fundingSource:'chatgpt'});
  assert.ok(f.service.details().lastCompletedAt);assert.equal(f.service.details().usage.requests,1);
  f.completed='failed';await assert.rejects(f.service.verifyAccess(),/Subscription limit/);
  assert.equal(f.service.details().usage.requests,1);
  f.plan='pro';const count=f.calls.filter(c=>c.method==='turn/start').length;
  await assert.rejects(f.service.verifyAccess(),/Free plan/);
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,count);
});
test('account changes cancel local access and never adopt a previous owner Codex login',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();const created=await f.client.request('thread/start',{model:'gpt-codex'});
  f.owner='another-owner';f.service.stop();assert.equal(f.service.connection().status,'disconnected');
  await f.service.refresh();assert.ok(f.calls.filter(c=>c.method==='account/logout').length>=2);
  assert.equal(f.service.connection().account,null);
  await assert.rejects(f.client.request('turn/start',{threadId:created.thread.id,input:[]}),/another Timewarp account/);
});
test('restart restores only the same Timewarp owner binding and model catalog is not inference proof',async t=>{
  const f=fixture({owner:'timewarp-owner',selected:true});t.after(()=>f.service.stop());f.account={type:'chatgpt',planType:'plus'};
  await f.service.refresh();assert.equal(f.service.connection().status,'available');
  assert.equal((await f.service.models()).length,1);assert.equal(f.service.details().lastCompletedAt,null);
  assert.equal(f.calls.filter(c=>c.method==='account/logout').length,0);
});
test('encrypted account binding loads after readiness, never in the bootstrap constructor',async t=>{
  let ready=false,reads=0;const client=new EventEmitter();client.start=async()=>{};client.request=async()=>({account:null});
  const service=createChatgpt({storage:{load:()=>{assert.ok(ready);reads++;return null;},save:()=>{}},userId:()=>ready?'owner':null});service.bindClient(client);t.after(()=>service.stop());
  assert.equal(reads,0);assert.equal(service.connection().status,'disconnected');ready=true;await service.refresh();assert.equal(reads,1);
});
test('late login-start response is cancelled after a Timewarp owner change',async t=>{
  let owner='first',resolveStart;const calls=[],client=new EventEmitter();client.start=async()=>{};client.request=async(method,params)=>{calls.push({method,params});return method==='account/login/start'?new Promise(resolve=>{resolveStart=resolve;}):{account:null};};
  const service=createChatgpt({storage:{load:()=>null,save:()=>{}},userId:()=>owner});service.bindClient(client);t.after(()=>service.stop());
  const pending=service.startBrowserLogin();await tick();owner='second';service.stop();resolveStart({loginId:'old-login',authUrl:'https://auth.openai.com/oauth/authorize'});
  await assert.rejects(pending,/account changed/);assert.deepEqual(calls.find(c=>c.method==='account/login/cancel').params,{loginId:'old-login'});assert.equal(service.connection().status,'disconnected');
});
test('explicit disconnect restores credit funding and account switching uses native logout',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();const before=f.calls.filter(c=>c.method==='account/logout').length;
  await f.service.startBrowserLogin({newAccount:true});assert.equal(f.calls.filter(c=>c.method==='account/logout').length,before+1);
  await f.service.disconnect();assert.equal(f.service.connection().status,'disconnected');assert.equal((await f.funding.current()).source,'timewarp');
});
test('the subscription proxy fails closed with no Timewarp inference call',async t=>{
  const f=fixture();t.after(()=>f.service.stop());await f.login();let cloudInference=0;
  const server=createBridge({authorize:async()=>true,userId:()=> 'timewarp-owner'},async route=>{if(route==='/billing')return Response.json({plan:'free',included:0,purchased:10});cloudInference++;throw Error('Must not call paid inference');},0,{chatgpt:f.service,aiFunding:f.funding});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/responses',{method:'POST',headers:{authorization:'Bearer local','content-type':'application/json'},body:JSON.stringify({model:'gpt-codex',input:'Hello'})});
  assert.equal(response.status,409);assert.equal(cloudInference,0);
});
