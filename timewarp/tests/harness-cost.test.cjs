"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function moduleOf(file,bindings={}) {
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
  const context=vm.createContext(bindings);vm.runInContext(source,context);return context;
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
test('cache reads, writes and ordinary input are charged once with the long-context tier selected by total input',()=>{
  const cost=vm.runInContext('computeCostUsd',moduleOf('cloud/aiCost.ts'));
  near(cost('openai/gpt-5.6-sol',100000,1000,{cached_tokens:80000,cache_write_tokens:10000}),.142);
  near(cost('openai/gpt-5.6-luna',100000,1000,{cached_tokens:80000,cache_write_tokens:10000}),.0073);
  near(cost('openai/gpt-5.6-sol',300000,10000,{cached_tokens:300000}),.54);
  near(cost('openai/gpt-5.6-sol',100000,0,{cache_write_tokens:100000}),.5);
  near(cost('openai/gpt-5.6-sol',100000,1000),.42);
  for(const details of [{cached_tokens:-1},{cached_tokens:NaN},{cache_write_tokens:1.5},{cached_tokens:100,cache_write_tokens:1},{cached_tokens:'50'}])assert.throws(()=>cost('openai/gpt-5.6-sol',100,0,details),/accounting/);
});
test('reservation includes worst-case cache writes and recovery preserves the discounted cost',async()=>{
  const costs={computeCostUsd:vm.runInContext('computeCostUsd',moduleOf('cloud/aiCost.ts'))},calls=[];let fail=false;
  const {reserveAgentAi}=moduleOf('cloud/agentAiReservation.ts',{...costs,TextEncoder,crypto,setTimeout:done=>done(),console:{error(){}},AI_COST_MARKUP:2.5,USD_PER_CREDIT:.125});
  const admin={rpc:async(name,input)=>{calls.push({name,input});return name==='timewarp_reserve_agent_ai'?{data:true}:fail?{error:{message:'offline'}}:{data:{settled:true}};}};
  const reservation=await reserveAgentAi(admin,'owner','openai/gpt-5.6-sol',{}, {inputTokens:100000,outputTokens:1000});
  near(calls[0].input.p_credits,.52*20);
  fail=true;await assert.rejects(reservation.finish('settled',100000,1000,{cached_tokens:80000,cache_write_tokens:10000}),/reconciliation/);
  fail=false;await reservation.finish('uncertain');
  for(const call of calls.slice(1)){near(call.input.p_cost,.142);assert.equal(call.input.p_outcome,'settled');}
});
test('stream metering forwards cache details and does not change the streamed provider response',async()=>{
  const finishes=[],usage={input_tokens:100000,output_tokens:1000,input_tokens_details:{cached_tokens:80000,cache_write_tokens:10000}};
  const event='data: '+JSON.stringify({type:'response.completed',response:{usage}});let pending,upstreamBody;
  const {nativeStream}=moduleOf('cloud/nativeResponses.ts',{responseOutputLimit:moduleOf('cloud/agentAiReservation.ts',{}).responseOutputLimit,TextEncoder,TextDecoder,Response,AbortSignal,console,EdgeRuntime:{waitUntil:value=>{pending=value;}},assertCloudSafe(){},azureLunaModel:()=> 'gpt-5.6-luna',azureSolKeys:()=>['fixture'],azureLunaKeys:()=>['fixture'],azureFoundryBase:()=> 'https://fixture.invalid',fetch:async(_url,options)=>{upstreamBody=JSON.parse(options.body);return new Response(event);},reserveAgentAi:async()=>({id:'fixture',finish:async(...args)=>finishes.push(args)})});
  const response=await nativeStream({},'owner','gpt-5.6-sol',{prompt_cache_key:'stable-thread',input:[]},{});
  assert.equal(await response.text(),event);await pending;
  assert.equal(finishes[0][3].cached_tokens,80000);assert.equal(finishes[0][3].cache_write_tokens,10000);
  assert.equal(upstreamBody.prompt_cache_key,'stable-thread');assert.equal(upstreamBody.store,false);
});

