"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyBrandedGoogle}=require('../scripts/verify-branded-google.cjs');
const config={supabaseUrl:'https://auth.example',publishableKey:'public'};
const manifest={protocol:'timewarp-google-desktop-v1',target:'energy-desktop',startUrl:'https://timewarpdev.com/auth/google',googleCallback:'https://timewarpdev.com/auth/v1/callback',desktopCallback:'http://127.0.0.1:17654/oauth-callback'};
function service({published=true,registered=true,provider=true}={}){
  return async input=>{
    const url=new URL(input);
    if(url.pathname==='/timewarp-desktop-auth.json')return Response.json(published?manifest:{},{status:published?200:404});
    if(url.pathname==='/auth/v1/settings')return Response.json({external:{google:provider}});
    if(url.origin==='https://accounts.google.com'){
      const response=new Response(registered?'Google sign-in':'redirect_uri_mismatch');
      Object.defineProperty(response,'url',{value:'https://accounts.google.com/v3/signin/identifier'});return response;
    }
    return new Response('Timewarp');
  };
}
test('activation readiness passes only for a published compatible website and registered branded callback',async()=>{
  const result=await verifyBrandedGoogle({config,fetcher:service()});assert.equal(result.passed,true);assert.ok(Object.values(result.checks).every(Boolean));
  for(const options of [{published:false},{registered:false},{provider:false}]){
    const failed=await verifyBrandedGoogle({config,fetcher:service(options)});assert.equal(failed.passed,false);assert.ok(failed.error);
  }
  assert.equal(config.googleAuthBridgeUrl,undefined);
});
