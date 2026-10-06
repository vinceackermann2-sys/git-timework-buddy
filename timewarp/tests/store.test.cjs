"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {validateStore}=require('../shared/store.cjs');
const config=require('../store.json');
test('Store update retains the existing listing and application identity',()=>{
  const store=validateStore(config);
  assert.equal(store.storeId,'9N6WRN6GN0KR');assert.equal(store.packageVersion,'1.1.22.0');
  assert.equal(store.appUserModelId,'TimeWarpDev.TimeWarpDev_m60bgk3k2x9p0!TimeWarp');
});
test('Store package rejects equal, lower, malformed or oversized versions',()=>{
  for(const version of ['1.1.21','1.1.20','1.0.99','1.1.22-beta','65536.0.0','01.1.22'])assert.throws(()=>validateStore({...config,version}));
  assert.throws(()=>validateStore({...config,previousPackageVersion:'1.1.22.1'}));
});
test('Store package rejects identity mismatch and XML injection',()=>{
  for(const patch of [{packageFamilyName:'Other_otherpublisher'},{publisher:'CN=Unsigned Test'},{applicationId:'1bad'},{displayName:'<x>'},{publisherDisplayName:'a&b'},{privateKey:'secret'}])assert.throws(()=>validateStore({...config,...patch}));
});
