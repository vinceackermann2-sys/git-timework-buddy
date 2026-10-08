"use strict";
// Render the component extracted from the staged bundle with native-shaped
// activity events. No account, model calls or user's chat content is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),reports=path.join(root,'reports');
if(process.versions.electron){
  const {app,BrowserWindow}=require('electron');app.setPath('userData',path.join(root,'.temp/task-activity-profile'));
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({width:880,height:800,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}),errors=[],checks=[],layouts=[];
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    const evaluate=code=>win.webContents.executeJavaScript(code),pause=()=>new Promise(r=>setTimeout(r,80));
    try{
      await win.loadFile(path.join(reports,'task-activity-preview.html'));await pause();
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-activity-worker").length'),2);
      await evaluate('document.querySelectorAll(".timewarp-activity-worker")[1].click()');assert.equal(await evaluate('window.activityCheck.followed'),'worker-2');checks.push('follow button opens the matching worker');
      await evaluate('document.querySelector(".timewarp-activity-toggle").click()');await pause();assert.equal(await evaluate('document.querySelector(".timewarp-activity-toggle").getAttribute("aria-expanded")'),'false');assert.equal(await evaluate('document.querySelectorAll(".timewarp-activity-worker").length'),0);
      await evaluate('document.querySelector(".timewarp-activity-toggle").click()');await pause();checks.push('expand/collapse');
      for(const [state,label]of [['paused','Needs input'],['failed','Failed'],['interrupted','Stopped'],['completed','Finished'],['running','Working']]){
        await evaluate(`window.activityCheck.update(${JSON.stringify(state)})`);await pause();assert.equal(await evaluate('document.querySelector(".timewarp-worker-status").textContent'),label);
      }checks.push('live running, waiting, failed, stopped, finished transitions');
      await evaluate('window.activityCheck.disconnected(true)');await pause();assert.match(await evaluate('document.querySelector(".timewarp-activity-summary").textContent'),/Reconnecting/);checks.push('disconnection never claims completion');await evaluate('window.activityCheck.disconnected(false)');await pause();
      await evaluate('window.activityCheck.stop()');await pause();assert.match(await evaluate('document.querySelector("[role=alert]").textContent'),/Stopped after the first/);assert.equal(await evaluate('document.querySelector(".timewarp-activity-summary").textContent'),'Stopping…');await evaluate('window.activityCheck.update("interrupted")');await pause();assert.equal(await evaluate('document.querySelector(".timewarp-activity-summary").textContent'),'Stopped');checks.push('controller stop reason and cancellation acknowledgement arrive through event subscription');
      for(const [width,height,dark]of [[880,800,false],[880,800,true],[360,740,false]]){
        win.setSize(width,height);await evaluate(`document.documentElement.classList.toggle('dark',${dark})`);await pause();
        const layout=await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,workers:[...document.querySelectorAll(".timewarp-activity-worker")].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})),cardHeight:document.querySelector(".timewarp-task-activity").getBoundingClientRect().height})');
        assert.equal(layout.overflow,false);assert.ok(layout.workers.every(item=>item.width>100&&item.height>=44));assert.ok(layout.cardHeight<=261);layouts.push({width,height,dark,...layout});
        await win.webContents.capturePage().then(image=>fs.writeFileSync(path.join(reports,`task-activity-${width}-${dark?'dark':'light'}.png`),image.toPNG()));
      }checks.push('light, dark, narrow layouts without overflow');assert.deepEqual(errors,[]);
      fs.writeFileSync(path.join(reports,'task-activity-ui.json'),JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,checks,layouts},null,2));console.log(JSON.stringify({passed:true,checks}));
    }catch(error){console.error(error.stack);process.exitCode=1;}finally{win.destroy();app.exit(process.exitCode||0);}
  });
}else{
  const cp=require('node:child_process'),acorn=require('acorn'),renderer=path.join(root,'build/app/out/renderer');
  const ui=fs.readFileSync(path.join(renderer,'assets/mermaid-GHXKKRXX-YWFhvrpV.js'),'utf8');
  assert.ok(ui.includes('i&&!g&&h.jsx(TimewarpTaskActivity'));assert.ok(ui.includes('"aria-label":"View task activity"'));assert.ok(ui.includes('a&&h.jsx(b.Suspense,{fallback:null,children:h.jsx(Qkn,'));
  const declaration=acorn.parse(ui,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).find(n=>n.id.name==='TimewarpTaskActivity');assert.ok(declaration);
  const component='const '+ui.slice(declaration.start,declaration.end)+';';
  fs.mkdirSync(reports,{recursive:true});
  const source=`import b from 'react';import * as h from 'react/jsx-runtime';import {createRoot} from 'react-dom/client';
const Context=b.createContext(null),VG=()=>b.useContext(Context);${component}
window.activityCheck={followed:null};let callback;window.timewarp={request:async()=>window.activityCheck.runs||[],onExecutionChanged:fn=>{callback=fn;return()=>{callback=null;}}};
function Preview(){const [status,setStatus]=b.useState('running'),[error,setError]=b.useState(false);window.activityCheck.update=setStatus;window.activityCheck.disconnected=setError;window.activityCheck.stop=()=>{window.activityCheck.runs=[{id:'run',stopped:true,toolCalls:5,failures:1,inputTokens:2400,cachedTokens:1900,reason:'Stopped after the first tool error, as requested. Open activity for the exact error; the task is unfinished.'}];callback?.();};
const activity={conversationId:'fixture',error,activities:[{kind:'state',threadId:'parent',state:{status:'running'}},...['worker-1','worker-2'].map((threadId,i)=>({kind:'state',threadId,parentThreadId:'parent',name:i?'Verify results':'Browser research',state:{status,error:{message:'Page could not be loaded'},reason:'Waiting for your input'}})),{kind:'commentary',threadId:'worker-1',text:'Comparing the sources and checking the details',createdAt:'2026-10-08T12:00:00Z'}]};
return h.jsx(Context.Provider,{value:activity,children:h.jsx(TimewarpTaskActivity,{onOpenDetails:id=>{window.activityCheck.followed=id;}})});}createRoot(document.getElementById('activity')).render(h.jsx(Preview,{}));`;
  require('esbuild').buildSync({stdin:{contents:source,resolveDir:root},bundle:true,platform:'browser',outfile:path.join(reports,'task-activity-preview.js')});
  const css=fs.readFileSync(path.join(renderer,'timewarp-task-activity.css'),'utf8');
  fs.writeFileSync(path.join(reports,'task-activity-preview.html'),`<!doctype html><html><head><meta charset="utf-8"><style>:root{--color-background:#fffcf8;--color-foreground:#2d2a35;--color-border:#e5dfe8;--color-muted-foreground:#706877;--color-accent:#eee7f8;--timewarp-accent-ink:#745ba4;--color-ring:#9072be}.dark{--color-background:#24222a;--color-foreground:#efebf5;--color-border:#45404e;--color-muted-foreground:#b6aec2;--color-accent:#383041;--timewarp-accent-ink:#c7a8ee}*{box-sizing:border-box}body{margin:0;background:var(--color-background);color:var(--color-foreground);font:14px system-ui}header{padding:20px 24px;border-bottom:1px solid var(--color-border);font-weight:600}main{max-width:800px;margin:25px auto}.message{padding:18px 24px;line-height:1.6}.muted{color:var(--color-muted-foreground)}button{font:inherit}${css}</style></head><body><header>Timewarp · Task activity</header><main><div class="message">Research the options and verify the result.<p class="muted">I’m checking the sources. You can follow each worker below.</p></div><div id="activity"></div></main><script src="task-activity-preview.js"></script></body></html>`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const result=cp.spawnSync(require('electron'),[__filename],{env,windowsHide:true,encoding:'utf8',timeout:45000});if(result.stdout)process.stdout.write(result.stdout);if(result.status!==0){process.stderr.write(result.stderr||'UI verification failed');process.exitCode=1;}
}
