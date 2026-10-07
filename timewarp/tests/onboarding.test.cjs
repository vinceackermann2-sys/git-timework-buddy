"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {bindOnboardingSettings,brandPromptBundle}=require('../desktop/onboarding.cjs');
function fixture(saved=null){
  let owner='alice',value=saved,failure=false;
  const base={appearance:{scheme:'dark'},onboarding:{done:true,conversationId:null}};
  const settings={get:async()=>base,update:async patch=>Object.assign(base,patch)};
  bindOnboardingSettings({settings,storage:{load:()=>structuredClone(value),save:next=>{if(failure)throw Error('Disk unavailable');value=structuredClone(next)}},userId:()=>owner});
  return {settings,owner:id=>owner=id,fail:next=>failure=next,saved:()=>value,base};
}
test('native setup uses owner-specific persistent conversation and completion',async()=>{
  const f=fixture();assert.deepEqual((await f.settings.get()).onboarding,{done:false,conversationId:null});
  await f.settings.update({onboarding:{conversationId:'alice-chat'}});await f.settings.update({onboarding:{done:true}});
  f.owner('bob');assert.deepEqual((await f.settings.get()).onboarding,{done:false,conversationId:null});
  await f.settings.update({onboarding:{conversationId:'bob-chat'}});f.owner('alice');
  assert.deepEqual((await f.settings.get()).onboarding,{done:true,conversationId:'alice-chat'});
  const restarted=fixture(f.saved());assert.deepEqual((await restarted.settings.get()).onboarding,{done:true,conversationId:'alice-chat'});
});
test('previously completed owners bypass replacement setup',async()=>{
  const f=fixture({version:1,completedUserIds:['alice']});assert.equal((await f.settings.get()).onboarding.done,true);
  await f.settings.update({appearance:{scheme:'light'}});assert.equal((await f.settings.get()).appearance.scheme,'light');
  assert.deepEqual(f.base.onboarding,{done:true,conversationId:null},'Legacy device flag is independent');
});
test('failed persistence remains incomplete, retry works and native restart resets only its owner',async()=>{
  const f=fixture();f.fail(true);await assert.rejects(f.settings.update({onboarding:{done:true}}),/Disk unavailable/);assert.equal((await f.settings.get()).onboarding.done,false);
  f.fail(false);await f.settings.update({onboarding:{done:true,conversationId:'chat'}});await f.settings.update({onboarding:{done:false,conversationId:null}});
  assert.deepEqual((await f.settings.get()).onboarding,{done:false,conversationId:null});
  f.owner(null);await assert.rejects(f.settings.update({onboarding:{done:true}}),/Sign in/);
});
test('an account swap during another settings write cannot save setup for the new owner',async()=>{
  let owner='alice',writes=0;const settings={get:async()=>({}),update:async()=>{owner='bob'}};
  bindOnboardingSettings({settings,storage:{load:()=>null,save:()=>writes++},userId:()=>owner});
  await assert.rejects(settings.update({appearance:{},onboarding:{done:true}}),/account changed/);assert.equal(writes,0);
});
test('cached and fetched onboarding instructions receive Timewarp branding and funding copy',()=>{
  const result=brandPromptBundle({id:'stable-contract',prompts:{'system-instructions.md':'Energy onboarding. If you already have a ChatGPT plan, connect it to use Energy for free!'}});
  assert.equal(result.id,'stable-contract');const copy=result.prompts['system-instructions.md'];assert.ok(!copy.includes('Energy'));assert.match(copy,/eligible ChatGPT or Codex subscription/);assert.match(copy,/Timewarp credits/);
});
