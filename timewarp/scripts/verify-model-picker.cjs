"use strict";
// Exercise the shipped picker in an isolated Electron renderer. No inference,
// account, billing, workspace, or personal application profile is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),reports=path.join(root,'reports');

if(process.versions.electron){
  const {app,BrowserWindow}=require('electron');
  app.disableHardwareAcceleration();app.setPath('userData',path.join(root,'backups/model-picker-verification-profile'));
  app.whenReady().then(async()=>{
    const window=new BrowserWindow({width:500,height:640,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    const errors=[];window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    const evaluate=code=>{fs.writeFileSync(path.join(reports,'model-picker-progress.txt'),code);return window.webContents.executeJavaScript(code);},pause=()=>new Promise(resolve=>setTimeout(resolve,60));
    const click=async selector=>{assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause();};
    const key=async code=>{window.webContents.sendInputEvent({type:'keyDown',keyCode:code});window.webContents.sendInputEvent({type:'keyUp',keyCode:code});await pause();};
    try{
      await window.loadFile(path.join(reports,'model-picker-preview.html'));await pause();
      assert.equal(await evaluate("document.querySelector('.timewarp-model-name').textContent"),'GPT-6.1 Sol');
      assert.equal(await evaluate("document.querySelector('.timewarp-model-effort').textContent"),'Extra high');
      await click('.timewarp-model-trigger');
      assert.equal(await evaluate("document.querySelector('input[type=range]').max"),'5');
      await evaluate("document.querySelector('input[type=range]').focus()");await key('End');
      assert.equal(await evaluate('pickerCheck.settings.reasoningEffort'),'ultra');
      await click('.timewarp-thinking-reset');assert.equal(await evaluate('pickerCheck.settings.reasoningEffort'),'low');
      await evaluate("document.querySelector('input[type=range]').focus()");await key('Right');await key('Right');await key('Right');
      assert.equal(await evaluate('pickerCheck.settings.reasoningEffort'),'xhigh');
      for(const scheme of ['light','dark']){
        await evaluate(`document.documentElement.classList.toggle('dark',${scheme==='dark'})`);await pause();
        fs.writeFileSync(path.join(reports,`model-picker-thinking-${scheme}.png`),(await window.webContents.capturePage()).toPNG());
        await click('.timewarp-choose-model');
        assert.equal(await evaluate("document.querySelectorAll('[role=menuitemradio]').length"),8);
        assert.equal(await evaluate("document.querySelectorAll('[aria-checked=true]').length"),1);
        fs.writeFileSync(path.join(reports,`model-picker-models-${scheme}.png`),(await window.webContents.capturePage()).toPNG());
        await key('Escape');assert.ok(await evaluate("!!document.querySelector('input[type=range]')"));
      }
      await click('.timewarp-choose-model');await key('Down');
      assert.equal(await evaluate('document.activeElement.textContent'),'GPT-6 Astra');await key('Enter');
      assert.equal(await evaluate('pickerCheck.settings.name'),'gpt-6-astra');
      await click('.timewarp-choose-model');await key('End');await key('Enter');
      assert.equal(await evaluate('pickerCheck.settings.name'),'gpt-5.5');assert.equal(await evaluate("document.querySelector('input[type=range]').max"),'3');
      await evaluate("document.querySelector('input[type=range]').focus()");await key('End');assert.equal(await evaluate('pickerCheck.settings.reasoningEffort'),'xhigh');
      await evaluate('pickerCheck.credits()');await pause();
      assert.equal(await evaluate("document.querySelector('.timewarp-model-name').textContent"),'Sol');
      await click('.timewarp-choose-model');assert.equal(await evaluate("document.querySelectorAll('[role=menuitemradio]').length"),2);
      await key('End');await key('Enter');assert.equal(await evaluate('pickerCheck.settings.name'),'openai/gpt-5.6-luna');
      assert.equal(await evaluate("document.querySelector('input[type=range]').max"),'2');
      await evaluate('pickerCheck.unavailable()');await pause();assert.match(await evaluate("document.querySelector('[role=status]').textContent"),/Models unavailable/);
      await click('[role=status] button');assert.ok(await evaluate('pickerCheck.refetches>1'));
      await evaluate('pickerCheck.restore()');await pause();
      window.setSize(320,640);await pause();assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await evaluate('pickerCheck.disable()');await pause();assert.equal(await evaluate("document.querySelector('.timewarp-model-trigger').disabled"),true);
      assert.deepEqual(errors,[]);
      fs.writeFileSync(path.join(reports,'model-picker-ui.json'),JSON.stringify({verifiedAt:new Date().toISOString(),modelCount:8,checks:['all models visible','model selection','keyboard menu navigation','supported reasoning efforts including Ultra','model default reset','funding catalog switch','unavailable catalog and retry','disabled picker','light and dark themes','320px layout'],consoleErrors:errors},null,2));
      console.log('Verified native picker: eight models, supported effort slider, reset, keyboard navigation, funding changes, error recovery, disabled controls, and both themes.');app.exit(0);
    }catch(error){console.error(error.stack);app.exit(1);}
  });
}else{
  const acorn=require('acorn'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
  const asar=require('@electron/asar'),archive=path.resolve(root,'../energy-testv1/app/resources/app.asar');
  const renderer=path.join(reports,'model-picker-renderer');fs.mkdirSync(renderer,{recursive:true});
  const read=file=>asar.extractFile(archive,('out/renderer/'+file).split('/').join(path.sep)).toString();
  const source=read('assets/mermaid-GHXKKRXX-YWFhvrpV.js');
  const declarations=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(node=>node.type==='VariableDeclaration').flatMap(node=>node.declarations);
  const picker=declarations.find(node=>node.id.name==='zCe');assert.ok(picker);const initializer=source.slice(picker.init.start,picker.init.end);assert.ok(initializer.includes('createModelPicker'));
  assert.ok(initializer.includes(require('../desktop/model-picker.cjs').createModelPicker.toString()),'Rebuild the desktop to verify the current picker source.');
  const composer=declarations.find(node=>node.id.name==='nyn');assert.ok(composer);const trigger=source.slice(composer.init.start,composer.init.end);assert.ok(trigger.includes('timewarp-model-trigger'));
  const models=require('../shared/codex-models.json').models.filter(model=>model.visibility==='list').sort((a,b)=>a.priority-b.priority).map((model,i)=>({id:model.slug,displayName:model.display_name,featured:i===0,defaultReasoningEffort:model.default_reasoning_level,supportedReasoningEfforts:model.supported_reasoning_levels.map(item=>({reasoningEffort:item.effort,description:item.description})),defaultServiceTier:null}));
  const entry=`import * as b from 'react';import * as h from 'react/jsx-runtime';import {createRoot} from 'react-dom/client';
    import {ChevronDown as Na,ChevronRight as j2,Check as Dn} from 'lucide-react';
    const context=b.createContext(null);let data=${JSON.stringify(models)},refetches=0;
    const tc=({open,onOpenChange,children})=>h.jsx(context.Provider,{value:{open,onOpenChange},children:h.jsx('div',{className:'fixture-popover',children})});
    const Lu=({render,disabled})=>{const state=b.useContext(context);return b.cloneElement(render,{disabled,'aria-expanded':state.open,onClick:()=>state.onOpenChange(!state.open)})};
    const nc=({children,className,onKeyDownCapture,...rest})=>{const state=b.useContext(context);return state.open?h.jsx('div',{className,role:'dialog',onKeyDownCapture,onKeyDown:event=>{if(event.key==='Escape'&&!event.defaultPrevented)state.onOpenChange(false)},children}):null};
    const ne=b.forwardRef(({variant,size,...props},ref)=>h.jsx('button',{...props,ref}));
    const le={product:{models:{list:{useQuery:()=>({data,isPending:false,refetch:async()=>{refetches++}})}}}};
    const Picker=${initializer};
    const ComposerTrigger=${trigger};
    function Preview(){const[settings,setSettings]=b.useState({name:'gpt-6.1-sol',reasoningEffort:'xhigh',serviceTier:null}),[disabled,setDisabled]=b.useState(false),[,refresh]=b.useState(0);
      window.pickerCheck={settings,get refetches(){return refetches},credits:()=>{data=${JSON.stringify(require('../shared/models.cjs').models())};refresh(n=>n+1)},unavailable:()=>{data=null;refresh(n=>n+1)},restore:()=>{data=${JSON.stringify(models)};refresh(n=>n+1)},disable:()=>setDisabled(true)};
      return h.jsxs('main',{children:[h.jsxs('header',{children:[h.jsx('img',{src:${JSON.stringify(pathToFileURL(path.join(root,'assets/timewarp-logo.svg')).href)},alt:'Timewarp'}),'Timewarp']}),h.jsxs('div',{className:'fixture-composer',children:[h.jsx('p',{children:'What would you like to work on?'}),h.jsx(Picker,{settings,disabled,onChange:setSettings,children:props=>h.jsx(ComposerTrigger,props)})]})]})}
    createRoot(document.getElementById('preview')).render(h.jsx(Preview,{}));`;
  fs.mkdirSync(reports,{recursive:true});require('esbuild').buildSync({stdin:{contents:entry,resolveDir:root},bundle:true,platform:'browser',format:'iife',outfile:path.join(reports,'model-picker-preview.js'),define:{'process.env.NODE_ENV':'"production"'}});
  const styles=['assets/index-CgqM7Ghz.css','assets/mermaid-GHXKKRXX-Cl4CJFD3.css','timewarp-appearance.css','timewarp-controls.css','timewarp-model-picker.css'].map(file=>{const local=path.join(renderer,path.basename(file));fs.writeFileSync(local,read(file));return `<link rel="stylesheet" href="${pathToFileURL(local).href}">`;}).join('');
  fs.writeFileSync(path.join(reports,'model-picker-preview.html'),`<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{margin:0;background:var(--color-background);color:var(--color-foreground)}main{min-height:100vh;padding:24px;display:flex;flex-direction:column;justify-content:space-between}header{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600}header img{width:30px;height:30px}.fixture-composer{border:1px solid var(--color-border);border-radius:20px;padding:16px;background:var(--color-card)}.fixture-composer p{margin:0 0 24px;color:var(--color-muted-foreground);font-size:14px}.fixture-popover{position:relative;display:flex;justify-content:flex-end}.fixture-popover>.timewarp-picker-panel{position:absolute;right:0;bottom:calc(100% + 8px)}</style></head><body><div id="preview"></div><script src="./model-picker-preview.js"></script></body></html>`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const stdout=path.join(reports,'model-picker-stdout.txt'),stderr=path.join(reports,'model-picker-stderr.txt');
  const descriptors=[fs.openSync(stdout,'w'),fs.openSync(stderr,'w')];
  const result=cp.spawnSync(require('electron'),[__filename],{env,windowsHide:true,stdio:['ignore',...descriptors],timeout:45000});
  descriptors.forEach(descriptor=>fs.closeSync(descriptor));process.stdout.write(fs.readFileSync(stdout,'utf8'));
  if(result.status!==0){process.stderr.write(fs.readFileSync(stderr,'utf8'));if(result.error)console.error(result.error.message);process.exitCode=1;}
}
