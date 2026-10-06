"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const { recentWebsite } = require('../desktop/workspace-home.js');

test('recent websites keep actual visits in order, update titles, deduplicate and stay bounded', () => {
  let entries = [];
  for (let index = 0; index < 15; index++) entries = recentWebsite(entries, { url: `https://site${index}.example/article`, title: `Article ${index}` }, index);
  assert.equal(entries.length, 12);
  assert.equal(entries[0].title, 'Article 14');
  entries = recentWebsite(entries, { url: 'https://site8.example/article', title: 'Updated title' }, 20);
  assert.equal(entries[0].title, 'Updated title');
  assert.equal(entries[0].visitedAt, 20);
  assert.equal(entries.filter(entry => entry.url === 'https://site8.example/article').length, 1);
});

test('internal pages, invalid addresses and URLs with credentials do not become recommendations', () => {
  const entries = [{ url: 'https://example.com/', title: 'Example', visitedAt: 1 }];
  for (const url of ['about:blank', 'file:///private.txt', 'invalid url', 'javascript:alert(1)', 'https://user:password@example.com']) {
    assert.equal(recentWebsite(entries, { url }), entries);
  }
  assert.equal(recentWebsite([], { url: 'https://example.com/', title: '' })[0].title, 'example.com');
});
