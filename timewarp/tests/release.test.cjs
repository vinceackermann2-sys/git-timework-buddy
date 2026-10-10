"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const {validateRelease}=require('../shared/release.cjs');
const {checkRelease}=require('../scripts/release-config.cjs');
const {configureUpdates}=require('../desktop/updates.cjs');
const {verifyManifest}=require('../scripts/verify-release.cjs');
const {verifyUpstream,copyRuntime}=require('../scripts/upstream.cjs');
const {verifyInstaller}=require('../shared/authenticode.cjs');
const release={enabled:true,version:'0.1.0',updateUrl:'https://updates.timewarp.example/windows/',publisherNames:['Timewarp AB']};
test('public releases reject inherited feeds, credentials, absent publishers and invalid versions',()=>{
  assert.deepEqual(validateRelease({enabled:false}),{enabled:false});assert.deepEqual(validateRelease(release),release);
  for(const updateUrl of ['https://static.getenergy.com/a','https://proxy.generalwork.ai/'])assert.throws(()=>checkRelease({...release,updateUrl}),/public Timewarp/);
  assert.throws(()=>checkRelease({...release,publisherNames:['The Computer Work Company, Inc.']}),/publisher/);
  assert.deepEqual(checkRelease(release),release);
  for(const updateUrl of ['http://updates.example.com','https://localhost/','https://127.0.0.1/','https://u:p@updates.example.com/','https://updates.example.com/?secret=x'])assert.throws(()=>validateRelease({...release,updateUrl}));
  for(const patch of [{publisherNames:[]},{version:'1.2.3-draft.1'},{certificatePassword:'secret'}])assert.throws(()=>validateRelease({...release,...patch}));
});
function fixture(feed={provider:'generic',url:release.updateUrl,channel:'latest',publisherName:release.publisherNames}){
  const app=new EventEmitter();Object.assign(app,{isPackaged:true,getVersion:()=>release.version,whenReady:async()=>{}});
  const updater=new EventEmitter();let calls=0,notify=0,installed=0;updater.checkForUpdates=async()=>{calls++;return 'checked';};updater.quitAndInstall=()=>{installed++;};
  const result=configureUpdates({app,autoUpdater:updater,release,readUpdateConfig:()=>feed,notify:install=>{notify++;return install();},logger:{error(){}},interval:()=>({unref(){}}),clear(){}});
  return{app,updater,result,counts:()=>({calls,notify,installed})};
}
test('an unsigned development/draft build never calls the inherited update implementation',async()=>{
  const f=fixture({provider:'generic',url:'https://static.getenergy.com',publisherName:['Energy']});assert.equal(f.result.enabled,false);assert.equal(await f.updater.checkForUpdates(),null);assert.equal(f.counts().calls,0);
  assert.equal(f.updater.autoDownload,false);assert.equal(f.updater.autoInstallOnAppQuit,false);
});
test('release updates require the matching feed, publisher and version and install explicitly',async()=>{
  const f=fixture();if(process.platform!=='win32'){assert.equal(f.result.enabled,false);return;}
  assert.equal(f.result.enabled,true);await Promise.all([f.updater.checkForUpdates(),f.updater.checkForUpdates()]);assert.equal(f.counts().calls,1);
  assert.equal(f.updater.allowDowngrade,false);assert.equal(f.updater.autoInstallOnAppQuit,false);
  f.updater.emit('update-downloaded');assert.equal(f.counts().notify,1);assert.equal(f.counts().installed,1);
  f.app.emit('will-quit');
});
test('installer verification fails closed for blocked PowerShell, invalid trust, wrong publisher or missing timestamp',async()=>{
  const names=['Timewarp AB'];assert.equal(await verifyInstaller('fixture.exe',names,async()=>({status:'Valid',publisher:names[0],timestamped:true})),null);
  for(const result of [{status:'NotSigned',publisher:names[0],timestamped:true},{status:'Valid',publisher:'Other publisher',timestamped:true},{status:'Valid',publisher:names[0],timestamped:false},null])assert.ok(await verifyInstaller('fixture.exe',names,async()=>result));
  assert.ok(await verifyInstaller('fixture.exe',names,async()=>{throw Error('PowerShell blocked');}));
});
test('the real Windows trust probe receives literal paths and rejects an unsigned fixture',async t=>{
  if(process.platform!=='win32')return;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'timewarp-signature-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'unsigned test.exe');fs.writeFileSync(file,'unsigned fixture');
  const {signatureAsync}=require('../shared/authenticode.cjs');const result=await signatureAsync(file);
  assert.ok(result.status);assert.notEqual(result.status,'Valid');assert.equal(result.timestamped,false);
  assert.ok(await verifyInstaller(file,['Timewarp AB']));
});
test('release metadata fails if installer size, checksum, version or path is substituted',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'timewarp-manifest-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const name='Timewarp-Setup-0.1.0-x64.exe',bytes=Buffer.from('fixture');fs.writeFileSync(path.join(directory,name),bytes);
  const entry={url:name,size:bytes.length,sha512:crypto.createHash('sha512').update(bytes).digest('base64')};
  const value={version:'0.1.0',files:[entry]};assert.equal(verifyManifest(value,release,directory),path.join(directory,name));
  for(const patch of [{url:'../outside.exe'},{sha512:'substituted'},{size:10}])assert.throws(()=>verifyManifest({...value,files:[{...entry,...patch}]},release,directory));
  assert.throws(()=>verifyManifest({...value,version:'0.2.0'},release,directory));
});
test('pinned runtime copying excludes stray files and rejects corrupt and escaping inputs',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'timewarp-input-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const input=path.join(directory,'input'),output=path.join(directory,'output');fs.mkdirSync(path.join(input,'app'),{recursive:true});
  const make=(name,text)=>{const bytes=Buffer.from(text);fs.writeFileSync(path.join(input,name),bytes);return{path:name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};};
  const lock={format:1,platform:'win32',arch:'x64',archive:make('pristine.asar','archive'),executable:make('upstream.exe','exe'),files:[make('app/resource.pak','pak')]};make('app/stray.env','do not copy');
  const verified=verifyUpstream(input,lock);copyRuntime(verified,output);assert.ok(fs.existsSync(path.join(output,'resource.pak')));assert.ok(!fs.existsSync(path.join(output,'stray.env')));
  fs.writeFileSync(path.join(input,'app/resource.pak'),'wrong');assert.throws(()=>verifyUpstream(input,lock),/integrity/);
  assert.throws(()=>verifyUpstream(input,{...lock,files:[{...lock.files[0],path:'app/../../escape'}]}));
});
