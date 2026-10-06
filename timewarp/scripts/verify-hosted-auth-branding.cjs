"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {verifyBrandedGoogle}=require('./verify-branded-google.cjs');
const root=path.resolve(__dirname,'..'),origin=require('../config.json').googleAuthBridgeUrl;
const digest=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
async function verify(){
  const report={verifiedAt:new Date().toISOString(),passed:false,origin,checks:{}};
  try{
    for(const [url,file]of [['/desktop-auth-logo.svg','assets/timewarp-logo.svg'],['/desktop-auth.css','assets/auth-bridge.css']]){
      const response=await fetch(origin+url,{cache:'no-store',signal:AbortSignal.timeout(30000)});
      assert.ok(response.ok,url+' published');
      const content=await response.text(),matches=digest(content)===digest(fs.readFileSync(path.join(root,file),'utf8'));
      assert.ok(matches,url+' matches desktop asset');report.checks[url]={matchesDesktop:true,sha256:digest(content)};
    }
    const bridge=await fetch(origin+'/auth-bridge.html',{cache:'no-store',signal:AbortSignal.timeout(30000)}),html=await bridge.text();
    assert.ok(bridge.ok);assert.match(html,/class="timewarp-auth-page"/);assert.match(html,/\/desktop-auth\.css/);assert.match(html,/\/desktop-auth-logo\.svg/);assert.match(html,/Sign-in could not complete/);report.checks.bridgePublished=true;
    const routing=await verifyBrandedGoogle();assert.ok(routing.passed,routing.error);report.checks.googleRouting=routing.checks;report.passed=true;
    console.log('Live auth bridge assets match the desktop. Google accepts the branded callback and desktop routing is ready.');
  }catch(error){report.error=error.message;console.error(error.message);process.exitCode=1;}
  fs.writeFileSync(path.join(root,'reports/hosted-auth-branding.json'),JSON.stringify(report,null,2)+'\n');
}
verify();
