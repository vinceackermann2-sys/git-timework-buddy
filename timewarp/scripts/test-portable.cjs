"use strict";
// Run source tests on a checkout without the privately supplied Electron runtime.
// npm test still runs the complete suite, including the upstream contract tests.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const upstreamTests = new Set(['agents.test.cjs', 'connector-browser.test.cjs', 'wire.integration.test.cjs']);
const files = fs.readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.test.cjs') && !upstreamTests.has(name))
  .sort().map(name => path.join(root, 'tests', name));
if (!files.length) throw new Error('No portable source tests found.');
console.log('Upstream-dependent suites are separate: ' + [...upstreamTests].join(', ') + '. Run npm test after supplying and building the Energy runtime.');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
