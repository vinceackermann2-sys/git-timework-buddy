"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {request,keys,fixture,token,root}=require('./live-client.cjs');
const report={verifiedAt:new Date().toISOString(),passed:false,checks:{},checkoutAmounts:{},chatgptLiveInference:'Requires the account owner to approve Continue with ChatGPT and run Test subscription connection.'};
const pass=(name,value)=>{assert.ok(value,name);report.checks[name]=true;};
const base='/functions/v1/timewarp-energy';
let owner,other,adminToken,workspaceId,imageId;const sessions=[];
async function rpc(t,name,input={}){return request(base+'/native/rpc',{rpc:name,input},t);}
async function ok(r,name){pass(name,r.status===200);return r.data;}
async function run(){
  adminToken=keys();owner=JSON.parse(fs.readFileSync(path.join(root,'reports/billing-fixture.private.json'),'utf8'));other=await fixture({save:false});
  const ownerToken=await token(owner),otherToken=await token(other);
  const before=await ok(await request(base+'/billing/service',{action:'status'},ownerToken),'billingStatusIsLive');pass('levelPlansAndMarginConversion',before.plans.map(p=>p.monthlyUsd).join(',')==='0,50,100'&&before.plans.every(p=>p.monthlyCredits===p.monthlyUsd*14)&&before.credits.markup===2.5);
  pass('retiredProCannotBeBought',(await request(base+'/billing/service',{action:'checkout',plan:'pro'},ownerToken)).status===400);
  for(const [plan,cents] of [['max',5000],['ultra',10000]]){
    const checkout=await ok(await request(base+'/billing/service',{action:'checkout',plan},ownerToken),'realStripeCheckout'+plan);sessions.push({id:checkout.sessionId,token:ownerToken});
    pass('correctStripePrice'+plan,checkout.amountTotal===cents&&checkout.currency==='usd'&&new URL(checkout.url).hostname==='checkout.stripe.com');report.checkoutAmounts[plan]=checkout.amountTotal/100;
    pass('unpaidCheckoutDoesNotGrant'+plan,(await request(base+'/billing/service',{action:'sync-checkout',sessionId:checkout.sessionId},ownerToken)).data.pending===true);
    pass('checkoutCannotBeClaimedByAnotherAccount'+plan,(await request(base+'/billing/service',{action:'sync-checkout',sessionId:checkout.sessionId},otherToken)).status===403);
    await ok(await request(base+'/billing/service',{action:'cancel-checkout',sessionId:checkout.sessionId},ownerToken),'checkoutExpires'+plan);
  }
  for(const [credits,cents] of [[180,1500],[1500,12500]]){
    const checkout=await ok(await request(base+'/billing/service',{action:'buy-credits',packCredits:credits},ownerToken),'realCreditPackCheckout'+credits);sessions.push({id:checkout.sessionId,token:ownerToken});pass('correctCreditPackAmount'+credits,checkout.amountTotal===cents&&checkout.currency==='usd');
    await request(base+'/billing/service',{action:'cancel-checkout',sessionId:checkout.sessionId},ownerToken);
  }
  pass('freePurchaserCanManageInvoices',(await request(base+'/billing/service',{action:'status'},ownerToken)).data.canOpenPortal===true);
  const portal=await ok(await request(base+'/billing/service',{action:'portal'},ownerToken),'realStripeBillingPortal');pass('billingPortalUsesStripe',new URL(portal.url).hostname==='billing.stripe.com');
  await ok(await rpc(ownerToken,'product.profile.update',{name:'Persisted acceptance profile'}),'profileSave');
  pass('profileSurvivesFreshLogin',(await request('/auth/v1/user',undefined,await token(owner),'GET')).data.user_metadata.full_name==='Persisted acceptance profile');
  await ok(await rpc(ownerToken,'product.organizations.update',{name:'Persisted personal workspace'}),'personalWorkspaceSave');
  await ok(await rpc(ownerToken,'product.organizations.create',{name:'Acceptance organization'}),'organizationCreate');
  const account=await ok(await request(base+'/account',{},ownerToken),'organizationRead');workspaceId=account.activeOrganization.id;pass('organizationIsPersistedTeam',!workspaceId.startsWith('personal_'));
  await ok(await rpc(ownerToken,'product.organizations.update',{name:'Persisted organization'}),'organizationRename');
  const reopened=await ok(await request(base+'/account',{},await token(owner)),'organizationFreshLogin');pass('organizationAndActiveSelectionSurviveLogin',reopened.activeOrganization.id===workspaceId&&reopened.activeOrganization.name==='Persisted organization');
  pass('foreignOrganizationSelectionDenied',(await rpc(otherToken,'product.organizations.setActive',{organizationId:workspaceId})).status===403);
  const upload=await ok(await rpc(ownerToken,'product.images.beginUpload'),'cloudPictureUploadStarts');imageId=upload.imageId;
  const uploaded=await fetch(upload.uploadUrl,{method:'PUT',headers:{'content-type':'image/png'},body:fs.readFileSync(path.join(root,'assets/mascots/orbit.png'))});pass('cloudPictureActuallyStored',uploaded.ok);
  await ok(await rpc(ownerToken,'product.organizations.update',{name:'Persisted organization',logo:imageId}),'organizationPictureSave');
  await ok(await rpc(ownerToken,'product.profile.update',{imageId}),'profilePictureSave');
  const pictures=await ok(await request(base+'/account',{},await token(owner)),'cloudPicturesReload');pass('cloudPicturesAreDownloadable',(await fetch(pictures.image)).ok&&(await fetch(pictures.activeOrganization.logo)).ok);
  pass('foreignProfilePictureDenied',(await rpc(otherToken,'product.profile.update',{imageId})).status===403);
  await ok(await rpc(ownerToken,'product.organizations.setActive',{organizationId:'personal_'+owner.id}),'personalSelectionSave');
  const personal=await ok(await request(base+'/account',{},await token(owner)),'personalSelectionReload');pass('personalNamePreservedAcrossOrganizationSwitch',personal.activeOrganization.name==='Persisted personal workspace');
  const at=new Date().toISOString(),chatId=crypto.randomUUID(),agentId=crypto.randomUUID(),entryId=crypto.randomUUID();
  const snapshot={conversation:{id:chatId,createdByEntityId:owner.id,kind:'dm',title:'Cloud acceptance',createdAt:at,updatedAt:at,lastActivityAt:at,read:true,archived:false,modelSettings:{name:'openai/gpt-5.6-luna',reasoningEffort:'low',serviceTier:null}},agents:[{id:agentId,displayName:'Timewarp'}],entries:[{id:entryId,kind:'message',authorId:owner.id,createdAt:at,parts:[{type:'text',text:'Persisted in production'}]}]};
  await ok(await request(base+'/history',{operation:'save',snapshot},ownerToken),'historySave');await ok(await request(base+'/history',{operation:'save',snapshot},ownerToken),'historyRetry');
  pass('historyRetryDoesNotDuplicate',(await request(base+'/history',{operation:'list'},ownerToken)).data.chats[0].entries.length===1);
  pass('foreignHistoryWriteDenied',(await request(base+'/history',{operation:'save',snapshot},otherToken)).status===403);pass('foreignHistoryIsEmpty',(await request(base+'/history',{operation:'list'},otherToken)).data.chats.length===0);
  const rows=Array.from({length:100},()=>{const id=crypto.randomUUID();return{user_id:owner.id,id,conversation:{...snapshot.conversation,id},agents:snapshot.agents,entries:[]};});
  const inserted=await request('/rest/v1/timewarp_energy_desktop_history',rows,adminToken);pass('paginationFixtureStored',inserted.status===201);
  const page1=await request(base+'/history',{operation:'list'},ownerToken),page2=await request(base+'/history',{operation:'list',offset:page1.data.nextOffset},ownerToken);pass('historyBeyondOneHundredChatsRestores',page1.data.chats.length===100&&page2.data.chats.length===1&&page2.data.nextOffset===null);
  await ok(await request('/rest/v1/rpc/timewarp_grant_credits',{p_workspace_id:null,p_owner_user_id:owner.id,p_credits:50,p_kind:'purchase',p_stripe_ref:'isolated-acceptance-'+crypto.randomUUID(),p_user_id:owner.id},adminToken),'isolatedFixtureCredits');
  const balance=(await request(base+'/billing',{},ownerToken)).data.purchased;
  const ai=await ok(await request(base+'/v1/responses',{model:'openai/gpt-5.6-luna',input:'Reply with OK.',stream:false},ownerToken),'realModelInference');
  const after=(await request(base+'/billing',{},ownerToken)).data.purchased;const expected=(ai.usage.input_tokens*0.2+ai.usage.output_tokens*1.2)/1000000*2.5/0.125;
  pass('ActualModelUsageDebitsMarginProtectedCredits',after<balance&&Math.abs(balance-after-expected)<0.00001);report.modelUsage={input:ai.usage.input_tokens,output:ai.usage.output_tokens,creditsDebited:balance-after};
  pass('modelReservationSettles',(await request(base+'/billing/service',{action:'status'},ownerToken)).data.purchasedCredits.balance===after);
  pass('freeAccountWithoutFundingRejected',(await request(base+'/v1/responses',{model:'openai/gpt-5.6-luna',input:'Reply OK.'},otherToken)).status===402);
  pass('unauthenticatedBillingDenied',(await request(base+'/billing/service',{action:'status'})).status===401);
  report.passed=true;
}
run().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{
  try{
    const cleaned=(result,name)=>{if(result.status<200||result.status>=300)throw Error(name+' cleanup failed ('+result.status+').');};
    for(const session of sessions)cleaned(await request(base+'/billing/service',{action:'cancel-checkout',sessionId:session.id},session.token),'Checkout');
    if(imageId)cleaned(await request('/storage/v1/object/timewarp-energy-pictures',{prefixes:[imageId]},adminToken,'DELETE'),'Picture');
    if(workspaceId)cleaned(await request('/rest/v1/timewarp_workspaces?id=eq.'+workspaceId,undefined,adminToken,'DELETE'),'Organization');
    for(const user of [owner,other].filter(Boolean))cleaned(await request('/auth/v1/admin/users/'+user.id,undefined,adminToken,'DELETE'),'Account');
    fs.rmSync(path.join(root,'reports/billing-fixture.private.json'),{force:true});report.fixtureCleanup=true;
  }catch(error){report.fixtureCleanup=false;report.cleanupError=error.message;process.exitCode=1;}
  fs.writeFileSync(path.join(root,'reports/billing-cloud.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
