// PNG in and out, as RGBA pixels. Reads 1 to 16-bit gray, gray and alpha, RGB,
// RGBA and palette images (not interlaced ones); writes 8-bit RGBA. Deflate is
// the runtime's own CompressionStream where there is one (Deno, browsers,
// Node), with a small inflate in plain TypeScript for anywhere there isn't.

export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_PIXELS = 50_000_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array, crc = 0xffffffff) {
  const table = CRC_TABLE;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i += 4096) {
    const end = Math.min(bytes.length, i + 4096);
    for (let j = i; j < end; j++) { a += bytes[j]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// Inflate (RFC 1950/1951) in plain TypeScript, after zlib's own "puff".
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
type Huffman = { count: Uint16Array; symbol: Uint16Array };

function huffman(lengths: ArrayLike<number>): Huffman {
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
  count[0] = 0;
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}
const FIXED = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144); lengths.fill(9, 144, 256); lengths.fill(7, 256, 280); lengths.fill(8, 280, 288);
  return { lit: huffman(lengths), dist: huffman(new Uint8Array(30).fill(5)) };
})();

export function inflateZlib(src: Uint8Array): Uint8Array {
  if (src.length < 6 || (src[0] & 0x0f) !== 8 || ((src[0] << 8) | src[1]) % 31) throw new Error('The PNG data is not zlib data.');
  const lengthBase = LENGTH_BASE, lengthExtra = LENGTH_EXTRA, distanceBase = DISTANCE_BASE, distanceExtra = DISTANCE_EXTRA;
  let pos = 2, held = 0, have = 0, size = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  const room = (n: number) => {
    if (size + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, size + n));
    bigger.set(out.subarray(0, size)); out = bigger;
  };
  const bits = (n: number) => {
    while (have < n) {
      if (pos >= src.length) throw new Error('The PNG data ends too early.');
      held |= src[pos++] << have; have += 8;
    }
    const value = held & ((1 << n) - 1);
    held >>>= n; have -= n;
    return value;
  };
  const decode = (h: Huffman) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('The PNG data is damaged.');
  };
  const codes = (lit: Huffman, dist: Huffman) => {
    for (;;) {
      let symbol = decode(lit);
      if (symbol < 256) { room(1); out[size++] = symbol; continue; }
      if (symbol === 256) return;
      symbol -= 257;
      if (symbol >= 29) throw new Error('The PNG data is damaged.');
      const length = lengthBase[symbol] + bits(lengthExtra[symbol]);
      const d = decode(dist);
      if (d >= 30) throw new Error('The PNG data is damaged.');
      const distance = distanceBase[d] + bits(distanceExtra[d]);
      if (distance > size) throw new Error('The PNG data is damaged.');
      room(length);
      for (let i = 0; i < length; i++, size++) out[size] = out[size - distance];
    }
  };
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      held = 0; have = 0;
      if (pos + 4 > src.length) throw new Error('The PNG data ends too early.');
      const length = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      if (pos + length > src.length) throw new Error('The PNG data ends too early.');
      room(length); out.set(src.subarray(pos, pos + length), size); size += length; pos += length;
    } else if (type === 1) {
      codes(FIXED.lit, FIXED.dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CODE_ORDER[i]] = bits(3);
      const lencode = huffman(lengths.subarray(0, 19));
      const all = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const symbol = decode(lencode);
        if (symbol < 16) { all[i++] = symbol; continue; }
        let repeat = 0, value = 0;
        if (symbol === 16) { if (!i) throw new Error('The PNG data is damaged.'); value = all[i - 1]; repeat = 3 + bits(2); }
        else if (symbol === 17) repeat = 3 + bits(3);
        else repeat = 11 + bits(7);
        if (i + repeat > nlen + ndist) throw new Error('The PNG data is damaged.');
        while (repeat--) all[i++] = value;
      }
      codes(huffman(all.subarray(0, nlen)), huffman(all.subarray(nlen)));
    } else throw new Error('The PNG data is damaged.');
  }
  return out.slice(0, size);
}

// Without CompressionStream the data is stored, not compressed: correct, just big.
function storeZlib(data: Uint8Array) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  out[0] = 0x78; out[1] = 0x01;
  let at = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535, length = Math.min(65535, data.length - start);
    out[at++] = b === blocks - 1 ? 1 : 0;
    out[at++] = length & 0xff; out[at++] = length >> 8; out[at++] = ~length & 0xff; out[at++] = (~length >> 8) & 0xff;
    out.set(data.subarray(start, start + length), at); at += length;
  }
  new DataView(out.buffer).setUint32(at, adler32(data));
  return out;
}

async function through(bytes: Uint8Array, stream: unknown) {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(body).arrayBuffer());
}
const streams = globalThis as unknown as { CompressionStream?: new (format: string) => unknown; DecompressionStream?: new (format: string) => unknown };
const inflate = (bytes: Uint8Array) => streams.DecompressionStream ? through(bytes, new streams.DecompressionStream('deflate')) : Promise.resolve(inflateZlib(bytes));
const deflate = (bytes: Uint8Array) => streams.CompressionStream ? through(bytes, new streams.CompressionStream('deflate')) : Promise.resolve(storeZlib(bytes));

