"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const {stripTypeScriptTypes}=require('node:module');
function moduleOf(file,bindings={}) {
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export const /g,'var ').replace(/export /g,'');
  const context=vm.createContext(bindings);vm.runInContext(source,context);return context;
}
// Azure routes with the production resource key's secret name set.
const azure=moduleOf('cloud/azureAgentAi.ts',{Deno:{env:{get:name=>name==='GPT_TERRA_KEY'?'fixture':''}},crypto,TextEncoder});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const plain=value=>JSON.parse(JSON.stringify(value));
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
test('usage past the reservation is charged the whole reservation instead of failing to settle',async()=>{
  const costs={computeCostUsd:vm.runInContext('computeCostUsd',moduleOf('cloud/aiCost.ts'))},calls=[],logged=[];
  const {reserveAgentAi}=moduleOf('cloud/agentAiReservation.ts',{...costs,TextEncoder,crypto,setTimeout:done=>done(),console:{error:(...args)=>logged.push(args)},AI_COST_MARKUP:2.5,USD_PER_CREDIT:.125});
  // The ledger's own check (timewarp_energy_complete_ai) refuses a cost above the reservation.
  const admin={rpc:async(name,input)=>{calls.push({name,input});if(name==='timewarp_reserve_agent_ai')return{data:true};return input.p_cost*2.5/.125>calls[0].input.p_credits?{error:{message:'Invalid reserved usage'}}:{data:{settled:true}};}};
  const reservation=await reserveAgentAi(admin,'owner','anthropic/claude-opus-5-5',{},{inputTokens:20000,outputTokens:16});
  await reservation.finish('settled',400000,16);
  const settled=calls.at(-1).input;
  assert.equal(calls.length,2,'settles on the first try');
  assert.ok(settled.p_cost*2.5/.125<=calls[0].input.p_credits);
  const held=calls[0].input.p_credits*.125/2.5;assert.ok(settled.p_cost>held*(1-1e-8),"charged the whole reservation");
  assert.equal(logged.length,1,'the overage is logged for the operator');
  // Usage within the reservation is charged as before.
  calls.length=0;logged.length=0;
  await (await reserveAgentAi(admin,'owner','anthropic/claude-opus-5-5',{},{inputTokens:20000,outputTokens:16})).finish('settled',10000,16);
  near(calls.at(-1).input.p_cost,costs.computeCostUsd('anthropic/claude-opus-5-5',10000,16));
  assert.equal(logged.length,0);
});

const reservations=moduleOf('cloud/agentAiReservation.ts',{computeCostUsd:vm.runInContext('computeCostUsd',moduleOf('cloud/aiCost.ts')),TextEncoder,atob,crypto,setTimeout:done=>done(),console:{error(){}},AI_COST_MARKUP:2.5,USD_PER_CREDIT:.125});
// The Azure request module with a scripted provider.
const native=bindings=>moduleOf('cloud/nativeResponses.ts',{responseOutputLimit:reservations.responseOutputLimit,requestInputTokens:reservations.requestInputTokens,azureCacheRetention:()=>false,TextEncoder,TextDecoder,Response,AbortSignal,console,assertCloudSafe(){},servedSpeed:azure.servedSpeed,azureFoundryBase:()=> 'https://fixture.invalid',EdgeRuntime:{waitUntil(){}},...bindings});
const completed=()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:12,output_tokens:2}}})+'\n\n');
const refusal=(error,status=400)=>Response.json({error},{status});

test('stream metering forwards cache details and does not change the streamed provider response',async()=>{
  const finishes=[],usage={input_tokens:100000,output_tokens:1000,input_tokens_details:{cached_tokens:80000,cache_write_tokens:10000}};
  const event='data: '+JSON.stringify({type:'response.delta',delta:'x'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{usage}});let pending,upstreamBody;
  const {nativeStream}=native({EdgeRuntime:{waitUntil:value=>{pending=value;}},fetch:async(_url,options)=>{upstreamBody=JSON.parse(options.body);return new Response(event);},reserveAgentAi:async()=>({id:'fixture',finish:async(...args)=>finishes.push(args)})});
  const response=await nativeStream({},'owner',azure.azureRoute('gpt-5.6-sol'),{prompt_cache_key:'stable-key',input:[]},{});
  assert.equal(await response.text(),event);await pending;
  assert.equal(finishes[0][3].cached_tokens,80000);assert.equal(finishes[0][3].cache_write_tokens,10000);
  assert.equal(upstreamBody.prompt_cache_key,'stable-key');assert.equal(upstreamBody.store,false);assert.equal(upstreamBody.prompt_cache_retention,undefined,'24-hour retention is off by default');
});

