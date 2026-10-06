"use strict";
const { isIP } = require('node:net');
function validateRelease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Release configuration is missing.');
  if (value.enabled !== true) return { enabled: false };
  if (typeof value.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)) throw new Error('A stable release version is required.');
  const feed = new URL(value.updateUrl);
  if (feed.protocol !== 'https:' || feed.username || feed.password || feed.search || feed.hash || isIP(feed.hostname.replace(/^\[|\]$/g,'')) || !feed.hostname.includes('.') || /(?:^|\.)(?:localhost|local|getenergy\.com|generalwork\.ai|newco-trace-ingest\.computerwork\.workers\.dev)$/i.test(feed.hostname)) throw new Error('A public Timewarp HTTPS update URL is required.');
  if (!Array.isArray(value.publisherNames) || !value.publisherNames.length || value.publisherNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 200 || /[\r\n\0]/.test(name) || name === 'The Computer Work Company, Inc.')) throw new Error('Timewarp signing publisher names are required.');
  if (Object.keys(value).some(key => !['enabled','version','updateUrl','publisherNames'].includes(key))) throw new Error('Unexpected release configuration field. Keep signing credentials in the environment.');
  return { enabled: true, version: value.version, updateUrl: feed.href.replace(/\/$/, '') + '/', publisherNames: value.publisherNames };
}
module.exports = { validateRelease };
