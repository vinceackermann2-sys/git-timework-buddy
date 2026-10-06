"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createComposio}=require('../desktop/composio.cjs'),{createBridge}=require('../desktop/bridge.cjs'),{avatar,shouldAssign}=require('../desktop/mascots.cjs');
function fixture(){let owner='user1',saved=null,active=true;const calls=[];const service=createComposio({userId:()=>owner,storage:{load:()=>saved,save:x=>{saved=structuredClone(x);}},getAgent:async id=>({id,ownerUserId:id==='foreign'?'user2':'user1'}),ensureCallback:async()=>{},mcpToken:'private-mcp-token',cloud:async(route,input)=>{
  calls.push({route,input});assert.equal(route,'/connectors');
  if(input.action==='list-apps')return {apps:[{toolkitSlug:'github',authConfigId:'ac_real',name:'GitHub',logo:'https://example.invalid/logo.png',description:'GitHub tools',accounts:[{connectionId:'ca_owned',active,status:active?'ACTIVE':'INITIATED',label:'Owned GitHub account'}]}]};
  if(input.action==='list-tools')return {tools:[{slug:'GITHUB_GET_THE_AUTHENTICATED_USER',inputParameters:{type:'object',properties:{}},description:'Read user profile'}]};
  if(input.action==='execute')return {successful:true,data:{login:'fixture'}};
  if(input.action==='initiate-connection')return {connectionId:'ca_owned',redirectUrl:'https://connect.composio.dev/fixture'};
  if(input.action==='disconnect')return {success:true};
  throw Error('Unexpected action');
}});return {service,calls,set active(x){active=x;service.invalidate();},set owner(x){owner=x;service.invalidate();}};}
test('Composio discovers and executes real schemas through the authenticated backend, enforcing ownership and assistant access',async()=>{
  const f=fixture();assert.equal((await f.service.list({owner:{kind:'agent',agentId:'assistant'}})).items[0].accounts[0].authStatus,'ready');
  const tools=await f.service.searchTools({assistantId:'assistant',query:'profile'});assert.equal(tools.tools[0].slug,'GITHUB_GET_THE_AUTHENTICATED_USER');
  assert.equal((await f.service.execute({assistantId:'assistant',connectedAccountId:'ca_owned',toolSlug:tools.tools[0].slug,arguments:{}})).successful,true);
  await assert.rejects(f.service.execute({assistantId:'foreign',connectedAccountId:'ca_owned',toolSlug:tools.tools[0].slug}),/Agent not found/);
  await assert.rejects(f.service.setAccess({agentId:'assistant',items:[{kind:'integration',integrationId:'composio-github',accountId:'someone-else',owner:'user'}]}),/own/);
  await f.service.setAccess({agentId:'assistant',items:[]});await assert.rejects(f.service.execute({assistantId:'assistant',connectedAccountId:'ca_owned',toolSlug:tools.tools[0].slug}),/not available/);
  f.owner='user2';await assert.rejects(f.service.connections('assistant'),/Agent not found/);
});
test('Composio browser return verifies the active connection before reporting success',async()=>{
  const f=fixture();f.active=false;await f.service.beginConnect({integrationId:'composio-github',owner:{kind:'agent',agentId:'assistant'}});await assert.rejects(f.service.callback(),/pending/);f.active=true;assert.equal((await f.service.callback()).connected,true);await assert.rejects(f.service.callback(),/awaiting/);
});
test('native MCP transport requires its private capability and returns genuine tool errors',async t=>{
  const f=fixture(),server=createBridge({authorize:async()=>false},async()=>{throw Error('Unexpected relay');},0,{integrations:f.service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const url='http://127.0.0.1:'+server.address().port+'/mcp/composio';
  const rpc=async(method,params,token='private-mcp-token')=>fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal((await rpc('tools/list',{},'attacker')).status,401);assert.equal((await rpc('initialize',{protocolVersion:'2025-06-18'}).then(r=>r.json())).result.serverInfo.name,'Timewarp Composio');assert.equal((await rpc('tools/list',{}).then(r=>r.json())).result.tools.length,4);
  assert.equal((await rpc('tools/call',{name:'composio_execute',arguments:{assistantId:'assistant',connectedAccountId:'foreign',toolSlug:'GITHUB_GET_THE_AUTHENTICATED_USER'}}).then(r=>r.json())).result.isError,true);
});
test('mascots stay stable across restore and preserve uploaded assistant pictures',()=>{assert.deepEqual(avatar('assistant-uuid'),avatar('assistant-uuid'));assert.match(avatar('assistant-uuid').avatarUrl,/\/mascots\/(orbit|nova|cosmo)\.png$/);assert.equal(shouldAssign({avatarType:null}),true);assert.equal(shouldAssign({avatarType:'uploaded',avatarUrl:'https://example.invalid/user.png'}),false);});
