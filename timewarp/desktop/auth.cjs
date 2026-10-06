"use strict";
const crypto=require('node:crypto');
const {createGoogleFlow,googleStartUrl,decryptGoogleHandoff}=require('../shared/google-oauth.cjs');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const email=value=>{const result=String(value||'').trim();if(result.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))throw fail(400,'Enter a valid email address.');return result;};
function googleBridgeOrigin(config){
  if(!config.googleAuthBridgeUrl)return null;
  const url=new URL(config.googleAuthBridgeUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw fail(500,'The Google sign-in bridge must use an HTTPS origin.');
  return url.origin;
}
function createAuth({config,storage,fetcher=fetch,now=Date.now,onChange=async()=>{}}) {
  const bridgeOrigin=googleBridgeOrigin(config);
  let session=null,capability=null,generation=0,refreshing=null,pending=null,completing=null;
  const user=()=>session?.user?{id:session.user.id,email:session.user.email,name:session.user.user_metadata?.full_name||session.user.email?.split('@')[0]||'Timewarp user'}:null;
  async function request(route,payload,{method='POST',token}={}) {
    const response=await fetcher(`${config.supabaseUrl}/auth/v1/${route}`,{method,headers:{apikey:config.publishableKey,'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(30000),redirect:'error'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(fail(response.status,data.msg||data.error_description||data.message||'Authentication failed.'),{code:data.error_code||data.code});
    return data;
  }
  function validate(value) {
    if(!value?.access_token||!value?.refresh_token||!value.user?.id)throw fail(502,'The authentication service returned an invalid session.');
    const expires_at=Number(value.expires_at)||Math.floor(now()/1000)+Number(value.expires_in);
    if(!Number.isFinite(expires_at)||expires_at<=now()/1000)throw fail(502,'The authentication service returned an expired session.');
    return {...value,expires_at};
  }
  async function commit(value,expected=generation,notify=true) {
    if(expected!==generation)throw fail(401,'This sign-in was cancelled.');
    const next=validate(value),changed=session?.user?.id!==next.user.id;
    const token=changed?crypto.randomBytes(32).toString('hex'):capability;
    storage.save(next,token);session=next;capability=token;
    if(notify)await onChange({signedIn:true,changedUser:changed});return {user:user()};
  }
  function newAttempt(){generation++;refreshing=null;return generation;}
  function flow(purpose,loginGeneration,bridge=null) {
    const verifier=crypto.randomBytes(48).toString('base64url');
    pending={verifier,purpose,generation:loginGeneration,expires:now()+(bridge?600000:86400000),...(bridge?{bridgeOrigin:bridge}:{})};storage.saveFlow(pending);
    return {code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256'};
  }
  const redirect=route=>`${route}?redirect_to=${encodeURIComponent('http://127.0.0.1:17654/oauth-callback')}`;
  async function init() {
    const saved=storage.load();session=saved.session;capability=saved.capability||crypto.randomBytes(32).toString('hex');
    pending=storage.loadFlow?.()||null;
    if(pending?.expires<now())pending=null;
    if(pending)generation=Number(pending.generation)||0;
    if(session){try{session=validate(session);}catch{if(!session?.refresh_token)session=null;}}
    storage.save(session,capability);
  }
  async function accessToken() {
    if(!session)throw fail(401,'Sign in to Timewarp.');
    if(Number(session.expires_at)>now()/1000+120)return session.access_token;
    if(!refreshing){const expected=generation,refreshToken=session.refresh_token;
      // The native account fetches its session through this bridge. Calling its
      // refresh hook from inside token refresh would wait on this very promise.
      const operation=(async()=>{try{await commit(await request('token?grant_type=refresh_token',{refresh_token:refreshToken}),expected,false);}catch(error){if(expected===generation&&[400,401].includes(error.status)){session=null;capability=crypto.randomBytes(32).toString('hex');storage.save(null,capability);void Promise.resolve(onChange({signedIn:false,changedUser:true})).catch(()=>{});}throw error;}})();
      refreshing=operation;operation.finally(()=>{if(refreshing===operation)refreshing=null;}).catch(()=>{});
    }
    await refreshing;if(!session)throw fail(401,'Sign in to Timewarp.');return session.access_token;
  }
  async function signOut() {
    newAttempt();const token=session?.access_token;session=null;pending=null;capability=crypto.randomBytes(32).toString('hex');
    storage.save(null,capability);storage.saveFlow(null);await onChange({signedIn:false,changedUser:true});
    if(token)await request('logout',undefined,{token}).catch(()=>{});return {signedOut:true};
  }
  return {
    init,accessToken,signOut,userId:()=>user()?.id,user,capability:()=>capability,expiresAt:()=>session?.expires_at,hasPendingFlow:()=>!!pending,passwordRecovery:()=>!!session?._timewarpRecovery,
    async authorize(token){const a=Buffer.from(token||''),b=Buffer.from(capability||'');if(capability&&a.length===b.length&&crypto.timingSafeEqual(a,b)){try{await accessToken();return true;}catch{return false;}}return !!session&&token===session.access_token&&session.expires_at>now()/1000;},
    async signIn(input){const expected=newAttempt();const result=await request('token?grant_type=password',{email:email(input.email),password:String(input.password||'')});const value=await commit(result,expected);pending=null;storage.saveFlow(null);return value;},
    async signUp(input){const expected=newAttempt(),password=String(input.password||'');if(password.length<8)throw fail(400,'Use a password with at least 8 characters.');if(input.privacyAccepted!==true)throw fail(400,'Read and accept the Privacy Policy to create an account.');const result=await request(redirect('signup'),{email:email(input.email),password,data:{full_name:String(input.name||'').trim().slice(0,120),privacy_policy_version:'2026-07-14',privacy_consent_at:new Date(now()).toISOString()},...flow('signup',expected)});if(result.access_token)return commit(result,expected);return {confirmationRequired:true};},
    async sendOtp(address){const expected=newAttempt();await request(redirect('otp'),{email:email(address),create_user:false,...flow('email',expected)});return {sent:true};},
    async resendConfirmation(address){await request(redirect('resend'),{type:'signup',email:email(address)});return {sent:true};},
    async sendRecovery(address){const expected=newAttempt();await request(redirect('recover'),{email:email(address),...flow('recovery',expected)});return {sent:true};},
    async verifyOtp(address,code,type='email'){
      const token=String(code||'').replace(/[\s-]/g,'');
      if(!['email','recovery'].includes(type)||!/^\d{6,10}$/.test(token))throw fail(400,'Enter the code from your email.');
      const expected=generation,current=pending;
      const value=await request('verify',{email:email(address),token,type});
      if(expected!==generation)throw fail(401,'This sign-in was cancelled.');
      validate(value);
      // Invalid codes must leave the pending link usable. Only a successful
      // verification cancels other in-flight sign-ins and consumes this flow.
      const verified=newAttempt();
      const result=await commit({...value,_timewarpRecovery:type==='recovery'},verified);
      if(generation===verified&&pending===current){pending=null;storage.saveFlow(null);}
      return result;
    },
    async completeOAuth(code){
      if(!pending||pending.expires<=now()||pending.generation!==generation)throw fail(400,'Start sign-in again from Timewarp.');
      if(completing===pending)throw fail(400,'This sign-in is already being completed.');
      if(typeof code!=='string'||code.length>(pending.purpose==='google-bridge'?32768:4096))throw fail(400,'Invalid sign-in code.');
      const current=pending;completing=current;let result;
      try{
      if(current.purpose==='google-bridge'){
        if(current.bridgeOrigin!==bridgeOrigin)throw fail(400,'Start Google sign-in again from Timewarp.');
        const idToken=decryptGoogleHandoff(code,current.google);
        result=await request('token?grant_type=id_token',{provider:'google',id_token:idToken,nonce:current.google.nonce});
      }else result=await request('token?grant_type=pkce',{auth_code:code,code_verifier:current.verifier});
      await commit({...result,_timewarpRecovery:current.purpose==='recovery'},current.generation);
      if(pending===current){pending=null;storage.saveFlow(null);}
      return {user:user(),passwordRecovery:current.purpose==='recovery'};
      }finally{if(completing===current)completing=null;}
    },
    async beginOAuth(provider){
      if(provider!=='google')throw fail(400,'This sign-in provider is unavailable.');
      const expected=newAttempt();
      if(bridgeOrigin){pending={purpose:'google-bridge',generation:expected,expires:now()+600000,bridgeOrigin,google:createGoogleFlow()};storage.saveFlow(pending);return googleStartUrl(bridgeOrigin,pending.google);}
      const challenge=flow('oauth',expected);
      const target=new URL(config.supabaseUrl+'/auth/v1/authorize');
      const query={provider,redirect_to:'http://127.0.0.1:17654/oauth-callback',...challenge};
      for(const [key,value]of Object.entries(query))target.searchParams.set(key,value);
      return target.href;
    },
    async updatePassword(password){if(String(password).length<8)throw fail(400,'Use a password with at least 8 characters.');const expected=generation;const data=await request('user',{password},{method:'PUT',token:await accessToken()});if(expected!==generation)throw fail(401,'Sign in again.');if(data.id!==session?.user.id)throw fail(502,'Invalid account response.');const next={...session,user:data,_timewarpRecovery:false};storage.save(next,capability);session=next;return {updated:true};},
    async providers(){const value=await request('settings',undefined,{method:'GET'});return {google:!!value.external?.google,email:!!value.external?.email,signup:!value.disable_signup};},
    async refreshUser(){const expected=generation,data=await request('user',undefined,{method:'GET',token:await accessToken()});if(expected!==generation||data.id!==session?.user.id)throw fail(401,'Sign in again.');const next={...session,user:data};storage.save(next,capability);session=next;return user();},
  };
}
module.exports={createAuth,email,googleBridgeOrigin};
