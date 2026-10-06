"use strict";
const fail=(status,message)=>Object.assign(Error(message),{status});
// Preserve the native tools, approvals, history and streaming. Change only the
// provider. A selected Codex account never falls back to paid inference.
function bindCodexFunding({client,chatgpt,funding,userId}){
  chatgpt.bindClient(client);
  const raw=client.request.bind(client),threads=new Map();
  const owner=()=>{const who=userId();if(!who)throw fail(401,'Sign in to Timewarp.');return who;};
  async function route(params,state){
    const model=params.model||params.collaborationMode?.settings?.model;
    const provider=state.source==='chatgpt'?'openai':'energy-llm-proxy';
    let selected=model;
    if(state.source==='chatgpt'){
      const choices=await chatgpt.models(),plain=typeof model==='string'?model.replace(/^openai\//,''):null;
      selected=choices.find(item=>item.id===plain)?.id||(choices.find(item=>item.featured)||choices[0]).id;
    }else if(!['openai/gpt-5.6-sol','openai/gpt-5.6-luna'].includes(model))selected='openai/gpt-5.6-sol';
    return {...params,model:selected,...params.collaborationMode?{collaborationMode:{...params.collaborationMode,settings:{...params.collaborationMode.settings,model:selected}}}:{},modelProvider:provider,config:{...params.config,model_provider:provider}};
  }
  client.request=async(method,params)=>{
    if(!['thread/start','thread/resume','thread/fork','turn/start','turn/steer'].includes(method))return raw(method,params);
    const who=owner(),state=await funding.current();if(who!==userId())throw fail(401,'The active Timewarp account changed.');
    if(params?._timewarpSubscriptionOnly&&state.source!=='chatgpt')throw fail(403,'The connection test requires your Codex allowance on the Free plan.');
    params={...params};delete params._timewarpSubscriptionOnly;
    const previous=threads.get(params?.threadId);
    if(previous&&previous.owner!==who)throw fail(401,'This chat belongs to another Timewarp account.');
    if(method==='turn/start'||method==='turn/steer'){
      if(!state.canFundUsage)throw fail(402,state.source==='chatgpt'?'Reconnect your ChatGPT / Codex account in Billing.':'Connect your ChatGPT / Codex account on Free, or add Timewarp credits in Billing.');
      const mapped=await route(params,state);if(who!==userId())throw fail(401,'The active Timewarp account changed.');
      if(!previous||previous.provider!==mapped.modelProvider){
        if(method==='turn/steer')throw fail(409,'Your AI funding changed. Start a new request to use the current plan.');
        const resumed=await raw('thread/resume',{threadId:params.threadId,modelProvider:mapped.modelProvider,model:mapped.model,config:{model_provider:mapped.modelProvider},excludeTurns:true});
        if(resumed.thread.modelProvider!==mapped.modelProvider)throw fail(502,'Codex did not confirm the selected AI funding provider.');
        if(who!==userId())throw fail(401,'The active Timewarp account changed.');
        threads.set(params.threadId,{owner:who,provider:mapped.modelProvider});
      }
      // Provider belongs to the thread, not TurnStartParams.
      delete mapped.modelProvider;delete mapped.config;
      if(method==='turn/steer'){delete mapped.model;delete mapped.collaborationMode;}
      if(state.source==='chatgpt'&&method==='turn/start')chatgpt.trackTurn(params.threadId,null,who);
      let result;
      try{result=await raw(method,mapped);}catch(error){if(state.source==='chatgpt'&&method==='turn/start')chatgpt.failTurn(params.threadId,error);throw error;}
      if(who!==userId()){if(result.turn?.id)await raw('turn/interrupt',{threadId:params.threadId,turnId:result.turn.id}).catch(()=>{});throw fail(401,'The active Timewarp account changed.');}
      return result;
    }
    const mapped=state.source==='chatgpt'&&!state.canFundUsage?{...params,modelProvider:'openai',config:{...params.config,model_provider:'openai'}}:await route(params,state);
    if(who!==userId())throw fail(401,'The active Timewarp account changed.');
    const result=await raw(method,mapped);if(who!==userId())throw fail(401,'The active Timewarp account changed.');
    if(result.thread.modelProvider!==mapped.modelProvider)throw fail(502,'Codex did not confirm the selected AI funding provider.');
    threads.set(result.thread.id,{owner:who,provider:mapped.modelProvider});return result;
  };
  client.on('status',state=>{if(['stopped','failed'].includes(state.status))threads.clear();});
  return client;
}
module.exports={bindCodexFunding};
