// A small QR code encoder for wallet addresses: byte mode, error correction
// level M, versions 1–10 (up to 213 bytes). It follows the structure of
// Project Nayuki's reference QR Code generator (MIT licence), cut down to what
// a deposit address needs, so the site gains no dependency.

// Per version (index 1–10): error correction codewords per block, and blocks.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_M = 0; // Level M's two format bits.

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version]! * BLOCKS[version]!;
}

// --- Reed–Solomon over GF(2^8) with the QR polynomial 0x11D ----------------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

export function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i]! ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

// --- Format bits (level and mask, BCH-protected) --------------------------------------

export function formatBits(mask: number): number {
  const data = (FORMAT_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

// --- The symbol -------------------------------------------------------------------------

class QrSymbol {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly fixed: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  private set(x: number, y: number, dark: boolean) {
    this.modules[y]![x] = dark;
    this.fixed[y]![x] = true;
  }

  private drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    positions.forEach((px, i) =>
      positions.forEach((py, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        this.alignment(px, py);
      }),
    );
    this.drawFormat(0);
    this.drawVersion();
  }

  private finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.set(xx, yy, dist !== 2 && dist !== 4);
      }
  }

  private alignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  drawFormat(mask: number) {
    const bits = formatBits(mask);
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(bits, i));
    this.set(8, this.size - 8, true);
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, bit(bits, i));
      this.set(b, a, bit(bits, i));
    }
  }

  drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.fixed[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = bit(data[i >>> 3]!, 7 - (i & 7));
            i++;
          }
        }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        if (this.fixed[y]![x]) continue;
        const invert = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][mask];
        if (invert) this.modules[y]![x] = !this.modules[y]![x];
      }
  }

  // Runs of one colour, 2×2 blocks and dark/light balance; enough to pick a
  // readable mask (any mask is valid; the format bits name it).
  penalty(): number {
    const n = this.size;
    let score = 0;
    for (let y = 0; y < n; y++) {
      let run = 1;
      for (let x = 1; x <= n; x++) {
        if (x < n && this.modules[y]![x] === this.modules[y]![x - 1]) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    }
    for (let x = 0; x < n; x++) {
      let run = 1;
      for (let y = 1; y <= n; y++) {
        if (y < n && this.modules[y]![x] === this.modules[y - 1]![x]) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    }
    let dark = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (this.modules[y]![x]) dark++;
        if (
          y < n - 1 &&
          x < n - 1 &&
          this.modules[y]![x] === this.modules[y]![x + 1] &&
          this.modules[y]![x] === this.modules[y + 1]![x] &&
          this.modules[y]![x] === this.modules[y + 1]![x + 1]
        )
          score += 3;
      }
    const total = n * n;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

// Data codewords: mode, length, bytes, terminator and padding.
export function encodeData(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const result: number[] = [];
  for (let i = 0; i < bits.length; i += 8) result.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  return result;
}

// Split into blocks, add error correction, interleave.
export function interleave(data: number[], version: number): number[] {
  const blocks = BLOCKS[version]!;
  const eccLen = ECC_PER_BLOCK[version]!;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = reedSolomonDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    all.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < all[0]!.length; i++)
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) result.push(block[i]!);
    });
  return result;
}

// The QR matrix for text: rows of modules, true for dark.
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  while (
    version <= 10 &&
    4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8
  )
    version++;
  if (version > 10) throw new Error("Too long for a QR code here.");
  const codewords = interleave(encodeData(bytes, version), version);
  let best: QrSymbol | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const symbol = new QrSymbol(version);
    symbol.drawCodewords(codewords);
    symbol.applyMask(mask);
    symbol.drawFormat(mask);
    const score = symbol.penalty();
    if (score < bestScore) {
      best = symbol;
      bestScore = score;
    }
  }
  return best!.modules;
}

// An SVG path of the dark modules, with a 4-module quiet zone.
export function qrPath(text: string): { size: number; path: string } {
  const matrix = qrMatrix(text);
  const border = 4;
  let path = "";
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + border},${y + border}h1v1h-1z`;
    }),
  );
  return { size: matrix.length + border * 2, path };
}
