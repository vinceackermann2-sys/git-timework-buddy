// SSH public keys an agent signs its Git commits with, and the
// allowed_signers file Git checks those signatures against.
import { fail, fromBase64, sha256, toBase64 } from './util.ts';

// "ssh-ed25519 AAAA… comment" → the key without its comment and its SHA256
// fingerprint, as `ssh-keygen -lf` prints it.
export async function parseSshKey(input: unknown) {
  const parts = String(input || '').trim().split(/\s+/);
  if (parts[0] !== 'ssh-ed25519' || !parts[1]) throw fail(400, 'invalid', 'The signing key must be an ssh-ed25519 public key.');
  let blob: Uint8Array;
  try { blob = fromBase64(parts[1]); } catch { throw fail(400, 'invalid', 'The signing key is not valid base64.'); }
  // string "ssh-ed25519" then a 32-byte string.
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const typeLength = blob.length >= 4 ? view.getUint32(0) : -1;
  const type = typeLength === 11 ? new TextDecoder().decode(blob.slice(4, 15)) : '';
  const keyLength = blob.length >= 19 ? view.getUint32(15) : -1;
  if (type !== 'ssh-ed25519' || keyLength !== 32 || blob.length !== 51) throw fail(400, 'invalid', 'The signing key is not a valid ssh-ed25519 key.');
  const fingerprint = 'SHA256:' + toBase64(await sha256(blob)).replace(/=+$/, '');
  return { publicKey: `ssh-ed25519 ${parts[1]}`, fingerprint };
}

// One line per key: who may sign (the agent's Git email), for Git only.
export function allowedSignersLine(principal: string, publicKey: string, comment: string) {
  return `${principal} namespaces="git" ${publicKey} ${comment.replace(/[\r\n]/g, ' ')}`;
}
