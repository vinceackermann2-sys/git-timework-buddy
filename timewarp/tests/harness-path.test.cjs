"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { prepareHarnessPath } = require('../desktop/harness-path.cjs');
const { bindHarnessClient } = require('../desktop/harness-instructions.cjs');
const { browserInstructions } = require('../desktop/harness-instructions.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timewarp-launchers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'WindowsApps', 'package'), home = path.join(root, 'home');
  fs.mkdirSync(path.join(pkg, 'codex-path'), { recursive: true });
  for (const name of ['browser.exe', 'nango.exe', 'rg.exe', 'unreviewed.exe']) fs.writeFileSync(path.join(pkg, 'codex-path', name), name);
  return { pkg, home };
}
test('browser workers receive Windows shell guidance without growing repeated instructions', () => {
  const original='Generic browser command examples';
  const patched=browserInstructions(original,'win32');
  assert.match(patched,/Windows PowerShell 5/);
  assert.match(patched,/one browser command per shell call/);
  assert.equal(browserInstructions(patched,'win32'),patched);
  assert.equal(browserInstructions(original,'darwin'),original);
});
test('Windows launchers preserve multicall names outside WindowsApps, copy only shipped tools and reuse unchanged files', t => {
  const { pkg, home } = fixture(t), target = prepareHarnessPath(pkg, home, 'win32');
  assert.ok(target.startsWith(home + path.sep));
  assert.deepEqual(fs.readdirSync(target).sort(), ['browser.exe','nango.exe','rg.exe']);
  const file = path.join(target, 'browser.exe'), mtime = fs.statSync(file).mtimeMs;
  assert.equal(fs.readFileSync(file, 'utf8'), 'browser.exe');
  assert.equal(prepareHarnessPath(pkg, home, 'win32'), target);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  fs.writeFileSync(path.join(pkg, 'codex-path/browser.exe'), 'new version');
  const upgraded = prepareHarnessPath(pkg, home, 'win32');
  assert.notEqual(upgraded, target);
  assert.equal(fs.readFileSync(file, 'utf8'), 'browser.exe');
  assert.equal(fs.readFileSync(path.join(upgraded, 'browser.exe'), 'utf8'), 'new version');
});
test('tampered cached launchers fail closed and non-Windows uses packaged executables', t => {
  const { pkg, home } = fixture(t), target = prepareHarnessPath(pkg, home, 'win32');
  fs.writeFileSync(path.join(target, 'browser.exe'), 'unexpected');
  assert.throws(() => prepareHarnessPath(pkg, home, 'win32'), /integrity/);
  assert.equal(prepareHarnessPath(pkg, home, 'darwin'), path.join(pkg, 'codex-path'));
});
test('an installed compatibility repair follows new launcher versions without replacing unrelated config', t => {
  const {pkg,home}=fixture(t),first=prepareHarnessPath(pkg,home,'win32');
  const file=path.join(home,'config.toml');
  const prefix='model = "user-choice"\n\n# Timewarp WindowsApps launcher repair\n[shell_environment_policy.set]\nPATH = ';
  fs.writeFileSync(file,prefix+JSON.stringify(first+';C:\\Tools')+'\n');
  fs.writeFileSync(path.join(pkg,'codex-path/browser.exe'),'upgraded');
  const next=prepareHarnessPath(pkg,home,'win32');
  assert.equal(fs.readFileSync(file,'utf8'),prefix+JSON.stringify(next+';C:\\Tools')+'\n');
});
test('task verification instructions preserve existing constraints, do not grow on resume, and leave other RPCs untouched', async () => {
  const calls = [], client = bindHarnessClient({ request: async (method, params) => { calls.push({ method, params }); return params; } });
  const original = { developerInstructions: 'User-specific instructions', dynamicTools: [{name:'browser'}], sandbox: 'read-only' };
  const first = await client.request('thread/start', original);
  assert.ok(first.developerInstructions.startsWith(original.developerInstructions));
  assert.equal(first.dynamicTools, original.dynamicTools);
  assert.equal(first.sandbox, 'read-only');
  const resumed = await client.request('thread/resume', first);
  assert.equal(resumed.developerInstructions, first.developerInstructions);
  assert.equal(original.developerInstructions, 'User-specific instructions');
  await client.request('turn/steer', original);
  assert.equal(calls.at(-1).params, original);
});

test('workspace permission compatibility retains approvals, explicit profiles and writable roots',async()=>{
  const client=bindHarnessClient({request:async(_method,params)=>params});
  const result=await client.request('thread/start',{cwd:'C:/fixture',sandbox:'workspace-write',approvalPolicy:'on-request',approvalsReviewer:'guardian_subagent',config:{'sandbox_workspace_write.writable_roots':['C:/memory']}});
  assert.equal(result.permissions,':workspace');assert.equal(result.sandbox,undefined);assert.equal(result.approvalPolicy,'on-request');assert.equal(result.approvalsReviewer,'guardian_subagent');assert.deepEqual(result.runtimeWorkspaceRoots,['C:/fixture','C:/memory']);
  const explicit=await client.request('thread/resume',{permissions:'custom',sandbox:'workspace-write'});assert.equal(explicit.permissions,'custom');
  const fresh=await client.request('thread/start',{});assert.match(fresh.developerInstructions,/<timewarp_task_execution>/);
});
