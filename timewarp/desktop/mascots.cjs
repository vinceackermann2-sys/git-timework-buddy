"use strict";
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { choices } = require('../shared/mascots.cjs');
const urls = choices.map(choice => choice.avatarUrl);
function mascot(seed) {
  const index = crypto.createHash('sha256').update(String(seed || 'Timewarp')).digest()[0] % choices.length;
  const { imageId, avatarUrl } = choices[index];
  return { imageId, avatarUrl };
}
function selectedAvatar(imageId) {
  const choice = choices.find(item => item.imageId === imageId);
  return choice ? { avatarType: 'native', avatarUrl: choice.avatarUrl } : null;
}
function avatar(seed) { return { avatarType: 'native', avatarUrl: mascot(seed).avatarUrl }; }
function shouldAssign(agent) {
  return !agent.avatarUrl || (agent.avatarType === 'native' && !urls.includes(agent.avatarUrl));
}
function serve(req, res, pathname) {
  const match = /^\/mascots\/(orbit|nova|cosmo)\.png$/.exec(pathname);
  if (!match || req.method !== 'GET') return false;
  const file = path.join(__dirname, '../assets/mascots', match[1] + '.png');
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': 'app://app' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res); return true;
}
module.exports = { mascot, avatar, selectedAvatar, shouldAssign, serve, urls };
