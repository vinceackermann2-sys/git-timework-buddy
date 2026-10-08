import { assertCloudSafe } from './privacy.ts';
const fail=(status:number,message:string)=>Object.assign(new Error(message),{status});
const checked=(r:any)=>{if(r.error)throw fail(503,'Chat history storage is temporarily unavailable.');return r.data;};
const identifier=(v:any)=>{if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v))throw fail(400,'Invalid chat identifier.');return v;};
const date=(v:any)=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw fail(400,'Invalid chat timestamp.');return new Date(v).toISOString();};
export function historySnapshot(userId:string,input:any){
  const c=input?.conversation;if(!c||c.createdByEntityId!==userId||c.kind!=='dm')throw fail(403,'This chat belongs to another account.');
  if(!Array.isArray(input.agents)||input.agents.length>8||!Array.isArray(input.entries)||input.entries.length>1000)throw fail(400,'Invalid chat history.');
  const agents=input.agents.map((a:any)=>({id:identifier(a.id),displayName:String(a.displayName||'Timewarp').slice(0,120)}));
  const authors=new Set([userId,...agents.map((a:any)=>a.id)]);
  const entries=input.entries.map((e:any)=>{
    if(e.kind!=='message'||!authors.has(e.authorId)||!Array.isArray(e.parts)||!e.parts.length||e.parts.some((p:any)=>p.type!=='text'||typeof p.text!=='string'||p.text.length>100000))throw fail(400,'Only chat messages can be synchronized.');
    return{id:identifier(e.id),kind:'message',authorId:e.authorId,createdAt:date(e.createdAt),parts:e.parts.map((p:any)=>({type:'text',text:p.text})),suggestedReplies:[],replyToMessageId:null,forwardedFromMessageId:null};
  });
  const snapshot={conversation:{id:identifier(c.id),createdByEntityId:userId,kind:'dm',title:typeof c.title==='string'?c.title.slice(0,200):null,createdAt:date(c.createdAt),updatedAt:date(c.updatedAt),lastActivityAt:date(c.lastActivityAt),archived:!!c.archived,read:!!c.read,modelSettings:{name:String(c.modelSettings?.name||'gpt-5.6-sol').slice(0,100),reasoningEffort:typeof c.modelSettings?.reasoningEffort==='string'&&/^[a-z][a-z0-9_-]{0,99}$/.test(c.modelSettings.reasoningEffort)?c.modelSettings.reasoningEffort:'low',serviceTier:typeof c.modelSettings?.serviceTier==='string'&&/^[a-z][a-z0-9_-]{0,99}$/.test(c.modelSettings.serviceTier)?c.modelSettings.serviceTier:null}},agents,entries};
  assertCloudSafe(snapshot);if(JSON.stringify(snapshot).length>900000)throw fail(413,'Chat history is too large.');return snapshot;
}
export async function nativeHistory(admin:any,user:any,input:any){
  if(input.operation==='list'||!input.operation){
    const offset=input.offset===undefined?0:Number(input.offset);if(!Number.isSafeInteger(offset)||offset<0)throw fail(400,'Invalid history offset.');
    if(input.metadataOnly===true){
      const rows=checked(await admin.from('timewarp_energy_desktop_history').select('id,updated_at').eq('user_id',user.id).order('id',{ascending:true}).range(offset,offset+99))||[];
      return{protocol:2,manifest:rows.map((row:any)=>({id:row.id,version:row.updated_at})),nextOffset:rows.length===100?offset+100:null};
    }
    const chats=checked(await admin.from('timewarp_energy_desktop_history').select('conversation,agents,entries').eq('user_id',user.id).order('id',{ascending:true}).range(offset,offset+99))||[];
    return{chats,nextOffset:chats.length===100?offset+100:null};
  }
  if(input.operation==='get'){
    if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>100)throw fail(400,'Invalid history identifiers.');
    const ids=[...new Set(input.ids.map(identifier))];
    const rows=checked(await admin.from('timewarp_energy_desktop_history').select('conversation,agents,entries,updated_at').eq('user_id',user.id).in('id',ids))||[];
    return{protocol:2,chats:rows.map(({updated_at,...chat}:any)=>({...chat,version:updated_at}))};
  }
  if(input.operation!=='save')throw fail(400,'Invalid history action.');
  const snapshot=historySnapshot(user.id,input.snapshot);
  checked(await admin.rpc('timewarp_energy_merge_history',{p_user:user.id,p_id:snapshot.conversation.id,p_conversation:snapshot.conversation,p_agents:snapshot.agents,p_entries:snapshot.entries}));return{saved:true};
}
