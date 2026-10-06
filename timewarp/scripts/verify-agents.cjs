"use strict";
// Exercise the packaged creation components in an isolated, hidden Electron
// window. Native transport and saved-avatar behavior are covered by agents.test.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), reports = path.join(root, 'reports');
const { choices } = require('../shared/mascots.cjs');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(root, 'backups/agent-ui-verification-profile'));
  app.whenReady().then(async () => {
    const window = new BrowserWindow({width:800,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    let exitCode=0;
    const stage=value=>fs.writeFileSync(path.join(reports,'agents-progress.json'),JSON.stringify({stage:value,at:new Date().toISOString()}));
    try {
      stage('loading');
      const errors=[];
      window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
      await window.loadFile(path.join(reports,'agents-preview.html'));
      const evaluate = async code => {
        try { return await window.webContents.executeJavaScript(code); }
        catch(error) { throw new Error(code+'\n'+error.message); }
      };
      const pause = () => new Promise(resolve=>setTimeout(resolve,80));
      await pause();
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-mascot-option").length'),3);
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".timewarp-mascot-image")).every(image=>image.complete&&image.naturalWidth>0)'),true);
      assert.equal(await evaluate('document.querySelector("h2").textContent'),'New Agent');
      assert.equal(await evaluate('document.querySelector(".timewarp-mascot-option[aria-pressed=true]").textContent'),'Orbit');
      await evaluate(`(()=>{const field=document.querySelector('input[placeholder="Agent name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'New test agent');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await pause();
      for(const choice of choices){
        await evaluate(`document.querySelector('[aria-label="Choose ${choice.name}"]').click()`);
        await pause();
        assert.equal(await evaluate('document.querySelectorAll(".timewarp-mascot-option[aria-pressed=true]").length'),1);
        assert.equal(await evaluate('document.querySelector(".timewarp-agent-avatar-preview img").src.endsWith('+JSON.stringify('timewarp-mascot-'+choice.name.toLowerCase()+'.png')+')'),true);
        await evaluate('document.querySelector("form").requestSubmit()');
        await pause();
        const submitted=await evaluate('window.agentCheck.submitted.at(-1)');
        assert.equal(submitted.avatar.imageId,choice.imageId);
        assert.equal(submitted.avatar.type,'native');
        assert.equal(submitted.displayName,'New test agent');
      }
      stage('all mascot selections and create payloads passed');
      await window.webContents.capturePage().then(image=>fs.writeFileSync(path.join(reports,'agents-creation.png'),image.toPNG()));
      await evaluate('window.agentCheck.setBusy(true)');await pause();
      assert.equal(await evaluate('Array.from(document.querySelectorAll(".timewarp-mascot-option")).every(button=>button.disabled)'),true);
      await evaluate('window.agentCheck.setBusy(false)');await pause();
      stage('busy state passed');
      await evaluate('window.agentCheck.setOpen(false)');await pause();
      await evaluate('window.agentCheck.setOpen(true)');await pause();
      assert.equal(await evaluate('document.querySelector(".timewarp-mascot-option[aria-pressed=true]").textContent'),'Orbit');
      assert.equal(await evaluate(`document.querySelector('input[placeholder="Agent name"]').value`),'');
      stage('reopen reset passed');
      await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([1])],'photo.png',{type:'image/png'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause();
      assert.equal(await evaluate('document.querySelectorAll(".timewarp-mascot-option[aria-pressed=true]").length'),0);
      assert.equal(await evaluate('document.querySelector(".timewarp-agent-avatar-preview img").dataset.avatarType'),'upload');
      await evaluate(`document.querySelector('[aria-label="Choose Nova"]').click()`);await pause();
      assert.equal(await evaluate('document.querySelector(".timewarp-agent-avatar-preview img").src.endsWith("timewarp-mascot-nova.png")'),true);
      stage('upload and mascot switching passed');
      const layouts=[];
      for(const [width,height,scheme]of [[800,900,'light'],[800,900,'dark'],[360,740,'light']]){
        window.setSize(width,height);
        await evaluate(`document.documentElement.classList.toggle('dark',${scheme==='dark'});document.documentElement.style.colorScheme=${JSON.stringify(scheme)}`);await pause();
        const layout=await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,choices:Array.from(document.querySelectorAll(".timewarp-mascot-option")).map(button=>({width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))})');
        assert.equal(layout.overflow,false);
        assert.ok(layout.choices.every(button=>button.width>=70&&button.height>=44));
        layouts.push({width,height,scheme,...layout});
      }
      assert.deepEqual(errors,[]);
      fs.writeFileSync(path.join(reports,'agents-ui.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:['three mascot choices','live selection and preview','native create payload for every mascot','disabled while saving','reset on reopen','uploaded picture and switch back','light, dark and narrow layouts'],layouts},null,2));
      console.log('Verified native agent creation, all mascot selections, upload switching, reset, busy state and light/dark/narrow layouts.');
      stage('complete');
    } catch(error) {console.error(error.stack);stage('failed: '+error.message);exitCode=1}
    finally {window.destroy();app.exit(exitCode)}
  });
} else {
  const acorn=require('acorn'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
  const dependencyRoot=path.resolve(__dirname,'..');
  const resolve=name=>require.resolve(name,{paths:[dependencyRoot]});
  const renderer=path.join(root,'build/app/out/renderer');
  const ui=fs.readFileSync(path.join(renderer,'assets/mermaid-GHXKKRXX-YWFhvrpV.js'),'utf8');
  const declarations=acorn.parse(ui,{ecmaVersion:'latest',sourceType:'module'}).body.filter(node=>node.type==='VariableDeclaration').flatMap(node=>node.declarations);
  const extract=names=>names.map(name=>{const node=declarations.find(item=>item.id.name===name);assert.ok(node,name);return 'const '+ui.slice(node.start,node.end).replaceAll('import.meta.url',JSON.stringify(pathToFileURL(path.join(renderer,'assets/mermaid-GHXKKRXX-YWFhvrpV.js')).href))+';'}).join('\n');
  const images=Object.fromEntries(choices.map(choice=>[choice.avatarUrl,pathToFileURL(path.join(root,'assets/mascots',choice.name.toLowerCase()+'.png')).href]));
  const entry=`import * as b from ${JSON.stringify(resolve('react'))};
    import * as h from ${JSON.stringify(resolve('react/jsx-runtime'))};
    import {createRoot} from ${JSON.stringify(resolve('react-dom/client'))};
    const images=${JSON.stringify(images)}, choices=${JSON.stringify(choices)};
    const Tp=({avatar,className})=>avatar?h.jsx('img',{src:images[avatar.url]||avatar.url,className,'data-avatar-type':avatar.type,'data-image-id':choices.find(choice=>choice.avatarUrl===avatar.url)?.imageId}):null;
    const ne=({variant,size,...props})=>h.jsx('button',{...props,className:'preview-button '+(props.className||'')});
    const Khe=()=>null,Ce=()=>h.jsx('span',{children:'…'});
    const Tt=({open,children})=>open?h.jsx('div',{role:'dialog',children}):null;
    const Mt=({children,className})=>h.jsx('main',{className:'preview-dialog '+className,children});
    const St='h2',qs='label',Ln='input',sn='div';
    const Mx=({minRows,maxRows,...props})=>h.jsx('textarea',{...props,rows:3});
    const Sg=()=>crypto.randomUUID();
    const submitted=[],agentCheck={submitted};window.agentCheck=agentCheck;
    let finish;
    const mutate=async input=>{submitted.push(input);if(agentCheck.busy)await new Promise(resolve=>finish=resolve);return {id:input.agentId}};
    const le={useUtils:()=>({
      client:{product:{images:{beginUpload:{mutate:async()=>({})}},agents:{create:{mutate}}}},
      product:{agents:{list:{invalidate:async()=>{}}}}
    })};
    const nU=async()=> 'uploaded-photo';
    ${extract(['wrt','krt','tU','_rt','Ert','Art'])}
    const Srt=({create})=>{const[open,setOpen]=b.useState(true);agentCheck.setOpen=setOpen;agentCheck.setBusy=value=>{agentCheck.busy=value;if(value)document.querySelector('form').requestSubmit();else finish?.()};return h.jsx(Art,{open,onOpenChange:setOpen,onCreate:create})};
    createRoot(document.getElementById('preview')).render(h.jsx(Ert,{}));`;
  fs.mkdirSync(reports,{recursive:true});
  require(resolve('esbuild')).buildSync({stdin:{contents:entry,resolveDir:dependencyRoot,loader:'js'},bundle:true,platform:'browser',format:'iife',outfile:path.join(reports,'agents-preview.js'),define:{'process.env.NODE_ENV':'"production"'}});
  const styles=['assets/index-CgqM7Ghz.css','assets/mermaid-GHXKKRXX-Cl4CJFD3.css','timewarp-appearance.css','timewarp-agents.css'].map(file=>`<link rel="stylesheet" href="${pathToFileURL(path.join(renderer,file)).href}">`).join('');
  fs.writeFileSync(path.join(reports,'agents-preview.html'),`<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{margin:0;padding:24px}.preview-dialog{margin:auto;max-width:512px;border:1px solid var(--color-border);border-radius:16px;padding:24px;background:var(--color-background)}input:not([type=file]),textarea{width:100%;border:1px solid var(--color-border);border-radius:8px;padding:10px;background:var(--color-background)}.preview-button{border:1px solid var(--color-border);padding:8px 16px;border-radius:8px;background:var(--color-primary);color:var(--color-primary-foreground)}.size-full{width:100%;height:100%;object-fit:contain}</style><title>Agent creation preview</title></head><body class="bg-background text-foreground"><div id="preview"></div><script src="./agents-preview.js"></script></body></html>`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const started=Date.now();
  const result=cp.spawnSync(require(resolve('electron')),[__filename],{env,windowsHide:true,encoding:'utf8',timeout:45000});
  if(result.stdout)process.stdout.write(result.stdout);
  const report=path.join(reports,'agents-ui.json');
  if(result.status!==0||!fs.existsSync(report)||fs.statSync(report).mtimeMs<started){if(result.stderr)process.stderr.write(result.stderr);if(fs.existsSync(path.join(reports,'agents-progress.json')))console.error(fs.readFileSync(path.join(reports,'agents-progress.json'),'utf8'));process.exitCode=1}
}