test('bounded output limits validate inputs and reserve the same request sent upstream',async()=>{
  const {responseOutputLimit}=moduleOf('cloud/agentAiReservation.ts');assert.equal(responseOutputLimit({}),16384);assert.equal(responseOutputLimit({max_output_tokens:256}),256);assert.equal(responseOutputLimit({max_output_tokens:20000}),16384);
  for(const value of [0,-1,1.5,'100',NaN])assert.throws(()=>responseOutputLimit({max_output_tokens:value}),error=>error.status===400);
  let reserved,bounds,sent,pending;
  const {nativeStream}=native({EdgeRuntime:{waitUntil:p=>pending=p},fetch:async(_url,options)=>{sent=options.body;return completed();},reserveAgentAi:async(_admin,_owner,_model,body,given)=>{reserved=JSON.stringify(body);bounds=given;return{id:'fixture',finish:async()=>{}};}});
  await (await nativeStream({},'owner',azure.azureRoute('gpt-5.6-luna'),{input:[],max_output_tokens:256,prompt_cache_key:'stable'},{})).text();await pending;
  assert.equal(sent,reserved,'the reservation is sized from the very text that is sent');assert.equal(bounds.inputTokens,reservations.requestInputTokens(JSON.parse(sent)));
  assert.equal(JSON.parse(sent).max_output_tokens,256);assert.equal(JSON.parse(sent).prompt_cache_key,'stable');
});

// The cloud entry with Azure behind a scripted fetch.
function entry({user='owner',plan='free',fetch,reserved=[],finished=[]}={}) {
  let handler;
  const {nativeStream,nativeCall}=native({fetch,reserveAgentAi:async(_a,_u,model,body)=>{reserved.push({model,body:plain(body)});return{id:'r',finish:async(...args)=>{finished.push([model,...args]);}};}});
  moduleOf('cloud/index.ts',{Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async token=>token==='signed-out'?{data:{user:null},error:{message:'expired'}}:{data:{user:{id:user}}}},rpc:async()=>({data:{plan}})}),
    Response,TextDecoder,TextEncoder,AbortSignal,URL,Blob,DecompressionStream,REVIEW_OUTPUT_TOKENS:reservations.REVIEW_OUTPUT_TOKENS,responseOutputLimit:reservations.responseOutputLimit,assertCloudSafe:require('../shared/privacy.cjs').assertCloudSafe,
    azureSolModel:()=> 'gpt-5.6-sol',azureLunaModel:()=> 'gpt-5.6-luna',azureRoute:azure.azureRoute,promptCacheKey:azure.promptCacheKey,claudeRoute:moduleOf('cloud/claudeAgentAi.ts').claudeRoute,isClaudeReasoning:()=>false,
    claudeStream:async()=>{throw new Error('not Claude');},claudeCall:async()=>{throw new Error('not Claude');},nativeStream,nativeCall});
  return handler;
}
const call=(handler,body,{token='fixture',headers={}}={})=>handler(new Request('https://fixture.invalid/functions/v1/timewarp-energy/v1/responses',{method:'POST',headers:{authorization:'Bearer '+token,...headers},body:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)}));
const upstream=sent=>async(_url,init)=>{const body=JSON.parse(init.body);sent.push(body);return body.stream?completed():Response.json({usage:{input_tokens:100,output_tokens:2,input_tokens_details:{cached_tokens:80}},output:[]});};

