"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBridge}=require('../desktop/bridge.cjs');
async function bridge(t,cloud){const server=createBridge({authorize:async token=>token==='capability',userId:()=> 'owner'},cloud,0);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});return{url:`http://127.0.0.1:${server.address().port}/api/product/trpc/`,headers:{authorization:'Bearer capability','content-type':'application/json'}};}
test('account RPC uses the cloud and preserves its errors',async t=>{
  const calls=[],{url,headers}=await bridge(t,async(route,input)=>{calls.push({route,input});if(input.input.name==='Denied')return Response.json({error:'Only owners can rename this organization.'},{status:403});return Response.json(null);});
  const response=await fetch(url+'product.organizations.update',{method:'POST',headers,body:JSON.stringify({json:{name:'Timewarp'}})});assert.deepEqual(await response.json(),{result:{data:{json:null}}});assert.deepEqual(calls[0],{route:'/native/rpc',input:{rpc:'product.organizations.update',input:{name:'Timewarp'}}});
  const failed=await fetch(url+'product.organizations.update',{method:'POST',headers,body:JSON.stringify({name:'Denied'})});assert.equal(failed.status,403);assert.equal((await failed.json()).error.json.data.code,'FORBIDDEN');
});
test('local chat, memory and execution subscriptions never enter the cloud relay',async t=>{
  let calls=0;const{url,headers}=await bridge(t,async()=>{calls++;return Response.json({});});
  for(const rpc of ['product.conversations.list','product.conversations.send','product.conversations.changes.subscribe','product.conversations.activities.subscribe','product.agents.list','product.memory.list','product.settings.update'])assert.equal((await fetch(url+rpc,{headers})).status,410,rpc);
  for(const rpc of ['product.vault.list','product.secretInputs.submit','product.files.readBinary'])assert.equal((await fetch(url+rpc,{headers})).status,403,rpc);
  assert.equal(calls,0);
});
test('account relay rejects sensitive input before cloud transport',async t=>{
  let calls=0;const{url,headers}=await bridge(t,async()=>{calls++;return Response.json(null);});
  assert.equal((await fetch(url+'product.profile.update',{method:'POST',headers,body:JSON.stringify({name:'4111 1111 1111 1111'})})).status,400);assert.equal(calls,0);
});

test('hosted MCP listing succeeds without cloud access so local MCP cards can render',async t=>{
  let calls=0;const{url,headers}=await bridge(t,async()=>{calls++;throw Error('Unexpected cloud access');});
  const response=await fetch(url+'product.integrations.mcps.list',{headers});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{result:{data:{json:{items:[]}}}});
  const anonymous=await fetch(url+'product.integrations.mcps.list');
  assert.equal(anonymous.status,401);
  assert.equal(calls,0);
});