test('bounded output limits validate inputs and reserve the same request sent upstream',async()=>{
  const {responseOutputLimit}=moduleOf('cloud/agentAiReservation.ts');assert.equal(responseOutputLimit({}),16384);assert.equal(responseOutputLimit({max_output_tokens:256}),256);assert.equal(responseOutputLimit({max_output_tokens:20000}),16384);
  for(const value of [0,-1,1.5,'100',NaN])assert.throws(()=>responseOutputLimit({max_output_tokens:value}),error=>error.status===400);
  let reserved,sent,pending;const event='data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:12,output_tokens:2}}});
  const {nativeStream}=moduleOf('cloud/nativeResponses.ts',{responseOutputLimit,TextEncoder,TextDecoder,Response,AbortSignal,console,EdgeRuntime:{waitUntil:p=>pending=p},assertCloudSafe(){},azureLunaModel:()=> 'gpt-5.6-luna',azureSolKeys:()=>['fixture'],azureLunaKeys:()=>['fixture'],azureFoundryBase:()=> 'https://fixture.invalid',fetch:async(_url,options)=>{sent=JSON.parse(options.body);return new Response(event);},reserveAgentAi:async(_admin,_owner,_model,body)=>{reserved=JSON.parse(JSON.stringify(body));return{id:'fixture',finish:async()=>{}};}});
  await (await nativeStream({},'owner','gpt-5.6-luna',{input:[],max_output_tokens:256,prompt_cache_key:'stable'},{})).text();await pending;assert.deepEqual(sent,reserved);assert.equal(sent.max_output_tokens,256);assert.equal(sent.prompt_cache_key,'stable');
});

test('authenticated cloud entry preserves cache key and bounded output for streaming and nonstreaming requests',async()=>{
  let handler,forwarded,reserved,sent,finished;
  moduleOf('cloud/index.ts',{Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'owner'}}})}}),Response,TextDecoder,TextEncoder,AbortSignal,
    responseOutputLimit:moduleOf('cloud/agentAiReservation.ts').responseOutputLimit,assertCloudSafe:require('../shared/privacy.cjs').assertCloudSafe,azureSolModel:()=> 'gpt-5.6-sol',azureLunaModel:()=> 'gpt-5.6-luna',azureSolKeys:()=>['fixture'],azureLunaKeys:()=>['fixture'],azureFoundryBase:()=> 'https://fixture.invalid',
    nativeStream:async(_a,_u,_m,payload)=>{forwarded=payload;return new Response('stream');},reserveAgentAi:async(_a,_u,_m,payload)=>{reserved=JSON.parse(JSON.stringify(payload));return{finish:async(...args)=>{finished=args;}};},fetch:async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({usage:{input_tokens:100,output_tokens:2,input_tokens_details:{cached_tokens:80}},output:[]});},URL});
  const body={input:'fixture',model:'gpt-5.6-luna',max_output_tokens:256,prompt_cache_key:'stable-owner-thread',parallel_tool_calls:true,client_metadata:{irrelevant:'4111111111111111'}};
  const request=stream=>new Request('https://fixture.invalid/functions/v1/timewarp-energy/v1/responses',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({...body,stream})});
  assert.equal((await handler(request(true))).status,200);assert.equal(forwarded.prompt_cache_key,body.prompt_cache_key);assert.equal(forwarded.max_output_tokens,256);assert.equal(forwarded.parallel_tool_calls,true);
  assert.equal((await handler(request(false))).status,200);assert.deepEqual(sent,reserved);assert.equal(sent.max_output_tokens,256);assert.equal(finished[3].cached_tokens,80);
  assert.equal(sent.client_metadata,undefined);body.input='4111 1111 1111 1111';assert.equal((await handler(request(true))).status,400);
});