// PNG's Paeth predictor (made inside each function: see the note in image.ts).
const makePaeth = () => (a: number, b: number, c: number) => {
  const p = a + b - c, pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  if (!bytes || bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('This is not a PNG image.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  let palette: Uint8Array | null = null, transparency: Uint8Array | null = null;
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (body.length < length) throw new Error('The PNG image ends too early.');
    at += 12 + length;
    if (type === 'IHDR' && length >= 13) {
      width = view.getUint32(body.byteOffset - bytes.byteOffset); height = view.getUint32(body.byteOffset - bytes.byteOffset + 4);
      depth = body[8]; color = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') parts.push(body);
    else if (type === 'IEND') break;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  const depths = ({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] } as Record<number, number[]>)[color];
  if (!width || !height || !channels || !depths.includes(depth)) throw new Error('This PNG image has a format that is not supported.');
  if (interlace) throw new Error('Interlaced PNG images are not supported: save the image without interlacing.');
  if (width * height > MAX_PIXELS) throw new Error('This PNG image is too large.');
  if (color === 3 && !palette) throw new Error('This PNG image has no palette.');
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (joined.set(p, at), at + p.length), 0);
  const raw = await inflate(joined);

  const rowBits = width * channels * depth, rowBytes = Math.ceil(rowBits / 8), step = Math.max(1, (channels * depth) >> 3);
  if (raw.length < height * (rowBytes + 1)) throw new Error('The PNG image ends too early.');
  const rows = new Uint8Array(height * rowBytes), paeth = makePaeth();
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)], src = y * (rowBytes + 1) + 1, row = y * rowBytes, up = row - rowBytes;
    if (filter > 4) throw new Error('The PNG image is damaged.');
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= step ? rows[row + i - step] : 0, b = y ? rows[up + i] : 0, c = y && i >= step ? rows[up + i - step] : 0;
      const x = raw[src + i];
      rows[row + i] = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c);
    }
  }

  // Sample `s` of pixel x in row y, at the image's own depth.
  const max = (1 << depth) - 1;
  const sample = (y: number, x: number, s: number) => {
    const row = y * rowBytes;
    if (depth === 8) return rows[row + x * channels + s];
    if (depth === 16) return (rows[row + (x * channels + s) * 2] << 8) | rows[row + (x * channels + s) * 2 + 1];
    const bit = (x * channels + s) * depth;
    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
  };
  const to8 = (v: number) => depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max);
  const key = (i: number) => transparency && transparency.length >= i * 2 + 2 ? (transparency[i * 2] << 8) | transparency[i * 2 + 1] : -1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++, o += 4) {
      if (color === 3) {
        const index = sample(y, x, 0);
        data[o] = palette![index * 3]; data[o + 1] = palette![index * 3 + 1]; data[o + 2] = palette![index * 3 + 2];
        data[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (color === 0 || color === 4) {
        const g = sample(y, x, 0);
        data[o] = data[o + 1] = data[o + 2] = to8(g);
        data[o + 3] = color === 4 ? to8(sample(y, x, 1)) : g === key(0) ? 0 : 255;
      } else {
        const r = sample(y, x, 0), g = sample(y, x, 1), b = sample(y, x, 2);
        data[o] = to8(r); data[o + 1] = to8(g); data[o + 2] = to8(b);
        data[o + 3] = color === 6 ? to8(sample(y, x, 3)) : r === key(0) && g === key(1) && b === key(2) ? 0 : 255;
      }
    }
  }
  return { width, height, data };
}

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(12 + body.length), view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

// 8-bit RGBA, each row with whichever filter leaves the smallest numbers
// (the usual heuristic), which is what makes photos compress.
export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, data } = image;
  if (!(width > 0 && height > 0) || !data || data.length !== width * height * 4) throw new Error('An image is RGBA pixels: width × height × 4 bytes.');
  const rowBytes = width * 4, filtered = new Uint8Array(height * (rowBytes + 1)), paeth = makePaeth(), cost = new Float64Array(5);
  // How far each filter's output is from zero, all five in one pass.
  const size = (v: number) => { v &= 0xff; return v < 128 ? v : 256 - v; };
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes, up = row - rowBytes, out = y * (rowBytes + 1) + 1;
    cost.fill(0);
    for (let i = 0; i < rowBytes; i++) {
      const x = data[row + i], a = i >= 4 ? data[row + i - 4] : 0, b = y ? data[up + i] : 0, c = y && i >= 4 ? data[up + i - 4] : 0;
      cost[0] += x; cost[1] += size(x - a); cost[2] += size(x - b); cost[3] += size(x - ((a + b) >> 1)); cost[4] += size(x - paeth(a, b, c));
    }
    let filter = 0;
    for (let f = 1; f < 5; f++) if (cost[f] < cost[filter]) filter = f;
    filtered[out - 1] = filter;
    for (let i = 0; i < rowBytes; i++) {
      const x = data[row + i], a = i >= 4 ? data[row + i - 4] : 0, b = y ? data[up + i] : 0, c = y && i >= 4 ? data[up + i - 4] : 0;
      filtered[out + i] = x - (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c));
    }
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = 6;
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', await deflate(filtered)), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (png.set(p, at), at + p.length), 0);
  return png;
}
