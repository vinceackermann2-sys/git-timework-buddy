"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {request,keys,fixture,token,root}=require('./live-client.cjs');
const base='/functions/v1/timewarp-energy',report={verifiedAt:new Date().toISOString(),passed:false,checks:{}};
let user,auth,admin;const sessions=[];
const pass=(name,value)=>{assert.ok(value,name);report.checks[name]=true;};
(async()=>{
  admin=keys();user=await fixture({save:false});auth=await token(user);
  for(const [name,input,cents] of [['max',{action:'checkout',plan:'max'},5000],['credits',{action:'buy-credits',packCredits:180},1500]]){
    const result=await request(base+'/billing/service',input,auth);pass('cardCheckout'+name,result.status===200&&result.data.amountTotal===cents&&result.data.currency==='usd');sessions.push(result.data.sessionId);
    pass('unpaidPurchaseStillPending'+name,(await request(base+'/billing/service',{action:'sync-checkout',sessionId:result.data.sessionId},auth)).data.pending===true);
  }
  const unsigned=await request('/functions/v1/stripe-webhook',{type:'checkout.session.completed'});
  pass('productionWebhookConfiguredAndRejectsUnsignedRequests',unsigned.status===400);
  report.passed=true;
})().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{
  try{for(const [i,id] of sessions.entries())pass('checkoutExpired'+i,(await request(base+'/billing/service',{action:'cancel-checkout',sessionId:id},auth)).status===200);if(user)pass('fixtureDeleted',(await request('/auth/v1/admin/users/'+user.id,undefined,admin,'DELETE')).status===200);}
  catch(error){report.cleanupError=error.message;report.passed=false;process.exitCode=1;}
  fs.writeFileSync(path.join(root,'reports/checkout-payment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
