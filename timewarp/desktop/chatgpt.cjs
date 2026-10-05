"use strict";
// Codex owns OAuth, credential storage and refresh. Timewarp keeps safe metadata.
const fail=(status,message)=>Object.assign(Error(message),{status});
const safeError=error=>String(error?.rpcMessage||error?.message||error||'Codex connection failed.').replace(/https?:\/\/\S+/g,'[provider link]').replace(/\beyJ[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,500);
function createChatgpt({storage,userId,onConnected=()=>{},onLoginError=()=>{},now=Date.now}){
  let metadata={},metadataLoaded=false,client,rawRequest,loadedOwner=null,account=null,rateLimits=null,lastRead=0,reading=null,generation=0;
  let login={status:'idle'},loginOwner=null,loginTimer=null;
  const activeTurns=new Map();
  const verificationThreads=new Map();
  // Electron's OS keyring is available after app readiness. Load the encrypted
  // binding on first authenticated use, not during bootstrap module loading.
  const loadMetadata=()=>{if(!metadataLoaded){metadata=storage.load()||{};metadataLoaded=true;}};
  const owner=()=>{const value=userId();if(!value)throw fail(401,'Sign in to Timewarp.');loadMetadata();return value;};
  const bound=()=>{if(!userId())return false;loadMetadata();return metadata.owner===userId();};
  const selected=()=>bound()&&metadata.selected===true;
  const persist=()=>storage.save(metadata);
  const assertOwner=(value,epoch)=>{if(value!==userId()||epoch!==generation)throw fail(401,'The active Timewarp account changed.');};
  async function rpc(method,params){if(!client)throw fail(503,'Codex is starting. Retry shortly.');await client.start();let timer;try{return await Promise.race([rawRequest(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(504,'Codex account request timed out. Retry in Billing.')),20000);timer.unref?.();})]);}finally{clearTimeout(timer);}}
  function bindClient(value){
    if(client)throw Error('Codex client is already bound.');client=value;rawRequest=value.request.bind(value);
    client.on('notification',event=>void notification(event).catch(()=>{}));
    client.on('status',state=>{if(['stopped','failed'].includes(state.status)){lastRead=0;account=null;activeTurns.clear();}});
    return client;
  }
  async function refresh(force=false){
    const who=owner(),epoch=generation;
    if(!force&&loadedOwner===who&&lastRead&&now()-lastRead<15000)return details();
    if(reading){await reading;assertOwner(who,epoch);if(loadedOwner===who&&lastRead&&!force)return details();}
    const operation=(async()=>{
      await rpc('account/read',{refreshToken:false});assertOwner(who,epoch);
      // This private Codex home has one account. Do not adopt a personal CLI
      // login or reuse another Timewarp owner's account.
      if(metadata.owner!==who){await rpc('account/logout',{});assertOwner(who,epoch);account=null;}
      const result=await rpc('account/read',{refreshToken:false});assertOwner(who,epoch);
      account=selected()&&result.account?.type==='chatgpt'?result.account:null;
      loadedOwner=who;lastRead=now();
      if(account){
        try{const limits=await rpc('account/rateLimits/read',{});assertOwner(who,epoch);rateLimits=limits.rateLimitsByLimitId?.codex||limits.rateLimits||null;}catch(error){assertOwner(who,epoch);rateLimits=null;}
      }else rateLimits=null;
      return details();
    })();reading=operation;
    try{return await operation;}finally{if(reading===operation)reading=null;}
  }
  function connection(){return {status:selected()?(loadedOwner===userId()&&account?'available':'reauth_required'):'disconnected',account:selected()&&loadedOwner===userId()&&account?{email:account.email||null,planType:account.planType||null}:null};}
  function canUse(){return connection().status==='available';}
  function details(){const state=connection();return {...state,accounts:bound()&&metadata.selected?[{id:'codex',email:state.account?.email||null,selected:true}]:[],backend:'codex-app-server',planUsageDisabled:false,usage:bound()?metadata.usage||null:null,lastCompletedAt:bound()?metadata.lastCompletedAt||null:null,lastConnectionError:bound()?metadata.lastConnectionError||null:null,lastRequestError:bound()?metadata.lastRequestError||null:null,rateLimits:state.account?rateLimits:null,usageUrl:'https://chatgpt.com/codex/settings/usage'};}
  function currentBrowserLogin(){return loginOwner===userId()?{status:login.status,...login.error?{error:login.error,diagnostic:{message:login.error,stage:'codex_login'}}:{}}:{status:'idle'};}
  async function startBrowserLogin({newAccount=false}={}){
    const who=owner(),epoch=generation;await refresh();assertOwner(who,epoch);await cancelLogin();assertOwner(who,epoch);
    if(newAccount||account){await rpc('account/logout',{});assertOwner(who,epoch);account=null;}
    metadata={...metadata.owner===who?metadata:{},owner:who,selected:true,lastConnectionError:null};persist();
    loadedOwner=who;lastRead=0;loginOwner=who;
    try{
      const result=await rpc('account/login/start',{type:'chatgpt',useHostedLoginSuccessPage:true,appBrand:'chatgpt'});
      if(who!==userId()||epoch!==generation){if(result.loginId)await rpc('account/login/cancel',{loginId:result.loginId}).catch(()=>{});assertOwner(who,epoch);}
      const url=new URL(result.authUrl);
      if(url.protocol!=='https:'||url.hostname!=='auth.openai.com'||url.username||url.password||!result.loginId)throw fail(502,'Codex returned an invalid account approval link.');
      login={status:'waiting_for_user',id:result.loginId};
      clearTimeout(loginTimer);loginTimer=setTimeout(()=>void cancelLogin().catch(()=>{}),10*60*1000);loginTimer.unref?.();
      return {status:login.status,authUrl:url.href};
    }catch(error){assertOwner(who,epoch);login={status:'error',error:safeError(error)};metadata.lastConnectionError={message:login.error,stage:'codex_login'};persist();throw error;}
  }
  async function cancelLogin(){clearTimeout(loginTimer);const id=login.id;login={status:'idle'};loginOwner=null;if(id)await rpc('account/login/cancel',{loginId:id});return {cancelled:true};}
  async function disconnect(){const who=owner(),epoch=generation;await cancelLogin();assertOwner(who,epoch);await interruptActive();await rpc('account/logout',{});assertOwner(who,epoch);metadata={owner:who,selected:false};persist();account=null;rateLimits=null;lastRead=0;return {remoteRevoked:true};}
  async function models(){
    const who=owner(),epoch=generation;await refresh();assertOwner(who,epoch);
    if(!canUse())throw fail(401,'Connect your ChatGPT / Codex account in Billing to supply AI usage.');
    const result=await rpc('model/list',{limit:100,includeHidden:false});assertOwner(who,epoch);
    const choices=(result.data||[]).filter(item=>!item.hidden).map(item=>({id:item.model||item.id,displayName:item.displayName||item.model||item.id,description:item.description||'Uses your Codex allowance',inputModalities:item.inputModalities||['text'],supportedReasoningEfforts:item.supportedReasoningEfforts||[{reasoningEffort:'low',description:'Fast'}],defaultReasoningEffort:item.defaultReasoningEffort||'low',featured:item.isDefault===true,serviceTiers:[{value:null,label:'Standard',description:'Uses your ChatGPT / Codex allowance'}],defaultServiceTier:null}));
    if(!choices.length)throw fail(503,'Codex did not return available models. Retry in Billing.');
    if(metadata.lastConnectionError?.stage==='codex_account'){metadata.lastConnectionError=null;persist();}return choices;
  }
  async function notification(event){
    const params=event.params||{};
    if(event.method==='account/login/completed'&&login.id&&params.loginId===login.id&&loginOwner===userId()){
      const who=userId(),epoch=generation;clearTimeout(loginTimer);
      if(!params.success){login={status:'error',error:safeError(params.error||'Codex authorization could not be completed.')};metadata.lastConnectionError={message:login.error,stage:'codex_login'};persist();await Promise.resolve(onLoginError()).catch(()=>{});return;}
      login={status:'idle'};lastRead=0;
      try{await refresh(true);assertOwner(who,epoch);if(!canUse())throw fail(401,'Codex did not confirm a ChatGPT account.');metadata.lastConnectionError=null;persist();await onConnected();}
      catch(error){if(who===userId()&&epoch===generation){login={status:'error',error:safeError(error)};metadata.lastConnectionError={message:login.error,stage:'codex_account'};persist();await Promise.resolve(onLoginError()).catch(()=>{});}}
    }
    if(event.method==='account/updated')lastRead=0;
    if(event.method==='account/rateLimits/updated'&&loadedOwner===userId())rateLimits=params.rateLimitsByLimitId?.codex||params.rateLimits||rateLimits;
    const tracking=activeTurns.get(params.threadId);if(!tracking||tracking.owner!==userId()||tracking.generation!==generation)return;
    if(event.method==='turn/started')tracking.turnId=params.turn.id;
    if(event.method==='thread/tokenUsage/updated')tracking.tokens=params.tokenUsage?.last||null;
    if(event.method==='turn/completed'){
      activeTurns.delete(params.threadId);
      if(params.turn?.status==='completed'){
        metadata.lastCompletedAt=new Date(now()).toISOString();metadata.lastRequestError=null;
        const usage=metadata.usage||{since:metadata.lastCompletedAt,requests:0,inputTokens:0,outputTokens:0};usage.requests++;usage.inputTokens+=tracking.tokens?.inputTokens||0;usage.outputTokens+=tracking.tokens?.outputTokens||0;metadata.usage=usage;persist();
      }else{metadata.lastRequestError={message:safeError(params.turn?.error||'Codex ended the request with '+params.turn?.status)};persist();}
    }
  }
  function trackTurn(threadId,turnId,who){if(who!==userId())return;activeTurns.set(threadId,{owner:who,generation,turnId,tokens:null});}
  function usage(){const state=connection();if(state.status==='disconnected')return {plans:[{id:'codex',type:'chatgpt',name:'ChatGPT / Codex',status:'disconnected',limits:[]}]};const limits=[];if(state.status==='available')for(const [id,label]of [['primary','Primary Codex allowance'],['secondary','Secondary Codex allowance']]){const limit=rateLimits?.[id];if(limit&&Number.isFinite(limit.usedPercent))limits.push({id:'codex/'+id,label,remainingPercent:Math.min(100,Math.max(0,100-limit.usedPercent)),resetsAt:Number.isFinite(limit.resetsAt)?new Date(limit.resetsAt*1000).toISOString():null});}return {plans:[{id:'codex',type:'chatgpt',name:'ChatGPT / Codex'+(state.account?.planType?' · '+state.account.planType:''),status:state.status==='available'?'available':'reconnect_required',limits}]};}
  function failTurn(threadId,error){const tracking=activeTurns.get(threadId);activeTurns.delete(threadId);if(tracking?.owner===userId()&&selected()){metadata.lastRequestError={message:safeError(error)};persist();}}
  async function interruptActive(){const turns=[...activeTurns];activeTurns.clear();await Promise.allSettled(turns.filter(([,value])=>value.turnId).map(([threadId,value])=>rpc('turn/interrupt',{threadId,turnId:value.turnId})));}
  function stop(){generation++;loadedOwner=null;account=null;lastRead=0;void cancelLogin().catch(()=>{});void interruptActive();}
  function isVerificationThread(id){const binding=verificationThreads.get(id);return !!binding&&binding.owner===userId()&&binding.generation===generation;}
  async function verifyAccess(){
    const who=owner(),epoch=generation,choices=await models();assertOwner(who,epoch);
    const model=choices.find(item=>item.featured)||choices[0];
    const result=await client.request('thread/start',{_timewarpSubscriptionOnly:true,model:model.id,modelProvider:'openai',ephemeral:true,approvalPolicy:'never',sandbox:'read-only',developerInstructions:'Reply with OK only. Do not use tools, browse, read files or run commands.',dynamicTools:[],config:{web_search:'disabled','features.image_generation':false,'skills.include_instructions':false}});assertOwner(who,epoch);
    const threadId=result.thread.id;
    verificationThreads.set(threadId,{owner:who,generation:epoch});
    let finish,timer,turnId=null;const completed=new Promise((resolve,reject)=>{finish=event=>{if(event.method==='turn/completed'&&event.params.threadId===threadId){clearTimeout(timer);event.params.turn.status==='completed'?resolve():reject(fail(502,safeError(event.params.turn.error||'Codex request did not complete.')));}};client.on('notification',finish);timer=setTimeout(()=>reject(fail(504,'Codex connection test timed out.')),90000);timer.unref?.();});
    // A small turn may complete before the turn/start RPC response arrives.
    try{const started=await Promise.race([client.request('turn/start',{_timewarpSubscriptionOnly:true,threadId,input:[{type:'text',text:'Reply with OK only.',text_elements:[]}],model:model.id,effort:model.defaultReasoningEffort}),completed.then(()=>null)]);turnId=started?.turn.id;await completed;assertOwner(who,epoch);return {completed:true,fundingSource:'chatgpt'};}
    finally{clearTimeout(timer);client.off('notification',finish);turnId=turnId||activeTurns.get(threadId)?.turnId;if(turnId)await rpc('turn/interrupt',{threadId,turnId}).catch(()=>{});activeTurns.delete(threadId);verificationThreads.delete(threadId);await rpc('thread/unsubscribe',{threadId}).catch(()=>{});}
  }
  return {bindClient,refresh,connection,canUse,details,currentBrowserLogin,startBrowserLogin,cancelLogin,disconnect,models,verifyAccess,isVerificationThread,trackTurn,failTurn,stop,usage,catalog:async()=>({object:'list',data:(await models()).map(item=>({id:item.id,object:'model',owned_by:'openai'}))}),selectAccount:async()=>{throw fail(400,'Use Connect another ChatGPT account to change your Codex account.');}};
}
module.exports={createChatgpt,safeError};
