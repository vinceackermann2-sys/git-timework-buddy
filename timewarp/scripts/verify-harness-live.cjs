"use strict";
// Explicit, bounded paid acceptance using a disposable cloud user. Credentials
// remain in this parent process; the native harness receives only a loopback URL.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
  if(!process.argv.includes('--paid-fixture'))throw Error('Pass --paid-fixture to run bounded real inference.');
  const {keys,fixture,token,request}=require('./live-client.cjs'),config=require('../config.json');
  const report={verifiedAt:new Date().toISOString(),passed:false,model:'openai/gpt-5.6-luna',maxRequests:40,maxFixtureCredits:50};
  let user,admin,access,proxy,child,directory,requests=0;
  (async()=>{
    directory=fs.mkdtempSync(path.join(root,'.temp/live-harness-'));cp.execFileSync('git',['init','--quiet',directory],{windowsHide:true});fs.copyFileSync(path.join(root,'build/native/resources/app.asar'),path.join(directory,'app.asar'));
    admin=keys();user=await fixture({save:false});access=await token(user);
    const grant=await request('/rest/v1/rpc/timewarp_grant_credits',{p_workspace_id:null,p_owner_user_id:user.id,p_credits:report.maxFixtureCredits,p_kind:'purchase',p_stripe_ref:'harness-acceptance-'+crypto.randomUUID(),p_user_id:user.id},admin);assert.equal(grant.status,200,'Fixture credit grant');
    // Exercise the real local bridge, including metadata removal and privacy
    // validation. The disposable fixture owns this isolated loopback endpoint.
    proxy=require('../desktop/bridge.cjs').createBridge({authorize:async()=>true},async(route,input,method)=>{
        if(!['/v1/models','/v1/responses'].includes(route))return Response.json({error:'Unknown fixture route'},{status:404});
        if(method==='POST'&&++requests>report.maxRequests)return Response.json({error:'Acceptance request budget reached'},{status:429});
        const upstream=await fetch(config.supabaseUrl+'/functions/v1/timewarp-energy'+route,{method,headers:{apikey:config.publishableKey,authorization:'Bearer '+access,'content-type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)}),signal:AbortSignal.timeout(125000)});
        if(upstream.status===400&&input){
          const {luhn}=require('../shared/privacy.cjs'),matches=[];
          const inspect=(value,key)=>{if(typeof value==='string'){for(const match of value.matchAll(/(?<![A-Za-z0-9-])\d(?:[ -]?\d){12,18}(?![A-Za-z0-9-])/g)){const digits=match[0].replace(/\D/g,'');if(luhn(digits))matches.push({field:key,digits:digits.length,timestampLike:/^1[78]\d{11}$/.test(digits),preceding:value.slice(Math.max(0,match.index-45),match.index)});}}else if(value&&typeof value==='object')for(const [name,child]of Object.entries(value))inspect(child,key+'.'+name);};
          inspect(input,'request');if(matches.length)(report.privacyDiagnostics??=[]).push(...matches);
        }
        return upstream;
    },0);await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({proxyUrl:'http://127.0.0.1:'+proxy.address().port+'/v1',browserOnly:process.argv.includes('--browser-only')}));
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    // Do not inherit this test launcher's Codex chat, tool pipe or permission
    // context. The fixture owns an independent app-server and code-mode host.
    for(const key of Object.keys(env))if(key.startsWith('CODEX_'))delete env[key];
    const log=fs.openSync(path.join(directory,'native.log'),'w');child=cp.spawn(require('electron'),[__filename,'--fixture',directory],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
    const timer=setTimeout(()=>{if(child.pid)cp.spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});},8*60000);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(timer));
    const file=path.join(directory,'result.json');if(fs.existsSync(file))Object.assign(report,JSON.parse(fs.readFileSync(file,'utf8')));
    assert.equal(code,0,'Native acceptance process: see '+path.join(directory,'native.log'));
    const billing=await request('/functions/v1/timewarp-energy/billing',{},access);assert.equal(billing.status,200);report.creditsDebited=report.maxFixtureCredits-billing.data.purchased;report.passed=true;
  })().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{
    proxy?.closeAllConnections();proxy?.close();report.forwardedRequests=Math.min(requests,report.maxRequests);report.requestAttempts=requests;report.fixtureDirectory=directory;
    if(access){try{const billing=await request('/functions/v1/timewarp-energy/billing',{},access);if(billing.status===200)report.creditsDebited=report.maxFixtureCredits-billing.data.purchased;}catch{}}
    try{if(access){const result=await request('/auth/v1/logout?scope=global',{},access);assert.ok([200,204].includes(result.status),'Fixture logout');}if(user){const result=await request('/auth/v1/admin/users/'+user.id,undefined,admin,'DELETE');assert.equal(result.status,200,'Fixture deletion');}report.fixtureCleanup=true;}catch(error){report.fixtureCleanup=false;report.cleanupError=error.message;process.exitCode=1;}
    fs.writeFileSync(path.join(root,'reports/harness-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  });
}else{
  const {app,clipboard}=require('electron'),directory=process.argv[process.argv.indexOf('--fixture')+1];assert.equal(path.dirname(path.resolve(directory)),path.join(root,'.temp'));
  app.disableHardwareAcceleration();app.setPath('userData',path.join(directory,'profile'));
  const filename=path.join(directory,'app.asar/out/main/index.js'),Module=require('node:module'),native=new Module(filename,module);native.filename=filename;native.paths=Module._nodeModulePaths(path.dirname(filename));
  native._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.acceptance={S9,UAe,Txe,WSe,FSe,OSe,JSe,KSe,JEe,Gke};',filename);
  const {S9,UAe,Txe,WSe,FSe,OSe,JSe,KSe,JEe,Gke}=native.exports.acceptance;
  app.whenReady().then(async()=>{
    let client,guard,manager,gateway,server;const report={checks:{},tasks:[]},resources=path.join(root,'build/native/resources'),executable=OSe({isPackaged:true,resourcesPath:resources});
    const pass=(key,value)=>{report.checks[key]=!!value;};let code=0;
    try{
      const nonce=crypto.randomBytes(6).toString('hex');let submitted=false;
      server=http.createServer((req,res)=>{if(req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{submitted=body===nonce;res.end(submitted?'VERIFIED '+nonce:'Incorrect');});return;}res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Harness fixture</title><p>Code: <strong>${nonce}</strong></p><input aria-label="Verification code"><button onclick="fetch('/verify',{method:'POST',body:document.querySelector('input').value}).then(r=>r.text()).then(t=>document.querySelector('output').textContent=t)">Verify</button><output>Waiting</output>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const url='http://127.0.0.1:'+server.address().port,ownerId=crypto.randomUUID(),profileId=crypto.randomUUID(),trace=new JEe(),telemetry={capture(){},captureException(){}};
      manager=new UAe({getOperational:async id=>id===profileId?{id,source:{type:'energy'}}:null},{browserTabsPath:path.join(directory,'tabs.json')},{telemetry,traceStore:trace,resolvePersistedBrowserOwnerId:async id=>id,downloadPath:directory,passwordAutofill:{closeOwner(){},registerWebContents(){}},closeAgentBrowserSession:key=>JSe(executable,key)});
      await manager.activate({ownerId,profileId,url});
      const runner=Txe(manager,clipboard,(argv,cwd,options)=>WSe(argv,{cwd,executablePath:executable,...options}),(argv,connection,cwd,options)=>FSe(argv,connection.endpoint,{cdpIdentity:connection.identity,cwd,executablePath:executable,sessionKey:connection.sessionKey,tabId:connection.tabId,...options}),trace,()=>{},async()=>ownerId,async()=>null);
      gateway=await Gke({browser:{run:runner}});
      const home=path.join(directory,'home');fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'managed.toml'),'');fs.writeFileSync(path.join(home,'config.toml'),'[features]\nremote_plugin = false\n');
      client=new S9({home,configPath:path.join(home,'managed.toml'),cwd:directory,packageRoot:path.join(resources,'openai-codex'),marketplaces:{defaults:path.join(resources,'packages/codex-marketplaces/defaults'),nango:path.join(resources,'packages/codex-marketplaces/nango'),mcpEcosystem:path.join(resources,'packages/codex-marketplaces/mcp-ecosystem')},authCredentialsStore:'file',clientVersion:'0.1.0',threadContextProvider:false,env:{...gateway.browser.env,PATH:process.env.PATH},llmProxy:{baseUrl:JSON.parse(fs.readFileSync(path.join(directory,'config.json'),'utf8')).proxyUrl}});
      require('../desktop/harness-instructions.cjs').bindHarnessClient(client);guard=require('../desktop/execution-guard.cjs').bindExecutionGuard(client,{userId:()=>ownerId,maxToolCalls:35,maxDurationMs:150000});
      require('../desktop/codex-funding.cjs').bindCodexFunding({client,userId:()=>ownerId,chatgpt:{bindClient(){}},funding:{current:async()=>({source:'timewarp',canFundUsage:true})}});
      const events=[];client.on('notification',event=>{events.push(event);if(['turn/completed','error','item/completed'].includes(event.method))console.log(event.method,JSON.stringify(event.params));fs.writeFileSync(path.join(directory,'events.json'),JSON.stringify(events));});client.on('request',event=>client.respondError(event.id,{code:-32601,message:'Unavailable in acceptance'}));
      await client.start();await client.waitForDefaultBundledPlugins();
      async function run(name,text){
        const start=Date.now(),offset=events.length,created=await client.request('thread/start',{agentRole:'energy-task',model:'openai/gpt-5.6-luna',cwd:directory,approvalPolicy:'on-request',approvalsReviewer:'guardian_subagent',sandbox:'workspace-write',experimentalRawEvents:true,config:{model_reasoning_effort:'low','sandbox_workspace_write.network_access':true},developerInstructions:'Use tools to execute the task. All file work must stay inside the current fixture directory. Browser profile ID: '+profileId+'. Browser fixture URL: '+url+'.'}),id=created.thread.id;
        const complete=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{client.off('notification',listen);reject(Error(name+' timed out'));},165000);const listen=event=>{if(event.method==='turn/completed'&&event.params.threadId===id){clearTimeout(timer);client.off('notification',listen);resolve(event.params.turn);}};client.on('notification',listen);});
        await client.request('turn/start',{threadId:id,model:'openai/gpt-5.6-luna',effort:'low',input:[{type:'text',text}]});const turn=await complete;
        const captured=events.slice(offset),workers=[...new Set(captured.filter(e=>e.params.item?.type==='subAgentActivity').map(e=>e.params.item.agentThreadId))],summary={name,status:turn.status,durationMs:Date.now()-start,run:guard.snapshot([id])[0],spawned:workers.length,workerIds:workers};report.tasks.push(summary);console.log('Task result',JSON.stringify(summary));return{turn,captured,id};
      }
      if(!JSON.parse(fs.readFileSync(path.join(directory,'config.json'),'utf8')).browserOnly){
      const artifact=await run('file and no delegation','Do not delegate. Use your shell tool to create result.txt containing exactly HARNESS_OK in the current fixture directory. Read it back using a tool, then give a clickable absolute file link.');
      const outputs=artifact.captured.filter(e=>e.method==='rawResponseItem/completed'&&['custom_tool_call_output','function_call_output'].includes(e.params.item?.type));
      pass('artifactWrittenAndReadBack',fs.existsSync(path.join(directory,'result.txt'))&&fs.readFileSync(path.join(directory,'result.txt'),'utf8').trim()==='HARNESS_OK'&&JSON.stringify(outputs).includes('HARNESS_OK'));pass('noDelegationHonored',report.tasks.at(-1).spawned===0);
      const stopped=await run('stop on first error','Stop after the first tool error. Execute Get-Content ./missing-acceptance-file.txt. If it fails do not retry and do not create forbidden.txt.');
      pass('firstErrorStopsRun',/Stopped after the first tool error/.test(guard.snapshot([stopped.id])[0]?.reason||'')&&!fs.existsSync(path.join(directory,'forbidden.txt')));
      }
      const delegated=await run('visible browser worker',`Delegate to one browser subagent to open ${url}, read the displayed code, enter it in the Verification code field, click Verify, and read back the output. Pass the browser profile ${profileId} and all constraints. Wait for its completion using wait_agent and report the verified result. Do not poll list_agents. Do not use HTTP or filesystem access to bypass the browser.`);
      pass('browserActionIndependentlyVerified',submitted);report.verificationCode=nonce;
      Object.assign(report.checks,require('./harness-evidence.cjs').delegationChecks(delegated.captured,delegated.id,report.tasks.at(-1).workerIds,nonce));
      pass('completedTaskTimerStops',report.tasks.at(-1).run.endedAt!==null);
      const file=path.join(directory,'events.json');fs.writeFileSync(file,JSON.stringify(events,null,2));report.eventsFile=file;assert.ok(Object.values(report.checks).every(Boolean),'Some native acceptance checks failed');report.passed=true;
    }catch(error){report.passed=false;report.error=error.message;console.error(error.stack);code=1;}
    finally{guard?.stop();await client?.stop().catch(()=>{});await gateway?.stop().catch(()=>{});await manager?.dispose().catch(()=>{});await KSe(executable).catch(()=>{});server?.close();fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));app.exit(code);}
  });
}