test('authenticated cloud entry keeps bounded output and gives every chat of an account and model one cache key',async()=>{
  const sent=[],reserved=[],finished=[],handler=entry({reserved,finished,fetch:upstream(sent)});
  const body={input:'fixture',model:'gpt-5.6-luna',max_output_tokens:256,prompt_cache_key:'owner-thread-1',parallel_tool_calls:true,client_metadata:{irrelevant:'4111111111111111'}};
  assert.equal((await call(handler,{...body,stream:true})).status,200);assert.equal(sent[0].max_output_tokens,256);assert.equal(sent[0].parallel_tool_calls,true);assert.equal(sent[0].client_metadata,undefined);
  assert.equal((await call(handler,{...body,stream:false})).status,200);assert.deepEqual(sent[1],reserved[1].body);assert.ok(finished.some(entry=>entry[1]==='settled'&&entry[4]?.cached_tokens===80));
  await call(handler,{...body,prompt_cache_key:'owner-thread-2',stream:true});
  const key=sent[0].prompt_cache_key;
  assert.deepEqual(sent.map(request=>request.prompt_cache_key),[key,key,key],'a new chat reads what earlier chats cached');
  assert.match(key,/^tw-[0-9a-f]{32}$/);assert.ok(key.length<64);
  await call(handler,{...body,model:'gpt-5.6-sol',stream:true});assert.notEqual(sent.at(-1).prompt_cache_key,key,'each model has its own key');
  const other=[];await call(entry({user:'someone-else',fetch:upstream(other)}),{...body,stream:true});assert.notEqual(other[0].prompt_cache_key,key,'and each account');
  assert.equal((await call(handler,{...body,input:'4111 1111 1111 1111',stream:true})).status,400);
  assert.equal((await call(handler,{...body,stream:true},{token:'signed-out'})).status,401,'a signed-out session still fails at once');
});

test('gzipped request bodies are unpacked within the 2 MB limit, and plain ones work as before',async()=>{
  const sent=[],handler=entry({fetch:upstream(sent)}),body={model:'gpt-5.6-luna',stream:true,input:'Hi'},packed=zlib.gzipSync(JSON.stringify(body));
  const answer=async(...args)=>{const response=await call(handler,...args);return [response.status,(await response.text()).includes('Invalid JSON.')?'invalid':''];};
  assert.deepEqual(await answer(body),[200,'']);
  assert.deepEqual(await answer(packed,{headers:{'content-encoding':'gzip'}}),[200,'']);
  assert.deepEqual(await answer(packed),[200,''],'gzip is told by its first bytes');
  assert.deepEqual(await answer(JSON.stringify(body),{headers:{'content-encoding':'gzip'}}),[200,''],'a body the platform already unpacked');
  assert.deepEqual(sent.map(request=>request.input),['Hi','Hi','Hi','Hi']);
  assert.deepEqual(await answer(Buffer.from([0x1f,0x8b,8,0,1,2,3,4,5,6,7,8,9]),{headers:{'content-encoding':'gzip'}}),[400,'invalid'],'the desktop then sends it unpacked');
  assert.deepEqual(await answer(packed.subarray(0,packed.length-12)),[400,'invalid']);
  assert.deepEqual(await answer('{"model":'),[400,'invalid']);
  const bomb=zlib.gzipSync(JSON.stringify({...body,input:'x'.repeat(3*1024*1024)}));assert.ok(bomb.length<64*1024);
  assert.deepEqual(await answer(bomb),[413,''],'the limit holds for the unpacked JSON');
  assert.deepEqual(await answer(JSON.stringify({...body,input:'x'.repeat(2*1024*1024)})),[413,'']);
  assert.deepEqual(await answer(zlib.gzipSync(JSON.stringify({...body,input:'y'.repeat(1024*1024)}))),[200,'']);
  assert.equal(sent.length,5);
});

test('approval reviews run on Luna, billed as Luna, with a small output cap',async()=>{
  assert.deepEqual(plain(azure.azureRoute('codex-auto-review','priority')),{slug:'gpt-5.6-luna',deployment:'gpt-5.6-luna',keys:['fixture'],fast:false,billing:'openai/gpt-5.6-luna',review:true});
  const sent=[],reserved=[],handler=entry({reserved,fetch:upstream(sent)}),review={stream:true,input:'Review this command',reasoning:{effort:'medium'}};
  for(const model of ['codex-auto-review','openai/codex-auto-review'])assert.equal((await call(handler,{...review,model})).status,200);
  await call(handler,{...review,model:'codex-auto-review',max_output_tokens:1000});
  assert.deepEqual(sent.map(request=>[request.model,request.max_output_tokens]),[['gpt-5.6-luna',4096],['gpt-5.6-luna',4096],['gpt-5.6-luna',1000]]);
  assert.deepEqual(reserved.map(entry=>[entry.model,reservations.responseOutputLimit(entry.body)]),[['openai/gpt-5.6-luna',4096],['openai/gpt-5.6-luna',4096],['openai/gpt-5.6-luna',1000]]);
  assert.equal((await call(handler,{...review,model:'codex-auto-review',max_output_tokens:0})).status,400);
  await call(handler,{...review,model:'gpt-5.6-luna'});assert.equal(sent.at(-1).max_output_tokens,16384,'chats keep their allowance');
  assert.notEqual(sent.at(-1).prompt_cache_key,sent[0].prompt_cache_key,'reviews cache apart from Luna chats');
});

