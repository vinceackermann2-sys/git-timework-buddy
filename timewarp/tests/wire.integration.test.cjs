"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const originalWire=require('../scripts/original-wire.cjs'),{createBridge}=require('../desktop/bridge.cjs');
test('the original decoder reads account queries, mutations, batches and local-route errors',async t=>{
  const transformer=originalWire(),auth={authorize:async token=>token==='cap',accountSession:async()=>({organizations:[{id:'personal'}]}),userId:()=> 'owner'};
  const server=createBridge(auth,async(_route,{rpc,input})=>{if(rpc==='product.profile.update')return Response.json({error:'Profile update denied.'},{status:403});assert.deepEqual(input,{});return Response.json([{id:'owner',roles:['owner']}]);},0);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/product/trpc/`,headers={authorization:'Bearer cap','content-type':'application/json'};
  const query=await fetch(base+'product.organizations.members?input='+encodeURIComponent(JSON.stringify(transformer.serialize({}))),{headers});assert.equal(transformer.deserialize((await query.json()).result.data)[0].id,'owner');
  const mutation=await fetch(base+'product.profile.update',{method:'POST',headers,body:JSON.stringify(transformer.serialize({}))});assert.equal(transformer.deserialize((await mutation.json()).error).data.code,'FORBIDDEN');
  const anonymous=await fetch(base+'product.organizations.members');assert.equal(transformer.deserialize((await anonymous.json()).error).data.code,'UNAUTHORIZED');
  const inputs={'0':transformer.serialize({}),'1':transformer.serialize({}),'2':transformer.serialize({})};
  const batch=await fetch(base+'product.organizations.members,product.organizations.list,product.vault.list?batch=1&input='+encodeURIComponent(JSON.stringify(inputs)),{headers});assert.equal(batch.status,207);
  const results=await batch.json();assert.equal(transformer.deserialize(results[0].result.data)[0].id,'owner');assert.equal(transformer.deserialize(results[1].result.data).organizations[0].id,'personal');assert.equal(transformer.deserialize(results[2].error).data.code,'FORBIDDEN');
  const local=await fetch(base+'product.conversations.changes.subscribe',{headers});assert.equal(local.status,410);assert.equal(transformer.deserialize((await local.json()).error).data.httpStatus,410);
});
