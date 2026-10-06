"use strict";
// Temporary, read-only acceptance package using the existing signed-in profile.
// It does not start checkout, approve OAuth, change preferences or send a chat.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports.init=(options={})=>{
  const root=options.root||path.resolve(process.resourcesPath,'../../../timewarp'),checks={},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const pass=(name,value)=>{assert.ok(value,name);checks[name]=true;};
  // Allow native cleanup, then release any lingering Electron handles so the
  // acceptance runner can finish and the packaged app can be reopened.
  const quit=code=>{const timer=setTimeout(()=>app.exit(code),5000);timer.unref();app.quit();};
  app.whenReady().then(async()=>{
    const runtime=options.runtime||require('./desktop/runtime.cjs');let native,window;
    for(let i=0;i<100;i++){native=runtime.getNativeRuntime();window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://app/'));if(native&&window)break;await wait(500);}
    pass('nativeServicesReady',!!native&&!!window);
    const preferences=await native.caller().product.settings.get();pass('localSettingsAvailable',!!preferences.appearance);
    await runtime.flushHistory();
    await window.loadURL('app://app/#/customize/billing');let text='';
    for(let i=0;i<60;i++){text=await window.webContents.executeJavaScript('document.body.innerText');if(text.includes('Compare plans.')&&text.includes('Recent activity')&&!text.includes('Loading Codex account…'))break;await wait(500);}
    const ui=await window.webContents.executeJavaScript("({plans:Array.from(document.querySelectorAll('.tw-plan-card'),node=>({id:node.dataset.plan,price:node.querySelector('.tw-plan-price strong').textContent,addon:node.querySelector('select').value})),balance:document.querySelector('.tw-active-credit-value strong')?.textContent,packs:Array.from(document.querySelector('.tw-extra-credits select').options,node=>({credits:node.value,label:node.textContent})),percent:document.querySelector('.tw-usage-percent').textContent,overflow:document.querySelector('.tw-billing').scrollWidth>document.querySelector('.tw-billing').clientWidth})");
    pass('fourPricedPlansRendered',ui.plans.map(p=>p.id).join(',')==='free,pro,max,ultra'&&ui.plans.every(p=>p.price.startsWith('$')));
    pass('liveBalancesRendered',ui.balance!==undefined&&text.includes('Active credits'));
    pass('realCreditPacksRendered',ui.packs.some(p=>p.credits==='50'&&p.label.includes('$15'))&&ui.packs.some(p=>p.credits==='1000'&&p.label.includes('$125')));
    pass('simpleUsageAndPlanLayout',text.includes('Plan usage')&&text.includes('Your plan')&&text.includes('Extra credits')&&!text.includes('Choose your plan'));
    pass('nativeBillingStylesLoaded',await window.webContents.executeJavaScript("getComputedStyle(document.querySelector('.tw-billing')).containerName==='timewarp-billing'"));
    pass('brandedCreditDropdowns',await window.webContents.executeJavaScript("CSS.supports('appearance','base-select')&&Array.from(document.querySelectorAll('.tw-billing select')).every(select=>getComputedStyle(select).appearance==='base-select'&&getComputedStyle(select,'::picker(select)').borderRadius==='10px')"));
    pass('responsiveBillingWithoutOverflow',!ui.overflow);
    const details=await window.webContents.executeJavaScript("window.timewarp.request('chatgptDetails').then(x=>({plan:x.funding.plan,subscriptionAllowed:x.funding.subscriptionAllowed,source:x.funding.source}))");
    pass('subscriptionRestrictedToCurrentFreePlan',details.subscriptionAllowed===(details.plan==='free'));
    pass('chatgptSubscriptionControlsRendered',details.subscriptionAllowed?text.includes('Connect Codex account')||text.includes('Disconnect Codex account')||text.includes('Cancel connection'):!text.includes('Connect Codex account'));
    pass('singleCodexConnectionAction',await window.webContents.executeJavaScript("document.querySelectorAll('.tw-provider button').length<=1"));
    pass('codexCardContainsNoRequestDiagnostics',!text.includes('OpenAI request failed:')&&!text.includes('Input tokens')&&!text.includes('Test connection'));
    const authUi=fs.readFileSync(options.root?path.join(root,'desktop/auth-ui.js'):path.join(__dirname,'desktop/auth-ui.js'),'utf8');pass('timewarpLoginDoesNotOfferChatgpt',!authUi.includes('ChatGPT')&&!authUi.includes('connectChatgpt'));
    const chatgpt=runtime.chatgpt.details();
    if(details.subscriptionAllowed&&chatgpt.status!=='available'&&chatgpt.lastConnectionError)pass('connectionErrorIsAccessible',await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.tw-provider [role=alert]')).some(node=>node.innerText.includes('needs to be connected again'))"));
    if(details.subscriptionAllowed&&chatgpt.status==='reauth_required')pass('incompleteApprovalNotPresentedAsConnected',text.includes('needs to be connected again')&&!text.includes('AI requests use your Codex allowance.'));
    pass('noBillingTransportError',!text.includes('Error invoking remote method')&&!text.includes('This feature uses the local desktop harness.'));
    fs.writeFileSync(path.join(root,'reports/billing-desktop.png'),(await window.webContents.capturePage()).toPNG());
    const cloud=await window.webContents.executeJavaScript("window.timewarp.request('cloud',{route:'/billing/service',data:{action:'status'}}).then(x=>({plan:x.plan,prices:x.plans.map(p=>p.monthlyUsd),allowance:x.includedCredits.allowance,included:x.includedCredits.balance,purchased:x.purchasedCredits.balance,monthlyExtraCredits:x.monthlyExtraCredits,monthlyUsd:x.monthlyUsd,monthlyCreditAddons:x.monthlyCreditAddons}))");
    pass('billingUsesProductionAccount',cloud.prices.join(',')==='0,20,50,100'&&Number.isFinite(cloud.included)&&Number.isFinite(cloud.purchased));
    const balancesMatch=await window.webContents.executeJavaScript("document.querySelector('.tw-active-credit-value strong').textContent==="+JSON.stringify(cloud.purchased.toLocaleString(undefined,{maximumFractionDigits:2})));
    pass('displayedBalancesMatchProduction',balancesMatch);
    pass('monthlyCreditCatalogUsesLivePrices',cloud.monthlyCreditAddons.some(p=>p.credits===100&&p.monthlyUsd===20));
    pass('currentMonthlyAdditionRendered',ui.plans.find(p=>p.id===cloud.plan).addon===String(cloud.monthlyExtraCredits||0));
    const providerUsage=await window.webContents.executeJavaScript("window.timewarp.request('chatgptDetails').then(x=>({available:x.status==='available',used:x.rateLimits?.primary?.usedPercent}))");
    const expected=cloud.allowance>0?(cloud.allowance-cloud.included)/cloud.allowance*100:null;
    pass('usagePercentageMatchesLiveAccount',Number.isFinite(expected)?ui.percent===Math.min(100,Math.max(0,expected)).toLocaleString(undefined,{maximumFractionDigits:2})+'%':ui.percent==='—');
    if(details.subscriptionAllowed&&providerUsage.available&&Number.isFinite(providerUsage.used))pass('codexRemainingAllowanceMatchesLiveAccount',await window.webContents.executeJavaScript("document.querySelector('.tw-provider [role=progressbar]').getAttribute('aria-valuenow')==="+JSON.stringify(String(Math.round(Math.min(100,Math.max(0,100-providerUsage.used)))))));
    const state=await window.webContents.executeJavaScript("window.timewarp.request('historyStatus')");pass('nativeHistorySyncSucceeded',state.state==='synced'&&!!state.lastSyncedAt);
    if(fs.existsSync(path.join(__dirname,'verify-chatgpt-desktop.cjs'))){let codex;for(let i=0;i<60;i++){try{codex=JSON.parse(fs.readFileSync(path.join(root,'reports/chatgpt-desktop.json'),'utf8'));}catch{}if(codex?.liveInference?.modelsParseNativeSchema&&typeof codex.liveInference.noTimewarpCreditCharge==='boolean')break;await wait(500);}pass('codexModelsAndCreditIsolationVerified',codex?.liveInference?.modelCount>0&&codex.liveInference.modelsParseNativeSchema&&codex.liveInference.noTimewarpCreditCharge);checks.codexProviderCompleted=codex.liveInference.completed;checks.codexUsageLimitReported=!codex.liveInference.completed&&/usage limit/i.test(codex.liveInference.error||'');}
    fs.writeFileSync(path.join(root,'reports/billing-desktop.json'),JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));quit(0);
  }).catch(error=>{fs.writeFileSync(path.join(root,'reports/billing-desktop.json'),JSON.stringify({passed:false,checks,error:error.message},null,2));console.error(error.message);quit(1);});
};
