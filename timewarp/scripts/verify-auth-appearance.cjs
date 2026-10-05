"use strict";
// Exercise the real account UI in an isolated renderer; no user session is opened.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),reports=path.join(root,'reports/auth-appearance');

if(process.versions.electron){
  const {app,BrowserWindow,nativeTheme}=require('electron');
  const {callbackServer}=require('../desktop/oauth.cjs');
  app.setPath('userData',path.join(root,'backups/auth-appearance-profile'));
  app.whenReady().then(async()=>{
    const window=new BrowserWindow({width:960,height:960,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    const evaluate=async script=>{const value=await window.webContents.executeJavaScript(`try{${script}}catch(error){({verificationError:error.message})}`,true);if(value?.verificationError)throw new Error(value.verificationError);return value;};
    const checks=[];
    let server;
    try{
      const load=async(query='')=>{await window.loadFile(path.join(reports,'index.html'),{search:query});await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');};
      const snapshot=async(name)=>{
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const result=await evaluate(`(() => {
          const shell=document.querySelector('.timewarp-auth-shell')||document.body;
          const image=shell.querySelector('img'),submit=shell.querySelector('button[type=submit]');
          const value={name:${JSON.stringify(name)},logoLoaded:!!image&&image.complete&&image.naturalWidth>0,overflow:document.documentElement.scrollWidth>innerWidth,verticalOverflow:document.documentElement.scrollHeight>innerHeight+1,brandVisible:shell.querySelector('img').getBoundingClientRect().top>=0};
          if(submit){const style=getComputedStyle(submit),ctx=document.createElement('canvas').getContext('2d');
            const luminance=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0)};
            const fg=luminance(style.color),bg=luminance(style.backgroundColor);value.contrast=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);}
          return value;
        })()`);
        assert.ok(result.logoLoaded,name+' logo');assert.ok(!result.overflow,name+' horizontal overflow');assert.ok(result.brandVisible,name+' top remains accessible');if(!result.contrast)assert.ok(!result.verticalOverflow,name+' vertical overflow');if(result.contrast)assert.ok(result.contrast>=4.5,name+' primary contrast');
        fs.writeFileSync(path.join(reports,name+'.png'),(await window.webContents.capturePage()).toPNG());checks.push(result);console.log('Verified '+name);
      };
      for(const scheme of ['light','dark']){
        nativeTheme.themeSource=scheme;
        for(const width of [960,390,320]){
          window.setContentSize(width,900);await load(scheme==='dark'?'dark=1':'');
          await snapshot(`sign-in-${scheme}-${width}`);
          await evaluate('document.querySelector(".timewarp-auth-google").click()');
          assert.equal(await evaluate('window.authCalls.filter(call=>call.action==="beginOAuth").length'),1);
          await evaluate('[...document.querySelectorAll("button")].find(node=>node.textContent==="Create account").click()');
          await snapshot(`sign-up-${scheme}-${width}`);
          await evaluate('document.querySelector(".timewarp-auth-google").click()');
          assert.equal(await evaluate('window.authCalls.filter(call=>call.action==="beginOAuth").length'),2);
          assert.equal(await evaluate('window.authCalls.find(call=>call.action==="beginOAuth").input.provider'),'google');
        }
      }
      console.log('Checking unavailable providers');
      await load('google=0');assert.equal(await evaluate('getComputedStyle(document.querySelector(".timewarp-auth-providers")).display'),'none');
      await evaluate('[...document.querySelectorAll("button")].find(node=>node.textContent==="Create account").click()');
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".timewarp-auth-providers")).display'),'none');
      console.log('Checking email links');await load();
      await evaluate('[...document.querySelectorAll("button")].find(node=>node.textContent==="Use email link").click()');console.log('Email form opened');
      assert.equal(await evaluate('document.querySelector(".timewarp-auth-google")'),null);
      await evaluate('document.querySelector("input[type=email]").value="fixture@example.com";document.querySelector("form").requestSubmit()');console.log('Email form submitted');
      assert.equal(await evaluate('window.authCalls.some(call=>call.action==="sendOtp")'),true);
      assert.equal(await evaluate('document.querySelector("input[autocomplete=one-time-code]")!==null'),true);
      console.log('Checking account dialog');await load();
      await evaluate('window.timewarpAuth.showAccount()');
      assert.equal(await evaluate('document.querySelector("dialog .timewarp-auth-brand img").complete'),true);
      await evaluate('document.querySelector("dialog").close()');
      console.log('Checking callback pages');server=callbackServer(async()=>({}),async()=>{},0);
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const origin=`http://127.0.0.1:${server.address().port}`;
      window.setContentSize(960,900);
      for(const scheme of ['light','dark']){
        nativeTheme.themeSource=scheme;
        await window.loadURL(origin+'/oauth-callback?code=fixture');await snapshot('callback-success-'+scheme);
        await window.loadURL(origin+'/oauth-callback');await snapshot('callback-error-'+scheme);
      }
      if(process.env.TIMEWARP_VERIFY_HOSTED_AUTH==='1'){
        const hosted=require('../config.json').googleAuthBridgeUrl;
        // The website selects its desktop hash router for an Electron UA.
        // Hosted OAuth pages must be checked as the ordinary browser the app opens.
        window.webContents.setUserAgent(window.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/g,''));
        for(const [name,route]of [['google-start','/auth/google?target=energy-desktop'],['google-callback','/auth/v1/callback'],['desktop-bridge','/auth-bridge.html']]){
          for(const scheme of ['light','dark']){
            nativeTheme.themeSource=scheme;window.setContentSize(390,844);await window.loadURL(hosted+route);
            await evaluate('new Promise((resolve,reject)=>{const deadline=Date.now()+10000;function ready(){if(document.querySelector(".timewarp-auth-page .brand img")?.complete)return resolve();if(Date.now()>deadline)return reject(Error("Hosted account screen did not render"));requestAnimationFrame(ready);}ready();})');
            await snapshot(`hosted-${name}-${scheme}`);
          }
        }
      }
      fs.writeFileSync(path.join(reports,'verification.json'),JSON.stringify({passed:true,verifiedAt:new Date().toISOString(),checks},null,2));
      console.log(`Verified ${checks.length} account/callback layouts, Google in both account modes, provider availability, email links and dialog branding.`);
      server?.closeAllConnections();server?.close();window.destroy();app.exit(0);
    }catch(error){console.error(error);console.error(await window.webContents.executeJavaScript('({url:location.href,text:document.body.innerText.slice(0,1200)})').catch(()=>null));fs.writeFileSync(path.join(reports,'failure.png'),(await window.webContents.capturePage()).toPNG());server?.closeAllConnections();server?.close();window.destroy();app.exit(1);}
  });
}else{
  fs.mkdirSync(reports,{recursive:true});
  fs.copyFileSync(path.join(root,'assets/timewarp-logo.svg'),path.join(reports,'timewarp-logo.svg'));
  const renderer=path.join(root,'build/app/out/renderer');
  const styles=['assets/index-CgqM7Ghz.css','assets/mermaid-GHXKKRXX-Cl4CJFD3.css'].map(file=>`<link rel="stylesheet" href="${pathToFileURL(path.join(renderer,file)).href}">`).join('')+
    ['desktop/appearance.css','desktop/auth.css'].map(file=>`<link rel="stylesheet" href="${pathToFileURL(path.join(root,file)).href}">`).join('');
  fs.writeFileSync(path.join(reports,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<title>Timewarp account preview</title><script>
    if(new URLSearchParams(location.search).has('dark'))document.documentElement.classList.add('dark');
    window.authCalls=[];window.timewarp={request:async(action,input={})=>{window.authCalls.push({action,input});if(action==='authProviders')return{google:!new URLSearchParams(location.search).has('google'),signup:true};if(action==='state')return{user:null};return{};}};
    </script><script src="${pathToFileURL(path.join(root,'desktop/auth-ui.js')).href}" defer></script></head><body class="bg-background text-foreground"><main id="timewarp-auth-view" style="height:100vh"></main></body></html>`);
  const dependencyRoot=path.dirname(path.dirname(require('../config.json').brandSource));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require(require.resolve('electron',{paths:[dependencyRoot]})),[__filename],{env,windowsHide:true,stdio:'inherit'});
  const timeout=setTimeout(()=>{console.error('Auth appearance verification timed out');child.kill();},60000);
  child.on('exit',code=>{clearTimeout(timeout);process.exitCode=code===0?0:1;});
}
