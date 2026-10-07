"use strict";
// Validate cloud-restored chat messages against the shipped Energy wire schemas.
// Only individual schema expressions are evaluated, never the desktop bundle.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),acorn=require('acorn');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'build/app/out/main/index.js'),'utf8');
const declarations=new Map();
for(const node of acorn.parse(source,{ecmaVersion:'latest',sourceType:'script'}).body)if(node.type==='VariableDeclaration')for(const value of node.declarations)if(value.id.type==='Identifier'&&value.init)declarations.set(value.id.name,source.slice(value.init.start,value.init.end));
const context=vm.createContext({o:require(path.join(root,'build/app/node_modules/zod')),Intl,RegExp});
function schema(name){
  if(context[name]!==undefined)return context[name];
  const expression=declarations.get(name);if(!expression)throw new Error('Missing schema dependency: '+name);
  for(let attempts=0;attempts<30;attempts++)try{context[name]=vm.runInContext('('+expression+')',context,{timeout:1000});return context[name];}catch(error){const dependency=/^([\w$]+) is not defined$/.exec(error.message);if(!dependency)throw error;schema(dependency[1]);}
  throw new Error('Schema dependency limit reached: '+name);
}
schema('k8');
schema('Gwe').parse(require('../shared/models.cjs').models());
for(const model of require('../shared/codex-models.json').models.filter(model=>model.visibility==='list')){
  const choices={id:model.slug,displayName:model.display_name,description:model.description,inputModalities:model.input_modalities,supportedReasoningEfforts:model.supported_reasoning_levels.map(option=>({reasoningEffort:option.effort,description:option.description})),defaultReasoningEffort:model.default_reasoning_level,featured:model.priority===1,serviceTiers:[{value:null,label:'Standard',description:'Uses Codex allowance'}],defaultServiceTier:null};
  schema('Gwe').parse([choices]);
  for(const effort of choices.supportedReasoningEfforts)schema('ir').parse({name:model.slug,reasoningEffort:effort.reasoningEffort,serviceTier:null});
}
const appearance=require('../shared/appearance.cjs');
for(const preset of appearance.presets)schema('zd').shape.appearance.parse({scheme:'light',accent:appearance.hexToAccent(preset.hex),radiance:.2,texture:{type:'dots',step:2}});
schema('zd').shape.appearance.parse({scheme:'dark',accent:appearance.defaultAccent,radiance:.2,texture:{type:'dots',step:2}});
const nativeSource=require('node:module').stripTypeScriptTypes(fs.readFileSync(path.join(root,'cloud/nativeHistory.ts'),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/\bexport (?=(?:async )?function|const)/g,'');
const native=vm.createContext({assertCloudSafe:require('../shared/privacy.cjs').assertCloudSafe});
vm.runInContext(nativeSource,native);
const at='2026-10-04T16:00:00.000Z',owner='11111111-1111-4111-8111-111111111111',helper='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
for(const model of ['gpt-5.6-sol','gpt-5.6-luna','openai/account-approved-model']){
  const snapshot=native.historySnapshot(owner,{conversation:{id,kind:'dm',createdByEntityId:owner,title:'Local task',createdAt:at,updatedAt:at,lastActivityAt:at,modelSettings:{name:model,reasoningEffort:'low',serviceTier:null}},agents:[{id:helper,displayName:'Timewarp'}],entries:[{id:'44444444-4444-4444-8444-444444444444',kind:'message',authorId:helper,createdAt:at,parts:[{type:'text',text:'Completed on this device.'}]}]});
  schema('ir').parse(snapshot.conversation.modelSettings);
  const entries=snapshot.entries.map((entry,i)=>({entry:{...entry,conversationId:id,sequence:i+1},reactions:[],relatedConversations:[]}));
  schema('pf').parse({entries,olderCursor:null,newerCursor:null});
  assert.equal(snapshot.conversation.modelSettings.name,model);
}
console.log(`Original desktop schemas accept cloud-restored chat messages, model settings, and all ${appearance.presets.length} Timewarp color presets.`);
