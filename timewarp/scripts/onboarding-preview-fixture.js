"use strict";
// This fixture wraps the production UI. No actual files, sessions or purchases.
(() => {
  const params=new URLSearchParams(location.search),scenario=params.get('scenario')||'welcome',owner=params.get('owner')||'sample',key='timewarp-orb-preview:'+owner;
  if(params.has('reset')){sessionStorage.removeItem(key);params.delete('reset');history.replaceState(null,'','?'+params+location.hash);}
  const stages=['agent','user','knowledge','theme','reaction','plans','finish'];
  let state=JSON.parse(sessionStorage.getItem(key)||'null')||{signedIn:scenario!=='welcome',completed:scenario==='returning',step:stages.includes(scenario)?scenario:'agent',agentName:stages.indexOf(scenario)>0?'Orbit':'',userName:stages.indexOf(scenario)>1?'Alex':'',imports:{},selectedPlan:scenario==='finish'?'free':null,pendingPlan:null};
  const presets=[['Pale lilac','#E9D2FF'],['Ice blue','#B7D6FF'],['Soft lime','#D8F3B0'],['Warm cream','#FFE0A3'],['Pink lilac','#E8B5F4'],['Seafoam','#BCEBDD'],['Lavender','#CCC5FF'],['Powder rose','#FFD0DD'],['Apricot','#FFD0B5'],['Butter','#FFF0B8'],['Cloud','#DFE9F5'],['Glacier','#BAEBF5'],['Mist sage','#D6E5C8']].map(([name,hex])=>({name,hex}));
  const plans=[{id:'free',name:'Free',monthlyUsd:0,monthlyCredits:0},{id:'max',name:'Max',monthlyUsd:50,monthlyCredits:700},{id:'ultra',name:'Ultra',monthlyUsd:100,monthlyCredits:1400}];
  const detected={profiles:[{id:'sample-chrome',browser:'chrome',name:'Chrome · Personal'},{id:'sample-edge',browser:'edge',name:'Edge · Work'}],items:[{id:'codex-chatgpt:memory',source:'codex-chatgpt',category:'memory',names:['AGENTS.md','memories/preferences.md']},{id:'codex-chatgpt:skills',source:'codex-chatgpt',category:'skills',names:['Writing partner']},{id:'claude-code:memory',source:'claude-code',category:'memory',names:['CLAUDE.md']},{id:'claude-code:skills',source:'claude-code',category:'skills',names:['Research']},{id:'cursor:memory',source:'cursor',category:'memory',names:['rules/project.mdc']},{id:'cursor:skills',source:'cursor',category:'skills',names:['Code review']}],errors:[]};
  const save=()=>sessionStorage.setItem(key,JSON.stringify(state)),read=()=>({...structuredClone(state),presets,appearance:{scheme:'light'}});
  window.preview={calls:[],failures:{},paymentConfirmed:false,state:read};
  window.timewarp={request:async(action,input={})=>{
    preview.calls.push({action,input});const failureKey=action==='onboardingAction'?input.action:action;if(preview.failures[failureKey]){preview.failures[failureKey]--;throw Error('Connection interrupted. Please try again.');}
    if(action==='state')return {user:state.signedIn?{id:owner,email:'preview@example.invalid',name:state.userName}:null};
    if(action==='authProviders')return {google:false,signup:true};
    if(action==='signUp')return {confirmationRequired:true};
    if(['signIn','verifyOtp'].includes(action)){state.signedIn=true;save();setTimeout(()=>location.reload(),50);return {user:{id:owner}};}
    if(action==='signOut'){state.signedIn=false;save();return {};}
    if(['resendConfirmation','sendOtp','sendRecovery','openLink'].includes(action))return {};
    if(!state.signedIn)throw Error('Sign in to Timewarp.');
    if(action==='onboardingState')return read();
    if(action==='onboardingDetect')return structuredClone(detected);
    if(action==='cloud')return {plan:'free',plans};
    if(action!=='onboardingAction')throw Error('Unavailable in preview.');
    if(input.action==='agent'){state.agentName=input.name;state.step='user';}
    else if(input.action==='user'){state.userName=input.name;state.step='knowledge';}
    else if(input.action==='import'){for(const id of input.profiles||[])state.imports[id]={kind:'browser'};for(const item of input.items||[])state.imports[item.id]={kind:item.id.split(':')[1],names:item.names};save();return {profiles:input.profiles||[],memoryFiles:(input.items||[]).filter(i=>i.id.endsWith(':memory')).length,skills:(input.items||[]).filter(i=>i.id.endsWith(':skills')).length,warnings:[]};}
    else if(input.action==='cursor-folder')return structuredClone(detected);
    else if(input.action==='knowledge-done')state.step='theme';
    else if(input.action==='theme'){state.theme={scheme:input.scheme,color:input.color,radiance:input.radiance};state.step='reaction';}
    else if(input.action==='plans')state.step='plans';
    else if(input.action==='select-plan'){if(input.plan==='free'){state.selectedPlan='free';state.step='finish';}else{state.pendingPlan=input.plan;state.pendingCheckout='sample-checkout';}}
    else if(input.action==='check-plan'){if(preview.paymentConfirmed){state.selectedPlan=state.pendingPlan;state.pendingPlan=null;state.pendingCheckout=null;state.step='finish';}save();return {...read(),paymentPending:!!state.pendingPlan};}
    else if(input.action==='cancel-plan'){state.pendingPlan=null;state.pendingCheckout=null;}
    else if(input.action==='back')state.step=input.step;
    else if(input.action==='complete')state.completed=true;
    save();return read();
  }};
  document.addEventListener('DOMContentLoaded',()=>{
    const samplePayment=document.createElement('button');samplePayment.textContent='Complete sample payment';samplePayment.hidden=true;samplePayment.onclick=()=>{preview.paymentConfirmed=true;samplePayment.hidden=true;window.dispatchEvent(new Event('focus'));};document.querySelector('.preview-controls').append(' · ',samplePayment);new MutationObserver(()=>{samplePayment.hidden=!state.pendingPlan||preview.paymentConfirmed;}).observe(document.getElementById('preview-host'),{childList:true,subtree:true});
    const host=document.getElementById('preview-host');
    if(!state.signedIn){const auth=document.createElement('main');auth.id='timewarp-auth-view';host.append(auth);window.timewarpMountAuth(auth);const note=document.createElement('p');note.textContent='Preview only: use any sample email and password. Sign-up verification accepts 123456.';note.style.cssText='position:fixed;top:12px;width:100%;text-align:center;font-size:11px;color:#8b7d95';document.body.append(note);return;}
    if(state.completed){host.className='preview-workspace';const heading=document.createElement('h1'),copy=document.createElement('p');heading.textContent='Let’s get to work, '+(state.userName||'Alex')+'.';copy.textContent=(state.agentName||'Your agent')+' is ready in your Timewarp workspace. Completed accounts skip onboarding.';host.append(heading,copy);return;}
    window.timewarpReadyOrganization={id:'sample-org',name:'Your workspace'};window.timewarpMountOnboarding(host);
  });
})();
