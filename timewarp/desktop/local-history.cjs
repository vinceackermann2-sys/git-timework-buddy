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
  let owner=null,stopped=false,running=null,restoring=false;const dirty=new Set(),hashes=new Map(),remoteHashes=new Map();
  const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
      const account=userId();if(!account){owner=null;hashes.clear();remoteHashes.clear();dirty.clear();return;}
      if((await settings.get()).privacy?.mode==='private'){onStatus({state:'paused'});return;}
      const first=owner!==account;if(first){hashes.clear();remoteHashes.clear();dirty.clear();}
      // Download every page on each pass, so new chats on another device arrive
      // without signing out. Pending local edits are uploaded before a pull.
      if(!first)await upload(account);
      let offset=0;do{
        const result=await cloud('/history',{operation:'list',offset});if(userId()!==account)return;
        for(const chat of result.chats){const id=chat.conversation.id,hash=digest(chat);if(remoteHashes.get(id)===hash||dirty.has(id))continue;
          const existed=!!store.conversations.get(id);
          restoring=true;try{await restore(chat,account);}finally{restoring=false;}
          remoteHashes.set(id,hash);
          // A restored chat must not be immediately echoed with device-generated
          // timestamps. Keep unsent local history on the first pass, however.
          if(!existed||!first){const snapshot=await snapshotOf(store,account,id);if(snapshot)hashes.set(id,digest(snapshot));}
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
        const send=async()=>{if(userId()!==account)throw Error('The active account changed.');await cloud('/history',{operation:'save',snapshot:{...value,entries}});entries=[];size=JSON.stringify({...value,entries:[]}).length;};
        for(const entry of value.entries){const length=JSON.stringify(entry).length+1;if(entries.length&&(entries.length>=1000||size+length>750000))await send();entries.push(entry);size+=length;}
        if(entries.length||!value.entries.length)await send();
        if(userId()!==account)return;hashes.set(id,hash);dirty.delete(id);const latest=await snapshotOf(store,account,id);if(latest&&digest(latest)!==hash)dirty.add(id);
      }catch(error){failed=true;onStatus({state:'error',message:error.message});onError(error);}}
      return failed;
  }
  const timer=setInterval(()=>{void sync();},intervalMs);timer.unref?.();
  return{sync,stop(){stopped=true;clearInterval(timer);unsubscribe();},snapshot:id=>snapshotOf(store,userId(),id)};
}
module.exports={createLocalHistory,snapshotOf};
