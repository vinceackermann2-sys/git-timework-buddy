"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), vm = require('node:vm'), acorn = require('acorn');
const { resolveCursorAgent } = require('../desktop/browser-cursor.cjs');
const { patchBrowserCursor, patchBrowserCursorActivity } = require('../scripts/browser-cursor.cjs');
const { choices } = require('../shared/mascots.cjs');

test('cursor identity uses the selected mascot of the active agent and respects account ownership', async () => {
  const active = { threadId:'thread', activeTurnId:'turn' }, input = { threadId:'thread', turnId:'turn' };
  for (const choice of choices) {
    const agent = { id:'agent', ownerUserId:'owner', displayName:choice.name, avatarType:'native', avatarUrl:choice.avatarUrl };
    const dependencies = { readSnapshot:()=>active, getUserId:()=> 'owner', resolveAgent:async()=>agent };
    const identity = await resolveCursorAgent(dependencies,input);
    assert.deepEqual(identity,{id:'agent',displayName:choice.name,avatar:{type:'native',url:choice.avatarUrl}});
    assert.equal(await resolveCursorAgent(dependencies,{...input,turnId:'another-turn'}),null);
    assert.equal(await resolveCursorAgent({...dependencies,getUserId:()=> 'another-user'},input),null);
    assert.equal(await resolveCursorAgent(dependencies,null),null);
  }
});

test('late agent lookups cannot overwrite a new turn, released browser or signed-out account', async () => {
  for(const changed of ['turn','release','account']){
    let state={threadId:'thread',activeTurnId:'turn'},user='owner',finish;
    const lookup=resolveCursorAgent({readSnapshot:()=>state,getUserId:()=>user,resolveAgent:()=>new Promise(resolve=>finish=resolve)},{threadId:'thread',turnId:'turn'});
    if(changed==='turn')state={threadId:'thread',activeTurnId:'next'};
    if(changed==='release')state={threadId:null,activeTurnId:null};
    if(changed==='account')user=null;
    finish({id:'agent',ownerUserId:'owner',displayName:'Orbit',avatarType:'native',avatarUrl:choices[0].avatarUrl});
    assert.equal(await lookup,null);
  }
});

