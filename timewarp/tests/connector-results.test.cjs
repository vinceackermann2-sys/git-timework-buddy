"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createComposio}=require('../desktop/composio.cjs');
const http=require('node:http');
function fixture(account,result={successful:true}) {
  return createComposio({userId:()=> 'owner',storage:{load:()=>null,save(){}},getAgent:async id=>({id,ownerUserId:'owner'}),ensureCallback:async()=>{},mcpToken:'fixture-token',cloud:async(_route,input)=>{
    if(input.action==='list-apps')return {apps:[{toolkitSlug:'github',name:'GitHub',accounts:[{connectionId:'owned',...account}]}]};
    if(input.action==='execute')return result;
    throw Error('Unexpected action');
  }});
}
test('connector cards and executable access agree on explicit inactive and status-only accounts',async()=>{
  for(const [account,ready]of [[{active:false,status:'ACTIVE'},false],[{status:'ACTIVE'},true],[{active:true,status:'ACTIVE'},true],[{status:'INITIATED'},false]]) {
    const service=fixture(account);
    const card=(await service.list({agentId:'agent'})).items[0].accounts[0];
    assert.equal(card.authStatus,ready?'ready':'reauthorization_required');
    assert.equal((await service.connections('agent')).length,ready?1:0);
  }
});
test('provider-declared failures are MCP errors even when HTTP transport succeeds',async t=>{
  for(const result of [{successful:false,error:'Provider rejected the action'},{success:false,error:'Not saved'},{isError:true,error:'Tool failed'}]) {
    const service=fixture({active:true},result),server=http.createServer(service.mcp);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
    const response=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',headers:{authorization:'Bearer fixture-token','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'composio_execute',arguments:{assistantId:'agent',connectedAccountId:'owned',toolSlug:'GITHUB_TEST',arguments:{}}}})});
    const rpc=await response.json();assert.equal(rpc.result.isError,true);assert.deepEqual(JSON.parse(rpc.result.content[0].text),result);
  }
});
