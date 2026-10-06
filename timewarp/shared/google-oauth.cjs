"use strict";
const crypto = require('node:crypto');
const CONTEXT = 'timewarp-google-desktop-v1';
const CALLBACK = 'https://timewarpdev.com/auth/v1/callback';
const CLIENT_ID = '657009835367-1doqgk3lsldhgm0sqitko2ecbqn3677d.apps.googleusercontent.com';
function createGoogleFlow() {
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    state: crypto.randomBytes(32).toString('hex'),
    nonce: crypto.randomBytes(32).toString('hex'),
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
  };
}
function googleStartUrl(origin, flow) {
  const url = new URL('/auth/google', origin);
  url.search = new URLSearchParams({ target: 'energy-desktop', desktop_state: flow.state,
    desktop_key: flow.publicKey, desktop_nonce: crypto.createHash('sha256').update(flow.nonce).digest('hex') });
  return url.href;
}
function decryptGoogleHandoff(code, flow) {
  try {
    if (typeof code !== 'string' || code.length > 32768 || !/^twgi_[A-Za-z0-9_-]+$/.test(code)) throw Error();
    const envelope = JSON.parse(Buffer.from(code.slice(5), 'base64url').toString('utf8'));
    if (envelope.version !== 1 || typeof envelope.key !== 'string' || envelope.key.length > 256 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw Error();
    const peer = crypto.createPublicKey({ key: Buffer.from(envelope.key, 'base64url'), type: 'spki', format: 'der' });
    if (peer.asymmetricKeyType !== 'ec' || peer.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error();
    const privateKey = crypto.createPrivateKey({ key: Buffer.from(flow.privateKey, 'base64url'), type: 'pkcs8', format: 'der' });
    const shared = crypto.diffieHellman({ privateKey, publicKey: peer });
    const key = crypto.hkdfSync('sha256', shared, Buffer.from(flow.state), CONTEXT, 32);
    const iv = Buffer.from(envelope.iv, 'base64url'), bytes = Buffer.from(envelope.data, 'base64url');
    if (iv.length !== 12 || bytes.length < 17) throw Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(CONTEXT)); decipher.setAuthTag(bytes.subarray(-16));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8'));
    if (value.state !== flow.state || typeof value.idToken !== 'string' || !value.idToken || value.idToken.length > 16384) throw Error();
    return value.idToken;
  } catch { throw Object.assign(new Error('This Google sign-in result could not be verified. Start again from Timewarp.'), { status: 400 }); }
}
module.exports = { createGoogleFlow, googleStartUrl, decryptGoogleHandoff, CALLBACK, CLIENT_ID, CONTEXT };
