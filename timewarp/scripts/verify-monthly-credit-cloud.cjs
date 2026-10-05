"use strict";
// Isolated unpaid Stripe checkouts. No payment method or real account is changed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {request,keys,fixture,token,root}=require('./live-client.cjs');
const base='/functions/v1/timewarp-energy/billing/service',sessions=[],users=[],report={verifiedAt:new Date().toISOString(),passed:false,checks:{},monthlyAmounts:{}};
let adminToken;
const pass=(name,value)=>{assert.ok(value,name);report.checks[name]=true;};
const ok=(result,name)=>{assert.equal(result.status,200,name+': '+(result.data?.error||result.status));return result.data;};
async function run(){
  adminToken=keys();const owner=await fixture({save:false});users.push(owner);const other=await fixture({save:false});users.push(other);
  const ownerToken=await token(owner),otherToken=await token(other);
  const status=ok(await request(base,{action:'status'},ownerToken),'Live billing status');
  pass('monthlyCatalogIsLive',status.monthlyCreditAddons.some(addon=>addon.credits===100&&addon.monthlyUsd===20)&&status.monthlyExtraCredits===0);
  for(const [plan,extra,amount] of [['pro',0,2000],['pro',100,4000],['max',100,7000],['ultra',200,14000]]){
    const checkout=ok(await request(base,{action:'checkout',plan,monthlyExtraCredits:extra},ownerToken),'Recurring checkout');sessions.push({id:checkout.sessionId,token:ownerToken});
    pass(plan+'Plus'+extra+'MonthlyPrice',checkout.amountTotal===amount&&checkout.currency==='usd'&&new URL(checkout.url).hostname==='checkout.stripe.com');report.monthlyAmounts[plan+'+'+extra]=amount/100;
    pass(plan+'Plus'+extra+'UnpaidDoesNotGrant',(await request(base,{action:'sync-checkout',sessionId:checkout.sessionId},ownerToken)).data.pending===true);
    pass(plan+'Plus'+extra+'OwnershipProtected',(await request(base,{action:'sync-checkout',sessionId:checkout.sessionId},otherToken)).status===403);
    ok(await request(base,{action:'cancel-checkout',sessionId:checkout.sessionId},ownerToken),'Expire checkout');
  }
  pass('unknownMonthlyAdditionRejected',(await request(base,{action:'checkout',plan:'pro',monthlyExtraCredits:123},ownerToken)).status===400);
  const pack=ok(await request(base,{action:'buy-credits',packCredits:100},ownerToken),'Standalone credit checkout');sessions.push({id:pack.sessionId,token:ownerToken});
  pass('standalonePriceRemainsSeparate',pack.amountTotal===3000&&pack.currency==='usd');
  const after=ok(await request(base,{action:'status'},ownerToken),'Unpaid status');pass('unpaidSessionsNeverActivatePlan',after.plan==='free'&&after.monthlyExtraCredits===0&&after.includedCredits.allowance===0&&after.purchasedCredits.balance===0);
  report.passed=true;
}
run().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{
  try{
    for(const session of sessions)ok(await request(base,{action:'cancel-checkout',sessionId:session.id},session.token),'Checkout cleanup');
    for(const user of users){const result=await request('/auth/v1/admin/users/'+user.id,undefined,adminToken,'DELETE');assert.ok(result.status>=200&&result.status<300,'Fixture cleanup');}
    report.fixtureCleanup=true;
  }catch(error){report.fixtureCleanup=false;report.cleanupError=error.message;process.exitCode=1;}
  fs.writeFileSync(path.join(root,'reports/monthly-credit-cloud.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