test('encrypted reasoning is asked for, so it carries across tool steps',async()=>{
  const sent=[],handler=entry({fetch:upstream(sent)}),body={model:'gpt-5.6-sol',stream:true,input:'Hi'};
  await call(handler,{...body,include:['reasoning.encrypted_content','message.output_text.logprobs']});
  await call(handler,{...body,include:['file_search_call.results']});
  await call(handler,body);
  assert.deepEqual(sent.map(request=>request.include??null),[['reasoning.encrypted_content'],null,null]);
  assert.ok(sent.every(request=>request.store===false));
});

test('reasoning another model encrypted is left out once Azure turns it down, and a deployment that cannot encrypt it is asked without',async()=>{
  const sent=[],finished=[],pending=[];let replies;
  const {nativeStream}=native({EdgeRuntime:{waitUntil:value=>pending.push(value)},fetch:async(_url,init)=>{sent.push(JSON.parse(init.body));return replies.shift();},reserveAgentAi:async()=>({id:'r',finish:async outcome=>{finished.push(outcome);}})});
  const input=[{type:'message',role:'user',content:[{type:'input_text',text:'Hi'}]},{type:'reasoning',summary:[],encrypted_content:'gAAAA-other-model'},{type:'function_call',call_id:'c1',name:'exec_command',arguments:'{}'},{type:'function_call_output',call_id:'c1',output:'ok'}];
  const foreign={message:'The encrypted content for item rs_1 could not be verified.',code:'invalid_encrypted_content',param:null};
  replies=[refusal(foreign),completed()];
  await (await nativeStream({},'owner',azure.azureRoute('gpt-5.6-sol'),{input,include:['reasoning.encrypted_content']},{})).text();await Promise.all(pending);
  assert.deepEqual(sent.map(request=>request.input.map(item=>item.type).join()),['message,reasoning,function_call,function_call_output','message,function_call,function_call_output']);
  assert.deepEqual(sent.map(request=>request.include),[['reasoning.encrypted_content'],['reasoning.encrypted_content']],'the reply still brings its own reasoning');
  assert.deepEqual(finished,['released','settled']);
  sent.length=0;replies=[refusal(foreign),refusal(foreign),refusal(foreign)];
  await assert.rejects(nativeStream({},'owner',azure.azureRoute('gpt-5.6-sol'),{input:input.slice(0,2)},{}),error=>error.status===502);
  assert.equal(sent.length,2,'once');
  sent.length=0;replies=[refusal({message:'Encrypted content is not supported with this model.',param:'include',code:'unsupported_parameter'}),completed(),completed()];
  for(let turn=0;turn<2;turn++)await (await nativeStream({},'owner',azure.azureRoute('gpt-5.6-luna'),{input:'Hi',include:['reasoning.encrypted_content']},{})).text();
  assert.deepEqual(sent.map(request=>request.include??null),[['reasoning.encrypted_content'],null,null],'remembered for the deployment');
  replies=[completed()];await (await nativeStream({},'owner',azure.azureRoute('gpt-5.6-sol'),{input:'Hi',include:['reasoning.encrypted_content']},{})).text();
  assert.deepEqual(sent.at(-1).include,['reasoning.encrypted_content'],'other deployments still get it');
});

