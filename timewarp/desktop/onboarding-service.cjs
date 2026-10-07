"use strict";
const crypto=require('node:crypto');
const {readOwners}=require('./onboarding.cjs');
const {presets,hexToAccent}=require('../shared/appearance.cjs');
const steps=['agent','user','knowledge','theme','reaction','plans','finish'];
function createOnboardingService({storage,userId,native,browsers,cloud,updateProfile,rememberName,openPayment,chooseCursorRoot}){
  let pending=Promise.resolve();
  const owner=()=>{const id=userId();if(!id)throw Error('Sign in to Timewarp.');return id};
  const check=id=>{if(id!==userId())throw Error('Your account changed. Reopen setup to continue.')};
  const record=id=>readOwners(storage)[id]||{};
  const draft=id=>record(id).draft||{};
  const save=(id,patch)=>{check(id);const owners=readOwners(storage);owners[id]={...owners[id],draft:{...draft(id),...patch}};storage.save({version:3,owners});return owners[id].draft};
  const name=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\r\n\x00-\x1f]/.test(value))throw Error('Enter a name between 1 and 80 characters.');return value.trim()};
  const billing=input=>cloud('/billing/service',input);
  const profileId=source=>crypto.createHash('sha256').update(source.browserId+'\0'+source.profilePath).digest('hex');
  async function read(){const id=owner(),saved=draft(id),settings=await native().settings.get();check(id);return {...saved,cursorRoot:undefined,completed:!!record(id).done,step:steps.includes(saved.step)?saved.step:'agent',presets,appearance:settings.appearance};}
  async function detect(){
    const id=owner(),[profiles,imports]=await Promise.all([browsers().profileManager.detect(),native().caller().codex.setupImport.detect()]);check(id);
    return {profiles:profiles.profiles.map(item=>({id:profileId(item.source),name:item.label||item.name||item.source.browserId,browser:item.source.browserId})),items:imports.items.filter(item=>['memory','skills'].includes(item.category)),errors:[...(profiles.errors||[]).map(item=>item.message),...(imports.errors||[]).map(item=>item.message)]};
  }
  async function execute(id,action,input={}){
    check(id);const n=native();
    if(action==='agent'){
      const displayName=name(input.name),agents=await n.caller().product.agents.list({});check(id);
      let agent=agents.find(item=>item.id===draft(id).agentId)||agents.find(item=>['Timewarp','Main Assistant'].includes(item.displayName));
      if(!agent){const agentId=draft(id).agentId||crypto.randomUUID();save(id,{agentId});await n.caller().product.agents.create({agentId,displayName,instructions:'You are '+displayName+', the user’s Timewarp agent. Help with their computer work. Use their personal memory and ask before consequential actions.',avatar:{type:'native',imageId:'timewarp-orbit'},introduction:'none'});agent={id:agentId};}
      else await n.caller().product.agents.update({agentId:agent.id,displayName,avatar:{type:'native',imageId:'timewarp-orbit'}});
      save(id,{agentId:agent.id,agentName:displayName,step:'user'});
    }else if(action==='user'){
      const userName=name(input.name);await updateProfile(userName);check(id);await rememberName(userName,draft(id).agentName);save(id,{userName,step:'knowledge'});
    }else if(action==='cursor-folder'){
      const root=await chooseCursorRoot();check(id);if(root)save(id,{cursorRoot:root});return detect();
    }else if(action==='import'){
      const selectedProfiles=Array.isArray(input.profiles)?[...new Set(input.profiles)]:[],selectedItems=Array.isArray(input.items)?input.items:[];
      if(!selectedProfiles.length&&!selectedItems.length)throw Error('Select at least one profile, memory or skill.');
      const available=await detect();check(id);
      const chosen=selectedItems.map(selection=>{const item=available.items.find(item=>item.id===selection.id);if(!item||!Array.isArray(selection.names)||!selection.names.length||selection.names.some(value=>!item.names.includes(value)))throw Error('An import selection is no longer available. Refresh and try again.');return{id:item.id,names:[...new Set(selection.names)]}});
      if(selectedProfiles.some(key=>!available.profiles.some(item=>item.id===key)))throw Error('A browser profile is no longer available. Refresh and try again.');
      const result={profiles:[],memoryFiles:0,skills:0,warnings:[]};
      // Record each completed operation so a partial failure never claims all succeeded.
      for(const key of selectedProfiles){check(id);const detected=await browsers().profileManager.detect();const profile=detected.profiles.find(item=>profileId(item.source)===key);if(!profile)throw Error('The browser profile changed. Refresh and try again.');const imported=await browsers().importProfiles({onboardingRunId:null,selections:[{browserId:profile.source.browserId,profilePath:profile.source.profilePath}]});result.profiles.push(key);if(imported.summary?.failedDecryption||imported.summary?.failedWrite||imported.passwords?.outcome==='failed')result.warnings.push((profile.label||profile.name||'Browser')+': some sign-ins could not be imported. Sign in again inside Timewarp.');save(id,{imports:{...draft(id).imports,[key]:{kind:'browser',label:profile.label||profile.name,at:Date.now()}}});}
      for(const item of chosen){check(id);const receipt=await n.caller().codex.setupImport.import({sync:false,items:[item]});check(id);result.memoryFiles+=receipt.imported.memoryFiles;result.skills+=receipt.imported.skills;save(id,{imports:{...draft(id).imports,[item.id]:{kind:item.id.split(':')[1],names:item.names,at:Date.now()}}});}
      return result;
    }else if(action==='knowledge-done'){save(id,{step:'theme'});
    }else if(action==='theme'){
      if(!['light','dark'].includes(input.scheme)||!/^#[0-9a-f]{6}$/i.test(input.color))throw Error('Choose a theme and a valid color.');
      const current=await n.settings.get();check(id);const radiance=input.radiance??current.appearance.radiance??.5;if(!Number.isFinite(radiance)||radiance<0||radiance>1)throw Error('Choose a valid radiance.');await n.settings.update({appearance:{...current.appearance,scheme:input.scheme,accent:hexToAccent(input.color),radiance}});save(id,{theme:{scheme:input.scheme,color:input.color,radiance},step:'reaction'});
    }else if(action==='plans'){save(id,{step:'plans'});return billing({action:'status'});
    }else if(action==='select-plan'){
      const status=await billing({action:'status'});check(id);if(!status.plans.some(plan=>plan.id===input.plan))throw Error('Choose an available plan.');
      if(status.plan===input.plan){save(id,{selectedPlan:input.plan,pendingPlan:null,pendingCheckout:null,step:'finish'});return read();}
      const checkout=await billing(input.plan==='free'?{action:'portal'}:{action:'checkout',plan:input.plan,monthlyExtraCredits:0});check(id);
      save(id,{pendingPlan:input.plan,pendingCheckout:checkout.sessionId||null,step:'plans'});
      if(checkout.url){const url=new URL(checkout.url);if(url.protocol!=='https:'||url.username||url.password||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw Error('The payment service returned an invalid link.');await openPayment(url.href);}
      else if(!checkout.updated)throw Error('Checkout did not open. Please try again.');
      return read();
    }else if(action==='check-plan'){
      const saved=draft(id);if(saved.pendingCheckout){const result=await billing({action:'sync-checkout',sessionId:saved.pendingCheckout});check(id);if(result.pending)return {...await read(),paymentPending:true};}
      const status=await billing({action:'status'});check(id);
      if(saved.pendingPlan&&status.plan===saved.pendingPlan)save(id,{selectedPlan:status.plan,pendingPlan:null,pendingCheckout:null,step:'finish'});
      return {...await read(),paymentPending:!!draft(id).pendingPlan};
    }else if(action==='cancel-plan'){
      if(draft(id).pendingCheckout)await billing({action:'cancel-checkout',sessionId:draft(id).pendingCheckout});save(id,{pendingPlan:null,pendingCheckout:null});
    }else if(action==='back'){
      if(!steps.includes(input.step)||steps.indexOf(input.step)>steps.indexOf(draft(id).step||'agent'))throw Error('Complete the current step first.');save(id,{step:input.step});
    }else if(action==='complete'){
      const saved=draft(id);if(!saved.agentName||!saved.userName||!saved.selectedPlan||saved.pendingPlan)throw Error('Finish setup before continuing.');
      const [status,account]=await Promise.all([billing({action:'status'}),cloud('/account',{})]);check(id);
      if(status.plan!==saved.selectedPlan||!account.activeOrganization)throw Error('Your account changed. Check your plan and organization before continuing.');
      await n.settings.update({onboarding:{done:true,conversationId:null}});
    }else throw Error('Unknown setup action.');
    return read();
  }
  return {read,detect,run(action,input){const id=owner();const result=pending.catch(()=>{}).then(()=>execute(id,action,input));pending=result;return result;},cursorRoot(){return userId()?draft(userId()).cursorRoot:null;}};
}
module.exports={createOnboardingService};
