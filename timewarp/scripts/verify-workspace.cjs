"use strict";
// Render the patched production pane with an isolated native-browser API fixture.
// No real account, local workspace, or browser profile is modified.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), reports = path.join(root, 'reports');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(root, 'backups/workspace-ui-verification-profile'));
  app.whenReady().then(async () => {
    const stage = value => fs.writeFileSync(path.join(reports,'workspace-progress.json'),JSON.stringify({stage:value,at:new Date().toISOString()}));
    stage('ready');
    const window = new BrowserWindow({ width: 540, height: 820, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    let exitCode = 0;
    const errors = [];
    try {
      window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
      stage('loading');
      await window.loadFile(path.join(reports, 'workspace-preview.html'));
      stage('loaded');
      const evaluate = async code => {stage(code.slice(0,300));try{return await window.webContents.executeJavaScript(code)}catch(error){throw Error(code+'\n'+error.message)}};
      const pause = () => new Promise(resolve => setTimeout(resolve, 100));
      const click = async selector => { assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(); };
      const search = async value => {
        await evaluate(`(()=>{const input=document.querySelector('[aria-label="Search or enter a URL"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        await pause();
        await evaluate(`document.querySelector('[aria-label="Search or enter a URL"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); await pause();
      };
      await pause();
      assert.equal(await evaluate('!!document.querySelector("[data-workspace-home]")'), true);
      assert.equal(await evaluate('document.querySelectorAll(".fixture-header").length'), 0);
      assert.equal(await evaluate('workspaceCheck.browser.tabs[0].url'), 'about:blank');
      assert.equal(await evaluate('workspaceCheck.calls.some(call=>call.action==="show")'), false);
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".timewarp-workspace-tool-copy strong")).map(item=>item.textContent).join(",")'), 'Agent,Files');
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-workspace-site").length'), 0);
      await click('.timewarp-workspace-tool-card');
      assert.equal(await evaluate('!!document.querySelector("#agent-content")'), true);
      assert.equal(await evaluate('!!document.querySelector("[data-browser-chrome-target=address]")'), true);
      const agentTab = await evaluate('workspaceCheck.browser.selectedTabId');
      await click('[aria-label="Add browser tab"]');
      assert.equal(await evaluate('workspaceCheck.browser.tabs.length'), 2);
      assert.equal(await evaluate('!!document.querySelector("[data-workspace-home]")'), true);
      await click(`[data-browser-chrome-target="tab:${agentTab}"]`);
      assert.equal(await evaluate('!!document.querySelector("#agent-content")'), true);
      await click('[aria-label="Back to browser home"]');
      await click('.timewarp-workspace-tool-card:last-child');
      assert.equal(await evaluate('!!document.querySelector("#files-content")'), true);
      await click('#open-test-file');
      assert.equal(await evaluate('document.querySelector("#file-preview").textContent'), '/workspace/notes.md');
      await click('[aria-label="Back to browser home"]');
      await search('timewarp browser layout');
      assert.equal(await evaluate('workspaceCheck.browser.tabs.find(tab=>tab.id===workspaceCheck.browser.selectedTabId).url'), 'https://www.google.com/search?q=timewarp%20browser%20layout');
      assert.ok(await evaluate('workspaceCheck.calls.some(call=>call.action==="show")'));
      await search('example.com');
      assert.equal(await evaluate('workspaceCheck.browser.tabs.find(tab=>tab.id===workspaceCheck.browser.selectedTabId).url'), 'https://example.com/');
      await click('[aria-label="Go back"]');
      await click('[aria-label="Go forward"]');
      await click('[aria-label="Refresh"]');
      assert.deepEqual(await evaluate('workspaceCheck.calls.filter(call=>["goBack","goForward","reload"].includes(call.action)).map(call=>call.action)'), ['goBack', 'goForward', 'reload']);
      await click('[aria-label="Browser home"]');
      assert.equal(await evaluate('!!document.querySelector("[data-workspace-home]")'), true);
      assert.ok(await evaluate('Array.from(document.querySelectorAll(".timewarp-workspace-site")).some(button=>button.title==="https://example.com/")'));
      await click('.timewarp-workspace-site[title="https://example.com/"]');
      assert.equal(await evaluate('workspaceCheck.browser.tabs.find(tab=>tab.id===workspaceCheck.browser.selectedTabId).url'), 'https://example.com/');
      await click('[aria-label="Browser home"]');
      await evaluate('workspaceCheck.profile("profile-two")'); await pause();
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-workspace-site").length'), 0);
      await search('second-profile.example');
      await click('[aria-label="Browser home"]');
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-workspace-site").length'), 1);
      await evaluate('workspaceCheck.profile("profile-one")'); await pause();
      await click('[aria-label="Browser home"]');
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".timewarp-workspace-site")).some(button=>button.title.includes("second-profile"))'), false);
      await evaluate('workspaceCheck.remount()'); await pause();
      assert.ok(await evaluate('document.querySelectorAll(".timewarp-workspace-site").length>0'));
      for(const url of ['https://figma.com/','https://notion.so/','https://github.com/','https://linear.app/','https://linear.app/settings'])await search(url);
      await click('[aria-label="Browser home"]');
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-workspace-site").length'),4);
      assert.equal(await evaluate('new Set(Array.from(document.querySelectorAll(".timewarp-workspace-site")).map(button=>new URL(button.title).origin)).size'),4);
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-workspace-site-icon img").length'),4);
      await evaluate(`(()=>{const image=document.querySelector('.timewarp-workspace-site-icon img');image.dispatchEvent(new Event('error'))})()`);await pause();
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-workspace-site-icon svg").length'),1);
      // Closing the final browser tab keeps the unified pane open at a fresh home.
      await evaluate('workspaceCheck.onlyOneTab()'); await pause();
      const remaining = await evaluate('workspaceCheck.browser.selectedTabId');
      await click(`[data-browser-chrome-target="tab-close:${remaining}"]`);
      assert.equal(await evaluate('workspaceCheck.browser.tabs.length'), 1);
      assert.equal(await evaluate('!!document.querySelector("[data-workspace-home]")'), true);
      // Reset only the fixture's browser surface; persisted recommendations survive.
      // Finish theme changes immediately in the hidden window's paused compositor.
      await evaluate('document.querySelectorAll(".timewarp-workspace-tool-card,.timewarp-workspace-site").forEach(button=>button.style.transition="none")');
      const layouts = [];
      for (const [width, height, dark] of [[540, 820, false], [540, 820, true], [360, 740, false]]) {
        window.setSize(width, height);
        await evaluate(`document.documentElement.classList.toggle('dark',${dark});document.documentElement.style.colorScheme=${JSON.stringify(dark ? 'dark' : 'light')}`); await pause();
        const layout = await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,toolbarOverflow:document.querySelector(".timewarp-browser-toolbar").scrollWidth>document.querySelector(".timewarp-browser-toolbar").clientWidth,inputWidth:document.querySelector("[data-browser-chrome-target=address]").getBoundingClientRect().width})');
        assert.equal(layout.overflow, false); assert.equal(layout.toolbarOverflow, false); assert.ok(layout.inputWidth > 90);
        const cards=await evaluate('({tools:Array.from(document.querySelectorAll(".timewarp-workspace-tool-card")).map(button=>button.getBoundingClientRect().height),favicon:document.querySelector(".timewarp-workspace-site-icon").getBoundingClientRect().width,center:document.querySelector(".timewarp-workspace-home-content").getBoundingClientRect().left+document.querySelector(".timewarp-workspace-home-content").getBoundingClientRect().width/2,pane:document.querySelector("[data-workspace-home]").getBoundingClientRect().left+document.querySelector("[data-workspace-home]").clientWidth/2})');
        assert.ok(cards.tools.every(height=>height>=150));assert.ok(cards.favicon>=64);assert.ok(Math.abs(cards.center-cards.pane)<2);
        const colors=await evaluate('(()=>{const button=document.querySelector(".timewarp-workspace-tool-card"),style=getComputedStyle(button);return{background:style.backgroundColor,foreground:style.color,themeBackground:style.getPropertyValue("--color-background"),themeForeground:style.getPropertyValue("--color-foreground")}})()');
        layouts.push({ width, height, dark, ...layout,colors });
        await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
        await new Promise(resolve=>setTimeout(resolve,300));
        await window.webContents.capturePage().then(image => fs.writeFileSync(path.join(reports, `workspace-${width}-${dark ? 'dark' : 'light'}.png`), image.toPNG()));
      }
      await evaluate('workspaceCheck.noProfiles()'); await pause();
      assert.equal(await evaluate('!!document.querySelector("[data-workspace-home]")'), true);
      await click('.timewarp-workspace-tool-card:last-child');
      assert.equal(await evaluate('!!document.querySelector("#files-content")'), true);
      assert.deepEqual(errors, []);
      fs.rmSync(path.join(reports,'workspace-error.txt'),{force:true});
      fs.writeFileSync(path.join(reports, 'workspace-ui.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), nativeBrowser: 'isolated API fixture', checks: ['default tab without Chat or Workspace heading', 'Agent and Files with persistent toolbar', 'file opening', 'multiple tabs and tool restoration', 'URL and search navigation', 'back/forward/refresh', 'native page visibility', 'recent visits and reopen', 'four distinct recommended websites', 'large native favicons with error fallback', 'centered large tool cards', 'profile isolation', 'history persistence', 'last tab returns home', 'tools without a browser profile', 'light/dark/narrow layout'], layouts }, null, 2));
      console.log('Verified unified Workspace UI, tabs, tools, search, browser actions, profile isolation and light/dark/narrow layouts.');
    } catch (error) { fs.writeFileSync(path.join(reports,'workspace-error.txt'),error.stack+'\n'+errors.join('\n'));console.error(error.stack); if(errors.length)console.error(errors.join('\n')); exitCode = 1; }
    finally { stage('exiting '+exitCode); app.exit(exitCode); }
  });
} else {
  (async () => {
    const acorn = require('acorn'), cp = require('node:child_process'), { pathToFileURL } = require('node:url');
    const { patchWorkspacePane } = require('./workspace-pane.cjs');
    const asar = await import('@electron/asar');
    const original = asar.extractFile(path.resolve(root, '../energy-testv1/build/app.asar.pristine'), path.join('out', 'renderer', 'assets', 'mermaid-GHXKKRXX-YWFhvrpV.js')).toString('utf8');
    const ui = patchWorkspacePane(original);
    assert.throws(() => patchWorkspacePane('changed upstream bundle'), /contract changed/);
    const declarations = acorn.parse(ui, { ecmaVersion: 'latest', sourceType: 'module' }).body.flatMap(node => node.declarations || []);
    const extract = names => names.map(name => { const node = declarations.find(item => item.id.name === name); assert.ok(node, name); return 'const ' + ui.slice(node.start, node.end) + ';'; }).join('\n');
    const dependencyRoot = path.resolve(__dirname,'..');
    const resolve = name => require.resolve(name, { paths: [dependencyRoot] });
    const renderer = path.join(root, 'build/app/out/renderer');
    const entry = `import * as b from ${JSON.stringify(resolve('react'))};
      import * as h from ${JSON.stringify(resolve('react/jsx-runtime'))};
      import {createRoot} from ${JSON.stringify(resolve('react-dom/client'))};
      import {Globe as b4,Folder as Whe,ArrowRight as j2,ArrowLeft as _$,RefreshCw as hFe,VolumeX as fD,Volume2 as ofe,Plus as Pn,X as Ai,Loader as Ce,User as A8,MessageCircle as Qhe} from ${JSON.stringify(resolve('lucide-react'))};
      const profileList=[{id:'profile-one',label:'Personal'},{id:'profile-two',label:'Work'}],calls=[],paneContext=b.createContext(null),browserContext=b.createContext(null);
      let api,setBrowser,allProfiles=profileList,active=null,updateProfiles,rerender,serial=0;
      const ok={ok:true};
      const clone=()=>({...active,tabs:[...active.tabs]});
      const publish=()=>{setBrowser(clone());};
      const makeTab=(url,profileId=active.selectedProfileId)=>({id:'tab-'+(++serial),profileId,url,title:url==='about:blank'?'':new URL(url).hostname,history:[url],historyIndex:0,isLoading:false,canGoBack:false,canGoForward:false,isAudioMuted:true});
      const selected=()=>active.tabs.find(tab=>tab.id===active.selectedTabId);
      const call=async(action,input,mutate)=>{calls.push({action,input});mutate?.();publish();return ok};
      const native={connect:input=>call('connect',input,()=>{active.selectedProfileId=input.profileId;let tab=selected()?.profileId===input.profileId?selected():active.tabs.find(tab=>tab.profileId===input.profileId);if(!tab){tab=makeTab(input.url,input.profileId);active.tabs.push(tab)}active.selectedTabId=tab.id}),
        createTab:input=>call('createTab',input,()=>{const tab=makeTab(input.url);active.tabs.push(tab);active.selectedTabId=tab.id}),
        selectTab:input=>call('selectTab',input,()=>{active.selectedTabId=input.tabId;active.selectedProfileId=selected().profileId}),
        closeTab:input=>call('closeTab',input,()=>{active.tabs=active.tabs.filter(tab=>tab.id!==input.tabId);if(active.selectedTabId===input.tabId)active.selectedTabId=active.tabs.at(-1)?.id||null}),
        navigate:input=>call('navigate',input,()=>{const tab=selected();tab.url=input.url;tab.title=new URL(input.url).hostname;tab.history=tab.history.slice(0,tab.historyIndex+1).concat(input.url);tab.historyIndex++;tab.canGoBack=true;tab.canGoForward=false}),
        goBack:input=>call('goBack',input,()=>{const tab=selected();tab.historyIndex--;tab.url=tab.history[tab.historyIndex];tab.title=new URL(tab.url).hostname;tab.canGoBack=tab.historyIndex>0;tab.canGoForward=true}),
        goForward:input=>call('goForward',input,()=>{const tab=selected();tab.historyIndex++;tab.url=tab.history[tab.historyIndex];tab.title=new URL(tab.url).hostname;tab.canGoBack=true;tab.canGoForward=tab.historyIndex<tab.history.length-1}),
        reload:input=>call('reload',input),show:input=>call('show',input),hide:input=>call('hide',input),setLayout:input=>{calls.push({action:'setLayout',input})},setAudioMuted:input=>call('setAudioMuted',input),setPinned:input=>call('setPinned',input)};
      window.newco={browserView:native};
      const workspaceCheck={calls,get browser(){return active},profile:id=>api.onSelectProfile(id),remount:()=>rerender(value=>value+1),onlyOneTab:()=>{active.tabs=[selected()];publish()},noProfiles:()=>{allProfiles=[];active={selectedProfileId:null,selectedTabId:null,tabs:[]};publish();updateProfiles(value=>value+1)}};window.workspaceCheck=workspaceCheck;
      const te=(...items)=>items.filter(Boolean).join(' '),Ba=()=>b.useContext(paneContext),Ix=()=>b.useContext(browserContext),is=()=>({layout:'split',setLayout:()=>{}}),rc=()=> 'local';
      function $n(key,initial){const[value,setValue]=b.useState(()=>{try{return JSON.parse(localStorage.getItem(key))??initial}catch{return initial}});const set=b.useCallback(next=>setValue(previous=>{const result=typeof next==='function'?next(previous):next;localStorage.setItem(key,JSON.stringify(result));return result}),[key]);return[value,set]}
      const ne=b.forwardRef(({variant,size,render,nativeButton,children,...props},ref)=>h.jsx('button',{...props,ref,className:te('fixture-button',size?.includes('icon')&&'fixture-icon',props.className),children})),Ln=b.forwardRef((props,ref)=>h.jsx('input',{...props,ref}));
      const Tf=({children})=>h.jsx(h.Fragment,{children}),Kc={div:({initial,animate,exit,transition,onUpdate,onAnimationComplete,...props})=>h.jsx('div',{...props,style:{...props.style,width:animate?.width}})};
      const Wr=({children,viewportRef,orientation,fade,scrollbar,...props})=>h.jsx('div',{...props,ref:viewportRef,style:{overflow:'auto',scrollbarWidth:'none'},children});
      const DMn=()=>({animatedAddress:null}),BMn=url=>{try{return new URL(url).hostname}catch{return ''}},UMn=props=>{api=props;return h.jsx('button',{className:'fixture-button fixture-icon','aria-label':'Browser profile: '+props.selectedProfile.label,title:props.selectedProfile.label,children:h.jsx(A8,{})})},VMn=()=>h.jsx('p',{children:'Choose a browser profile in Settings to start browsing.'}),ur='a';
      const jDe=({children})=>children,$e={error:message=>{throw Error(message)}},sx=url=>!url||url==='about:blank'?null:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#B7D6FF"/><text x="32" y="43" text-anchor="middle" font-family="system-ui" font-size="32" fill="#16243d">'+new URL(url).hostname.slice(0,1).toUpperCase()+'</text></svg>');
      const _o=({leading,actions,children,className})=>h.jsxs('header',{className:te('fixture-header',className),children:[h.jsxs('div',{className:'fixture-header-row',children:[leading,h.jsx('div',{className:'fixture-header-actions',children:actions})]}),children]}),Vw=({label,onClick})=>h.jsx('button',{onClick,children:label}),GMn=()=>h.jsx('span',{children:'↗'}),zTe=({value,onChange})=>h.jsx('input',{'aria-label':'Search workspace files',placeholder:'Search files',value,onChange:event=>onChange(event.target.value)}),_W=()=>null;
      const aL=({children})=>h.jsx('div',{className:'flex items-center',children}),BK=({label,onSelect,onClose})=>h.jsxs('div',{children:[h.jsx('button',{onClick:onSelect,children:label}),onClose&&h.jsx('button',{onClick:onClose,children:'×'})]}),WMn=()=>null,a1=()=>null,Qn=p=>p.split('/').at(-1);
      const kMn=({filePath})=>h.jsx('div',{id:'file-preview',children:filePath}),d_n=()=>{const pane=Ba();return h.jsxs('div',{id:'files-content',className:'fixture-tool-content',children:[h.jsx('strong',{children:'Workspace files'}),h.jsx('button',{id:'open-test-file',onClick:()=>pane.openFile({mount:'task',path:'/workspace/notes.md'}),children:'notes.md'})]})},h_n=()=>h.jsx('div',{children:'No workspace'});
      const local={trpc:{entities:{browserProfiles:{list:{}}}}};local.trpc.entities.browserProfiles.list.useQuery=()=>({data:allProfiles,isPending:false,isError:false,refetch:async()=>{}});const M0=()=>local;
      ${extract(['s_','che','FMn','zMn','lhe','LMn','TMn','ODe','MMn','ohe','ihe','ahe','PMn','IMn','NMn','CMn','DDe','LDe','jMn','RMn','YMn','ZMn','qMn','HMn','$Mn','KMn','TWWorkspaceHome','TWRecents'])}
      function Preview(){const[mode,setMode]=b.useState('browser'),[browser,saveBrowser]=b.useState({selectedProfileId:null,selectedTabId:null,tabs:[]}),[file,setFile]=b.useState(null),[opened,setOpened]=b.useState([]),[revision,setRevision]=b.useState(0),[,refresh]=b.useState(0);active=browser;setBrowser=saveBrowser;rerender=setRevision;updateProfiles=refresh;const pane={mode,setMode:kind=>{if(kind==='files')setFile(null);setMode(kind)},openItems:opened,selectedItem:file,openFile:input=>{const item={...input,id:'file:'+input.path,type:'file'};setFile(item);setOpened([item]);setMode('files')},selectItem:()=>{setFile(opened[0]);setMode('files')},closeItem:()=>{setFile(null);setOpened([])},clearPendingBrowserUrl:()=>{}};return h.jsx(paneContext.Provider,{value:pane,children:h.jsx(browserContext.Provider,{value:browser,children:h.jsx(KMn,{browserOwnerId:'fixture-chat',rootThreadId:'fixture-chat',rootPath:'/workspace',assistant:h.jsxs('div',{id:'agent-content',className:'fixture-tool-content',children:[h.jsx('strong',{children:'Agent'}),h.jsx('p',{children:'The existing agent instructions and activity open here.'})]}),assistantIcon:h.jsx('img',{src:${JSON.stringify(pathToFileURL(path.join(root,'assets/mascots/orbit.png')).href)},alt:''})},revision)})})}
      localStorage.clear();createRoot(document.getElementById('preview')).render(h.jsx(Preview,{}));`;
    fs.mkdirSync(reports, { recursive: true });
    require(resolve('esbuild')).buildSync({ stdin: { contents: entry, resolveDir: dependencyRoot, loader: 'js' }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(reports, 'workspace-preview.js'), define: { 'process.env.NODE_ENV': '"production"' } });
    const styles = ['assets/index-CgqM7Ghz.css','assets/mermaid-GHXKKRXX-Cl4CJFD3.css','timewarp-appearance.css','timewarp-controls.css'].map(file => `<link rel="stylesheet" href="${pathToFileURL(path.join(renderer,file)).href}">`).join('');
    fs.writeFileSync(path.join(reports, 'workspace-preview.html'), `<!doctype html><html><head><meta charset="utf-8">${styles}<link rel="stylesheet" href="${pathToFileURL(path.join(root,'desktop/workspace.css')).href}"><style>html,body,#preview{height:100%;margin:0}button{font:inherit}.fixture-header-row{display:flex;height:42px;align-items:center;justify-content:space-between;padding:0 12px}.fixture-header-actions{display:flex;align-items:center;gap:8px}.fixture-button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;padding:4px;cursor:pointer;color:inherit}.fixture-button:hover{background:var(--color-accent)}.fixture-icon{width:28px;height:28px;flex-shrink:0}.fixture-icon svg{width:15px;height:15px}input{min-width:0;width:100%;color:inherit;background:transparent}input:focus{outline:1px solid var(--color-ring)}.fixture-tool-content{padding:24px;display:flex;flex-direction:column;gap:16px}body{background:var(--color-background);color:var(--color-foreground)}</style><title>Workspace verification preview</title></head><body><div id="preview"></div><script>window.addEventListener('error',event=>console.error(event.error?.stack||event.message));</script><script src="./workspace-preview.js"></script></body></html>`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const started = Date.now();
    const stdoutFile=path.join(reports,'workspace-stdout.txt'),stderrFile=path.join(reports,'workspace-stderr.txt');
    const descriptors=[fs.openSync(stdoutFile,'w'),fs.openSync(stderrFile,'w')];
    const result = cp.spawnSync(require(resolve('electron')), [__filename], { env, windowsHide: true, stdio:['ignore',...descriptors], timeout: 45000 });
    descriptors.forEach(descriptor=>fs.closeSync(descriptor));
    process.stdout.write(fs.readFileSync(stdoutFile,'utf8'));
    const report = path.join(reports, 'workspace-ui.json');
    if (result.status !== 0 || !fs.existsSync(report) || fs.statSync(report).mtimeMs < started) { process.stderr.write(fs.readFileSync(stderrFile,'utf8')); process.exitCode = 1; }
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