test('a deployment that turns Fast or 24-hour retention down is remembered, so later requests skip the extra round trip',async()=>{
  const sent=[],reserved=[];let replies,retention=true;
  const {nativeStream,nativeCall}=native({azureCacheRetention:()=>retention,fetch:async(_url,init)=>{sent.push(JSON.parse(init.body));return replies.shift();},reserveAgentAi:async(_a,_u,model)=>{reserved.push(model);return{id:'r',finish:async()=>{}};}});
  replies=[refusal({param:'service_tier',message:'Priority processing is not enabled for this deployment.'}),refusal({message:'Unrecognized request argument supplied: prompt_cache_retention'}),completed(),completed()];
  for(let turn=0;turn<2;turn++)await (await nativeStream({},'owner',azure.azureRoute('openai/gpt-6.1-sol','priority'),{input:'Hi'},{})).text();
  assert.deepEqual(sent.map(request=>[request.service_tier??'standard',request.prompt_cache_retention??'']),[['priority','24h'],['standard','24h'],['standard',''],['standard','']]);
  assert.deepEqual(reserved,['openai/gpt-6.1-sol-fast','openai/gpt-6.1-sol','openai/gpt-6.1-sol','openai/gpt-6.1-sol']);
  sent.length=0;replies=[completed()];await (await nativeStream({},'owner',azure.azureRoute('openai/gpt-6-astra','priority'),{input:'Hi'},{})).text();
  assert.deepEqual([sent[0].service_tier,sent[0].prompt_cache_retention],['priority','24h'],'other deployments are asked as before');
  sent.length=0;replies=[Response.json({usage:{input_tokens:5,output_tokens:1},output:[]})];
  assert.equal((await nativeCall({},'owner',azure.azureRoute('openai/gpt-6.1-sol','priority'),{input:'Hi'})).usage.input_tokens,5);
  assert.deepEqual([sent[0].service_tier,sent[0].prompt_cache_retention,sent[0].stream],[undefined,undefined,false],'the same memory serves requests that do not stream');
  retention=false;sent.length=0;replies=[completed()];await (await nativeStream({},'owner',azure.azureRoute('openai/gpt-6-luna'),{input:'Hi'},{})).text();
  assert.equal(sent[0].prompt_cache_retention,undefined);
});

test('Free reaches GPT-6, and Fast reaches Azure as priority billed at Fast rates',async()=>{
  const sent=[],reserved=[],handler=entry({plan:'free',reserved,fetch:upstream(sent)});
  assert.equal((await call(handler,{model:'openai/gpt-6.1-sol',service_tier:'priority',stream:true,input:'Hi'})).status,200);
  assert.equal((await call(handler,{model:'openai/gpt-6-luna',stream:true,input:'Hi'})).status,200);
  assert.deepEqual(sent.map(request=>[request.model,request.service_tier]),[['gpt-6.1-sol','priority'],['gpt-6-luna',undefined]]);
  assert.deepEqual(reserved.map(entry=>entry.model),['openai/gpt-6.1-sol-fast','openai/gpt-6-luna']);
});

