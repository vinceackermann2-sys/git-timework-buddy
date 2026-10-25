// Image marks: a keyed spread-spectrum pattern hidden in the brightness of a
// picture. Every picture is looked at the same way, as its brightness shrunk
// to a 256 × 256 grid (the canonical image, which is all a browser sends to be
// checked). The 80 bits live in low-to-mid frequencies of that grid's 8 × 8
// blocks, each bit spread with random signs over 204 or 205 places across the
// whole picture, so JPEG, resizing (to any size or shape) and brightness
// changes leave it readable, while the grain it adds is scaled to how busy
// each part of the picture is: more in texture and edges, little in flat sky.
// Reading limits each coefficient softly, so the strong edges of text, logos
// and diagrams can't outvote the many small nudges. Embedding knows the
// picture, so it also measures what the picture itself already says about
// each bit and pushes harder only where the picture disagrees (informed
// embedding): every bit then reads cleanly at little cost.
// Cropping moves the grid, so a cropped picture no longer reads.
// Hot loops use local names only (Math too): the test sandbox makes every
// global lookup slow, and locals are fastest everywhere anyway.
import { MARK_BITS, markBits, readMark, type Detection } from './payload.ts';
import { layout, type Layout } from './keyed.ts';
import type { RgbaImage } from './png.ts';

export type { RgbaImage };
export const CANONICAL = 256;

// The 16 coefficients of each block that carry the mark: frequencies 2 to 5
// steps from the block's average, none higher than 4 on either axis.
const BAND: number[] = [];
for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) if (u + v >= 2 && u + v <= 5 && u <= 4 && v <= 4) BAND.push(u * 8 + v);
const SLOTS = (CANONICAL / 8) * (CANONICAL / 8) * BAND.length;
// Slot j's place in the grid of block coefficients (row = block row × 8 + u).
const SLOT_AT = (() => {
  const at = new Int32Array(SLOTS);
  let j = 0;
  for (let by = 0; by < CANONICAL; by += 8) for (let bx = 0; bx < CANONICAL; bx += 8) for (const c of BAND) at[j++] = (by + (c >> 3)) * CANONICAL + bx + (c & 7);
  return at;
})();

// Each slot's coefficient moves by about this much (brightness levels on the
// canonical grid) before the texture mask scales it: about 46 dB PSNR on
// photos. However hard some bits must push, the change stays under 3 levels
// RMS (PSNR 38.5 dB or more) at strength 1.
const AMPLITUDE = 5, MAX_RMS = 3;
// Coefficients are softly limited to about this size (brightness levels) when read.
const LIMIT = 8;
const ROUNDS = 3;
// The texture mask: a floor in flat areas, rising with the local spread of
// brightness, capped on strong edges.
const MASK_FLOOR = 0.25, MASK_SCALE = 14, MASK_MAX = 1.6;

function checkImage(image: RgbaImage) {
  const { width, height, data } = image || ({} as RgbaImage);
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) || !data || data.length !== width * height * 4) {
    throw new Error('An image is RGBA pixels: width × height × 4 bytes.');
  }
}

// Area resampling on one axis: each output cell is the average of the source
// pixels under it, a pixel cut by a cell edge counting for its share.
function areaWeights(from: number, to: number) {
  const { min, floor, ceil, max } = Math;
  const scale = from / to, start = new Int32Array(to + 1), index: number[] = [], weight: number[] = [];
  for (let o = 0; o < to; o++) {
    start[o] = index.length;
    const lo = o * scale, hi = lo + scale;
    for (let i = floor(lo); i < min(from, ceil(hi)); i++) {
      const share = min(hi, i + 1) - max(lo, i);
      if (share > 0) { index.push(i); weight.push(share / scale); }
    }
  }
  start[to] = index.length;
  return { start, index: Int32Array.from(index), weight: Float64Array.from(weight) };
}

// Area averages on the 256 × 256 grid of each pixel's brightness (BT.601
// luma, 0 to 255) and, when asked, of its square. Only additions and
// multiplications in a fixed order, so a browser running this same code gets
// the same numbers. Rows are read one at a time, so memory stays small.
function gridAverages(image: RgbaImage, squares: boolean) {
  const n = CANONICAL, { width, height, data } = image;
  const xs = areaWeights(width, n), ys = areaWeights(height, n), xStart = xs.start, xIndex = xs.index, xWeight = xs.weight;
  const line = new Float64Array(width), rows = new Float64Array(height * n), rows2 = squares ? new Float64Array(height * n) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) line[x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    for (let o = 0; o < n; o++) {
      let sum = 0, sum2 = 0;
      for (let k = xStart[o]; k < xStart[o + 1]; k++) { const v = line[xIndex[k]], w = xWeight[k]; sum += v * w; sum2 += v * v * w; }
      rows[y * n + o] = sum;
      if (rows2) rows2[y * n + o] = sum2;
    }
  }
  const down = (src: Float64Array) => {
    const out = new Float64Array(n * n);
    for (let o = 0; o < n; o++) {
      for (let k = ys.start[o]; k < ys.start[o + 1]; k++) {
        const w = ys.weight[k], row = ys.index[k] * n, at = o * n;
        for (let x = 0; x < n; x++) out[at + x] += src[row + x] * w;
      }
    }
    return out;
  };
  return { mean: down(rows), square: rows2 ? down(rows2) : null };
}

