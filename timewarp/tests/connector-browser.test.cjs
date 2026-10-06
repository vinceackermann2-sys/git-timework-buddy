"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),acorn=require('acorn');
const {patchConnectorRouting}=require('../scripts/build.cjs');
const {createConnectorBrowser}=require('../desktop/connector-browser.js');
const root=path.resolve(__dirname,'..');
const source=(async()=>{const asar=await import('@electron/asar');return asar.extractFile(path.resolve(root,'../energy-testv1/build/app.asar.pristine'),path.join('out','renderer','assets','mermaid-GHXKKRXX-YWFhvrpV.js')).toString('utf8');})();
function expression(bundle,name,next){const start=bundle.indexOf(name+'=');assert.ok(start>=0);const end=bundle.indexOf(','+next+'=',start);assert.ok(end>start);return '('+bundle.slice(start+name.length+1,end)+')';}
function hookContext(platform='desktop'){
  const calls=[],errors=[];let state=0;
  return {calls,errors,context:{Nn:()=>({pathname:'/customize/tools',search:''}),tn:()=>()=>{},_1:()=>[new URLSearchParams()],Oa:()=>platform,ZAe:()=>()=>{},
    Mqe:()=>({querySelector:()=>({click:()=>calls.push({dialogClosed:true})})}),b:{useState:()=>{const errorState=state++===1;return[null,value=>{if(errorState&&typeof value==='string')errors.push(value);}];},useCallback:fn=>fn},
    le:{product:{integrations:{beginConnect:{useMutation:()=>({mutateAsync:async input=>{calls.push({input});return {kind:'redirect',connectUrl:'https://connect.composio.dev/authorize'};}})}}}},
    it:{capture:()=>{}},T2n:()=>'',coe:()=>'',M2n:error=>error.message,Error,
    window:{newco:{app:{openExternal:async url=>calls.push({external:url})}},timewarpOpenConnectorBrowser:async(url,options)=>{calls.push({internal:url});options?.onReady?.();},location:{assign:url=>calls.push({web:url})}}}};
}
test('native Connect, reconnect and assistant connections open authorization inside the app browser',async()=>{
  const bundle=patchConnectorRouting(await source);
  for(const [agent,options]of [[undefined,{}],[undefined,{reconnectAccountId:'existing'}],['assistant',{access:[]}]]){
    const f=hookContext(),hook=vm.runInNewContext(expression(bundle,'aP','T2n'),f.context);
    await hook(agent).connectPlugin('composio-github',options);
    assert.deepEqual(f.calls.filter(call=>call.internal),[{internal:'https://connect.composio.dev/authorize'}]);
    assert.equal(f.calls.filter(call=>call.external).length,0);
    assert.equal(f.calls.filter(call=>call.dialogClosed).length,1);
    assert.equal(f.calls[0].input.owner.kind,agent?'agent':'user');
    assert.equal(f.calls[0].input.reconnectAccountId,options.reconnectAccountId);
    assert.deepEqual(f.errors,[]);
  }
  const calls=[],nango=vm.runInNewContext(expression(bundle,'GAe','YAe'),{KAe:options=>options,window:{timewarpOpenConnectorBrowser:async url=>calls.push(url)}});
  await nango({app:{nangoApiUrl:'https://nango.example',openExternal:()=>assert.fail('Authorization escaped the app')},sessionToken:'test'}).openAuthorization('https://provider.example/authorize');
  assert.deepEqual(calls,['https://provider.example/authorize']);
});
test('the browser failure is shown on the Connect flow and never falls back to the external browser',async()=>{
  const f=hookContext();f.context.window.timewarpOpenConnectorBrowser=async()=>{throw Error('Browser unavailable');};
  const hook=vm.runInNewContext(expression(patchConnectorRouting(await source),'aP','T2n'),f.context);
  await hook().connectPlugin('composio-github');assert.ok(f.errors.includes('Browser unavailable'));assert.equal(f.calls.some(call=>call.external),false);
  assert.throws(()=>patchConnectorRouting('changed upstream bundle'),/contract changed/);
});
test('web connections continue using their web authorization redirect',async()=>{
  const f=hookContext('web'),hook=vm.runInNewContext(expression(patchConnectorRouting(await source),'aP','T2n'),f.context);
  await hook().connectPlugin('composio-github');assert.deepEqual(f.calls.filter(call=>call.web),[{web:'https://connect.composio.dev/authorize'}]);assert.equal(f.calls.some(call=>call.external||call.internal),false);
});
test('app plugins and custom MCP authorization also stay in the app browser',async()=>{
  const bundle=patchConnectorRouting(await source),calls=[];let pluginMutation;
  const context={Mqe:()=>({querySelector:()=>({click:()=>calls.push({closed:true})})}),b:{useCallback:fn=>fn},rCe:()=>({begin:()=>{},cancel:()=>{},reconcile:async()=>{}}),
    window:{open:()=>assert.fail('External popup opened'),timewarpOpenConnectorBrowser:async(url,options)=>{calls.push({url,serverName:options.serverName});options.onReady();}}};
  const local={trpc:{useUtils:()=>({codex:{mcpEcosystemPlugins:{list:{invalidate:async()=>{}}}}}),codex:{mcpEcosystemPlugins:{connect:{useMutation:options=>{pluginMutation=options;return{};}}}}}};
  vm.runInNewContext(expression(bundle,'sCe','iCe'),context)({local,item:{serverName:'app-server'},open:true});
  await pluginMutation.onSuccess({status:'oauthRequired',authorizationUrl:'https://provider.example/app'});
  const custom=expression(bundle,'Gun','ITe'),start=custom.indexOf('onSuccess:async g=>{await window.timewarpOpenConnectorBrowser'),end=custom.indexOf(',onError:d.cancel',start);
  assert.ok(start>0&&end>start);
  await vm.runInNewContext('('+custom.slice(start+'onSuccess:'.length,end)+')',{...context,n:{name:'custom-server'},j:context.Mqe(),d:{reconcile:async()=>{}}})({authorizationUrl:'https://provider.example/mcp'});
  assert.deepEqual(calls.filter(call=>call.url),[{url:'https://provider.example/app',serverName:'app-server'},{url:'https://provider.example/mcp',serverName:'custom-server'}]);assert.equal(calls.filter(call=>call.closed).length,2);
});
function panelFixture({opening=async()=>({ownerId:'connector:test'}),show=async()=>({ok:true})}={}){
  const calls=[],panels=[];let listener;
  const controller=createConnectorBrowser({browser:{show:async input=>{calls.push({show:input});return show();},onUpdate:fn=>{listener=fn;return()=>calls.push({unsubscribe:true});},setLayout:input=>calls.push({layout:input}),goBack:async input=>{calls.push({back:input});return{ok:true};}},
    request:async(action,input)=>{calls.push({action,input});return action==='openConnectorBrowser'?opening():{closed:true};},
    createPanel:options=>{const panel={options,updates:[],removed:false,layout:()=>({pageBounds:{x:0,y:80,width:900,height:600},surfaceBounds:{x:0,y:0,width:900,height:680}}),update:state=>panel.updates.push(state),error:message=>calls.push({error:message}),remove:()=>{panel.removed=true;}};panels.push(panel);return panel;}});
  return {controller,calls,panels,update:state=>listener(state)};
}
test('native authorization uses the app surface, filters tab events and releases the session on close',async()=>{
  const f=panelFixture();await f.controller.open('https://connect.composio.dev/authorize');
  assert.equal(f.calls.find(call=>call.show).show.ownerId,'connector:test');
  f.update({ownerId:'conversation:other',selectedTabId:'other',tabs:[]});assert.equal(f.panels[0].updates.length,0);
  f.update({ownerId:'connector:test',selectedTabId:'auth',tabs:[{id:'auth',url:'https://provider.example/login'}]});assert.equal(f.panels[0].updates.length,1);
  await f.panels[0].options.onNavigate('goBack');assert.deepEqual(f.calls.find(call=>call.back).back,{ownerId:'connector:test',tabId:'auth'});
  await f.controller.close();assert.equal(f.panels[0].removed,true);assert.equal(f.calls.filter(call=>call.action==='closeConnectorBrowser').length,1);
});
test('cancelling while the browser starts also destroys the eventual authorization session',async()=>{
  let resolve;const f=panelFixture({opening:()=>new Promise(done=>{resolve=done;})});
  const opening=f.controller.open('https://provider.example/authorize');await new Promise(done=>setImmediate(done));
  await f.controller.close();resolve({ownerId:'connector:late'});await opening;
  assert.equal(f.calls.some(call=>call.show),false);assert.equal(f.calls.find(call=>call.action==='closeConnectorBrowser').input.ownerId,'connector:late');assert.equal(f.panels[0].removed,true);
});
test('simultaneous Connect clicks keep only the latest panel and yield the app dialog before showing the page',async()=>{
  const f=panelFixture(),first=f.controller.open('https://provider.example/first'),second=f.controller.open('https://provider.example/second',{onReady:()=>f.calls.push({dialogClosed:true})});
  await Promise.all([first,second]);assert.equal(f.panels.length,1);assert.ok(f.calls.findIndex(call=>call.dialogClosed)<f.calls.findIndex(call=>call.show));await f.controller.close();
});
test('a failed native surface cleans up the session and invalid connection URLs never start a browser',async()=>{
  const f=panelFixture({show:async()=>({ok:false,error:'Surface failed'})});await assert.rejects(f.controller.open('https://provider.example/authorize'),/Surface failed/);
  assert.equal(f.panels[0].removed,true);assert.equal(f.calls.filter(call=>call.action==='closeConnectorBrowser').length,1);
  for(const url of ['http://provider.example/authorize','file:///secret','https://user:password@provider.example/'])await assert.rejects(f.controller.open(url),/Invalid app connection/);
  assert.equal(f.calls.filter(call=>call.action==='openConnectorBrowser').length,1);
});
function runtimeFixture(){
  const calls=[];let account='user1';
  const context=vm.createContext({URL,Error,crypto:require('node:crypto'),auth:{userId:()=>account},connectorBrowsers:new Map(),
    nativeRuntime:{entities:{browserProfiles:{list:async()=>[{id:'imported',source:{type:'chrome'}},{id:'app-profile',source:{type:'energy'}}]}}},
    browserManager:{activate:async input=>calls.push({activate:input}),destroyOwner:async ownerId=>calls.push({destroy:ownerId})}});
  const text=fs.readFileSync(path.join(root,'desktop/runtime.cjs'),'utf8'),ast=acorn.parse(text,{ecmaVersion:'latest'});
  for(const node of ast.body)if(node.type==='FunctionDeclaration'&&['openConnectorBrowser','closeConnectorBrowser','closeConnectorBrowsers','finishNativeConnector','bindToolRuntime'].includes(node.id.name))vm.runInContext(text.slice(node.start,node.end),context);
  return {context,calls,set account(value){account=value;},open:context.openConnectorBrowser,close:context.closeConnectorBrowser};
}
test('native authorization selects the app profile and enforces window and account ownership',async()=>{
  const f=runtimeFixture(),sender={isDestroyed:()=>false},result=await f.open(sender,'https://provider.example/authorize');
  assert.equal(f.calls[0].activate.profileId,'app-profile');assert.equal(f.calls[0].activate.ownerId,result.ownerId);
  await assert.rejects(f.close(result.ownerId,{isDestroyed:()=>false}),/another window/);assert.equal(f.calls.some(call=>call.destroy),false);
  await f.close(result.ownerId,sender);assert.equal(f.calls.at(-1).destroy,result.ownerId);
  f.account=null;await assert.rejects(f.open(sender,'https://provider.example/authorize'),/Sign in/);
});
test('an account switch during browser startup destroys its pending authorization session',async()=>{
  const f=runtimeFixture();f.context.browserManager.activate=async input=>{f.calls.push({activate:input});f.account='user2';};
  await assert.rejects(f.open({isDestroyed:()=>false},'https://provider.example/authorize'),/session has ended/);
  assert.equal(f.calls.at(-1).destroy,f.calls[0].activate.ownerId);assert.equal(f.context.connectorBrowsers.size,0);
});
test('native MCP approval closes its matching browser and refreshes Apps after successful authorization',async()=>{
  const f=runtimeFixture();let handler;
  f.context.bindToolRuntime({client:{on:(_event,callback)=>{handler=callback;}},mcp:{}});
  const sender={isDestroyed:()=>false,executeJavaScript:async()=>f.calls.push({panelClosed:true}),getURL:()=> 'app://app/#/customize/tools',loadURL:async url=>f.calls.push({refreshed:url})};
  const result=await f.open(sender,'https://provider.example/authorize','app-server');
  handler({method:'mcpServer/oauthLogin/completed',params:{name:'other-server',threadId:null,success:true}});await new Promise(done=>setImmediate(done));assert.equal(f.context.connectorBrowsers.size,1);
  handler({method:'mcpServer/oauthLogin/completed',params:{name:'app-server',threadId:null,success:false}});await new Promise(done=>setImmediate(done));assert.equal(f.context.connectorBrowsers.size,1);
  handler({method:'mcpServer/oauthLogin/completed',params:{name:'app-server',threadId:null,success:true}});await new Promise(done=>setImmediate(done));assert.equal(f.context.connectorBrowsers.size,0);assert.ok(f.calls.some(call=>call.destroy===result.ownerId));assert.ok(f.calls.some(call=>call.refreshed==='app://app/#/customize/tools'));
});
