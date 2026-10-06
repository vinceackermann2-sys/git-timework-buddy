"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), vm = require('node:vm'), acorn = require('acorn');
const { renameAgentCopy, patchAgentCreation, patchAgentAvatarResolver } = require('../scripts/agents.cjs');
const { selectedAvatar, shouldAssign } = require('../desktop/mascots.cjs');
const { choices } = require('../shared/mascots.cjs');

function extract(source, names) {
  const declarations = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  return names.map(name => {
    const node = declarations.find(item => item.id.name === name);
    assert.ok(node, 'Native declaration: ' + name);
    return 'const ' + source.slice(node.start, node.end) + ';';
  }).join('\n');
}

test('agent terminology changes UI copy while preserving roles, routes, CSS, events and storage keys', () => {
  const source = '({title:"Assistants",add:"Add assistant",edit:"Edit assistant",search:`Search conversations and assistants ${1}`,role:"assistant",widget:"assistants",route:"?assistant=edit",key:"newco.sidebar.assistant.",event:"assistant_created",classes:"group/assistant-task-group relative opacity-0",instructions:"Use <assistant> tags",license:"Copyright Assistant"})';
  const value = vm.runInNewContext(renameAgentCopy(source));
  assert.equal(value.title, 'Agents');
  assert.equal(value.add, 'Add agent');
  assert.equal(value.edit, 'Edit agent');
  assert.equal(value.search, 'Search conversations and agents 1');
  for (const key of ['role','widget','route','key','event','classes','instructions','license']) {
    assert.equal(value[key], vm.runInNewContext(source)[key], key);
  }
});

test('native create saves every selected mascot without a cloud image lookup or automatic reassignment', async () => {
  const asar = await import('@electron/asar');
  const archive = path.resolve(__dirname, '../../energy-testv1/build/app.asar.pristine');
  const read = file => asar.extractFile(archive, file.split('/').join(path.sep)).toString();
  const main = patchAgentAvatarResolver(read('out/main/index.js'));
  const ui = renameAgentCopy(patchAgentCreation(read('out/renderer/assets/mermaid-GHXKKRXX-YWFhvrpV.js')));
  let saved, generated = 0, uploads = 0;
  const context = vm.createContext({
    require: () => ({ selectedAvatar }),
    xq: 'legacy-orbit', I0: {avatarType:'native',avatarUrl:choices[0].avatarUrl}, ane:'legacy-nova', one:{avatarType:'native',avatarUrl:choices[1].avatarUrl},
    _e: value => value, Se: {input(){return this}, output(){return this}, mutation:fn=>fn, query:fn=>fn, subscription:fn=>fn},
    kq:{},Iq:{},mq:{},Fd:{},fk:{},pq:{},gq:{},yq:{},wq:{},bq:{},vq:{},sne:{},gk:{},
    o:{z:{array(){},void(){}}}, Q:Error,
  });
  vm.runInContext(extract(main, ['GC','dne']) + '\nglobalThis.resolveAvatar=GC;globalThis.router=dne;', context);
  const auth = {resolveImageUpload: async id => {uploads++;return 'https://example.invalid/'+id}, generateAgentAvatar:async()=>{generated++}};
  const routes = context.router({agents:{}}, {create:async input=>{saved=input;return {agent:{...input,avatarType:input.avatar.avatarType,avatarUrl:input.avatar.avatarUrl,mainConversationId:'conversation',starredAt:null},conversation:{id:'conversation'}}}}, {}, {}, async()=>{});
  context.fw = agent => ({id:agent.id,avatar:agent.avatar});
  let submitted;
  const create = async input => {
    submitted = input;
    return routes.create({
      ctx: { accountSession: { user: { id: 'owner' } }, auth, settingsStore: { get: async () => ({ modelSettings: { name: 'test-model' } }) } },
      input: { ...input, introduction: 'none' },
    });
  };
  const renderer = vm.createContext({
    h:{jsx:(type,props)=>({type,props})}, Srt:'provider', nU:async()=> 'uploaded-photo',
    le: { useUtils: () => ({
      client: { product: { images: { beginUpload: { mutate() {} } }, agents: { create: { mutate: create } } } },
      product: { agents: { list: { invalidate: async () => {} } } },
    }) },
  });
  vm.runInContext(extract(ui,['Ert'])+'\nglobalThis.create=Ert({children:null}).props.create;', renderer);
  for (const choice of choices) {
    await renderer.create({id:'agent-'+choice.imageId,displayName:choice.name,instructions:'Selected by user',avatar:{kind:'mascot',imageId:choice.imageId}});
    assert.equal(submitted.avatar.type, 'native');
    assert.equal(submitted.avatar.imageId, choice.imageId);
    assert.equal(saved.avatar.avatarUrl, choice.avatarUrl);
    assert.equal(saved.avatar.avatarType, 'native');
    assert.equal(shouldAssign({...saved.avatar}), false);
  }
  assert.equal(uploads, 0);
  assert.equal(generated, 0);
  await renderer.create({id:'photo-agent',displayName:'Photo',instructions:'',avatar:{kind:'upload',file:{}}});
  assert.equal(submitted.avatar.type, 'upload');
  assert.equal(saved.avatar.avatarType, 'upload');
  assert.equal(uploads, 1);
  assert.equal(shouldAssign(saved.avatar), false);
  assert.equal((await context.resolveAvatar(auth,{type:'native',imageId:'legacy-orbit'})).avatarUrl,choices[0].avatarUrl);
});
