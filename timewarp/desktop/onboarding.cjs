"use strict";

// Keep setup progress with its signed-in owner, including prior completions.
function bindOnboardingSettings({settings,storage,userId}) {
  if(settings.timewarpOnboardingBound)return;
  const get=settings.get.bind(settings),update=settings.update.bind(settings);
  const records=()=>readOwners(storage);
  const progress=id=>{const saved=id?records()[id]:{done:true};return {done:!!saved?.done,conversationId:saved?.conversationId??null};};
  settings.get=async()=>({...await get(),onboarding:progress(userId())});
  settings.update=async input=>{
    const owner=userId(),{onboarding,...rest}=input;
    if(onboarding&&!owner)throw Error('Sign in to Timewarp.');
    if(Object.keys(rest).length)await update(rest);
    if(owner!==userId())throw Error('Your account changed. Reopen setup to continue.');
    if(onboarding){const owners=records();owners[owner]={...owners[owner],...progress(owner),...onboarding};if(onboarding.done===false&&onboarding.conversationId===null)owners[owner].draft={};storage.save({version:3,owners});}
    return settings.get();
  };
  settings.timewarpOnboardingBound=true;
}
function readOwners(storage){const saved=storage.load();if([2,3].includes(saved?.version))return saved.owners||{};return Object.fromEntries((saved?.completedUserIds||[]).map(id=>[id,{done:true,conversationId:null}]));}
module.exports={bindOnboardingSettings,readOwners};
