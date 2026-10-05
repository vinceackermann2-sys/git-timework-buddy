"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

function chunks(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const out = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8);
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

for (const name of ['orbit', 'nova', 'cosmo']) {
  test(`${name} mascot is a square, endlessly looping animation that also works as a still`, () => {
    const list = chunks(fs.readFileSync(path.join(__dirname, '../assets/mascots', name + '.png')));
    const ihdr = list.find(c => c.type === 'IHDR').data, actl = list.find(c => c.type === 'acTL');
    assert.equal(ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), 'square, so object-contain fills icon slots');
    assert.equal(ihdr[9], 6, 'RGBA with transparency');
    assert.ok(actl, 'APNG animation control chunk');
    const frames = actl.data.readUInt32BE(0);
    assert.ok(frames >= 24, `animated (${frames} frames)`);
    assert.equal(actl.data.readUInt32BE(4), 0, 'loops forever');
    assert.equal(list.filter(c => c.type === 'fcTL').length, frames);
    assert.ok(list.findIndex(c => c.type === 'fcTL') < list.findIndex(c => c.type === 'IDAT'), 'first frame is the still image');
  });
}
