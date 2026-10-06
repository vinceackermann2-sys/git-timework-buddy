"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createAuth}=require('../desktop/auth.cjs');
const {CALLBACK,CLIENT_ID}=require('../shared/google-oauth.cjs');
const ORIGIN='https://timewarpdev.com';
async function verifyBrandedGoogle({config=require('../config.json'),fetcher=fetch}={}){
  const report={verifiedAt:new Date().toISOString(),passed:false,checks:{},bridgeOrigin:ORIGIN,providerCallback:CALLBACK};
  const check=(name,value,message)=>{report.checks[name]=!!value;assert.ok(value,message);};
  const request=(url,options={})=>fetcher(url,{...options,signal:AbortSignal.timeout(30000)});
  try{
    const manifestResponse=await request(ORIGIN+'/timewarp-desktop-auth.json',{redirect:'error'}),manifest=await manifestResponse.json().catch(()=>({}));
    check('websiteBridgePublished',manifestResponse.ok&&manifest.protocol==='timewarp-google-desktop-v1'&&manifest.target==='energy-desktop'&&manifest.startUrl===ORIGIN+'/auth/google'&&manifest.googleCallback===CALLBACK&&manifest.desktopCallback==='http://127.0.0.1:17654/oauth-callback','Publish the Local TimeWarp website changes before enabling branded desktop auth.');
    const auth=createAuth({config:{...config,googleAuthBridgeUrl:ORIGIN},fetcher,storage:{load:()=>({session:null,capability:null}),save:()=>{},saveFlow:()=>{},loadFlow:()=>null}});await auth.init();
    check('googleProviderEnabled',(await auth.providers()).google,'Enable the existing Google provider in Supabase.');
    const start=new URL(await auth.beginOAuth('google'));
    check('desktopUsesBrandedStart',start.origin===ORIGIN&&start.pathname==='/auth/google'&&start.searchParams.get('target')==='energy-desktop','The desktop did not select the branded bridge.');
    check('websiteStartReachable',(await request(start)).ok,'The branded sign-in page is unavailable.');
    check('websiteCallbackReachable',(await request(CALLBACK)).ok,'The branded Google callback page is unavailable.');
    const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:CALLBACK,response_type:'id_token',response_mode:'fragment',scope:'openid email profile',state:crypto.randomBytes(32).toString('hex'),nonce:crypto.randomBytes(32).toString('hex')});
    const signIn=await request(google),html=await signIn.text(),url=new URL(signIn.url);
    check('googleAcceptsBrandedCallback',signIn.ok&&!html.includes('redirect_uri_mismatch')&&url.origin==='https://accounts.google.com'&&url.pathname.includes('/signin/')&&!url.pathname.includes('/oauth/error'),'Register https://timewarpdev.com/auth/v1/callback on the existing Google OAuth client.');
    report.googleSignInPath=url.pathname;report.passed=true;
  }catch(error){report.error=error.message;}
  return report;
}
async function main(){
  const report=await verifyBrandedGoogle();
  const output=path.join(__dirname,'../reports/branded-google-oauth-verification.json');fs.mkdirSync(path.dirname(output),{recursive:true});
  if(report.passed&&process.argv.includes('--activate')){
    const file=path.join(__dirname,'../config.json'),config=JSON.parse(fs.readFileSync(file,'utf8'));
    config.googleAuthBridgeUrl=ORIGIN;fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');report.activated=true;
  }
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
if(require.main===module)void main();
module.exports={verifyBrandedGoogle};
