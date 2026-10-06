"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createAuth}=require('../desktop/auth.cjs');
const {createGoogleFlow,decryptGoogleHandoff}=require('../shared/google-oauth.cjs');
const config={supabaseUrl:'https://auth.example',publishableKey:'public',googleAuthBridgeUrl:'https://timewarpdev.com'};
const session={access_token:'verified-access',refresh_token:'verified-refresh',expires_in:3600,user:{id:'existing-owner',email:'owner@example.com'}};
function storage(){let value={session:null,capability:null},flow=null;return{load:()=>structuredClone(value),save:(session,capability)=>value=structuredClone({session,capability}),loadFlow:()=>structuredClone(flow),saveFlow:next=>flow=structuredClone(next),flow:()=>structuredClone(flow)};}
async function browserHandoff(flow,idToken='signed-google-identity'){
  const web=crypto.webcrypto,context=new TextEncoder().encode('timewarp-google-desktop-v1');
  const peer=await web.subtle.importKey('spki',Buffer.from(flow.publicKey,'base64url'),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const keys=await web.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const secret=await web.subtle.deriveBits({name:'ECDH',public:peer},keys.privateKey,256);
  const material=await web.subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);
  const key=await web.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode(flow.state),info:context},material,{name:'AES-GCM',length:256},false,['encrypt']);
  const iv=crypto.randomBytes(12),data=await web.subtle.encrypt({name:'AES-GCM',iv,additionalData:context},key,new TextEncoder().encode(JSON.stringify({state:flow.state,idToken})));
  return 'twgi_'+Buffer.from(JSON.stringify({version:1,key:Buffer.from(await web.subtle.exportKey('spki',keys.publicKey)).toString('base64url'),iv:iv.toString('base64url'),data:Buffer.from(data).toString('base64url')})).toString('base64url');
}
test('branded Google flow restores after restart and exchanges a nonce-bound identity for the existing account',async()=>{
  const disk=storage(),auth=createAuth({config,storage:disk});await auth.init();
  const start=new URL(await auth.beginOAuth('google')),pending=disk.flow();
  assert.equal(start.origin,'https://timewarpdev.com');assert.equal(start.pathname,'/auth/google');assert.equal(start.searchParams.get('target'),'energy-desktop');
  assert.equal(start.searchParams.get('desktop_nonce'),crypto.createHash('sha256').update(pending.google.nonce).digest('hex'));
  assert.ok(!start.href.includes(pending.google.nonce));assert.ok(!start.href.includes(pending.google.privateKey));
  let calls=0;
  const reopened=createAuth({config,storage:disk,fetcher:async(url,options)=>{calls++;assert.equal(url,'https://auth.example/auth/v1/token?grant_type=id_token');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{provider:'google',id_token:'signed-google-identity',nonce:pending.google.nonce});return Response.json(session);}});
  await reopened.init();const code=await browserHandoff(pending.google);await reopened.completeOAuth(code);
  assert.equal(reopened.userId(),'existing-owner');assert.equal(disk.flow(),null);await assert.rejects(reopened.completeOAuth(code),/again/);assert.equal(calls,1);
});
test('encrypted identity handoffs reject tampering, foreign devices and expired attempts before transport',async()=>{
  const flow=createGoogleFlow(),code=await browserHandoff(flow);
  assert.equal(decryptGoogleHandoff(code,flow),'signed-google-identity');
  assert.throws(()=>decryptGoogleHandoff(code,createGoogleFlow()),/verified/);
  const envelope=JSON.parse(Buffer.from(code.slice(5),'base64url').toString()),data=Buffer.from(envelope.data,'base64url');data[0]^=1;envelope.data=data.toString('base64url');
  assert.throws(()=>decryptGoogleHandoff('twgi_'+Buffer.from(JSON.stringify(envelope)).toString('base64url'),flow),/verified/);
  let at=Date.now(),calls=0;const disk=storage(),auth=createAuth({config,storage:disk,now:()=>at,fetcher:async()=>{calls++;return Response.json(session);}});await auth.init();await auth.beginOAuth('google');const pending=disk.flow();at=pending.expires;
  await assert.rejects(auth.completeOAuth(await browserHandoff(pending.google)),/again/);assert.equal(calls,0);
});
test('concurrent and late Google callbacks cannot replay a handoff or erase a newer attempt',async()=>{
  let release,calls=0;const disk=storage(),auth=createAuth({config,storage:disk,fetcher:()=>{calls++;return new Promise(resolve=>release=resolve);}});await auth.init();await auth.beginOAuth('google');const code=await browserHandoff(disk.flow().google);
  const first=auth.completeOAuth(code);await assert.rejects(auth.completeOAuth(code),/already/);assert.equal(calls,1);
  await auth.beginOAuth('google');const next=disk.flow();release(Response.json(session));await assert.rejects(first,/cancelled/);assert.deepEqual(disk.flow(),next);assert.equal(auth.user(),null);
});
test('bridge configuration rejects insecure or credential-bearing endpoints',()=>{
  for(const googleAuthBridgeUrl of ['http://timewarpdev.com','https://user:password@timewarpdev.com','https://timewarpdev.com/arbitrary','https://timewarpdev.com?redirect=evil'])assert.throws(()=>createAuth({config:{...config,googleAuthBridgeUrl},storage:storage()}),/HTTPS/);
});
