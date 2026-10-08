"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createAuth}=require('../desktop/auth.cjs');
const {createBridge}=require('../desktop/bridge.cjs');
test('cached native device tokens survive cloud JWT refresh and are revoked on sign-out',async t=>{
  let now=Date.now(),refreshes=0;
  let saved={session:{user:{id:'owner',email:'owner@example.test'},access_token:'cloud-old',refresh_token:'refresh-old',expires_at:Math.floor(now/1000)+3600},capability:'device-capability'};
  const auth=createAuth({config:{supabaseUrl:'https://auth.example.test',publishableKey:'public'},now:()=>now,storage:{load:()=>saved,save:(session,capability)=>{saved={session,capability}},saveFlow(){}},fetcher:async url=>{
    if(url.endsWith('/logout'))return Response.json({});
    assert.match(url,/grant_type=refresh_token/);refreshes++;
    return Response.json({user:{id:'owner',email:'owner@example.test'},access_token:'cloud-new',refresh_token:'refresh-new',expires_at:Math.floor(now/1000)+3600});
  }});
  await auth.init();
  const server=createBridge(auth,()=>assert.fail('No cloud operation expected'),0);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()});
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={authorization:'Bearer '+auth.capability()};
  const initial=await fetch(base+'/api/auth/token',{headers});const cached=(await initial.json()).token;
  assert.equal(cached,'device-capability');assert.notEqual(cached,'cloud-old');
  now+=3600*1000;
  const refreshed=await fetch(base+'/api/auth/electron/token',{headers:{authorization:'Bearer '+cached}});
  assert.equal(refreshed.status,200);assert.equal((await refreshed.json()).token,cached);assert.equal(refreshes,1);
  await auth.signOut();
  assert.equal((await fetch(base+'/api/auth/token',{headers:{authorization:'Bearer '+cached}})).status,401);
});
