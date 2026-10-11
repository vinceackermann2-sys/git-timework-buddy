"use strict";
const {accountBalance}=require('./account-compat.cjs');
const fail=(status,message)=>Object.assign(Error(message),{status});
const plans=new Set(['free','pro','max','ultra']);

// A saved provider connection is separate from Timewarp authentication and
// billing entitlement. Resolve the current personal plan from the server each
// time funding is used; a failed subscription never becomes a credit request.
// With cacheMs (the engine), the server's balance is kept that long per
// signed-in owner, so each step of a chat doesn't wait for the cloud. A kept
// balance never refuses usage: an answer that would is read fresh first. The
// ChatGPT connection is always read live (it has its own short cache).
function createAiFunding({cloud,chatgpt,userId,cacheMs=0,now=Date.now}){
  let cached=null,pending=null,epoch=0;
  // One request at a time per owner; callers arriving meanwhile share it.
  function balanceFor(owner){
    if(pending&&pending.owner===owner&&pending.epoch===epoch)return pending.promise;
    const request={owner,epoch};
    request.promise=accountBalance(cloud).then(balance=>{
      if(cacheMs&&request.epoch===epoch&&plans.has(balance.plan)&&(!userId||userId()===owner))cached={owner,at:now(),balance};
      return balance;
    }).finally(()=>{if(pending===request)pending=null;});
    pending=request;return request.promise;
  }
  async function resolve(owner,balance){
    if(userId&&owner!==userId())throw fail(401,'The active Timewarp account changed.');
    if(!plans.has(balance.plan))throw fail(502,'The cloud returned an invalid Timewarp plan.');
    const subscriptionAllowed=balance.plan==='free';
    if(subscriptionAllowed&&chatgpt?.refresh)await chatgpt.refresh();
    if(userId&&owner!==userId())throw fail(401,'The active Timewarp account changed.');
    const subscriptionSelected=subscriptionAllowed&&chatgpt&&chatgpt.connection().status!=='disconnected';
    return {plan:balance.plan,subscriptionAllowed,source:subscriptionSelected?'chatgpt':'timewarp',
      canFundUsage:subscriptionSelected?chatgpt.canUse():balance.total>0,
      timewarpCredits:subscriptionSelected?0:balance.total};
  }
  // { state, kept }: kept when the answer came from the cached balance. A
  // fresh read skips it (a request already on its way is shared).
  async function read(fresh=false){
    const owner=userId?.();if(userId&&!owner)throw fail(401,'Sign in to Timewarp.');
    const kept=!fresh&&cacheMs&&cached&&cached.owner===owner&&now()-cached.at<cacheMs?cached.balance:null;
    if(kept){
      const state=await resolve(owner,kept);
      // No credits (with Timewarp credits as the source) or usage refused: ask the server again.
      if(state.canFundUsage&&(kept.total>0||state.source==='chatgpt'))return {state,kept:true};
      if(cached?.balance===kept)cached=null;
    }
    return {state:await resolve(owner,await balanceFor(owner)),kept:false};
  }
  // fresh: what the interface shows (credits, plan) reads the server again.
  const current=async({fresh=false}={})=>(await read(fresh)).state;
  // After a plan, credit, account or ChatGPT connection change: a request
  // started before it isn't shared either.
  function invalidate(){epoch++;cached=null;}
  async function requireFree(){
    let {state,kept}=await read();
    if(!state.subscriptionAllowed&&kept)state=(await read(true)).state;
    if(!state.subscriptionAllowed)throw fail(403,'Your ChatGPT / Codex allowance can power AI usage on the Free plan. This plan uses Timewarp AI credits.');
    return state;
  }
  return {current,requireFree,invalidate};
}
module.exports={createAiFunding};
