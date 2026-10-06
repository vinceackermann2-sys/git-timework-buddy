"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createAuth}=require('../desktop/auth.cjs');const {callbackServer}=require('../desktop/oauth.cjs');
const config={supabaseUrl:'https://auth.example',publishableKey:'public'};
const session=(id='owner',expiry=Date.now()/1000+3600)=>({access_token:'jwt-'+id,refresh_token:'refresh-'+id,expires_at:expiry,user:{id,email:id+'@example.com'}});
function storage(initial=null){let value={session:initial,capability:'a'.repeat(64)},flow=null;return{load:()=>structuredClone(value),save:(session,capability)=>value=structuredClone({session,capability}),loadFlow:()=>structuredClone(flow),saveFlow:next=>flow=structuredClone(next),peek:()=>structuredClone(value),flow:()=>structuredClone(flow)};}
const response=value=>Promise.resolve(Response.json(value));
test('real session adapter persists a login, survives reopening, and rotates device capabilities across accounts and logout',async()=>{
  const disk=storage(),auth=createAuth({config,storage:disk,fetcher:(_url,options)=>response(session(JSON.parse(options.body||'{}').email?.split('@')[0]||'owner'))});await auth.init();
  await auth.signIn({email:'first@example.com',password:'private'});const first=auth.capability();assert.equal(auth.user().id,'first');
  const reopened=createAuth({config,storage:disk});await reopened.init();assert.equal(reopened.user().id,'first');assert.equal(reopened.capability(),first);
  await auth.signIn({email:'second@example.com',password:'private'});assert.notEqual(auth.capability(),first);assert.equal(await auth.authorize(first),false);
  const second=auth.capability();await auth.signOut();assert.equal(auth.user(),null);assert.equal(disk.peek().session,null);assert.equal(await auth.authorize(second),false);
});
test('wrong credentials and failed encrypted writes never create a signed-in session',async()=>{
  const disk=storage(),auth=createAuth({config,storage:disk,fetcher:async()=>Response.json({msg:'Invalid login credentials'},{status:400})});await auth.init();
  await assert.rejects(auth.signIn({email:'person@example.com',password:'wrong'}),/Invalid login/);assert.equal(auth.user(),null);
  const broken=storage(),other=createAuth({config,storage:broken,fetcher:()=>response(session())});await other.init();broken.save=()=>{throw Error('Disk failure');};
  await assert.rejects(other.signIn({email:'person@example.com',password:'correct'}),/Disk failure/);assert.equal(other.user(),null);
});
test('concurrent refreshes share one request and late refresh cannot restore a signed-out account',async()=>{
  let resolveRefresh,calls=0;const disk=storage(session('owner',Date.now()/1000-1));
  const auth=createAuth({config,storage:disk,fetcher:async url=>{if(url.includes('refresh_token')){calls++;return new Promise(resolve=>resolveRefresh=resolve);}return Response.json({});}});await auth.init();
  const one=auth.accessToken(),two=auth.accessToken();await auth.signOut();resolveRefresh(Response.json(session()));
  const results=await Promise.allSettled([one,two]);assert.equal(calls,1);assert.ok(results.every(result=>result.status==='rejected'));assert.equal(auth.user(),null);assert.equal(disk.peek().session,null);
});
test('a delayed password sign-in is cancelled by sign-out',async()=>{
  let release;const auth=createAuth({config,storage:storage(),fetcher:()=>new Promise(resolve=>release=resolve)});await auth.init();
  const attempt=auth.signIn({email:'owner@example.com',password:'correct'});await auth.signOut();release(Response.json(session()));await assert.rejects(attempt,/cancelled/);assert.equal(auth.user(),null);
});
test('token refresh does not re-enter the native account bridge through its sign-in hook',async()=>{
  const disk=storage(session('owner',Date.now()/1000-1));let notifications=0;
  const auth=createAuth({config,storage:disk,fetcher:()=>response(session()),onChange:async()=>{notifications++;await auth.accessToken();}});await auth.init();
  await Promise.race([auth.accessToken(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Refresh deadlocked')),1000);timer.unref();})]);
  assert.equal(notifications,0);assert.equal(await auth.authorize(auth.capability()),true);
});
test('refresh failure clears revoked sessions while temporary outages preserve encrypted credentials',async()=>{
  for(const status of [400,503]){const disk=storage(session('owner',Date.now()/1000-1)),auth=createAuth({config,storage:disk,fetcher:async()=>Response.json({msg:'Unavailable'},{status})});await auth.init();await assert.rejects(auth.accessToken());assert.equal(!!disk.peek().session,status===503);}
});
test('signup stays pending until confirmation, validates consent, and rejects malformed OTP',async()=>{
  let calls=0;const auth=createAuth({config,storage:storage(),fetcher:async url=>{calls++;if(url.includes('/verify'))return Response.json({msg:'Token is invalid'},{status:403});return Response.json({user:{id:'pending'}});}});await auth.init();
  await assert.rejects(auth.signUp({email:'owner@example.com',password:'LongPassword'}),/Privacy/);
  assert.deepEqual(await auth.signUp({email:'owner@example.com',password:'LongPassword',privacyAccepted:true}),{confirmationRequired:true});assert.equal(auth.user(),null);
  await assert.rejects(auth.verifyOtp('owner@example.com','anything'),/code/);assert.equal(calls,1);await assert.rejects(auth.verifyOtp('owner@example.com','123456'),/invalid/);assert.equal(auth.user(),null);
});
test('OAuth uses PKCE, restores the pending verifier after restart, and rejects replay',async()=>{
  const disk=storage();let payload;const auth=createAuth({config,storage:disk,fetcher:()=>response(session())});await auth.init();
  const target=new URL(await auth.beginOAuth('google'));assert.equal(target.searchParams.get('redirect_to'),'http://127.0.0.1:17654/oauth-callback');assert.equal(target.searchParams.get('code_challenge_method'),'s256');
  const verifier=disk.flow().verifier;assert.equal(target.searchParams.get('code_challenge'),crypto.createHash('sha256').update(verifier).digest('base64url'));assert.ok(!target.href.includes(verifier));
  const reopened=createAuth({config,storage:disk,fetcher:async(_url,options)=>{payload=JSON.parse(options.body);return Response.json(session());}});await reopened.init();await reopened.completeOAuth('valid-code');assert.equal(payload.code_verifier,verifier);assert.equal(disk.flow(),null);await assert.rejects(reopened.completeOAuth('valid-code'),/again/);
});
test('the shipped Google configuration uses the branded domain and device-bound handoff',async()=>{
  const shipped=require('../config.json'),auth=createAuth({config:shipped,storage:storage()});await auth.init();
  const target=new URL(await auth.beginOAuth('google'));
  assert.equal(target.origin,'https://timewarpdev.com');assert.equal(target.pathname,'/auth/google');assert.equal(target.searchParams.get('target'),'energy-desktop');assert.match(target.searchParams.get('desktop_state'),/^[a-f0-9]{64}$/);assert.match(target.searchParams.get('desktop_key'),/^[A-Za-z0-9_-]{100,256}$/);assert.match(target.searchParams.get('desktop_nonce'),/^[a-f0-9]{64}$/);
});
test('a rejected email code leaves the pending email link usable',async()=>{
  const disk=storage();const auth=createAuth({config,storage:disk,fetcher:async url=>url.endsWith('/verify')?Response.json({msg:'Token is invalid'},{status:403}):Response.json(session())});await auth.init();
  await auth.sendOtp('owner@example.com');const pending=disk.flow();
  await assert.rejects(auth.verifyOtp('owner@example.com','000000'),/invalid/);
  assert.deepEqual(disk.flow(),pending);assert.equal(auth.user(),null);
  await auth.completeOAuth('valid-email-link');assert.equal(auth.userId(),'owner');assert.equal(disk.flow(),null);
});
test('a cancelled code verification cannot clear a newer Google sign-in attempt',async()=>{
  let release;const disk=storage(),auth=createAuth({config,storage:disk,fetcher:()=>new Promise(resolve=>release=resolve)});await auth.init();
  const verification=auth.verifyOtp('owner@example.com','123456');
  await auth.beginOAuth('google');const next=disk.flow();release(Response.json(session()));
  await assert.rejects(verification,/cancelled/);assert.deepEqual(disk.flow(),next);assert.equal(auth.user(),null);
});
test('copied email codes accept grouping while preserving leading zeroes',async()=>{
  let payload;const auth=createAuth({config,storage:storage(),fetcher:async(_url,options)=>{payload=JSON.parse(options.body);return Response.json(session());}});await auth.init();
  await auth.verifyOtp('owner@example.com',' 01234-56789\n');assert.equal(payload.token,'0123456789');assert.equal(payload.type,'email');
  await assert.rejects(auth.verifyOtp('owner@example.com','01234x56789'),/code/);
});
test('recovery state survives restart and clears only after a successful password update',async()=>{
  const disk=storage(),auth=createAuth({config,storage:disk,fetcher:()=>response(session())});await auth.init();await auth.verifyOtp('owner@example.com','123456','recovery');assert.equal(auth.passwordRecovery(),true);
  const reopened=createAuth({config,storage:disk,fetcher:()=>response({id:'owner',email:'owner@example.com'})});await reopened.init();assert.equal(reopened.passwordRecovery(),true);await reopened.updatePassword('NewPassword123');assert.equal(reopened.passwordRecovery(),false);
});
test('OAuth loopback callback enforces host, method and one-use completion',async t=>{
  let calls=0;const server=callbackServer(async code=>{assert.equal(code,'test');calls++;if(calls>1)throw Error('Consumed');return{};},async()=>{},0);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const address=`http://127.0.0.1:${server.address().port}/oauth-callback?code=test`;
  const badHost=await new Promise((resolve,reject)=>{require('node:http').get(address,{headers:{host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});
  assert.equal(badHost,403);
  assert.equal((await fetch(address,{method:'POST'})).status,404);assert.equal(calls,0);
  const success=await fetch(address);assert.equal(success.status,200);
  const page=await success.text();assert.match(page,/class="timewarp-auth-page"/);assert.match(page,/You’re signed in/);assert.ok(!page.includes('code=test'));
  assert.equal(success.headers.get('cache-control'),'no-store');assert.equal(success.headers.get('referrer-policy'),'no-referrer');
  assert.match(success.headers.get('content-security-policy'),/img-src 'self'/);assert.match(success.headers.get('content-security-policy'),/style-src 'self'/);
  const origin=new URL(address).origin;
  const logo=await fetch(origin+'/timewarp-logo.svg');assert.equal(logo.headers.get('content-type'),'image/svg+xml');assert.equal(await logo.text(),require('node:fs').readFileSync(require('node:path').join(__dirname,'../assets/timewarp-logo.svg'),'utf8'));
  const styles=await fetch(origin+'/timewarp-auth.css');assert.match(styles.headers.get('content-type'),/text\/css/);assert.equal(await styles.text(),require('node:fs').readFileSync(require('node:path').join(__dirname,'../assets/auth-bridge.css'),'utf8'));assert.equal(calls,1);
  const replay=await fetch(address);assert.equal(replay.status,400);assert.match(await replay.text(),/role="alert"/);assert.equal(calls,2);
});

test('auth pages escape their copy and connector callbacks share the branded return screen',async t=>{
  const {authPage}=require('../desktop/auth-page.cjs');
  const html=authPage({title:'<script>bad</script>',message:'A & "B"'});assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/A &amp; &quot;B&quot;/);
  let connected=0,focused=0;
  const server=callbackServer(()=>assert.fail('connector approval must not sign in'),async()=>{focused++;},0,async()=>{connected++;});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const reply=await fetch(`http://127.0.0.1:${server.address().port}/connector-callback?code=private-approval`);
  assert.equal(reply.status,200);const body=await reply.text();assert.match(body,/Your app is connected/);assert.match(body,/timewarp-auth-page/);assert.ok(!body.includes('private-approval'));assert.equal(connected,1);assert.equal(focused,1);
});
