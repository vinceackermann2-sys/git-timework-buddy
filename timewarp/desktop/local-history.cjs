"use strict";
const crypto=require('node:crypto');
const {assertCloudSafe}=require('../shared/privacy.cjs');
const {avatar}=require('./mascots.cjs');
// Export only chat messages and display metadata. Device paths, tool traces,
// workspace files, credentials and memory never enter this history payload.
async function snapshotOf(store,userId,id){
  const value=store.conversations.get(id);if(!value||value.conversation.createdByEntityId!==userId||!value.members.some(m=>m.entityId===userId))return null;
  const agents=[];for(const m of value.members){if(m.entityId===userId)continue;const a=await store.agents.get(m.entityId);if(!a||a.ownerUserId!==userId)return null;agents.push({id:a.id,displayName:a.displayName});}
  const member=value.members.find(m=>m.entityId===userId),c=value.conversation;
  const conversation={id:c.id,kind:c.kind,createdByEntityId:userId,title:c.title,createdAt:c.createdAt,updatedAt:c.updatedAt,lastActivityAt:c.lastActivityAt,modelSettings:c.modelSettings,archived:!!member.archivedAt,read:!!member.read};
  const entries=value.entries.filter(e=>e.kind==='message'&&e.deliveryStatus!=='failed').flatMap(e=>{const parts=e.parts.filter(p=>p.type==='text').map(p=>({type:'text',text:p.text}));if(!parts.length)return[];return[{id:e.id,kind:'message',authorId:e.authorId,createdAt:e.createdAt,parts,suggestedReplies:[],replyToMessageId:null,forwardedFromMessageId:null}];});
  return assertCloudSafe({conversation,agents,entries});
}
// The cloud keeps chats as jsonb, which reorders object keys: digests sort
// them, so a chat that comes back unchanged compares equal to what was sent.
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
function createLocalHistory({store,workspace,settings,userId,cloud,onError=()=>{},onStatus=()=>{},intervalMs=30000}){
  let owner=null,stopped=false,running=null,restoring=false;const dirty=new Set(),hashes=new Map(),remoteHashes=new Map(),remoteVersions=new Map(),sentEntries=new Map();
  // The engine's store keeps what sync knew of each chat between launches, so a
  // launch downloads and uploads only chats that changed, and writes a restored
  // chat in one commit. Without it (the previous app) sync starts afresh.
  const state=store.syncState,atomic=state?.transaction||(fn=>fn());
  const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('base64url');
  const keep=(account,id)=>state?.save(account,id,{version:remoteVersions.get(id),remoteHash:remoteHashes.get(id),localHash:hashes.get(id)});
  const known=id=>{let map=sentEntries.get(id);if(!map)sentEntries.set(id,map=new Map(state?.entries(id)));return map;};
  const remember=(id,pairs)=>{const map=known(id),changed=pairs.filter(([key,hash])=>map.get(key)!==hash);for(const [key,hash] of changed)map.set(key,hash);if(changed.length)state?.remember(id,changed);};
  const forget=id=>{hashes.delete(id);remoteHashes.delete(id);remoteVersions.delete(id);sentEntries.delete(id);state?.forget(id);};
  const reset=()=>{hashes.clear();remoteHashes.clear();remoteVersions.clear();sentEntries.clear();dirty.clear();};
  const load=account=>{for(const row of state?.load(account)||[]){if(row.version)remoteVersions.set(row.id,row.version);if(row.remoteHash)remoteHashes.set(row.id,row.remoteHash);if(row.localHash)hashes.set(row.id,row.localHash);}};
  const unsubscribe=store.conversations.subscribe(change=>{if(!restoring&&owner)dirty.add(change.conversation.id);});
  async function restore(chat,account){
    const c=chat.conversation;if(c.createdByEntityId!==account)throw Error('History ownership mismatch.');
    for(const a of chat.agents){const existing=await store.agents.get(a.id);if(existing&&existing.ownerUserId!==account)throw Error("Agent ownership mismatch.");if(!existing)await workspace.create({id:a.id,displayName:a.displayName,instructions:'',avatar:avatar(a.id),ownerUserId:account,modelSettings:c.modelSettings});}
    atomic(()=>{
      let local=store.conversations.get(c.id);if(local&&!local.members.some(m=>m.entityId===account))throw Error('Chat ownership mismatch.');
      const previousUpdatedAt=local?.conversation.updatedAt;
      if(!local){store.conversations.create({id:c.id,kind:'dm',createdByEntityId:account,title:c.title,createdAt:c.createdAt,modelSettings:c.modelSettings,members:[{entityId:account},...chat.agents.map(a=>({entityId:a.id}))]});local=store.conversations.get(c.id);}
      const applyMetadata=!previousUpdatedAt||Date.parse(c.updatedAt)>=Date.parse(previousUpdatedAt);
      const ids=new Set(local.entries.map(e=>e.id));for(const e of chat.entries){if(ids.has(e.id))continue;store.conversations.appendEntry({...e,conversationId:c.id,codexTurnId:null});ids.add(e.id);}
      if(applyMetadata){store.conversations.setTitle(c.id,c.title);store.conversations.setModelSettings(c.id,c.modelSettings);c.archived?store.conversations.archive(c.id,account):store.conversations.unarchive(c.id,account);store.conversations.setRead(c.id,account,c.read);}
    });
  }
  async function sync(){
    if(stopped)return;if(running)return running;
    running=(async()=>{
      const account=userId();if(!account){owner=null;reset();return;}
      if((await settings.get()).privacy?.mode==='private'){onStatus({state:'paused'});return;}
      const first=owner!==account;if(first){reset();load(account);}
      // Ask for small revision manifests. Old servers ignore metadataOnly and
      // return the original list shape, so desktop/cloud upgrades are independent.
      if(!first)await upload(account);
      let offset=0;const listed=new Set();do{
        const result=await cloud('/history',{operation:'list',offset,metadataOnly:true});if(userId()!==account||stopped)return;
        let chats=result.chats;
        if(result.protocol===2){
          if(!Array.isArray(result.manifest))throw Error('Invalid history manifest.');
          for(const row of result.manifest)listed.add(row.id);
          const ids=result.manifest.filter(row=>!dirty.has(row.id)&&remoteVersions.get(row.id)!==row.version).map(row=>row.id);
          chats=ids.length?(await cloud('/history',{operation:'get',ids})).chats:[];
          if(userId()!==account||stopped)return;
        }
        if(!Array.isArray(chats))throw Error('Invalid history response.');
        for(const remote of chats){const {version,...chat}=remote;const id=chat.conversation.id,hash=digest(chat);listed.add(id);if(dirty.has(id))continue;
          if(remoteHashes.get(id)===hash){if(version&&remoteVersions.get(id)!==version){remoteVersions.set(id,version);keep(account,id);}continue;}
          const existed=!!store.conversations.get(id);
          restoring=true;try{await restore(chat,account);}finally{restoring=false;}
          remoteHashes.set(id,hash);
          if(version)remoteVersions.set(id,version);
          remember(id,chat.entries.map(entry=>[entry.id,digest(entry)]));
          // A restored chat must not be immediately echoed with device-generated
          // timestamps. Keep unsent local history on the first pass, however.
          const mark=state?.mark(id),snapshot=await snapshotOf(store,account,id);let seen=false;
          if(snapshot){const localHash=digest(snapshot);if(!existed||!first||localHash===hash){hashes.set(id,localHash);seen=true;}}
          keep(account,id);if(seen)state?.settle(id,mark);
        }
        if(result.nextOffset!==null&&result.nextOffset!==undefined&&(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=offset))throw Error('Invalid history cursor.');
        offset=result.nextOffset;
      }while(offset!==null&&offset!==undefined);
      if(first){
        // A chat the cloud no longer lists is uploaded in full again.
        for(const id of new Set([...remoteVersions.keys(),...remoteHashes.keys(),...hashes.keys()]))if(!listed.has(id))forget(id);
        await store.browserProfiles.bootstrap();
        if(!(await store.agents.listActiveByOwner(account)).length){const id=crypto.randomUUID();await workspace.create({id,displayName:'Timewarp',instructions:'You are Timewarp. Use the local tools to help the user.',avatar:avatar(id),ownerUserId:account,modelSettings:(await settings.get()).modelSettings});}
        owner=account;
        // Every chat is checked, except those not written to since sync saw them through.
        const settled=new Set(state?.settled(account));
        for(const row of store.conversations.list({memberId:account,includeArchived:true}))if(!settled.has(row.conversation.id))dirty.add(row.conversation.id);
      }
      const failed=await upload(account);
      if(failed)return;
      onStatus({state:'synced',lastSyncedAt:new Date().toISOString()});
    })().catch(error=>{onStatus({state:'error',message:error.message});onError(error);}).finally(()=>{running=null;});return running;
  }
  async function upload(account){
      let failed=false;
      for(const id of [...dirty]){try{if(userId()!==account)return;const mark=state?.mark(id),value=await snapshotOf(store,account,id);if(!value){dirty.delete(id);continue;}const hash=digest(value);if(hashes.get(id)===hash){dirty.delete(id);state?.settle(id,mark);continue;}
        let entries=[],sent=[],size=JSON.stringify({...value,entries:[]}).length;
        const send=async()=>{if(userId()!==account||stopped)throw Error('The active account changed.');await cloud('/history',{operation:'save',snapshot:{...value,entries}});if(userId()!==account||stopped)throw Error('The active account changed.');remember(id,sent);entries=[];sent=[];size=JSON.stringify({...value,entries:[]}).length;};
        for(const entry of value.entries){const entryHash=digest(entry);if(known(id).get(entry.id)===entryHash)continue;const length=JSON.stringify(entry).length+1;if(entries.length&&(entries.length>=1000||size+length>750000))await send();entries.push(entry);sent.push([entry.id,entryHash]);size+=length;}
        // Metadata-only updates still persist, without reuploading old messages.
        await send();
        if(userId()!==account)return;hashes.set(id,hash);keep(account,id);dirty.delete(id);const latest=await snapshotOf(store,account,id);if(latest&&digest(latest)!==hash)dirty.add(id);else state?.settle(id,mark);
      }catch(error){failed=true;onStatus({state:'error',message:error.message});onError(error);}}
      return failed;
  }
  const timer=setInterval(()=>{void sync();},intervalMs);timer.unref?.();
  return{sync,stop(){stopped=true;clearInterval(timer);unsubscribe();},snapshot:id=>snapshotOf(store,userId(),id)};
}
module.exports={createLocalHistory,snapshotOf};
