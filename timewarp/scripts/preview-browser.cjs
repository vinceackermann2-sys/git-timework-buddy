"use strict";
// A scripted demo through the packaged browser bridge. The conversation is
// illustrative; page reads, typing, clicks, and agent ownership are real.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), reports = path.join(root, 'reports/browser-demo');
const profileId = '715d6648-5093-49cb-a026-8efcd2399297', ownerId = 'deacfa0d-f7ca-46b4-9144-b1f760375f0d';

if (!process.versions.electron) {
  (async () => {
    const argument = process.argv.indexOf('--app-dir');
    const resources = path.join(argument < 0 ? path.join(root,'build/browser-cursor-preview') : path.resolve(process.argv[argument+1]), 'resources');
    assert.ok(fs.existsSync(path.join(resources, 'app.asar')), 'The verified browser preview build is required.');
    const fixtureJS = path.join(root, 'reports/workspace-preview.js');
    assert.ok(fs.existsSync(fixtureJS), 'Run verify:workspace to prepare the production pane fixture.');
    fs.mkdirSync(reports, { recursive: true });
    fs.mkdirSync(path.join(root, '.temp'), { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, '.temp/browser-demo-'));
    fs.copyFileSync(path.join(resources, 'app.asar'), path.join(directory, 'app.asar'));
    fs.cpSync(path.join(resources, 'agent-browser'), path.join(directory, 'agent-browser'), { recursive: true });
    fs.copyFileSync(path.join(resources, 'openai-codex/codex-path/browser.exe'), path.join(directory, 'browser.exe'));
    let renderer = fs.readFileSync(fixtureJS, 'utf8');
    const replace = (before, after) => { assert.ok(renderer.includes(before), before); renderer = renderer.replace(before, after); };
    replace('window.newco = { browserView: native };', 'window.newco = { browserView: window.browserPreview.native };');
    replace('window.workspaceCheck = workspaceCheck;', 'window.workspaceCheck = workspaceCheck;workspaceCheck.applyBrowser=state=>{active=state;publish()};window.browserPreview.onState(state=>workspaceCheck.applyBrowser(state));');
    assert.match(renderer, /^  var sx = .+;$/m, 'The fixture favicon provider is present.');
    renderer = renderer.replace(/^  var sx = .+;$/m, '  var sx = () => null;');
    renderer = renderer.replaceAll('profile-one', profileId).replaceAll('fixture-chat', ownerId);
    fs.writeFileSync(path.join(directory, 'pane.js'), renderer);
    fs.writeFileSync(path.join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('browserPreview',{native:Object.fromEntries(${JSON.stringify(['connect','show','hide','setLayout','createTab','selectTab','closeTab','setPinned','setAudioMuted','navigate','goBack','goForward','reload'])}.map(name=>[name,input=>ipcRenderer.invoke('demo:browser',name,input)])),onState:listener=>ipcRenderer.on('browserView:update',(_,state)=>listener(state))});`);
    // The status bar and cursor glyph come from the verified production bundle.
    const asar = await import('@electron/asar'), acorn = require('acorn');
    const ui = asar.extractFile(path.join(directory, 'app.asar'), path.join('out','renderer','assets','mermaid-GHXKKRXX-YWFhvrpV.js')).toString();
    const declarations = acorn.parse(ui, { ecmaVersion: 'latest', sourceType: 'module' }).body.flatMap(node => node.declarations || []);
    const extract = name => { const declaration = declarations.find(node => node.id.name === name); assert.ok(declaration, name); return 'const ' + ui.slice(declaration.start, declaration.end) + ';'; };
    const resolve = name => require.resolve(name, { paths: [root] });
    assert.ok(ui.includes('data-browser-cursor-badge'), 'Build the cursor badge before generating its preview.');
    const badgeDeclarations=['eRn','BIn','zIn','TWUseBrowserAgent','GIn','HIn','FIn','fhe','$In','XDe','VIn','UIn','WIn','phe','mhe','ZDe','fl','DIn','qIn','LIn','OIn','NIn','RIn','jIn','Uw'].map(extract).join('\n');
    require('esbuild').buildSync({ stdin: { contents: `import * as b from ${JSON.stringify(resolve('react'))};import * as h from ${JSON.stringify(resolve('react/jsx-runtime'))};import {createRoot} from ${JSON.stringify(resolve('react-dom/client'))};const te=(...classes)=>classes.filter(Boolean).join(' '),Ce=()=>null,ne=({size,variant,...props})=>h.jsx('button',{...props,className:'take-control '+(props.className||'')}),Tp=({avatar,className})=>avatar?h.jsx('img',{src:avatar.url,alt:'',className,style:{objectFit:'contain'}}):h.jsx('span',{className});${badgeDeclarations}function Overlay(){const[state,setState]=b.useState(null);b.useEffect(()=>window.browserPreview.onState(setState),[]);const agent=TWUseBrowserAgent(state?.threadId,state?.activeTurnId),cursor=state?.cursor??{x:innerWidth/2,y:innerHeight/2};return state?.activeTurnId?h.jsxs(h.Fragment,{children:[state.glowBounds&&h.jsx('div',{style:{position:'absolute',...{left:state.glowBounds.x,top:state.glowBounds.y,width:state.glowBounds.width,height:state.glowBounds.height},boxShadow:'inset 0 0 80px color-mix(in oklch, var(--color-primary) 95%, transparent)',opacity:.45}}),h.jsx('div',{style:{position:'absolute',left:cursor.x-5,top:cursor.y-5,width:24,height:24,color:'var(--color-primary)',filter:'drop-shadow(0 2px 4px rgba(0,0,0,.26))'},children:h.jsx(BIn,{})}),h.jsx(zIn,{bounds:{width:innerWidth,height:innerHeight},cursor,animate:false,summary:state.summary||'Working in the browser',agent}),h.jsx(eRn,{buttonShakeKey:0,hovered:true,takeControlDisabled:false,isTakingControl:false,onBlockedInteraction:()=>{},onTakeControl:()=>window.browserPreview.release()})]}):null}createRoot(document.getElementById('overlay')).render(h.jsx(Overlay,{}));`, resolveDir: root, loader: 'js' }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(directory, 'overlay.js'), define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(directory, 'overlay-preload.cjs'), `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('timewarp',{request:(action,input)=>ipcRenderer.invoke('demo:agent',input)});contextBridge.exposeInMainWorld('browserPreview',{onState:listener=>{ipcRenderer.on('browserOverlay:update',(_,state)=>listener(state));ipcRenderer.send('demo:overlayReady')},release:()=>ipcRenderer.invoke('demo:release')});`);
    const { pathToFileURL } = require('node:url');
    const overlayStyles = ['workspace-index-CgqM7Ghz.css','workspace-mermaid-GHXKKRXX-Cl4CJFD3.css'].map(file=>fs.readFileSync(path.join(root,'reports',file),'utf8')).concat(['appearance.css','browser-cursor.css'].map(file=>fs.readFileSync(path.join(root,'desktop',file),'utf8'))).join('\n');
    fs.writeFileSync(path.join(directory, 'overlay.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${overlayStyles}html,body,#overlay{margin:0;width:100%;height:100%;background:transparent}.take-control{background:#fff;color:#171717;padding:7px 13px;border:0;font:inherit}</style></head><body><div id="overlay"></div><script>${fs.readFileSync(path.join(directory,'overlay.js'),'utf8')}</script></body></html>`);
    const base = fs.readFileSync(path.join(root, 'reports/workspace-preview.html'), 'utf8');
    const mascot = pathToFileURL(path.join(root, 'assets/mascots/orbit.png')).href;
    const shell = `<div class="demo-shell"><aside class="demo-chat"><header><img src="${mascot}"><div><strong>Orbit</strong><span id="run-state">Working</span></div><span class="demo-badge">Demo task</span></header><div class="demo-messages"><p class="user-message">Check the browser integration guide and save a short verification note.</p><p class="agent-message">I’ll open the guide in the app’s browser and check the note form.</p><div class="activity"><small>Browser activity</small><ol id="activity"><li>Connecting to the app’s existing browser</li></ol><p id="current-action">Opening the guide…</p></div><p class="agent-message" id="result"></p></div><footer><span class="working-dot"></span><span id="footer-state">Orbit is working</span><button disabled aria-label="Stop demo">■</button></footer></aside><main id="preview"></main></div>`;
    const shellCSS = `html,body{width:100%;height:100%;overflow:hidden}.demo-shell input.text-transparent{color:transparent}.demo-shell{display:grid;grid-template-columns:420px minmax(0,1fr);height:100%;background:var(--color-background)}.demo-chat{display:flex;flex-direction:column;border-right:1px solid var(--color-border);min-height:0}.demo-chat header{height:74px;display:flex;align-items:center;gap:10px;padding:0 24px;border-bottom:1px solid var(--color-border)}.demo-chat header img{width:34px;height:34px;object-fit:contain}.demo-chat header div{display:flex;flex-direction:column;gap:2px}.demo-chat header strong{font-size:14px}.demo-chat header span{font-size:11px;color:var(--color-muted-foreground)}.demo-badge{margin-left:auto;border:1px solid var(--color-border);border-radius:14px;padding:4px 9px}.demo-messages{padding:28px 24px;flex:1;overflow:auto;font-size:14px;line-height:1.7}.user-message{background:var(--color-muted);border:1px solid var(--color-border);border-radius:14px;padding:16px;margin-bottom:24px}.agent-message{margin:0 0 24px}.activity{border:1px solid var(--color-border);border-radius:12px;padding:18px;margin-bottom:26px}.activity small{font-size:12px;color:var(--color-muted-foreground)}.activity ol{list-style:none;padding:0;margin:16px 0 0;display:grid;gap:12px;font-size:12px}.activity li{display:flex;gap:8px;align-items:flex-start}.activity li:before{content:'✓';color:#398757;font-weight:700}.activity p{font-size:12px;color:var(--color-muted-foreground);margin-top:16px}.demo-chat footer{padding:20px 24px;display:flex;gap:8px;align-items:center;font-size:12px;border-top:1px solid var(--color-border);color:var(--color-muted-foreground)}.demo-chat footer button{margin-left:auto;border:1px solid var(--color-border);border-radius:50%;width:28px;height:28px;color:var(--color-foreground)}.working-dot{width:7px;height:7px;background:#428aff;border-radius:50%}#preview{min-width:0;height:100%}`;
    fs.writeFileSync(path.join(directory, 'shell.html'), base.replace('</style>', shellCSS+'</style>').replace('<div id="preview"></div>', shell).replace('src="./workspace-preview.js"', 'src="./pane.js"'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = cp.spawnSync(require('electron'), [__filename, '--fixture', directory], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 });
    if (result.stdout) process.stdout.write(result.stdout);
    assert.equal(result.status, 0, result.stderr || 'Browser demo failed.');
    const frames = [{ file: 'reading.png', label: '1. Reading the guide' }, { file: 'typing.png', label: '2. Typing in the browser' }, { file: 'complete.png', label: '3. Note saved' }];
    fs.writeFileSync(path.join(reports, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Timewarp · Agent browser preview</title><style>body{margin:0;background:#f4f4f6;color:#24262b;font:14px system-ui}main{max-width:1280px;margin:32px auto;padding:0 24px}header{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:18px}h1{font-size:22px;margin:0 0 7px}p{margin:0;color:#686d75;font-size:13px}nav{display:flex;gap:6px;flex-wrap:wrap}button{background:white;color:inherit;border:1px solid #d9dde3;border-radius:8px;padding:9px 12px;cursor:pointer}button[aria-pressed=true]{background:#252a35;color:white;border-color:#252a35}img{display:block;width:100%;border:1px solid #d9dde3;border-radius:12px;box-shadow:0 12px 48px #262c3510}a{color:#4169ad}@media(max-width:900px){header{align-items:start;flex-direction:column}}</style></head><body><main><header><div><h1>Orbit working in the browser</h1><p>Scripted demo using the real app browser and harness. Chat text is illustrative.</p></div><nav>${frames.map((frame,index)=>`<button aria-pressed="${index===1}" data-frame="${index}">${frame.label}</button>`).join('')}</nav></header><img id="frame" src="typing.png" alt="Orbit typing a verification note in the Timewarp browser"><p style="margin-top:16px">Page reads, typing, clicks, and shared browser state were verified during this run.</p></main><script>const frames=${JSON.stringify(frames)};for(const button of document.querySelectorAll('button'))button.onclick=()=>{for(const item of document.querySelectorAll('button'))item.setAttribute('aria-pressed',String(item===button));document.getElementById('frame').src=frames[Number(button.dataset.frame)].file};</script></body></html>`);
    console.log('Saved browser demo screenshots and replay to ' + reports);
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, clipboard, protocol, ipcMain } = require('electron');
  const directory = process.argv[process.argv.indexOf('--fixture') + 1];
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(directory, 'profile'));
  const filename = path.join(directory, 'app.asar/out/main/index.js'), Module = require('node:module');
  const native = new Module(filename, module); native.filename = filename; native.paths = Module._nodeModulePaths(path.dirname(filename));
  let source = fs.readFileSync(filename, 'utf8');
  // Preserve the production overlay host, with an isolated renderer/preload.
  const overlayPreload = 'preload:k.join(__dirname,"../preload/index.js"),sandbox:!0,contextIsolation:!0,nodeIntegration:!1';
  assert.ok(source.includes(overlayPreload), 'The native browser overlay preload contract is present.');
  source = source.replace(overlayPreload, `preload:${JSON.stringify(path.join(directory,'overlay-preload.cjs'))},sandbox:!0,contextIsolation:!0,nodeIntegration:!1`);
  native._compile(source + '\nmodule.exports.browserDemo={UAe,Txe,WSe,FSe,OSe,JSe,KSe,JEe,Gke};', filename);
  const { UAe, Txe, WSe, FSe, OSe, JSe, KSe, JEe, Gke } = native.exports.browserDemo;
  app.whenReady().then(async () => {
    let manager, gateway, server, window;
    const executable = OSe({ isPackaged: true, resourcesPath: directory }), actions = [], badgeChecks = [];
    const threadId = crypto.randomUUID(), turnId = crypto.randomUUID();
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    let code = 0;
    try {
      protocol.handle('app', () => new Response(fs.readFileSync(path.join(directory, 'overlay.html')), { headers: { 'content-type': 'text/html' } }));
      server = require('node:http').createServer((request,response) => {
        response.setHeader('content-type','text/html; charset=utf-8');
        response.end(`<!doctype html><title>Browser integration · Timewarp docs</title><style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#fff;color:#262b34}nav{height:62px;border-bottom:1px solid #e9edf1;padding:0 34px;display:flex;align-items:center;gap:30px}nav strong{margin-right:auto;font-size:16px}nav span{font-size:12px;color:#707987}main{padding:40px 34px;max-width:750px;margin:auto}.crumb{color:#798291;font-size:12px}h1{font-size:30px;letter-spacing:-.7px;margin:18px 0 12px}p{line-height:1.8;color:#6c7685}section{border:1px solid #e2e7ee;border-radius:12px;padding:24px;margin:28px 0}h2{font-size:16px;margin:0 0 12px}ul{line-height:2.3;color:#5e6c7e;padding-left:22px}label{display:block;font-size:12px;font-weight:600;margin:24px 0 9px}input{width:100%;border:1px solid #d5dce7;border-radius:8px;padding:13px;font:13px system-ui}button{border:0;border-radius:8px;background:#3b6ce7;color:white;font:13px system-ui;padding:11px 20px;margin-top:12px;cursor:pointer}#saved{margin:18px 0 0;color:#35815a;font-size:13px;line-height:1.7}</style><nav><strong>Timewarp docs</strong><span>Guides</span><span>Browser</span><span>Local demo</span></nav><main><div class="crumb">Guides / Browser</div><h1>Browser integration</h1><p>Your agent can read pages, enter text, and click controls in the browser already available inside the app.</p><section><h2>What to check</h2><ul><li>Read this page through the harness</li><li>Type a note into the browser</li><li>Save the note and verify the result</li></ul><label for="note">Verification note</label><input id="note" placeholder="Write a short verification note"><button id="save" onclick="document.getElementById('saved').textContent='✓ Note saved: '+document.getElementById('note').value">Save note</button><div id="saved" role="status"></div></section></main>`);
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const url = 'http://127.0.0.1:'+server.address().port;
      const trace = new JEe();
      manager = new UAe({getOperational:async id=>id===profileId?{id,source:{type:'energy'}}:null},{browserTabsPath:path.join(directory,'tabs.json')},{telemetry:{capture(){},captureException(error){console.error(error.message)}},traceStore:trace,resolvePersistedBrowserOwnerId:async id=>id,downloadPath:directory,passwordAutofill:{closeOwner(){},registerWebContents(){}},closeAgentBrowserSession:key=>JSe(executable,key)});
      window = new BrowserWindow({ width:1280,height:820,useContentSize:true,show:false,webPreferences:{preload:path.join(directory,'preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false} });
      ipcMain.handle('demo:browser',async(event,name,input)=>{assert.equal(event.sender,window.webContents);try{if(name==='connect')await manager.activate(input);else if(name==='show'||name==='setLayout')await manager[name](window,input.ownerId,input.layout);else if(name==='hide')manager.hide(input.ownerId);else await manager[name](input);return{ok:true}}catch(error){console.error(name+': '+error.message);return{ok:false,error:error.message}}});
      ipcMain.on('demo:overlayReady',event=>manager.handleOverlayReady(event.sender));
      ipcMain.handle('demo:agent',async(event,input)=>{
        assert.equal(event.sender,manager.surfaceHost.overlayView?.webContents);
        return require('../desktop/browser-cursor.cjs').resolveCursorAgent({readSnapshot:()=>manager.surfaceHost.getSnapshot(),getUserId:()=> 'demo-owner',resolveAgent:async()=>({id:'orbit-demo',ownerUserId:'demo-owner',displayName:'Orbit',avatarType:'native',avatarUrl:'data:image/png;base64,'+fs.readFileSync(path.join(root,'assets/mascots/orbit.png')).toString('base64')})},input);
      });
      ipcMain.handle('demo:release',()=>manager.releaseBrowserTurn({threadId,turnId}));
      manager.subscribe(window.webContents);
      await window.loadFile(path.join(directory,'shell.html'));window.showInactive();await delay(600);
      const runner = Txe(manager,clipboard,(argv,cwd,options)=>WSe(argv,{cwd,executablePath:executable,...options}),(argv,connection,cwd,options)=>FSe(argv,connection.endpoint,{cdpIdentity:connection.identity,cwd,executablePath:executable,sessionKey:connection.sessionKey,tabId:connection.tabId,...options}),trace,()=>{},async()=>ownerId,async()=>null);
      gateway = await Gke({browser:{run:runner}});
      const env = {...process.env,...gateway.browser.env,PATH:directory+path.delimiter+(process.env.PATH||''),CODEX_THREAD_ID:threadId,CODEX_TURN_ID:turnId};
      const run = argv=>new Promise((resolve,reject)=>{const child=cp.spawn('browser.exe',argv,{cwd:directory,env:{...env,CODEX_TOOL_CALL_ID:crypto.randomUUID()},windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('close',exitCode=>{actions.push({command:argv,exitCode,output:stdout.trim()});exitCode===0?resolve(stdout.trim()):reject(Error(argv.join(' ')+': '+stderr))})});
      const evaluate = code=>window.webContents.executeJavaScript(code);
      const activity = async (items,current)=>evaluate(`document.getElementById('activity').replaceChildren(...${JSON.stringify(items)}.map(text=>{const item=document.createElement('li');item.textContent=text;return item}));document.getElementById('current-action').textContent=${JSON.stringify(current)}`);
      const capture = async name => {
        await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');await delay(500);
        assert.equal(await evaluate('!!document.querySelector("[data-workspace-home]")'),false,'The agent browser page is visible');
        const mount=manager.surfaceHost.mount;assert.ok(mount?.pageAttached,'Native browser page is attached');
        const page=mount.page.view.webContents, pageImage=await page.capturePage();
        const layers=[{bounds:mount.layout.pageBounds,image:pageImage.toDataURL()}];
        fs.writeFileSync(path.join(reports,'page-'+name),pageImage.toPNG());
        const overlay=manager.surfaceHost.overlayView;
        if(overlay&&!overlay.webContents.isDestroyed()){
          assert.ok(await overlay.webContents.executeJavaScript('!!document.querySelector("[data-browser-overlay-control]")'),'Production browser control overlay is rendered');
          const badge=await overlay.webContents.executeJavaScript('(()=>{const badge=document.querySelector("[data-browser-cursor-badge]"),image=badge?.querySelector("img"),bounds=badge?.getBoundingClientRect();return{agent:badge?.dataset.agentId,action:badge?.querySelector(".timewarp-browser-cursor-action")?.textContent,imageReady:image?.naturalWidth>0,width:bounds?.width,height:bounds?.height,x:bounds?.x,y:bounds?.y}})()');
          assert.equal(badge.agent,'orbit-demo');assert.equal(badge.action,manager.surfaceHost.getSnapshot().summary);assert.equal(badge.imageReady,true);assert.ok(badge.width<=280&&badge.height<=40&&badge.x>=0&&badge.y>=0,'Small badge stays beside the cursor');
          badgeChecks.push({frame:name,...badge});
          layers.push({bounds:overlay.getBounds(),image:(await overlay.webContents.capturePage()).toDataURL()});
        }
        // Electron captures each WebContentsView separately. Render their
        // untouched snapshots at their native bounds for the exported image.
        await evaluate(`for(const layer of ${JSON.stringify(layers)}){const image=new Image();image.className='demo-capture-layer';image.src=layer.image;Object.assign(image.style,{position:'fixed',left:layer.bounds.x+'px',top:layer.bounds.y+'px',width:layer.bounds.width+'px',height:layer.bounds.height+'px',zIndex:10000,pointerEvents:'none'});document.body.append(image)}Promise.all([...document.querySelectorAll('.demo-capture-layer')].map(image=>image.decode()))`);
        await delay(200);
        fs.writeFileSync(path.join(reports,name),(await window.webContents.capturePage()).toPNG());
        await evaluate('document.querySelectorAll(".demo-capture-layer").forEach(image=>image.remove())');
      };
      const existingTab = manager.runtimes.getState(ownerId).selectedTabId;
      assert.ok(existingTab, 'Reuse the browser tab already opened by the app');
      await run(['--profile',profileId,'tab',existingTab]);
      await run(['open',url]);await run(['wait','--text','Browser integration']);
      assert.match(await run(['snapshot','-i']),/Save note/);
      await activity(['Opened the guide in the app browser','Read the page and found the note form'],'Reading the browser integration guide');
      await capture('reading.png');
      await run(['fill','#note','Browser verified: reading, typing, and clicking work.']);
      await activity(['Opened the guide in the app browser','Read the page and found the note form','Typed the verification note'],'Entering a verification note');
      await capture('typing.png');
      const overlay=manager.surfaceHost.overlayView,originalBounds=overlay.getBounds(),snapshot=manager.surfaceHost.getSnapshot();
      for(const [width,height,dark] of [[860,788,false],[860,788,true],[260,360,false]]){
        overlay.setBounds({...originalBounds,width,height});
        await overlay.webContents.executeJavaScript(`document.documentElement.classList.toggle('dark',${dark})`);
        for(const [x,y] of [[2,2],[width-2,2],[2,height-2],[width-2,height-2]]){
          overlay.webContents.send('browserOverlay:update',{...snapshot,cursor:{...snapshot.cursor,x,y},summary:'Reading a browser page with a long activity description that must fit inside a small badge'});
          await delay(100);
          const layout=await overlay.webContents.executeJavaScript('(()=>{const badge=document.querySelector("[data-browser-cursor-badge]"),rect=badge.getBoundingClientRect();return{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,pointerEvents:getComputedStyle(badge).pointerEvents}})()');
          assert.ok(layout.x>=0&&layout.y>=0&&layout.right<=layout.viewportWidth&&layout.bottom<=layout.viewportHeight,'Cursor badge stays within the browser surface at every corner');
          assert.equal(layout.pointerEvents,'none');assert.ok(layout.height<=40&&layout.width<=280);
          badgeChecks.push({width,height,dark,cursor:{x,y},...layout});
        }
      }
      overlay.setBounds(originalBounds);await overlay.webContents.executeJavaScript('document.documentElement.classList.remove("dark")');overlay.webContents.send('browserOverlay:update',snapshot);
      assert.equal(await run(['get','value','#note']),'Browser verified: reading, typing, and clicking work.');
      await run(['click','#save']);await run(['wait','--text','Note saved:']);assert.match(await run(['get','text','#saved']),/Note saved: Browser verified/);
      await activity(['Opened the guide in the app browser','Read the page and found the note form','Typed the verification note','Clicked Save note and verified the result'],'Note saved successfully');
      await evaluate(`document.getElementById('result').textContent='The note was saved successfully. Reading, typing, and clicking worked in the same browser tab.';document.getElementById('run-state').textContent='Complete';document.getElementById('footer-state').textContent='Demo task complete'`);
      await run(['tab','release']);await capture('complete.png');
      assert.equal(manager.surfaceHost.getSnapshot().activeTurnId,null,'Cursor badge disappears when control is released');
      fs.writeFileSync(path.join(reports,'run.json'),JSON.stringify({createdAt:new Date().toISOString(),scriptedDemo:true,realPackagedBrowser:true,illustrativeConversation:true,actions,badgeChecks},null,2));
    }catch(error){console.error(error.stack);code=1}
    finally{await gateway?.stop().catch(()=>{});await manager?.dispose().catch(()=>{});await KSe(executable).catch(()=>{});window?.destroy();server?.close();app.exit(code)}
  }).catch(error=>{console.error(error.stack);app.exit(1)});
}
