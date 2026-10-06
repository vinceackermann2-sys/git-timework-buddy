"use strict";
// A deployment must bundle the same modules that the source tests exercise.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const cloud = path.join(root, 'cloud');
const staged = path.join(root, 'supabase/functions/timewarp-energy');
const files = fs.readdirSync(cloud).filter(name => name.endsWith('.ts') || name === 'deno.json');
for (const file of files) {
  assert.deepEqual(fs.readFileSync(path.join(staged, file)), fs.readFileSync(path.join(cloud, file)),
    'Staged cloud module differs: ' + file + '. Run node scripts/stage-cloud.cjs.');
}
const extras = fs.readdirSync(staged).filter(name => name.endsWith('.ts') && !files.includes(name));
assert.deepEqual(extras, [], 'Remove stale staged cloud modules: ' + extras.join(', '));
console.log('All ' + files.length + ' staged cloud modules match the editable source.');
