"use strict";
const {accountBalance}=require('./account-compat.cjs');
const fail=(status,message)=>Object.assign(Error(message),{status});
const plans=new Set(['free','pro','max','ultra']);

// A saved provider connection is separate from Timewarp authentication and
// billing entitlement. Resolve the current personal plan from the server each
// time funding is used; a failed subscription never becomes a credit request.
function createAiFunding({cloud,chatgpt,userId}){
  async function current(){
    const owner=userId?.();if(userId&&!owner)throw fail(401,'Sign in to Timewarp.');
    const balance=await accountBalance(cloud);
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
  async function requireFree(){
    const state=await current();if(!state.subscriptionAllowed)throw fail(403,'Your ChatGPT / Codex allowance can power AI usage on the Free plan. This plan uses Timewarp AI credits.');
    return state;
  }
  return {current,requireFree};
}
module.exports={createAiFunding};