// The picture's brightness on the 256 × 256 grid: what a browser sends.
export function canonicalImage(image: RgbaImage): Float32Array {
  checkImage(image);
  return Float32Array.from(gridAverages(image, false).mean);
}

const COS = (() => {
  const c = new Float64Array(64);
  for (let k = 0; k < 8; k++) for (let x = 0; x < 8; x++) c[k * 8 + x] = (k ? 0.5 : Math.SQRT1_2 / 2) * Math.cos(((2 * x + 1) * k * Math.PI) / 16);
  return c;
})();
// 8 × 8 block DCT (orthonormal) of the whole grid, or its inverse.
function blockDct(src: ArrayLike<number>, inverse = false) {
  const n = CANONICAL, cos = COS, out = new Float64Array(n * n), tmp = new Float64Array(64);
  const at = (k: number, x: number) => (inverse ? x * 8 + k : k * 8 + x);
  const table = new Float64Array(64);
  for (let k = 0; k < 8; k++) for (let x = 0; x < 8; x++) table[k * 8 + x] = cos[at(k, x)];
  for (let by = 0; by < n; by += 8) {
    for (let bx = 0; bx < n; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const row = (by + y) * n + bx;
        for (let k = 0; k < 8; k++) {
          let sum = 0;
          for (let x = 0; x < 8; x++) sum += table[k * 8 + x] * src[row + x];
          tmp[y * 8 + k] = sum;
        }
      }
      for (let x = 0; x < 8; x++) {
        for (let k = 0; k < 8; k++) {
          let sum = 0;
          for (let y = 0; y < 8; y++) sum += table[k * 8 + y] * tmp[y * 8 + x];
          out[(by + k) * n + bx + x] = sum;
        }
      }
    }
  }
  return out;
}

// A coefficient softly limited, so a few strong edges can't outvote the many
// small nudges that carry a bit.
const makeLimit = () => { const tanh = Math.tanh, limit = LIMIT; return (c: number) => limit * tanh(c / limit); };

// Each bit's mean signed (limited) coefficient: what the picture says about that bit.
function responses(coef: Float64Array, lay: Layout) {
  const slotAt = SLOT_AT, bit = lay.bit, chip = lay.chip, sum = new Float64Array(MARK_BITS), soft = makeLimit();
  for (let j = 0; j < slotAt.length; j++) sum[bit[j]] += chip[j] * soft(coef[slotAt[j]]);
  for (let b = 0; b < MARK_BITS; b++) sum[b] /= lay.count[b];
  return sum;
}

// How much grain each grid cell can hide: the spread of brightness over it
// and its eight neighbours, from a floor in flat areas to a cap on edges.
function textureMask(mean: Float64Array, square: Float64Array) {
  const n = CANONICAL, { sqrt, min, max } = Math, floor = MASK_FLOOR, scale = MASK_SCALE, cap = MASK_MAX, mask = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let m = 0, s = 0, count = 0;
      for (let yy = max(0, y - 1); yy <= min(n - 1, y + 1); yy++) {
        for (let xx = max(0, x - 1); xx <= min(n - 1, x + 1); xx++) { m += mean[yy * n + xx]; s += square[yy * n + xx]; count++; }
      }
      m /= count; s /= count;
      mask[y * n + x] = min(cap, floor + sqrt(max(0, s - m * m)) / scale);
    }
  }
  return mask;
}

// Where each pixel falls between grid cells on one axis (for bilinear stretching).
function stretchAxis(size: number) {
  const n = CANONICAL, i0 = new Int32Array(size), f = new Float64Array(size);
  for (let x = 0; x < size; x++) {
    const u = Math.min(n - 1, Math.max(0, ((x + 0.5) * n) / size - 0.5));
    i0[x] = Math.min(n - 2, Math.floor(u)); f[x] = u - i0[x];
  }
  return { i0, f };
}

