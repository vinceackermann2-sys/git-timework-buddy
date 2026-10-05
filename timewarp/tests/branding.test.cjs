"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { rebrandJavaScript } = require('../scripts/rebrand.cjs');
const { presets, defaultAccent, hexToAccent, migrateAppearance } = require('../shared/appearance.cjs');

test('rebranding covers escaped UI copy and prompts while preserving runtime protocols and attribution', () => {
  const source = '({title:"Energy",copy:"Welcome\\nEnergy assistant",prompt:`Hello\\nEnergy ${"Energy"}`,protocol:"energy-device://",worker:"energy-worker",env:"ENERGY_DATA_DIR",license:"Copyright © 2026 Energy"})';
  const value = vm.runInNewContext(rebrandJavaScript(source));
  assert.equal(value.title, 'Timewarp');
  assert.equal(value.copy, 'Welcome\nTimewarp assistant');
  assert.equal(value.prompt, 'Hello\nTimewarp Timewarp');
  assert.equal(value.protocol, 'energy-device://');
  assert.equal(value.worker, 'energy-worker');
  assert.equal(value.env, 'ENERGY_DATA_DIR');
  assert.equal(value.license, 'Copyright © 2026 Energy');
});

test('stock appearance upgrades without changing a custom theme, scheme, radiance or texture', () => {
  const old = { scheme: 'dark', accent: hexToAccent('#82B1F0'), radiance: 0.7, texture: { type: 'dots', step: 8 } };
  const migrated = migrateAppearance(old);
  assert.deepEqual(migrated, { ...old, accent: defaultAccent });
  assert.deepEqual(old.accent, hexToAccent('#82B1F0'));
  const custom = { ...old, accent: hexToAccent('#E8B5F4') };
  assert.equal(migrateAppearance(custom), custom);
  assert.equal(migrateAppearance(migrated), migrated);
});

test('all twelve preset values round trip through the native HSL accent schema', () => {
  assert.equal(presets.length, 12);
  assert.equal(new Set(presets.map(preset => preset.hex)).size, presets.length);
  for (const { hex } of presets) {
    const { hue, saturation, lightness, tint } = hexToAccent(hex);
    assert.equal(tint, 0.3);
    assert.ok(hue >= 0 && hue <= 360);
    assert.ok(saturation >= 0 && saturation <= 1);
    assert.ok(lightness >= 0 && lightness <= 1);
    const rgb = [0, 8, 4].map(offset => {
      const position = (offset + hue / 30) % 12;
      const amplitude = saturation * Math.min(lightness, 1 - lightness);
      return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1)))).toString(16).padStart(2, '0');
    });
    assert.equal(('#' + rgb.join('')).toUpperCase(), hex);
  }
});
