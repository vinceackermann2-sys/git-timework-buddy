"use strict";
const http=require('node:http');
const fs=require('node:fs'),path=require('node:path');
const {authPage}=require('./auth-page.cjs');
function callbackServer(complete,onComplete=async()=>{},port=17654,onConnector=null){
  const server=http.createServer({maxHeaderSize:49152},async(req,res)=>{
    const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    const reply=(code,message,title=code===200?'You’re signed in':'Sign-in could not complete')=>{res.writeHead(code,{...headers,'content-type':'text/html; charset=utf-8'});res.end(authPage({title,message,success:code===200}));};
    if(![`127.0.0.1:${server.address()?.port||port}`,`localhost:${server.address()?.port||port}`].includes(req.headers.host))return reply(403,'Invalid host.');
    if(req.url.length>40000)return reply(414,'Sign-in link is too long. Start again from Timewarp.');
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(req.method==='GET'&&url.pathname==='/timewarp-logo.svg'){res.writeHead(200,{...headers,'content-type':'image/svg+xml'});return res.end(fs.readFileSync(path.join(__dirname,'../assets/timewarp-logo.svg')));}
    if(req.method==='GET'&&url.pathname==='/timewarp-auth.css'){res.writeHead(200,{...headers,'content-type':'text/css; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'../assets/auth-bridge.css')));}
    if(req.method==='GET'&&url.pathname==='/connector-callback'&&onConnector){try{await onConnector(url.searchParams);await onComplete();return reply(200,'Return to Timewarp and refresh Tools to use your connected app.','Your app is connected');}catch{return reply(400,'App approval could not be verified. Return to Timewarp and refresh Tools.','App connection could not complete');}}
    if(req.method!=='GET'||url.pathname!=='/oauth-callback')return reply(404,'Not found.');
    if(!url.searchParams.get('code'))return reply(400,'Sign-in did not complete. Return to Timewarp and try again.');
    try{const result=await complete(url.searchParams.get('code'));await onComplete(result);reply(200,'Signed in to Timewarp. You can close this tab and return to the desktop app.');}catch{reply(400,'This sign-in link could not be verified. Return to Timewarp and try again.');}
  });server.headersTimeout=10000;server.requestTimeout=45000;return server;
}
module.exports={callbackServer};
