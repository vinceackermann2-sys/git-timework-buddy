"use strict";
// Temporary acceptance package. It records only safe connection status and
// makes one small inference after the owner approves this app's ChatGPT access.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
module.exports.init=()=>{
  const root=path.resolve(process.resourcesPath,'../../../timewarp'),reportFile=path.join(root,'reports/chatgpt-desktop.json');
  let busy=false,checked=false,opened=false,lastResult=null;
  async function inspect(){
    if(busy)return;busy=true;
    try{
      const runtime=require('./desktop/runtime.cjs'),window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://app/'));if(!window)return;
      const state=await window.webContents.executeJavaScript("window.timewarp.request('state').then(s=>({signedIn:!!s.user}))");
      if(state.signedIn)await runtime.chatgpt.refresh();
      const details=runtime.chatgpt.details(),login=runtime.chatgpt.currentBrowserLogin();
      const report={at:new Date().toISOString(),signedIn:state.signedIn,backend:details.backend,connection:details.status,accountPlan:details.account?.planType||null,hasRateLimits:!!details.rateLimits,rateLimits:details.rateLimits,lastConnectionError:details.lastConnectionError,lastRequestError:details.lastRequestError,login:login.status,lastCompletedAt:details.lastCompletedAt,liveInference:lastResult};
      fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
      if(state.signedIn&&!opened){opened=true;await window.loadURL('app://app/#/customize/billing');}
      if(state.signedIn&&details.status==='available'&&!checked){checked=true;let before;
        try{const models=await runtime.getNativeRuntime().caller().product.models.list();lastResult={modelCount:models.length,modelsParseNativeSchema:true};before=await window.webContents.executeJavaScript("window.timewarp.request('cloud',{route:'/billing',data:{}}).then(x=>x.included+x.purchased)");await runtime.chatgpt.verifyAccess();lastResult.completed=true;}
        catch(error){lastResult={...lastResult,completed:false,error:String(error.message).slice(0,500)};}
        finally{if(before!==undefined){const after=await window.webContents.executeJavaScript("window.timewarp.request('cloud',{route:'/billing',data:{}}).then(x=>x.included+x.purchased)");lastResult.noTimewarpCreditCharge=before===after;}}
        fs.writeFileSync(reportFile,JSON.stringify({...report,liveInference:lastResult},null,2));
      }
    }catch(error){fs.writeFileSync(reportFile,JSON.stringify({at:new Date().toISOString(),error:String(error.message).slice(0,500)},null,2));}
    finally{busy=false;}
  }
  app.whenReady().then(()=>{const timer=setInterval(()=>void inspect(),2000);timer.unref();app.on('before-quit',()=>clearInterval(timer));});
};
