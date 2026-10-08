"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const {snapshotOf,createLocalHistory}=require('../desktop/local-history.cjs');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../cloud/nativeHistory.ts'),'utf8'),{mode:'strip'}).replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
const context=vm.createContext({assertCloudSafe:require('../shared/privacy.cjs').assertCloudSafe});vm.runInContext(source,context);
const owner='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',at='2026-10-04T20:00:00Z';
const chat=()=>({conversation:{id,kind:'dm',createdByEntityId:owner,title:'Chat',createdAt:at,updatedAt:at,lastActivityAt:at,modelSettings:{name:'gpt-5.6-sol',reasoningEffort:'low',serviceTier:null}},members:[{entityId:owner,read:true},{entityId:agent}],entries:[{id:'44444444-4444-4444-8444-444444444444',kind:'message',authorId:owner,createdAt:at,parts:[{type:'text',text:'Hello'},{type:'file',path:'C:/private/file.txt'}]},{kind:'tool_call',secret:'local tool details'}]});
function store(value=chat()){return{conversations:{get:()=>value,list:()=>[{conversation:value.conversation}],subscribe(){return()=>{};}},agents:{get:async()=>({id:agent,ownerUserId:owner,displayName:'Timewarp',repositoryPath:'C:/private',instructions:'Local instructions'}),listActiveByOwner:async()=>[{id:agent}]},browserProfiles:{bootstrap:async()=>{}}};}
test('history exports messages without local attachments, tool traces or assistant files',async()=>{const value=await snapshotOf(store(),owner,id);assert.equal(value.entries.length,1);assert.deepEqual(value.entries[0].parts,[{type:'text',text:'Hello'}]);assert.equal(JSON.stringify(value).includes('C:/private'),false);assert.equal(JSON.stringify(value).includes('Local instructions'),false);});

test('history preserves provider reasoning and speed choices on restore',async()=>{
  const value=chat();value.conversation.modelSettings={name:'gpt-6-astra',reasoningEffort:'ultra',serviceTier:'priority'};
  const checked=context.historySnapshot(owner,await snapshotOf(store(value),owner,id));
  assert.equal(checked.conversation.modelSettings.reasoningEffort,'ultra');assert.equal(checked.conversation.modelSettings.serviceTier,'priority');
});
test('history rejects chats belonging to another account and sensitive message content',async()=>{assert.equal(await snapshotOf(store(),agent,id),null);const value=chat();value.entries[0].parts=[{type:'text',text:'4111 1111 1111 1111'}];await assert.rejects(snapshotOf(store(value),owner,id));});
test('server history accepts only known message authors and never saves arbitrary fields',async()=>{const value=await snapshotOf(store(),owner,id);value.localFiles={data:'file content'};const checked=context.historySnapshot(owner,value);assert.equal(checked.localFiles,undefined);assert.throws(()=>context.historySnapshot(agent,value));value.entries[0].authorId='another-account';assert.throws(()=>context.historySnapshot(owner,value));});
test('privacy mode pauses history upload and server failures retry on the next sync',async()=>{let privateMode=true,calls=0,failed=true;const sync=createLocalHistory({store:store(),workspace:{},settings:{get:async()=>({privacy:{mode:privateMode?'private':'standard'}})},userId:()=>owner,cloud:async(_route,input)=>{calls++;if(failed)throw Error('offline');return input.operation==='list'?{chats:[]}:{saved:true};}});try{await sync.sync();assert.equal(calls,0);privateMode=false;await sync.sync();assert.equal(calls,1);failed=false;await sync.sync();assert.equal(calls,3);}finally{sync.stop();}});

test('same-account sync downloads subsequent remote chats, all pages, and applies metadata before append changes local timestamps',async()=>{
  const rows=new Map(),remote=[];let saved=0;
  const local={conversations:{subscribe:()=>()=>{},get:key=>rows.get(key),list:()=>Array.from(rows.values()),create:c=>rows.set(c.id,{conversation:{...c,updatedAt:'2099-01-01T00:00:00Z'},members:c.members.map(m=>({...m,read:true})),entries:[]}),appendEntry:e=>{const row=rows.get(e.conversationId);row.entries.push(e);row.conversation.updatedAt='2099-01-01T00:00:00Z';},setTitle:(key,title)=>{rows.get(key).conversation.title=title;},setModelSettings:(key,value)=>{rows.get(key).conversation.modelSettings=value;},archive:key=>{rows.get(key).members[0].archivedAt=at;},unarchive:key=>{rows.get(key).members[0].archivedAt=null;},setRead:(key,_owner,read)=>{rows.get(key).members[0].read=read;}},agents:{get:async()=>({id:agent,ownerUserId:owner,displayName:'Timewarp'}),listActiveByOwner:async()=>[{id:agent}]},browserProfiles:{bootstrap:async()=>{}}};
  const sync=createLocalHistory({store:local,workspace:{},settings:{get:async()=>({privacy:{mode:'standard'}})},userId:()=>owner,cloud:async(_route,input)=>{if(input.operation==='save'){saved++;return{saved:true};}const offset=input.offset||0;return{chats:remote.slice(offset,offset+100),nextOffset:remote.length>offset+100?offset+100:null};}});
  try{
    await sync.sync();
    for(let i=0;i<101;i++){const value=await snapshotOf(store(),owner,id);value.conversation.id=require('node:crypto').randomUUID();value.conversation.archived=true;value.conversation.read=false;remote.push(value);}
    await sync.sync();assert.equal(rows.size,101);assert.equal(saved,0);assert.ok(Array.from(rows.values()).every(row=>row.members[0].archivedAt&&!row.members[0].read&&row.entries.length===1));
    await sync.sync();assert.equal(saved,0);assert.equal(rows.size,101);
  }finally{sync.stop();}
});
test('first upload saves older messages too, splitting long histories into bounded idempotent batches',async()=>{
  const value=chat();value.entries=Array.from({length:1501},(_,i)=>({...value.entries[0],id:require('node:crypto').randomUUID(),parts:[{type:'text',text:'Message '+i}]}));
  const batches=[],sync=createLocalHistory({store:store(value),workspace:{},settings:{get:async()=>({privacy:{mode:'standard'}})},userId:()=>owner,cloud:async(_route,input)=>{if(input.operation==='list')return{chats:[]};batches.push(input.snapshot.entries);return{saved:true};}});
  try{await sync.sync();assert.deepEqual(batches.map(b=>b.length),[1000,501]);assert.equal(batches[0][0].parts[0].text,'Message 0');await sync.sync();assert.equal(batches.length,2);}finally{sync.stop();}
});

