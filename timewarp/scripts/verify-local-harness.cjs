"use strict";
// Temporary acceptance package only. Runs the original desktop's local service
// APIs with an isolated profile and disposable account; never automates login UI.
const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
module.exports.init=()=>{
  const handlers=new Map(),handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>{handlers.set(name,fn);handle(name,fn);};
  const root=path.resolve(process.resourcesPath,'../../../timewarp'),fixtures=JSON.parse(fs.readFileSync(path.join(root,'reports/local-fixtures.private.json'),'utf8')),checks={};
  const pass=(name,value)=>{checks[name]=!!value;assert.ok(value,name);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const phase=process.argv.find(a=>a.startsWith('--local-phase='))?.split('=')[1]||'execute';
  if(!process.env.TIMEWARP_USER_DATA_DIR||!app.getPath('userData').includes('local-harness'))throw Error('Acceptance requires an isolated profile.');
  const originalFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/v1/responses')&&typeof init?.body==='string'){const b=JSON.parse(init.body),shape={keys:Object.keys(b),model:b.model,tools:b.tools?.map(t=>({type:t.type,name:t.name,keys:Object.keys(t),tools:t.tools?.map(x=>({type:x.type,name:x.name,keys:Object.keys(x)}))})),inputTypes:b.input?.map(x=>({type:x.type,role:x.role}))};fs.writeFileSync(path.join(root,'reports/local-model-request-shape.json'),JSON.stringify(shape,null,2));}return originalFetch(url,init);};
  async function api(route,body,token){const config=require('./config.json');const r=await fetch(config.supabaseUrl+'/functions/v1/timewarp-energy'+route,{method:'POST',headers:{apikey:config.publishableKey,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
  app.whenReady().then(async()=>{
    const frame={url:'app://app/'},event={senderFrame:frame,sender:{mainFrame:frame}},request=(action,input={})=>handlers.get('timewarp:request')(event,action,input);
    await request('state');await request('signIn',fixtures.users[0]);const runtime=require('./desktop/runtime.cjs');
    let native;for(let i=0;i<120;i++){native=runtime.getNativeRuntime();if(native)break;await wait(500);}pass('originalLocalServicesReady',!!native);await runtime.flushHistory();
    const caller=native.caller(),agents=await caller.product.agents.list({});pass('localAssistantCreated',agents.length>0);pass('defaultLocalBrowserProfile',(await native.entities.browserProfiles.list()).some(p=>p.source.type==='energy'));
    const models=await caller.product.models.list();pass('onlyConfiguredCloudModelsShown',models.length===2&&models.every(m=>['openai/gpt-5.6-sol','openai/gpt-5.6-luna'].includes(m.id)));
    const config=require('./config.json'),login=await fetch(config.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.publishableKey,'content-type':'application/json'},body:JSON.stringify({email:fixtures.users[0].email,password:fixtures.users[0].password})}).then(r=>r.json()),token=login.access_token;
    if(phase==='restore'){
      const restored=native.entities.conversations.get(fixtures.conversationId);pass('cloudHistoryRestoredIntoFreshLocalProfile',!!restored&&restored.entries.some(e=>e.authorId!==fixtures.users[0].id&&e.parts.some(p=>p.text?.includes('LOCAL_TOOL_READY'))));
    }else{
      await caller.product.settings.update({memory:{mode:'enabled'}});const memory=path.join(native.entities.getPaths().memoriesRoot,'user.md');fs.mkdirSync(path.dirname(memory),{recursive:true});fs.writeFileSync(memory,'# User\n\nThe local acceptance codename is Copper Swallow.\n');pass('memoryStoredOnDevice',fs.existsSync(memory));
      const conversationId=crypto.randomUUID(),messageId=crypto.randomUUID();fixtures.conversationId=conversationId;fixtures.agentId=agents[0].id;fs.writeFileSync(path.join(root,'reports/local-fixtures.private.json'),JSON.stringify(fixtures));
      await caller.product.conversations.start({agentId:agents[0].id,conversationId,messageId,parts:[{type:'text',text:'Use your local shell tool to create local-harness-check.txt in your current workspace containing exactly LOCAL_TOOL_READY. Read the file back with a tool, then reply exactly LOCAL_TOOL_READY.'}]});
      pass('localTaskStarted',!!native.entities.conversations.get(conversationId));
      let completed=false;for(let i=0;i<150;i++){const chat=native.entities.conversations.get(conversationId);completed=chat.entries.some(e=>e.kind==='message'&&e.authorId!==fixtures.users[0].id&&e.parts.some(p=>p.type==='text'&&p.text.includes('LOCAL_TOOL_READY')));if(completed)break;await wait(1000);}pass('localHarnessUsesRealCloudModel',completed);
      const agent=await native.entities.agents.get(agents[0].id),file=path.join(agent.repositoryPath,'local-harness-check.txt');pass('realLocalShellWroteFile',fs.existsSync(file)&&fs.readFileSync(file,'utf8').trim()==='LOCAL_TOOL_READY');
      await runtime.flushHistory();const saved=await api('/history',{operation:'list'},token);const chat=saved.data.chats?.find(c=>c.conversation.id===conversationId);pass('chatHistorySavedInCloud',saved.status===200&&chat?.entries.some(e=>e.authorId!==fixtures.users[0].id&&e.parts.some(p=>p.text.includes('LOCAL_TOOL_READY'))));
      pass('historyExcludesWorkspaceAndMemory',!JSON.stringify(saved.data).includes(agent.repositoryPath)&&!JSON.stringify(saved.data).includes('Copper Swallow'));
      for(const route of ['/document','/memory','/enqueue'])pass('retired'+route,(await api(route,{},token)).status===410);
      const billing=await api('/billing',{},token);pass('realCreditsStillAvailable',billing.status===200&&billing.data.purchased>0);
    }
    fs.writeFileSync(path.join(root,'reports/local-harness-'+phase+'.json'),JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,checks},null,2));console.log(JSON.stringify({phase,passed:true,checks}));app.quit();
  }).catch(error=>{fs.writeFileSync(path.join(root,'reports/local-harness-'+phase+'.json'),JSON.stringify({passed:false,checks,error:error.message},null,2));console.error(error);app.quit();});
};
