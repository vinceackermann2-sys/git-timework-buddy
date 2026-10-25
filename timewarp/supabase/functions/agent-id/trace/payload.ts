// A trace mark: 8 random bytes (64 bits) that name one output of one agent.
// Inside an image or a sound it travels as 80 bits, the 64 and a CRC-16, so a
// detector can tell a mark it read back from noise that happens to look like one.

export const MARK_BYTES = 8;
export const MARK_BITS = 80;

export type Detection = { found: boolean; mark?: Uint8Array; confidence: number };

// CRC-16/CCITT-FALSE (polynomial 0x1021, start 0xFFFF): one to three wrong bits
// in 80 are always caught, and random bits pass one time in 65 536. Starting at
// 0xFFFF means all-zero bits (a blank input) never pass.
export function crc16(bytes: Uint8Array) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export const newMark = () => crypto.getRandomValues(new Uint8Array(MARK_BYTES));

// The 80 bits, most significant first: the id, then its CRC.
export function markBits(id: Uint8Array): Uint8Array {
  if (!id || id.length !== MARK_BYTES) throw new Error('A trace mark is 8 bytes.');
  const crc = crc16(id);
  const bytes = [...id, crc >> 8, crc & 0xff];
  const bits = new Uint8Array(MARK_BITS);
  for (let i = 0; i < MARK_BITS; i++) bits[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return bits;
}

// The id back from 80 bits (anything truthy is a 1), or null when the CRC fails.
export function markFromBits(bits: ArrayLike<number>): Uint8Array | null {
  if (!bits || bits.length !== MARK_BITS) return null;
  const bytes = new Uint8Array(MARK_BITS / 8);
  for (let i = 0; i < MARK_BITS; i++) if (bits[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  const id = bytes.slice(0, MARK_BYTES);
  return crc16(id) === ((bytes[8] << 8) | bytes[9]) ? id : null;
}

// As text: tr_ and 16 hex characters.
export const markId = (mark: Uint8Array) => 'tr_' + Array.from(mark, b => b.toString(16).padStart(2, '0')).join('');
export function markFromId(id: string): Uint8Array | null {
  const match = /^tr_([0-9a-f]{16})$/.exec(String(id || '').trim().toLowerCase());
  if (!match) return null;
  return Uint8Array.from(match[1].match(/../g)!, pair => parseInt(pair, 16));
}

// A detector's verdict from its 80 bit scores. Each score is a bit's
// correlation in standard deviations of what unmarked content gives, so for
// unmarked content (or the wrong key) the average size of a score is about 0.8
// and can't be above 1 on average. A mark counts only when its CRC holds and
// the scores are clearly stronger than that: the two checks together make a
// false find far rarer than one in a million.
export function readMark(scores: ArrayLike<number>, threshold = 1.05): Detection {
  const bits = new Uint8Array(MARK_BITS);
  let sum = 0;
  for (let i = 0; i < MARK_BITS; i++) {
    const score = Number.isFinite(scores[i]) ? scores[i] : 0;
    bits[i] = score > 0 ? 1 : 0;
    sum += Math.abs(score);
  }
  const strength = sum / MARK_BITS;
  const mark = markFromBits(bits);
  // 0 for what noise looks like, 1 for a mark read clearly.
  const confidence = Math.round(Math.min(1, Math.max(0, (strength - 0.8) / 1.2)) * 1000) / 1000;
  return mark && strength >= threshold ? { found: true, mark, confidence } : { found: false, confidence };
}
