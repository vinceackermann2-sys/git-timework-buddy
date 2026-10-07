"use strict";
const fs=require('node:fs'),path=require('node:path'),acorn=require('acorn');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'reports/onboarding-preview');
function component(source,name){
  const position=source.indexOf(name+'=');if(position<0)throw Error('Native preview component missing: '+name);
  let node=acorn.parseExpressionAt(source,position+name.length+1,{ecmaVersion:'latest'});
  if(node.type==='SequenceExpression')node=node.expressions[0];
  return `const ${name}=${source.slice(node.start,node.end)};`;
}
async function writePreview(){
  fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(directory,'assets'),{recursive:true});fs.copyFileSync(path.join(root,'assets/mascots/orbit.png'),path.join(directory,'assets/timewarp-mascot-orbit.png'));fs.cpSync(path.join(root,'assets/onboarding-icons'),path.join(directory,'onboarding-icons'),{recursive:true});
  for(const [from,to]of [['desktop/onboarding-ui.js','onboarding-ui.js'],['desktop/onboarding.css','onboarding.css'],['desktop/auth-ui.js','auth-ui.js'],['desktop/auth.css','auth.css'],['assets/timewarp-logo.svg','timewarp-logo.svg'],['scripts/onboarding-preview-fixture.js','fixture.js']])fs.copyFileSync(path.join(root,from),path.join(directory,to));
  fs.writeFileSync(path.join(directory,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Timewarp · Your first light</title><link rel="icon" href="./timewarp-logo.svg"><link rel="stylesheet" href="./onboarding.css"><link rel="stylesheet" href="./auth.css"><style>body{margin:0;font-family:system-ui;background:#fbfafc;color:#27232e}#timewarp-auth-view{height:100dvh;box-sizing:border-box}.preview-controls{position:fixed;bottom:8px;left:14px;z-index:10002;font-size:10px;color:#8b7d95}.preview-controls a{color:inherit}.preview-workspace{max-width:500px;margin:20vh auto;text-align:center;padding:25px}.preview-workspace h1{font-weight:450}</style><script src="./fixture.js"></script><script src="./auth-ui.js" defer></script><script src="./onboarding-ui.js" defer></script></head><body><div id="preview-host"></div><aside class="preview-controls">Isolated preview · Sample data · <a href="?scenario=welcome&reset=1">Replay from sign-in</a></aside></body></html>`);
  return directory;
}
module.exports={writePreview,directory,component};
if(require.main===module||(process.versions.electron&&process.argv[1]&&path.resolve(process.argv[1])===__filename)){
  if(process.versions.electron){
    const {app,BrowserWindow}=require('electron');let previewWindow;app.disableHardwareAcceleration();
    app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'timewarp-onboarding-preview-')));
    app.whenReady().then(async()=>{previewWindow=new BrowserWindow({width:1080,height:900,title:'Timewarp · Fullscreen onboarding preview',autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true}});await previewWindow.loadFile(path.join(directory,'index.html'),{search:'scenario=welcome&reset=1'});previewWindow.show();});
    app.on('window-all-closed',()=>app.quit());
  }else if(process.argv.includes('--desktop')){
    writePreview().then(()=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=require('node:child_process').spawn(require('electron'),[__filename],{env,windowsHide:true,detached:true,stdio:'ignore'});child.unref();console.log('Opened fullscreen onboarding preview.');});
  }else{
    writePreview().then(()=>{const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
      const server=require('node:http').createServer((request,response)=>{const pathname=new URL(request.url,'http://127.0.0.1').pathname,file=path.resolve(directory,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));if(!file.startsWith(directory+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end('Not found');return}response.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'"});fs.createReadStream(file).pipe(response)});
      server.listen(Number(process.env.TIMEWARP_ONBOARDING_PREVIEW_PORT)||4176,'127.0.0.1',()=>console.log('Timewarp onboarding preview: http://127.0.0.1:'+server.address().port));
    }).catch(error=>{console.error(error);process.exitCode=1});
  }
}