test('incremental history sends one new entry, metadata only on rename, and retries failed deltas',async t=>{
  const value=chat();value.entries=Array.from({length:1000},(_,i)=>({...value.entries[0],id:require('node:crypto').randomUUID(),parts:[{type:'text',text:'Message '+i+' '+ 'x'.repeat(500)}]}));
  const local=store(value),sent=[];let change,fail=false;local.conversations.subscribe=fn=>{change=fn;return()=>{};};
  const sync=createLocalHistory({store:local,workspace:{},settings:{get:async()=>({})},userId:()=>owner,cloud:async(_route,input)=>{if(input.operation==='list')return{protocol:2,manifest:[],nextOffset:null};if(fail)throw Error('offline');sent.push(structuredClone(input.snapshot));return{saved:true};}});t.after(sync.stop);
  await sync.sync();assert.equal(sent.reduce((n,batch)=>n+batch.entries.length,0),1000);const initialBatches=sent.length;
  value.entries.push({...value.entries[0],id:require('node:crypto').randomUUID(),parts:[{type:'text',text:'One new message'}]});change(value);fail=true;await sync.sync();assert.equal(sent.length,initialBatches);
  fail=false;await sync.sync();assert.equal(sent.length,initialBatches+1);assert.equal(sent.at(-1).entries.length,1);
  const fullBytes=Buffer.byteLength(JSON.stringify(await snapshotOf(local,owner,id))),deltaBytes=Buffer.byteLength(JSON.stringify(sent.at(-1)));assert.ok(deltaBytes<fullBytes/100);t.diagnostic(JSON.stringify({fullBytes,deltaBytes,reductionPercent:100*(1-deltaBytes/fullBytes)}));
  value.conversation.title='Renamed';change(value);await sync.sync();assert.equal(sent.at(-1).entries.length,0);assert.equal(sent.at(-1).conversation.title,'Renamed');
});

test('unchanged manifests skip downloading messages and remote revision changes refetch once',async t=>{
  const local=store(),remote=await snapshotOf(local,owner,id),calls=[];let version='1';
  local.conversations.setTitle=()=>{};local.conversations.setModelSettings=()=>{};local.conversations.setRead=()=>{};local.conversations.unarchive=()=>{};
  const sync=createLocalHistory({store:local,workspace:{},settings:{get:async()=>({})},userId:()=>owner,cloud:async(_route,input)=>{calls.push(input);return input.operation==='list'?{protocol:2,manifest:[{id,version}],nextOffset:null}:input.operation==='get'?{chats:[{...remote,version}]}:{saved:true};}});t.after(sync.stop);
  await sync.sync();await sync.sync();assert.equal(calls.filter(x=>x.operation==='get').length,1);
  version='2';await sync.sync();assert.equal(calls.filter(x=>x.operation==='get').length,2);await sync.sync();assert.equal(calls.filter(x=>x.operation==='get').length,2);
  assert.equal(calls.some(x=>x.operation==='save'),false);
  const legacyBytes=Buffer.byteLength(JSON.stringify({chats:[remote],nextOffset:null})),manifestBytes=Buffer.byteLength(JSON.stringify({protocol:2,manifest:[{id,version}],nextOffset:null}));assert.ok(manifestBytes<legacyBytes);t.diagnostic(JSON.stringify({legacyBytes,manifestBytes}));
});

test('history server manifests and selective reads retain the owner filter and reject invalid IDs',async()=>{
  const calls=[];const query={select(value){calls.push(['select',value]);return this;},eq(...args){calls.push(['eq',...args]);return this;},order(){return this;},range(){return{data:[{id,updated_at:'revision'}]};},in(){return{data:[{conversation:{id},agents:[],entries:[],updated_at:'revision'}]};}};
  const admin={from:()=>query},nativeHistory=vm.runInContext('nativeHistory',context);
  const manifest=await nativeHistory(admin,{id:owner},{operation:'list',metadataOnly:true});assert.equal(manifest.protocol,2);assert.equal(manifest.manifest[0].version,'revision');assert.equal(calls[0][1],'id,updated_at');
  const fetched=await nativeHistory(admin,{id:owner},{operation:'get',ids:[id]});assert.equal(fetched.chats[0].version,'revision');assert.equal(calls.filter(x=>x[0]==='eq'&&x[1]==='user_id'&&x[2]===owner).length,2);
  for(const ids of [[],['invalid'],Array(101).fill(id)])await assert.rejects(nativeHistory(admin,{id:owner},{operation:'get',ids}),error=>error.status===400);
});
