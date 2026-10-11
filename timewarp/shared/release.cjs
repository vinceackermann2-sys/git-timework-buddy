"use strict";
const { isIP } = require('node:net');
function stableVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('A stable release version is required.');
  return value;
}
function publicFeed(value) {
  const feed = new URL(value);
  if (feed.protocol !== 'https:' || feed.username || feed.password || feed.search || feed.hash || isIP(feed.hostname.replace(/^\[|\]$/g,'')) || !feed.hostname.includes('.') || /(?:^|\.)(?:localhost|local)$/i.test(feed.hostname)) throw new Error('A public Timewarp HTTPS update URL is required.');
  return feed.href.replace(/\/$/, '') + '/';
}
function validateRelease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Release configuration is missing.');
  if (value.enabled !== true) return { enabled: false };
  stableVersion(value.version);
  const updateUrl = publicFeed(value.updateUrl);
  if (!Array.isArray(value.publisherNames) || !value.publisherNames.length || value.publisherNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 200 || /[\r\n\0]/.test(name))) throw new Error('Timewarp signing publisher names are required.');
  if (Object.keys(value).some(key => !['enabled','version','updateUrl','publisherNames'].includes(key))) throw new Error('Unexpected release configuration field. Keep signing credentials in the environment.');
  return { enabled: true, version: value.version, updateUrl, publisherNames: value.publisherNames };
}
// The Mac feed (build.json's macUpdates). Squirrel.Mac installs only an update
// signed with the app's own Developer ID, so it names no publishers.
function validateMacFeed(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mac update configuration is missing.');
  if (value.enabled !== true) return { enabled: false };
  stableVersion(value.version);
  const updateUrl = publicFeed(value.updateUrl);
  if (Object.keys(value).some(key => !['enabled','version','updateUrl'].includes(key))) throw new Error('Unexpected Mac update configuration field.');
  return { enabled: true, version: value.version, updateUrl };
}
module.exports = { validateRelease, validateMacFeed };