// The picture with a grid field stretched smoothly over it and added to
// brightness (the same amount to R, G and B keeps each colour's hue), and the
// mean square of what actually changed (clipped pixels change less). `out`
// is reused from round to round, so a big picture needs only one more copy.
type Axis = { i0: Int32Array; f: Float64Array };
function addField(image: RgbaImage, field: Float64Array, ax: Axis, ay: Axis, out: Uint8ClampedArray) {
  const n = CANONICAL, { width, height, data } = image, xi = ax.i0, xf = ax.f;
  out.set(data);
  let squares = 0;
  for (let y = 0; y < height; y++) {
    const r0 = ay.i0[y] * n, r1 = r0 + n, fy = ay.f[y];
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
      const c = xi[x], fx = xf[x];
      const top = field[r0 + c] + (field[r0 + c + 1] - field[r0 + c]) * fx, bottom = field[r1 + c] + (field[r1 + c + 1] - field[r1 + c]) * fx;
      const d = top + (bottom - top) * fy;
      out[i] = data[i] + d; out[i + 1] = data[i + 1] + d; out[i + 2] = data[i + 2] + d;
      const r = out[i] - data[i], g = out[i + 1] - data[i + 1], b = out[i + 2] - data[i + 2];
      squares += r * r + g * g + b * b;
    }
  }
  return squares / (3 * width * height);
}

// The marked picture: the same size, colours and alpha, with the pattern added
// to brightness (the same amount to R, G and B keeps each colour's hue).
// `strength` scales the pattern and its cap (1 by default; 2 is about 6 dB less PSNR).
export async function embedImage(image: RgbaImage, mark: Uint8Array, key: string, options: { strength?: number } = {}): Promise<RgbaImage> {
  checkImage(image);
  const { width, height } = image;
  const strength = Math.min(4, Math.max(0.1, Number(options.strength ?? 1) || 1));
  const lay = await layout(key, 'image v1', SLOTS);
  const sign = Array.from(markBits(mark), b => (b ? 1 : -1));
  const grid = gridAverages(image, true), host = responses(blockDct(grid.mean), lay), mask = textureMask(grid.mean, grid.square!);
  const ax = stretchAxis(width), ay = stretchAxis(height);
  const base = AMPLITUDE * strength, amp = new Float64Array(MARK_BITS).fill(base);
  const slotAt = SLOT_AT, bit = lay.bit, chip = lay.chip, cells = CANONICAL * CANONICAL;
  const out = new Uint8ClampedArray(image.data.length);
  for (let round = 0; round < ROUNDS; round++) {
    const coef = new Float64Array(cells);
    for (let j = 0; j < slotAt.length; j++) { const b = bit[j]; coef[slotAt[j]] = amp[b] * sign[b] * chip[j]; }
    const field = blockDct(coef, true);
    for (let c = 0; c < cells; c++) field[c] *= mask[c];
    const meanSquare = addField(image, field, ax, ay, out);
    // Never more than the cap, however hard the bits had to push.
    const cap = MAX_RMS * strength;
    if (meanSquare > cap * cap) {
      const scale = (0.97 * cap) / Math.sqrt(meanSquare);
      for (let c = 0; c < cells; c++) field[c] *= scale;
      addField(image, field, ax, ay, out);
    }
    if (round === ROUNDS - 1) break;
    // What came through for each bit (after the mask, resampling, rounding and
    // clipping), and how hard each must push to reach the same clear level.
    const got = responses(blockDct(canonicalImage({ width, height, data: out })), lay);
    const gain = Array.from(amp, (a, b) => Math.max(0.05, (sign[b] * (got[b] - host[b])) / a));
    const target = base * [...gain].sort((x, y) => x - y)[MARK_BITS >> 1];
    for (let b = 0; b < MARK_BITS; b++) amp[b] = Math.min(base * 6, Math.max(base * 0.4, (target - sign[b] * host[b]) / gain[b]));
  }
  return { width, height, data: out };
}

// Reads a mark from a picture or from its canonical grid (256 × 256 brightness).
export async function detectImage(input: RgbaImage | Float32Array, key: string): Promise<Detection> {
  const asImage = input as RgbaImage;
  const grid = asImage && typeof asImage.width === 'number' && asImage.data ? canonicalImage(asImage) : (input as Float32Array);
  if (!grid || grid.length !== CANONICAL * CANONICAL) throw new Error(`A canonical image is ${CANONICAL} × ${CANONICAL} brightness values.`);
  const finite = Number.isFinite;
  for (let i = 0; i < grid.length; i++) if (!finite(grid[i])) throw new Error('A canonical image holds numbers only.');
  const lay = await layout(key, 'image v1', SLOTS);
  const coef = blockDct(grid), slotAt = SLOT_AT, bit = lay.bit, chip = lay.chip, soft = makeLimit();
  const num = new Float64Array(MARK_BITS), den = new Float64Array(MARK_BITS);
  for (let j = 0; j < slotAt.length; j++) {
    const c = soft(coef[slotAt[j]]), b = bit[j];
    num[b] += chip[j] * c; den[b] += c * c;
  }
  return readMark(Array.from(num, (v, b) => (den[b] > 0 ? v / Math.sqrt(den[b]) : 0)));
}
