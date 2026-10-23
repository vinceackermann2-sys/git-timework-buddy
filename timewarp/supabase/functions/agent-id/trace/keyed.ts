// The secret part of a mark: which bit each place in an image or a sound
// carries, and with which sign. Both come from an AES-256-CTR keystream of the
// trace key, one stream per kind of media, so without the key the pattern
// can't be told from noise, read, or aimed at to remove it.
import { MARK_BITS } from './payload.ts';

export type Layout = { bit: Uint8Array; chip: Int8Array; count: Uint16Array };

export async function keystream(key: string, purpose: string, length: number) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agent-id trace ${purpose}\u0000${key}`));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-CTR', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter: new Uint8Array(16), length: 64 }, aes, new Uint8Array(length)));
}

// Slots shuffled and dealt to the 80 bits in turn (so each bit gets the same
// number, spread over the whole picture or clip), each with a random sign.
async function build(key: string, purpose: string, slots: number): Promise<Layout> {
  const stream = await keystream(key, purpose, slots * 4 + Math.ceil(slots / 8));
  const words = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const order = new Uint32Array(slots);
  for (let i = 0; i < slots; i++) order[i] = i;
  for (let i = slots - 1; i > 0; i--) {
    const j = words.getUint32(i * 4) % (i + 1);
    const swap = order[i]; order[i] = order[j]; order[j] = swap;
  }
  const bit = new Uint8Array(slots), chip = new Int8Array(slots), count = new Uint16Array(MARK_BITS);
  for (let i = 0; i < slots; i++) {
    bit[order[i]] = i % MARK_BITS;
    count[i % MARK_BITS]++;
    chip[i] = (stream[slots * 4 + (i >> 3)] >> (i & 7)) & 1 ? 1 : -1;
  }
  return { bit, chip, count };
}

// Kept for the last few keys: a server reads many inputs with the same key.
const made = new Map<string, Promise<Layout>>();
export function layout(key: string, purpose: string, slots: number): Promise<Layout> {
  if (typeof key !== 'string' || key.length < 16) throw new Error('A trace key is a secret of at least 16 characters.');
  const id = `${purpose}:${slots}:${key}`;
  let found = made.get(id);
  if (!found) {
    found = build(key, purpose, slots);
    found.catch(() => made.delete(id));
    made.set(id, found);
    if (made.size > 8) made.delete(made.keys().next().value!);
  }
  return found;
}
