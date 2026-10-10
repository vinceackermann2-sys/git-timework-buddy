"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const {patchLegacyOnboarding,patchOnboardingPrompts}=require('../scripts/onboarding.cjs');
const {rebrandJavaScript}=require('../scripts/rebrand.cjs'),{component}=require('../scripts/onboarding-preview.cjs');
const bundle=(async()=>{const asar=await import('@electron/asar');return patchLegacyOnboarding(rebrandJavaScript(asar.extractFile(path.resolve(__dirname,'../../timewarp-runtime/build/app.asar.pristine'),path.join('out','renderer','assets','mermaid-GHXKKRXX-YWFhvrpV.js')).toString()));})();
function gate(source,{ready=true,done=false,pathname='/'}={}){
  return vm.runInNewContext(component(source,'aIn')+';aIn()',{
    b:{useState:()=>[ready,()=>{}],useEffect:()=>{}},window:{},X3e:()=>({done,loaded:true}),Nn:()=>({pathname}),R3e:()=>({pending:false}),h:{jsx:(type,props)=>({type,...props})},N8:'workspace',Ui:'redirect'});
}
test('native first-use gate redirects to conversational setup only after organization readiness',async()=>{
  assert.equal(gate(await bundle).to,'/onboarding');assert.equal(gate(await bundle,{ready:false}).type,'workspace');assert.equal(gate(await bundle,{done:true}).type,'workspace');
  assert.equal(gate(await bundle,{pathname:'/customize/billing'}).type,'workspace');
});
test('one fullscreen route replaces the conversational component',async()=>{const source=await bundle;const route=component(source,'rIn');assert.match(route,/timewarpMountOnboarding/);assert.ok(!route.includes('conversationId'));assert.match(source,/Redo Onboarding/);});

test('the native opening and resumed setup prompts are branded, including cache resolution',async()=>{
  const asar=await import('@electron/asar');const main=patchOnboardingPrompts(rebrandJavaScript(asar.extractFile(path.resolve(__dirname,'../../timewarp-runtime/build/app.asar.pristine'),path.join('out','main','index.js')).toString()));
  assert.ok(main.includes('The user reopened Timewarp while onboarding was incomplete'));assert.ok(main.includes('Set up Timewarp'));
  assert.ok(main.includes('.brandPromptBundle(await this.fetchRemote(n))'));assert.ok(main.includes('.brandPromptBundle(i??nce(n))'));
});
