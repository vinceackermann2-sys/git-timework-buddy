"use strict";
// Only copied into a temporary acceptance build. The release excludes this file.
// Exercise application APIs and Windows encryption, without automating login UI.
const {app,safeStorage,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createAuth}=require('./desktop/auth.cjs'),{sessionStorage}=require('./desktop/session-storage.cjs'),{callbackServer}=require('./desktop/oauth.cjs');
const config=require('./config.json');
const root=path.resolve(process.resourcesPath,'../../../timewarp');
const fixtureFile=path.join(root,'reports/auth-fixtures.private.json'),fixtures=JSON.parse(fs.readFileSync(fixtureFile,'utf8'));
const phase=process.argv.find(value=>value.startsWith('--auth-phase='))?.split('=')[1]||'request-link',checks={};
const storage=sessionStorage(app.getPath('userData'),safeStorage);
function passed(name,value){checks[name]=!!value;assert.ok(value,name);}
app.whenReady().then(async()=>{
  const auth=createAuth({config,storage});await auth.init();
  if(phase==='request-link'){
    await auth.sendRecovery(fixtures.users[1].email);passed('realPkceRecoveryRequested',storage.loadFlow()?.purpose==='recovery');
  }else{
    const callback=callbackServer(code=>auth.completeOAuth(code));await new Promise(resolve=>callback.listen(17654,'127.0.0.1',resolve));
    const uri=`http://127.0.0.1:17654/oauth-callback?code=${encodeURIComponent(fixtures.recoveryCallbackCode)}`;
    passed('realBrowserCallbackCompleted',(await fetch(uri)).status===200&&auth.user()?.email===fixtures.users[1].email&&auth.passwordRecovery());
    passed('callbackReplayRejected',(await fetch(uri)).status===400);callback.closeAllConnections();callback.close();
    const next=fixtures.users[1].password+'again';await auth.updatePassword(next);await auth.signOut();
    await assert.rejects(auth.signIn(fixtures.users[1]));await auth.signIn({...fixtures.users[1],password:next});passed('realCallbackPasswordReset',!auth.passwordRecovery());fixtures.users[1].password=next;await auth.signOut();
    await auth.signIn(fixtures.users[0]);const old=storage.load();storage.save({...old.session,expires_at:Date.now()/1000-1},old.capability);
    const handlers=new Map(),handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>{handlers.set(name,fn);handle(name,fn);};
    const runtime=require('./desktop/runtime.cjs');let nativeRefreshes=0,nativeSession;
    runtime.bindNativeAccount({async refresh(){nativeRefreshes++;const token=storage.load().capability;const response=await fetch('http://127.0.0.1:7788/api/account/session',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,200);nativeSession=await response.json();},async clear(){nativeSession=null;}});
    const frame={url:'app://app/'},event={senderFrame:frame,sender:{mainFrame:frame}};
    const request=(action,input={})=>handlers.get('timewarp:request')(event,action,input);
    await request('state');await new Promise(resolve=>setTimeout(resolve,250));
    const response=await fetch('http://127.0.0.1:7788/api/account/session',{headers:{authorization:'Bearer '+old.capability}});
    passed('packagedBridgeRefreshDoesNotDeadlock',response.status===200);await response.json();
    passed('packagedBridgeHealth',(await fetch('http://127.0.0.1:7788/healthz')).status===200);
    passed('packagedBridgeRejectsAnonymous',(await fetch('http://127.0.0.1:7788/api/account/session')).status===401);
    await request('signOut');passed('packagedSignOut',!(await request('state')).user&&!fs.existsSync(path.join(app.getPath('userData'),'timewarp-cloud-session.enc')));
    await request('signIn',fixtures.users[0]);passed('packagedSignInNativeHandoff',nativeRefreshes>0&&nativeSession?.user.id===fixtures.users[0].id);
    const document=await request('cloud',{route:'/document',data:{operation:'save',name:'bridge-acceptance.txt',content:'Disposable bridge verification.'}});
    const loaded=await request('cloud',{route:'/document',data:{id:document.id}});passed('packagedBridgeCloudFiles',loaded.document.content==='Disposable bridge verification.');
    const token=storage.load().capability,native=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'runtime/account-session.json'),'utf8'));
    passed('nativeTokenEncryptedWithPackagedIdentity',safeStorage.decryptString(Buffer.from(native.encryptedToken,'base64'))===token);
    const restored=createAuth({config,storage});await restored.init();passed('packagedSessionRestores',restored.user().id===fixtures.users[0].id);
  }
  fs.writeFileSync(fixtureFile,JSON.stringify(fixtures));
  fs.writeFileSync(path.join(root,`reports/packaged-auth-${phase}.json`),JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,checks},null,2));
  console.log(JSON.stringify({passed:true,checks}));app.quit();
}).catch(error=>{fs.writeFileSync(path.join(root,`reports/packaged-auth-${phase}.json`),JSON.stringify({passed:false,checks,error:error.message},null,2));console.error(JSON.stringify({passed:false,checks,error:error.message}));app.exit(1);});
