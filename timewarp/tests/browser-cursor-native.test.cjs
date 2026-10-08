"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), vm = require('node:vm'), acorn = require('acorn');
const { resolveCursorAgent } = require('../desktop/browser-cursor.cjs');
const { patchBrowserCursor, patchBrowserCursorActivity } = require('../scripts/browser-cursor.cjs');
const { choices } = require('../shared/mascots.cjs');

test('same-profile browser actions publish each new activity without moving the cursor', async () => {
  const asar=await import('@electron/asar');
  const archive=path.resolve(__dirname,'../../timewarp-runtime/build/app.asar.pristine');
  const original=asar.extractFile(archive,path.join('out','main','index.js')).toString();
  const patched=patchBrowserCursorActivity(original);
  const classes=acorn.parse(patched,{ecmaVersion:'latest',sourceType:'script'}).body.filter(node=>node.type==='ClassDeclaration');
  const extract=name=>{const node=classes.find(node=>node.id.name===name);assert.ok(node);return patched.slice(node.start,node.end)};
  const runtimeKey=target=>JSON.stringify([target.ownerId,target.profileId]);
  const context=vm.createContext({Ee:runtimeKey,Tn:mount=>runtimeKey(mount.target),OR:(left,right)=>left===right});
  const Manager=vm.runInContext('('+extract('UAe')+')',context);
  let summary,publications=0;
  const manager={ensureBrowser:async()=>{},runtimes:{beginAgentUse:(_target,text)=>{summary=text;return false}},dismissTransientUi(){throw Error('Unnecessary transient reset')},emitState:()=>publications++};
  for(const text of ['Reading page','Filling field','Clicking button'])await Manager.prototype.startAgentBrowserNow.call(manager,{ownerId:'chat',profileId:'profile'},text,{});
  assert.equal(publications,3);assert.equal(summary,'Clicking button');
  const Host=vm.runInContext('('+extract('r_e')+')',context),host=new Host();
  const target={ownerId:'chat',profileId:'profile'},activeAgent={threadId:'thread',turnId:'turn'},cursor={id:'cursor',x:100,y:200};
  host.mount={target,page:null,agentPresentation:{activeAgent,summary:'Reading page'},cursor};
  host.syncSurface=()=>{};
  host.reconcile(target,null,{activeAgent,summary:'Filling field'});
  assert.equal(host.mount.cursor,cursor);
  assert.equal(host.mount.agentPresentation.summary,'Filling field');
  host.reconcile(target,null,{activeAgent:{...activeAgent,turnId:'new-turn'},summary:'Reading page'});
  assert.equal(host.mount.cursor,null);
});

test('the packaged cursor components pass the active identity to the compact action badge', async () => {
  const asar=await import('@electron/asar');
  const source=asar.extractFile(path.resolve(__dirname,'../../timewarp-runtime/build/app.asar.pristine'),path.join('out','renderer','assets','mermaid-GHXKKRXX-YWFhvrpV.js')).toString();
  const patched=patchBrowserCursor(source);
  assert.doesNotThrow(()=>acorn.parse(patched,{ecmaVersion:'latest',sourceType:'module'}));
  assert.ok(patched.includes('summary:i.summary,agent:TWAgent'));
  assert.ok(patched.includes('"data-browser-cursor-badge"'));
  assert.ok(patched.includes('Math.min(280,Math.max(0,e.width-fl*2))'));
  assert.throws(()=>patchBrowserCursor('const YNn=()=>{};'),/contract changed/);
});
