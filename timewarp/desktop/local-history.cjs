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
function createLocalHistory({store,workspace,settings,userId,cloud,onError=()=>{},onStatus=()=>{},intervalMs=30000}){
  let owner=null,stopped=false,running=null,restoring=false;const dirty=new Set(),hashes=new Map(),remoteHashes=new Map(),remoteVersions=new Map(),sentEntries=new Map();
  const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const rememberEntries=(id,entries)=>{let known=sentEntries.get(id);if(!known)sentEntries.set(id,known=new Map());for(const entry of entries)known.set(entry.id,digest(entry));};
  const reset=()=>{hashes.clear();remoteHashes.clear();remoteVersions.clear();sentEntries.clear();dirty.clear();};
  const unsubscribe=store.conversations.subscribe(change=>{if(!restoring&&owner)dirty.add(change.conversation.id);});
  async function restore(chat,account){
    const c=chat.conversation;if(c.createdByEntityId!==account)throw Error('History ownership mismatch.');
    for(const a of chat.agents){const existing=await store.agents.get(a.id);if(existing&&existing.ownerUserId!==account)throw Error("Agent ownership mismatch.");if(!existing)await workspace.create({id:a.id,displayName:a.displayName,instructions:'',avatar:avatar(a.id),ownerUserId:account,modelSettings:c.modelSettings});}
    let local=store.conversations.get(c.id);if(local&&!local.members.some(m=>m.entityId===account))throw Error('Chat ownership mismatch.');
    const previousUpdatedAt=local?.conversation.updatedAt;
    if(!local){store.conversations.create({id:c.id,kind:'dm',createdByEntityId:account,title:c.title,createdAt:c.createdAt,modelSettings:c.modelSettings,members:[{entityId:account},...chat.agents.map(a=>({entityId:a.id}))]});local=store.conversations.get(c.id);}
    const applyMetadata=!previousUpdatedAt||Date.parse(c.updatedAt)>=Date.parse(previousUpdatedAt);
    const ids=new Set(local.entries.map(e=>e.id));for(const e of chat.entries){if(ids.has(e.id))continue;store.conversations.appendEntry({...e,conversationId:c.id,codexTurnId:null});ids.add(e.id);}
    if(applyMetadata){store.conversations.setTitle(c.id,c.title);store.conversations.setModelSettings(c.id,c.modelSettings);c.archived?store.conversations.archive(c.id,account):store.conversations.unarchive(c.id,account);store.conversations.setRead(c.id,account,c.read);}
  }
  async function sync(){
    if(stopped)return;if(running)return running;
    running=(async()=>{
      const account=userId();if(!account){owner=null;reset();return;}
      if((await settings.get()).privacy?.mode==='private'){onStatus({state:'paused'});return;}
      const first=owner!==account;if(first)reset();
      // Ask for small revision manifests. Old servers ignore metadataOnly and
      // return the original list shape, so desktop/cloud upgrades are independent.
      if(!first)await upload(account);
      let offset=0;do{
        const result=await cloud('/history',{operation:'list',offset,metadataOnly:true});if(userId()!==account||stopped)return;
        let chats=result.chats;
        if(result.protocol===2){
          if(!Array.isArray(result.manifest))throw Error('Invalid history manifest.');
          const ids=result.manifest.filter(row=>!dirty.has(row.id)&&remoteVersions.get(row.id)!==row.version).map(row=>row.id);
          chats=ids.length?(await cloud('/history',{operation:'get',ids})).chats:[];
          if(userId()!==account||stopped)return;
        }
        if(!Array.isArray(chats))throw Error('Invalid history response.');
        for(const remote of chats){const {version,...chat}=remote;const id=chat.conversation.id,hash=digest(chat);if(dirty.has(id))continue;
          if(remoteHashes.get(id)===hash){if(version)remoteVersions.set(id,version);continue;}
          const existed=!!store.conversations.get(id);
          restoring=true;try{await restore(chat,account);}finally{restoring=false;}
          remoteHashes.set(id,hash);
          if(version)remoteVersions.set(id,version);
          rememberEntries(id,chat.entries);
          // A restored chat must not be immediately echoed with device-generated
          // timestamps. Keep unsent local history on the first pass, however.
          const snapshot=await snapshotOf(store,account,id);
          if(snapshot){const localHash=digest(snapshot);if(!existed||!first||localHash===hash)hashes.set(id,localHash);}
        }
        if(result.nextOffset!==null&&result.nextOffset!==undefined&&(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=offset))throw Error('Invalid history cursor.');
        offset=result.nextOffset;
      }while(offset!==null&&offset!==undefined);
      if(first){
        await store.browserProfiles.bootstrap();
        if(!(await store.agents.listActiveByOwner(account)).length){const id=crypto.randomUUID();await workspace.create({id,displayName:'Timewarp',instructions:'You are Timewarp. Use the local tools to help the user.',avatar:avatar(id),ownerUserId:account,modelSettings:(await settings.get()).modelSettings});}
        owner=account;
        for(const row of store.conversations.list({memberId:account,includeArchived:true}))dirty.add(row.conversation.id);
      }
      const failed=await upload(account);
      if(failed)return;
      onStatus({state:'synced',lastSyncedAt:new Date().toISOString()});
    })().catch(error=>{onStatus({state:'error',message:error.message});onError(error);}).finally(()=>{running=null;});return running;
  }
  async function upload(account){
      let failed=false;
      for(const id of [...dirty]){try{if(userId()!==account)return;const value=await snapshotOf(store,account,id);if(!value){dirty.delete(id);continue;}const hash=digest(value);if(hashes.get(id)===hash){dirty.delete(id);continue;}
        let entries=[],size=JSON.stringify({...value,entries:[]}).length;
        const send=async()=>{if(userId()!==account||stopped)throw Error('The active account changed.');await cloud('/history',{operation:'save',snapshot:{...value,entries}});if(userId()!==account||stopped)throw Error('The active account changed.');rememberEntries(id,entries);entries=[];size=JSON.stringify({...value,entries:[]}).length;};
        for(const entry of value.entries){if(sentEntries.get(id)?.get(entry.id)===digest(entry))continue;const length=JSON.stringify(entry).length+1;if(entries.length&&(entries.length>=1000||size+length>750000))await send();entries.push(entry);size+=length;}
        // Metadata-only updates still persist, without reuploading old messages.
        await send();
        if(userId()!==account)return;hashes.set(id,hash);dirty.delete(id);const latest=await snapshotOf(store,account,id);if(latest&&digest(latest)!==hash)dirty.add(id);
      }catch(error){failed=true;onStatus({state:'error',message:error.message});onError(error);}}
      return failed;
  }
  const timer=setInterval(()=>{void sync();},intervalMs);timer.unref?.();
  return{sync,stop(){stopped=true;clearInterval(timer);unsubscribe();},snapshot:id=>snapshotOf(store,userId(),id)};
}
module.exports={createLocalHistory,snapshotOf};
