// What follows an account to each computer it signs in on, besides its chats:
// agents, memory, instructions, skills, settings, connected-app access and MCP
// server addresses (desktop app/main/account-sync.cjs). The desktop keeps the
// data; the cloud keeps the latest copy of each item with a revision, so each
// computer fetches only what changed and a change made on two computers at
// once is merged on the desktop instead of overwritten here.
const fail=(status:number,message:string)=>Object.assign(new Error(message),{status});
const checked=(r:any)=>{if(r.error)throw fail(503,'Account data storage is temporarily unavailable.');return r.data;};
export const ACCOUNT_DATA_KINDS=new Set(['agent','memory','instructions','skill','connector-access','setting','mcp']);
// An item's JSON is at most 300 KB; a page of changes is cut near 1.5 MB.
export const MAX_ITEM=300*1024,PAGE_BYTES=1536*1024,PAGE_ROWS=50,PUT_ITEMS=25;
const revision=(v:any)=>{const n=v===undefined?0:Number(v);if(!Number.isSafeInteger(n)||n<0)throw fail(400,'Invalid account data revision.');return n;};
function item(v:any){
  if(!v||typeof v!=='object'||Array.isArray(v)||!ACCOUNT_DATA_KINDS.has(v.kind)||typeof v.key!=='string'||!v.key.length||v.key.length>400||/[\u0000-\u001f]/.test(v.key))throw fail(400,'Invalid account data item.');
  const value=v.value===undefined?null:v.value;
  if(value!==null&&(typeof value!=='object'||Array.isArray(value)))throw fail(400,'Invalid account data item.');
  if(value!==null&&JSON.stringify(value).length>MAX_ITEM)throw fail(413,'An account data item is too large.');
  return{kind:v.kind,key:v.key,value,base:revision(v.base)};
}
export async function accountData(admin:any,user:any,input:any){
  if(input?.operation==='changes'){
    // Every item changed after revision `after`, oldest first. `cursor` is
    // where the next page starts; `more` says whether there is one.
    const after=revision(input.after);
    const rows=checked(await admin.from('timewarp_energy_account_data').select('kind,key,value,revision').eq('user_id',user.id).gt('revision',after).order('revision',{ascending:true}).limit(PAGE_ROWS))||[];
    const items=[];let size=0;
    for(const row of rows){
      const length=JSON.stringify(row.value).length;
      if(items.length&&size+length>PAGE_BYTES)break;
      items.push({kind:row.kind,key:row.key,revision:Number(row.revision),value:row.value??null});size+=length;
    }
    return{items,cursor:items.length?items[items.length-1].revision:after,more:items.length<rows.length||rows.length===PAGE_ROWS};
  }
  if(input?.operation==='put'){
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>PUT_ITEMS)throw fail(400,'Invalid account data.');
    const items=input.items.map(item);
    const results=checked(await admin.rpc('timewarp_energy_put_account_data',{p_user:user.id,p_items:items}));
    if(!Array.isArray(results)||results.length!==items.length)throw fail(503,'Account data storage is temporarily unavailable.');
    return{results:results.map((r:any)=>({kind:r.kind,key:r.key,...r.conflict?{conflict:true,revision:Number(r.revision),value:r.value??null}:r.error?{error:String(r.error)}:{revision:Number(r.revision)}}))};
  }
  throw fail(400,'Invalid account data action.');
}
