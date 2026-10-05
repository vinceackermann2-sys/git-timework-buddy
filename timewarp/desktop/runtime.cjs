"use strict";
const {app,BrowserWindow,ipcMain,safeStorage,shell}=require('electron');
const {createBridge}=require('./bridge.cjs');
const {createAuth}=require('./auth.cjs');
const {sessionStorage}=require('./session-storage.cjs');
const {callbackServer}=require('./oauth.cjs');
const {assertCloudSafe}=require('../shared/privacy.cjs');
const path=require('node:path'),crypto=require('node:crypto');
const {protectedStore}=require('./protected-store.cjs');
const mascots=require('./mascots.cjs');
const config=require('../config.json');
const profile=app.getPath('userData');
app.on('browser-window-created',(_event,window)=>{
  if(process.platform==='win32')window.setIcon(path.join(__dirname,'../assets/app-icon.ico'));
  else if(process.platform==='linux')window.setIcon(path.join(__dirname,'../assets/app-icon.png'));
});
if(process.platform==='win32'){const count=Number(process.env.GIT_CONFIG_COUNT||0);if(Number.isInteger(count)&&count>=0&&count<100){process.env[`GIT_CONFIG_KEY_${count}`]='core.longpaths';process.env[`GIT_CONFIG_VALUE_${count}`]='true';process.env.GIT_CONFIG_COUNT=String(count+1);}}
let nativeAccount=null,oauthServer=null,callbackOpening=null,providersPromise=null,nativeRuntime=null,historySync=null,historyStatus={state:'starting'};
let toolRuntime=null,toolsOpening=null,integrationAgents=null,toolsRegistered=false;
let browserManager=null;
const connectorBrowsers=new Map();
const mcpToken=crypto.randomBytes(32).toString('base64url');
process.env.TIMEWARP_COMPOSIO_TOKEN=mcpToken;
function focusApp(){for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed()&&window.webContents.getURL().startsWith('app://app/')){window.show();window.focus();}}
async function selectModel(choices){
  if(!nativeRuntime)return;
  choices=choices||await modelChoices();const preferences=await nativeRuntime.settings.get();
  const selected=choices.find(model=>model.id===preferences.modelSettings.name)||choices[0];
  if(!selected)return;
  const effort=selected.supportedReasoningEfforts.some(item=>item.reasoningEffort===preferences.modelSettings.reasoningEffort)?preferences.modelSettings.reasoningEffort:selected.defaultReasoningEffort;
  if(preferences.modelSettings.name!==selected.id||preferences.modelSettings.serviceTier!==null||preferences.modelSettings.reasoningEffort!==effort)await nativeRuntime.settings.update({modelSettings:{name:selected.id,reasoningEffort:effort,serviceTier:null}});
}
const chatgpt=require('./chatgpt.cjs').createChatgpt({storage:protectedStore(path.join(profile,'codex-connection.bin'),safeStorage),userId:()=>auth.userId(),onConnected:async()=>{await selectModel();for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed()&&window.webContents.getURL().startsWith('app://app/'))await window.loadURL('app://app/#/customize/billing');focusApp();},onLoginError:async()=>{for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed()&&window.webContents.getURL().startsWith('app://app/')&&auth.userId())await window.loadURL('app://app/#/customize/billing');focusApp();}});
const disconnectCodex=chatgpt.disconnect;
chatgpt.disconnect=async()=>{const result=await disconnectCodex();await selectModel().catch(()=>console.error('[timewarp] The default model could not be updated.'));return result;};
const integrations=require('./composio.cjs').createComposio({cloud:cloudJson,userId:()=>auth.userId(),storage:protectedStore(path.join(profile,'connector-access.bin'),safeStorage),getAgent:id=>(nativeRuntime?.entities.agents||integrationAgents)?.get(id),listAgents:owner=>(nativeRuntime?.entities.agents||integrationAgents)?.listActiveByOwner(owner)||[],ensureCallback,onChanged:async()=>{focusApp();},mcpToken});
// Free with a connected Codex account lists the Codex catalog; every other
// plan lists Timewarp's Sol and Luna.
async function modelChoices(){await ready;return auth.userId()&&(await aiFunding.current()).source==='chatgpt'?chatgpt.models():require('../shared/models.cjs').models();}
// The picker refetches on open. Realign the default model with the current
// plan's catalog so a plan or Codex change never leaves a stale selection.
async function availableModels(){const choices=await modelChoices();await selectModel(choices).catch(()=>console.error('[timewarp] The default model could not be updated.'));return choices;}
function createIntegrations(dependencies){integrationAgents=dependencies.agents;return integrations;}
function bindToolRuntime({client,mcp}){toolRuntime={client,mcp};client.on('notification',event=>{if(event.method==='mcpServer/oauthLogin/completed'&&event.params?.threadId===null&&event.params.success)void finishNativeConnector(event.params.name).catch(()=>console.error('[timewarp] Refresh Apps to check the completed connection.'));});return mcp;}
function bindBrowserManager(manager){browserManager=manager;return manager;}
async function closeConnectorBrowser(ownerId,sender){
  const entry=connectorBrowsers.get(ownerId);
  if(!entry)return;
  if(sender&&entry.sender!==sender)throw new Error('This connection browser belongs to another window.');
  connectorBrowsers.delete(ownerId);
  await browserManager.destroyOwner(ownerId);
}
async function closeConnectorBrowsers(){
  await Promise.allSettled([...connectorBrowsers.keys()].map(ownerId=>closeConnectorBrowser(ownerId)));
}
async function finishNativeConnector(serverName){
  for(const [ownerId,entry]of connectorBrowsers)if(entry.serverName===serverName&&entry.account===auth.userId()){
    if(!entry.sender.isDestroyed())await entry.sender.executeJavaScript('window.timewarpCloseConnectorBrowser?.()').catch(()=>{});
    await closeConnectorBrowser(ownerId);
    if(!entry.sender.isDestroyed())await entry.sender.loadURL(entry.sender.getURL());
  }
}
async function openConnectorBrowser(sender,url,serverName){
  const account=auth.userId();
  if(!account)throw new Error('Sign in to Timewarp to connect an app.');
  const link=new URL(url);
  if(link.protocol!=='https:'||link.username||link.password)throw new Error('Invalid app connection link.');
  if(serverName!==undefined&&(typeof serverName!=='string'||!serverName||serverName.length>256))throw new Error('Invalid app connection.');
  if(!browserManager||!nativeRuntime)throw new Error('The app browser is starting. Retry Connect in a moment.');
  const profiles=await nativeRuntime.entities.browserProfiles.list();
  const browserProfile=profiles.find(item=>item.source.type==='energy');
  if(!browserProfile)throw new Error('The app browser profile is unavailable. Reopen Timewarp and retry.');
  if(account!==auth.userId()||sender.isDestroyed())throw new Error('The connection session has ended.');
  const ownerId='connector:'+crypto.randomUUID();
  connectorBrowsers.set(ownerId,{sender,account,serverName});
  try{
    await browserManager.activate({ownerId,profileId:browserProfile.id,url:link.href});
    if(account!==auth.userId()||sender.isDestroyed()||!connectorBrowsers.has(ownerId))throw new Error('The connection session has ended.');
    return {ownerId};
  }catch(error){await closeConnectorBrowser(ownerId).catch(()=>{});throw error;}
}
function bindCodexClient(client){return require('./codex-funding.cjs').bindCodexFunding({client,chatgpt,funding:aiFunding,userId:()=>auth.userId()});}
async function registerTools(force=false){
  if(!toolRuntime||!auth.userId())return;
  if(toolsRegistered&&!force)return;
  if(toolsOpening)return toolsOpening;
  toolsOpening=(async()=>{await toolRuntime.client.start();await toolRuntime.client.request('config/value/write',{keyPath:'mcp_servers.timewarp_composio',value:{url:'http://127.0.0.1:7788/mcp/composio',enabled:true,bearer_token_env_var:'TIMEWARP_COMPOSIO_TOKEN'},mergeStrategy:'replace'});await toolRuntime.client.request('config/mcpServer/reload',undefined);toolsRegistered=true;})().finally(()=>{toolsOpening=null;});
  return toolsOpening;
}
async function assignMascots(){
  if(!nativeRuntime||!auth.userId())return;
  const owner=auth.userId();for(const agent of await nativeRuntime.entities.agents.listActiveByOwner(owner))if(mascots.shouldAssign(agent)){
    await nativeRuntime.workspace.update({agentId:agent.id,ownerUserId:owner,avatar:mascots.avatar(agent.id)});
  }
}
async function syncNativeAccount(reload=false){
  if(!nativeAccount)return;
  try{
    if(auth.user())await nativeAccount.refresh();else await nativeAccount.clear();
    await historySync?.sync();
    await assignMascots();
    if(nativeRuntime)void registerTools().catch(()=>console.error('[timewarp] Connected-app tools are pending; refresh Tools to retry.'));
    if(reload)for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed()&&window.webContents.getURL().startsWith('app://app/'))await window.loadURL(auth.user()?'app://app/#/':'app://app/#/login');
  }catch{console.error('[timewarp] Desktop account refresh failed; use Account to retry.');}
}
const auth=createAuth({config,storage:sessionStorage(profile,safeStorage),onChange:async({changedUser})=>{if(changedUser){chatgpt.stop();integrations.invalidate();await closeConnectorBrowsers();}return syncNativeAccount(changedUser);}});
const aiFunding=require('./ai-funding.cjs').createAiFunding({cloud,chatgpt,userId:()=>auth.userId()});
const ready=app.whenReady().then(async()=>{if(process.platform==='darwin')app.dock?.setIcon(path.join(__dirname,'../assets/app-icon.png'));await auth.init();if(auth.hasPendingFlow())await ensureCallback().catch(()=>{});});
ready.catch(()=>console.error('[timewarp] Secure account storage is unavailable.'));
function bindNativeAccount(account){nativeAccount=account;void ready.then(()=>syncNativeAccount()).catch(()=>{});return account;}
async function ensureCallback(){
  if(oauthServer?.listening)return;
  if(callbackOpening)return callbackOpening;
  callbackOpening=(async()=>{
  const server=callbackServer(code=>auth.completeOAuth(code),async()=>focusApp(),17654,async()=>{const result=await integrations.callback();for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed()&&window.webContents.getURL().startsWith('app://app/')){await window.webContents.executeJavaScript('window.timewarpCloseConnectorBrowser?.()').catch(()=>{});await closeConnectorBrowsers();await window.loadURL(window.webContents.getURL());}return result;});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(17654,'127.0.0.1',resolve);}).catch(()=>{server.close();throw new Error('Another app is using the Timewarp sign-in callback. Close it and retry.');});
  oauthServer=server;
  })();
  try{await callbackOpening;}finally{callbackOpening=null;}
}
// A content type marks payload as already-encoded bytes (dictation audio).
async function cloud(route,payload,method='POST',contentType){
  await ready;const token=await auth.accessToken();
  return fetch(`${config.supabaseUrl}/functions/v1/timewarp-energy${route}`,{method,headers:{apikey:config.publishableKey,Authorization:`Bearer ${token}`,'content-type':contentType||'application/json'},...(payload===undefined?{}:{body:contentType?payload:JSON.stringify(assertCloudSafe(payload))}),signal:AbortSignal.timeout(140000),redirect:'error'});
}
async function cloudJson(route,input,method='POST'){
  const response=await cloud(route,input,method),value=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(typeof value.error==='string'?value.error:value.error?.message||'Cloud request failed.'),{status:response.status});return value;
}
const accountRpc=(rpc,input={})=>cloudJson('/native/rpc',{rpc,input});
async function accountSession(){
  await ready;await auth.accessToken();const user=await auth.refreshUser();
  const account=await cloudJson('/account',{});
  return {user:{...user,givenName:user.name,familyName:'',image:account.image},session:{token:auth.capability(),expiresAt:new Date(auth.expiresAt()*1000).toISOString(),activeOrganizationId:account.activeOrganization?.id??null},activeOrganization:account.activeOrganization,organizations:account.organizations};
}
const bridgeAuth={...auth,accountSession,async authorize(token){await ready;return auth.authorize(token);},async verifyOtp(email,code){await ready;return auth.verifyOtp(email,code);},async sendOtp(email){await ready;await ensureCallback();return auth.sendOtp(email);}};
const server=createBridge(bridgeAuth,cloud,7788,{chatgpt,aiFunding,integrations,mascots});
const bridgeReady=new Promise((resolve,reject)=>{server.once('error',error=>reject(new Error(error.code==='EADDRINUSE'?'The local account bridge is already in use. Close other Timewarp windows and reopen this app.':'The local account bridge could not start. Reopen Timewarp.')));server.listen(7788,'127.0.0.1',resolve);});
bridgeReady.catch(()=>console.error('[timewarp] Device bridge could not start.'));
app.on('browser-window-created',(_event,window)=>{window.webContents.once('destroyed',()=>{for(const [ownerId,entry]of connectorBrowsers)if(entry.sender===window.webContents)void closeConnectorBrowser(ownerId).catch(()=>{});});window.webContents.on('did-finish-load',()=>{if(window.webContents.getURL().startsWith('app://app/')){if(process.platform==='win32'&&!window.isVisible())window.show();window.emit('resize');window.webContents.invalidate();console.log('[timewarp] Original desktop interface loaded; cloud services connected through the device bridge.');}});});
async function attachNativeRuntime(binding){
  nativeRuntime=binding;await ready;
  const preferences=await binding.settings.get(),appearance=require('../shared/appearance.cjs').migrateAppearance(preferences.appearance);
  if(appearance!==preferences.appearance)await binding.settings.update({appearance});
  await selectModel().catch(()=>console.error('[timewarp] Connected ChatGPT models are temporarily unavailable.'));
  await binding.entities.browserProfiles.bootstrap();
  historySync?.stop();historySync=require('./local-history.cjs').createLocalHistory({store:binding.entities,workspace:binding.workspace,settings:binding.settings,userId:()=>auth.userId(),cloud:cloudJson,onStatus:state=>{historyStatus=state;},onError:()=>console.error('[timewarp] Chat history sync is pending; local chats are preserved.')});
  await historySync.sync();
  await assignMascots();
  await Promise.all([bridgeReady,registerTools().catch(()=>console.error('[timewarp] Connected-app tools are pending; refresh Tools to retry.'))]);
}
const routes=new Set(['/billing','/billing/service','/billing/history']);
ipcMain.handle('timewarp:request',async(event,action,input={})=>{
  if(!event.senderFrame?.url.startsWith('app://app/')||event.senderFrame!==event.sender.mainFrame)throw new Error('Untrusted window.');
  await Promise.all([ready,bridgeReady]);
  switch(action){
    case 'state':return {user:auth.user(),passwordRecovery:auth.passwordRecovery(),version:'0.1.0',privacy:'Vaults and payment details stay on this device.'};
    case 'historyStatus':return historyStatus;
    case 'chatgptDetails':{const funding=await aiFunding.current();if(!funding.subscriptionAllowed)await chatgpt.refresh();return {...chatgpt.details(),funding,login:chatgpt.currentBrowserLogin()};}
    case 'verifyChatgpt':await aiFunding.requireFree();return chatgpt.verifyAccess();
    case 'connectChatgpt':{await auth.accessToken();await aiFunding.requireFree();const result=await chatgpt.startBrowserLogin(input);await shell.openExternal(result.authUrl);return {status:result.status};}
    case 'cancelChatgpt':return chatgpt.cancelLogin();
    case 'disconnectChatgpt':return chatgpt.disconnect();
    case 'selectChatgpt':await aiFunding.requireFree();return chatgpt.selectAccount(input.id);
    case 'refreshAiFunding':await selectModel();return aiFunding.current();
    case 'refreshTools':integrations.invalidate();await registerTools(true);return {ready:true};
    case 'openConnectorBrowser':return openConnectorBrowser(event.sender,input.url,input.serverName);
    case 'closeConnectorBrowser':await closeConnectorBrowser(input.ownerId,event.sender);return {closed:true};
    case 'authProviders':if(!providersPromise)providersPromise=auth.providers().catch(error=>{providersPromise=null;throw error;});return providersPromise;
    case 'signIn':return auth.signIn(input);
    case 'signUp':await ensureCallback();return auth.signUp(input);
    case 'sendOtp':await ensureCallback();return auth.sendOtp(input.email);
    case 'resendConfirmation':await ensureCallback();return auth.resendConfirmation(input.email);
    case 'sendRecovery':await ensureCallback();return auth.sendRecovery(input.email);
    case 'verifyOtp':return auth.verifyOtp(input.email,input.code,input.type||'email');
    case 'updatePassword':return auth.updatePassword(input.password);
    case 'signOut':return auth.signOut();
    case 'beginOAuth':await ensureCallback();await shell.openExternal(await auth.beginOAuth(input.provider));return {opened:true};
    case 'openLink':{const link=new URL(input.url);if(link.protocol!=='https:'||link.username||link.password||/^(?:localhost|127\.|10\.|192\.168\.|\[|.*\.local$)/i.test(link.hostname))throw new Error('Only public HTTPS links can be opened.');await shell.openExternal(link.href);return {opened:true};}
    // Accounts without an organization must create (or join) one before using the app.
    case 'organizationStatus':{const account=await cloudJson('/account',{});return {active:account.activeOrganization?{id:account.activeOrganization.id,name:account.activeOrganization.name}:null,invitations:account.activeOrganization?[]:await accountRpc('product.organizations.invitations.pending')};}
    case 'organizationPictureUpload':return accountRpc('product.images.beginUpload');
    case 'createOrganization':return accountRpc('product.organizations.create',{name:String(input.name||''),...input.imageId?{logo:String(input.imageId)}:{}});
    case 'joinOrganization':return accountRpc('product.organizations.invitations.accept',{invitationId:String(input.invitationId||'')});
    case 'cloud':if(!routes.has(input.route))throw new Error('Invalid route.');return cloudJson(input.route,input.data||{});
    default:throw new Error('Unknown action.');
  }
});
app.on('before-quit',()=>{chatgpt.stop();historySync?.stop();server.close();oauthServer?.close();});
const {autoUpdater}=require('electron-updater');
autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;
autoUpdater.checkForUpdates = async () => null;
autoUpdater.checkForUpdatesAndNotify = async () => null;
module.exports={bindNativeAccount,attachNativeRuntime,getNativeRuntime:()=>nativeRuntime,flushHistory:()=>historySync?.sync(),chatgpt,availableModels,createIntegrations,bindCodexClient,bindToolRuntime,bindBrowserManager,integrations,mascot:mascots.mascot,inspectTools:async()=>{await registerTools();return toolRuntime.client.request('mcpServerStatus/list',{cursor:null,limit:1000,detail:'full'});}};
