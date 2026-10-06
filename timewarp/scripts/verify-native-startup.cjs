"use strict";
// Launch only the isolated staged executable with an empty verification profile.
// No account, checkout, model request or production profile is used.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function inUse(value){return new Promise(resolve=>{const socket=net.connect(value,'127.0.0.1');const done=result=>{socket.destroy();resolve(result);};socket.setTimeout(1000,()=>done(false));socket.once('connect',()=>done(true));socket.once('error',()=>done(false));});}
async function verify(){
  if(await inUse(7788)||await inUse(17654))throw new Error('Close the other Timewarp app before running native startup acceptance. Its profile will not be changed.');
  const supplied=process.argv.indexOf('--app-dir'),directory=supplied<0?path.join(root,'build/native'):path.resolve(process.argv[supplied+1]||'');
  const mac=process.argv.includes('--mac');
  if(mac&&process.platform!=='darwin')throw new Error('Mac startup acceptance requires macOS.');
  const buildRoot=fs.realpathSync(path.join(root,'build')),actual=fs.realpathSync(directory);
  if(!actual.startsWith(buildRoot+path.sep)||fs.lstatSync(directory).isSymbolicLink())throw new Error('Native startup acceptance must use an isolated build directory.');
  const normal=path.join(directory,'Timewarp.exe'),plist=mac?JSON.parse(cp.execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(directory,'Contents/Info.plist')],{encoding:'utf8'})):null;
  const exe=mac?path.join(directory,'Contents/MacOS',plist.CFBundleExecutable):(fs.existsSync(normal)?normal:path.join(directory,'Timewarp Preview.exe')),profile=fs.mkdtempSync(path.join(root,'build/startup-profile-')),debugPort=await port();
  const child=cp.spawn(exe,['--remote-debugging-port='+debugPort],{env:{...process.env,TIMEWARP_USER_DATA_DIR:profile},windowsHide:true,stdio:'ignore'});let socket;
  let startupError;child.once('error',error=>{startupError=error;});
  try{
    const deadline=Date.now()+45000;let target;
    while(Date.now()<deadline){
      if(startupError||child.exitCode!==null)throw new Error('The staged executable exited before its renderer was ready.');
      const targets=await fetch(`http://127.0.0.1:${debugPort}/json/list`,{signal:AbortSignal.timeout(1000)}).then(r=>r.json()).catch(()=>[]);
      target=targets.find(value=>value.type==='page'&&value.url.startsWith('app://app/'));if(target)break;await pause(250);
    }
    if(!target)throw new Error('The staged executable did not load its local renderer.');
    socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let sequence=0;const pending=new Map();socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}});
    // A cold installed renderer can still be parsing its bundle when CDP exposes
    // its target. Keep the overall startup deadline while allowing that first
    // evaluation to wait for the renderer, rather than failing after 3 seconds.
    const evaluate=expression=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native renderer probe timed out.'));},Math.min(15000,Math.max(1,deadline-Date.now())));pending.set(id,message=>{clearTimeout(timer);if(message.error)reject(new Error('Native renderer probe failed.'));else resolve(message.result?.result?.value);});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
    let state;
    while(Date.now()<deadline){state=await evaluate("({ready:document.readyState,auth:!!document.querySelector('#timewarp-auth-view'),bridge:!!window.timewarp,ua:navigator.userAgent})");if(state?.auth&&state.bridge)break;await pause(250);}
    assert.ok(state?.auth&&state.bridge,'Native authentication screen and isolated preload bridge loaded');
    // The upstream browser intentionally removes Electron from navigator's UA.
    const version=require('electron/package.json').version;
    if(mac){const frameworkPlist=JSON.parse(cp.execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(directory,'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist')],{encoding:'utf8'}));assert.equal(frameworkPlist.CFBundleVersion,version);}
    else assert.ok(fs.readFileSync(exe).includes(Buffer.from('Electron/'+version)),'The staged executable embeds the patched Electron runtime');
    const applicationVersion=JSON.parse((await import('@electron/asar')).extractFile(path.join(directory,mac?'Contents/Resources/app.asar':'resources/app.asar'),'package.json').toString()).version;
    fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,mac?'reports/mac-startup.json':'reports/native-startup.json'),JSON.stringify({verifiedAt:new Date().toISOString(),version:applicationVersion,electronVersion:version,platform:process.platform,arch:process.arch,authScreen:true,preloadBridge:true,emptyProfile:true,liveAcceptance:false},null,2));
    console.log('Staged native app started with Electron '+version+', verified ASAR integrity, preload bridge and the signed-out authentication screen.');
  }finally{socket?.close();if(child.pid&&child.exitCode===null){if(mac){child.kill('SIGTERM');await pause(1500);if(child.exitCode===null)child.kill('SIGKILL');}else cp.spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}}
}
verify().catch(error=>{console.error(error.message);process.exitCode=1;});