// Image headers: just enough of each format for its size.
const png=(width,height,filler=0)=>{const bytes=Buffer.alloc(33+filler);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13]).copy(bytes);bytes.write('IHDR',12,'latin1');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes.toString('base64');};
const gif=(width,height)=>{const bytes=Buffer.alloc(32);bytes.write('GIF89a',0,'latin1');bytes.writeUInt16LE(width,6);bytes.writeUInt16LE(height,8);return bytes.toString('base64');};
const webp=(chunk,fill)=>{const bytes=Buffer.alloc(40);bytes.write('RIFF',0,'latin1');bytes.writeUInt32LE(32,4);bytes.write('WEBPVP8',8,'latin1');bytes.write(chunk,12,'latin1');fill(bytes);return bytes.toString('base64');};
const jpeg=(width,height,exif=0)=>{
  const segment=(type,body)=>Buffer.concat([Buffer.from([0xff,type,(body.length+2)>>8,(body.length+2)&255]),body]);
  return Buffer.concat([Buffer.from([0xff,0xd8]),segment(0xe0,Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0','latin1')),segment(0xe1,Buffer.alloc(exif,0x45)),Buffer.from([0xff,0xff]),segment(0xdb,Buffer.alloc(65)),segment(0xc4,Buffer.alloc(30)),
    segment(0xc0,Buffer.from([8,height>>8,height&255,width>>8,width&255,3,1,0x22,0,2,0x11,1,3,0x11,1])),segment(0xda,Buffer.alloc(12)),Buffer.alloc(100)]).toString('base64');
};

test('images reserve by their pixels, within what either provider can bill for them',()=>{
  const {imageSize,imageTokens,requestInputTokens}=reservations,size=data=>plain(imageSize(data));
  assert.deepEqual(size(png(1280,800)),[1280,800]);
  assert.deepEqual(size(gif(640,480)),[640,480]);
  assert.deepEqual(size(jpeg(1280,720)),[1280,720]);
  assert.deepEqual(size(jpeg(4032,3024,40000)),[4032,3024],'the frame header can sit past a large EXIF block');
  assert.deepEqual(size(webp('VP8 ',bytes=>{bytes.writeUInt16LE(1920,26);bytes.writeUInt16LE(1080,28);})),[1920,1080]);
  assert.deepEqual(size(webp('VP8L',bytes=>{bytes[20]=0x2f;bytes.writeUInt32LE((1279|(799<<14))>>>0,21);})),[1280,800]);
  assert.deepEqual(size(webp('VP8X',bytes=>{bytes.writeUIntLE(2999,24,3);bytes.writeUIntLE(1999,27,3);})),[3000,2000]);
  for(const data of [png(1280,800).replace(/^(.{20})/,'$1\n'),jpeg(1280,720,3000).replace(/^(.{1000})/,'$1\n'),png(1280,800).slice(0,20),jpeg(1280,0),Buffer.alloc(64,7).toString('base64'),'not base64!',''])assert.equal(imageSize(data),null);
  // At least what Claude (28 px patches, at most 4,784) or GPT (32 px patches
  // times 1.2, kept whole) would bill, at any size either accepts.
  for(const [width,height] of [[1,1],[27,29],[1280,720],[1280,800],[1280,4000],[1920,1080],[2048,768],[4032,3024],[7999,7999]]){
    const claude=Math.min(Math.ceil(width/28)*Math.ceil(height/28),4784),gpt=Math.ceil(Math.ceil(width/32)*Math.ceil(height/32)*1.2);
    assert.ok(imageTokens(width,height)>=Math.max(claude,gpt),`${width}x${height}`);
  }
  // A 1 MB screenshot reserves its pixels, in Responses input and tool output
  // and in Claude messages and tool results; text still counts by its bytes.
  const shot=png(1280,800,1024*1024),url='data:image/png;base64,'+shot;
  const responses={input:[{type:'message',role:'user',content:[{type:'input_text',text:'Look'},{type:'input_image',image_url:url}]},{type:'function_call_output',call_id:'c',output:[{type:'input_image',image_url:url}]}]};
  assert.equal(requestInputTokens(responses),Buffer.byteLength(JSON.stringify(responses))+4096-2*url.length+2*imageTokens(1280,800));
  assert.ok(requestInputTokens(responses)<20000);
  const claude={messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:shot}},{type:'tool_result',tool_use_id:'t',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:shot}}]}]}]};
  assert.equal(requestInputTokens(claude),Buffer.byteLength(JSON.stringify(claude))+4096-2*shot.length+2*imageTokens(1280,800));
  // An image whose size can't be read here (unparsed, linked, or a file id)
  // counts as the most one image bills; a file raises the request to the most
  // input a model takes, since a small PDF can bill hundreds of pages.
  const {UNSIZED_IMAGE_TOKENS,MODEL_INPUT_TOKENS}=reservations;
  const junk='data:image/png;base64,'+Buffer.alloc(3000,7).toString('base64'),link='https://example.com/x.png';
  const unsized={input:[{type:'message',role:'user',content:[{type:'input_image',image_url:junk},{type:'input_image',image_url:link},{type:'input_image',file_id:'file-1'}]}]};
  assert.equal(requestInputTokens(unsized),Buffer.byteLength(JSON.stringify(unsized))+4096+3*UNSIZED_IMAGE_TOKENS-junk.length-link.length);
  const linked={messages:[{role:'user',content:[{type:'image',source:{type:'url',url:link}},{type:'tool_result',tool_use_id:'t',content:[{type:'image',source:{type:'url',url:link}}]}]}]};
  assert.equal(requestInputTokens(linked),Buffer.byteLength(JSON.stringify(linked))+4096+2*UNSIZED_IMAGE_TOKENS);
  for(const part of [{type:'input_file',file_data:'data:application/pdf;base64,'+Buffer.alloc(3000).toString('base64')},{type:'input_file',file_url:link},{type:'document',source:{type:'base64',media_type:'application/pdf',data:'JVBERi0='}}])
    assert.equal(requestInputTokens({input:[{type:'message',role:'user',content:[part]}]}),MODEL_INPUT_TOKENS);
  assert.equal(requestInputTokens({input:'Hi'}),Buffer.byteLength('{"input":"Hi"}')+4096);
});
