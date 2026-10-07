"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { nativeCatalogConfig } = require('../shared/codex-catalog.cjs');

test('the versioned OpenAI compatibility catalog contains all eight standard models with intact metadata', () => {
  const bytes=fs.readFileSync(path.join(__dirname,'../shared/codex-models.json'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),require('../shared/codex-models.source.json').sha256);
  const models=JSON.parse(bytes).models.filter(model=>model.visibility==='list').sort((a,b)=>a.priority-b.priority);
  assert.deepEqual(models.map(model=>model.slug),['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5']);
  for(const model of models){assert.ok(model.model_messages.instructions_template.length>100);assert.ok(model.supported_reasoning_levels.some(option=>option.effort===model.default_reasoning_level));}
});

test('only the unversioned vendor runtime gets a native catalog override, outside ASAR', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'timewarp-catalog-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={home:path.join(root,'private-codex-home'),packageRoot:root};
  const metadata=path.join(root,'codex-package.json');fs.writeFileSync(metadata,JSON.stringify({version:'0.0.0'}));
  const config=nativeCatalogConfig(options);assert.equal(config.length,1);assert.equal(config[0][0],'model_catalog_json');
  assert.ok(config[0][1].startsWith(options.home+path.sep));
  assert.deepEqual(fs.readFileSync(config[0][1]),fs.readFileSync(path.join(__dirname,'../shared/codex-models.json')));
  const at=fs.statSync(config[0][1]).mtimeMs;nativeCatalogConfig(options);assert.equal(fs.statSync(config[0][1]).mtimeMs,at);
  fs.writeFileSync(metadata,JSON.stringify({version:'0.160.1'}));assert.deepEqual(nativeCatalogConfig(options),[]);
});
