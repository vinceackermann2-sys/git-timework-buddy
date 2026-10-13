import { createClient } from 'npm:@supabase/supabase-js@2.106.2';
import { REVIEW_OUTPUT_TOKENS, responseOutputLimit } from './agentAiReservation.ts';
import { azureRoute, azureSolModel, azureLunaModel, promptCacheKey } from './azureAgentAi.ts';
import { claudeRoute } from './claudeAgentAi.ts';
import { claudeCall, claudeStream, isClaudeReasoning } from './claudeResponses.ts';
import { assertCloudSafe } from './privacy.ts';
import { nativeCall, nativeStream } from './nativeResponses.ts';
import { accountProduct, nativeAccountSnapshot, productionService } from './nativeAccount.ts';
import { nativeHistory } from './nativeHistory.ts';
import { accountData } from './accountData.ts';
import { nativeBilling } from './nativeBilling.ts';
import { transcribe } from './transcription.ts';
const url=Deno.env.get('SUPABASE_URL')||'',serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,content-encoding','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}});
const fail=(status:number,message:string)=>Object.assign(new Error(message),{status});
const check=<T>(result:{data:T;error:any}):T=>{if(result.error)throw fail(503,'Cloud storage is temporarily unavailable.');return result.data;};

// Request bodies are at most 2 MB, read as they arrive so a larger one stops
// early. The desktop gzips large ones; the limit then also holds for the JSON
// inside, unpacked a piece at a time so a small upload can't expand without
// bound. Gzip is told by its first bytes, in case the platform unpacked it.
const MAX_BODY=2*1024*1024;
async function readLimited(stream:ReadableStream<Uint8Array>|null):Promise<Uint8Array<ArrayBuffer>>{
  const chunks:Uint8Array[]=[];let size=0;
  if(stream){const reader=stream.getReader();
    try{for(let part=await reader.read();!part.done;part=await reader.read()){size+=part.value.byteLength;if(size>MAX_BODY)throw fail(413,'Request is too large.');chunks.push(part.value);}}
    finally{reader.cancel().catch(()=>{});}}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return bytes;
}
const requestBytes=(req:Request)=>Number(req.headers.get('content-length'))>MAX_BODY?Promise.reject(fail(413,'Request is too large.')):readLimited(req.body);
async function requestJson(raw:Uint8Array<ArrayBuffer>){
  let bytes=raw;
  if(raw[0]===0x1f&&raw[1]===0x8b){
    try{bytes=await readLimited(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')));}
    catch(error){if((error as any)?.status===413)throw error;throw fail(400,'Invalid JSON.');}
  }
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail(400,'Invalid JSON.');}
}


function catalog() {
  return { object: 'list', data: [azureSolModel(), azureLunaModel()].map(id => ({ id, object: 'model', owned_by: 'timewarp' })), models: [azureSolModel(), azureLunaModel()].map(slug => ({
    slug, featured: true, display_name: slug === azureLunaModel() ? 'Luna' : 'Sol', description: 'Timewarp cloud AI', visibility: 'list', supported_in_api: true, priority: 1,
    default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }, { effort: 'medium', description: 'Balanced' }, { effort: 'high', description: 'Deep' }],
    shell_type: 'shell_command', supports_reasoning_summaries: true, support_verbosity: true, default_verbosity: 'medium', prefer_websockets: false,
    upgrade: null, availability_nux: null, default_reasoning_summary: 'auto', apply_patch_tool_type: null,
    truncation_policy: {mode:'bytes',limit:10000}, supports_image_detail_original:false, experimental_supported_tools:[],
    supports_parallel_tool_calls: false, context_window: 200000, effective_context_window_percent: 95, input_modalities: ['text', 'image'],
    base_instructions: 'You are Timewarp, a helpful assistant. Use tools to verify your work. Keep payment data and secrets on the owner\'s device.',
  })) };
}


Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  const route=new URL(req.url).pathname.split('/timewarp-energy')[1]||'/';
  try{
    if(route==='/healthz')return response({ok:true,execution:'local',services:['auth','history','account-data','billing','models','transcription']});
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    // The body arrives while the session is checked; it is only unpacked and
    // parsed once the user is known.
    const raw=req.method==='POST'&&route!=='/v1/transcriptions'?requestBytes(req):null;raw?.catch(()=>{});
    const {data:{user},error}=await admin.auth.getUser(token);if(error||!user)throw fail(401,'Sign in to Timewarp.');
    if(req.method==='GET'&&route==='/v1/models')return response(catalog());
    if(req.method!=='POST')throw fail(405,'Method not allowed.');
    if(route==='/v1/transcriptions'){
      // Multipart audio, not JSON. Errors use the provider shape the desktop
      // dictation client parses, so a funding rejection opens Billing.
      try{return response(await transcribe(admin,user.id,req));}
      catch(error){const e=error as any;return response({error:{message:e instanceof Error?e.message:'Transcription failed.',type:e?.type||'server_error'}},e?.status||500);}
    }
    const body:any=await requestJson(await raw!);
    if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Invalid request object.');
    // Older desktop clients can still send native telemetry. It is never model
    // input; discard it before scanning the retained request for secrets. This
    // one scan covers everything a model call forwards.
    if(route==='/v1/responses')delete body.client_metadata;
    assertCloudSafe(body);
    if(['/document','/workspace','/memory','/enqueue','/cancel','/internal/worker'].includes(route))throw fail(410,'Files, memory and task execution are local.');
    if(route==='/account')return response(await nativeAccountSnapshot(admin,user,token));
    if(route==='/history')return response(await nativeHistory(admin,user,body));
    if(route==='/account-data')return response(await accountData(admin,user,body));
    if(route==='/connectors'){
      if(!['list-apps','list-connections','initiate-connection','connection-status','disconnect','list-tools','execute'].includes(body.action))throw fail(400,'Invalid connected-app action.');
      // The production service derives the personal Composio identity from this
      // verified user's JWT. Device workspaces and vaults are never forwarded.
      const {workspaceId,workspace_id,...personalInput}=body;
      return response(await productionService(token,'composio',personalInput));
    }
    if(route==='/billing/history'){
      const [purchases,included]=await Promise.all([
        admin.from('timewarp_credit_events').select('id,occurred_at,delta_credits,kind,model').eq('user_id',user.id).is('workspace_id',null).order('occurred_at',{ascending:false}).limit(50),
        admin.from('timewarp_ai_cost_events').select('id,occurred_at,model,credits_charged,cost_usd').eq('user_id',user.id).is('workspace_id',null).eq('paid_with','plan').order('occurred_at',{ascending:false}).limit(50),
      ]);
      const events=[...(check(purchases)||[]),...(check(included)||[]).map((event:any)=>({...event,kind:'included usage',delta_credits:-Number(event.credits_charged??(event.cost_usd*1.33/0.125))}))];
      return response({events:events.sort((a:any,b:any)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)).slice(0,50)});
    }
    if(route==='/billing/service')return response(await nativeBilling(token,body));
    if(route==='/billing'){const usage=check(await admin.rpc('timewarp_ai_usage',{p_user_id:user.id,p_workspace_id:null})) as any;return response({plan:usage?.plan||'free',included:Number(usage?.included_balance_credits)||0,purchased:Number(usage?.purchased_balance_credits)||0});}
    if(route==='/native/rpc'){const result=await accountProduct(admin,user,token,String(body.rpc||''),body.input||{});if(result===undefined)throw fail(410,'This feature uses the local desktop harness.');return response(result);}
    if(route==='/v1/responses'){
      // Every plan runs every model (Claude through claudeResponses.ts), Free on
      // purchased credits; the call's reservation checks the balance first.
      const claude=claudeRoute(body.model),azure=claude?null:azureRoute(body.model,body.service_tier);
      if(claude)return body.stream?await claudeStream(admin,user.id,body,cors):response(await claudeCall(admin,user.id,body));
      // Execution belongs to the desktop. Forward its client-executed tools,
      // excluding inherited upstream hosted search/image tools. Claude's
      // thinking from earlier turns of the chat stays out; the model's own
      // encrypted reasoning comes back so it carries across tool steps.
      const tools=body.tools?.filter((t:any)=>['function','custom','namespace','tool_search'].includes(t.type));
      const input=Array.isArray(body.input)?body.input.filter((item:any)=>!isClaudeReasoning(item)):body.input;
        const payload={input,instructions:body.instructions,tools,reasoning:body.reasoning,text:body.text,
          parallel_tool_calls:body.parallel_tool_calls===true,
          ...(azure!.review?{max_output_tokens:Math.min(responseOutputLimit(body),REVIEW_OUTPUT_TOKENS)}:body.max_output_tokens!==undefined?{max_output_tokens:body.max_output_tokens}:{}),
          ...(Array.isArray(body.include)&&body.include.includes('reasoning.encrypted_content')?{include:['reasoning.encrypted_content']}:{}),
          prompt_cache_key:await promptCacheKey(user.id,azure!.review?'codex-auto-review':azure!.slug)};
      if(body.stream)return await nativeStream(admin,user.id,azure!,payload,cors);return response(await nativeCall(admin,user.id,azure!,payload));
    }
    throw fail(404,'This endpoint is unavailable.');
  }catch(error){return response({error:error instanceof Error?error.message:'Cloud request failed.'},(error as any)?.status||500);}
});
