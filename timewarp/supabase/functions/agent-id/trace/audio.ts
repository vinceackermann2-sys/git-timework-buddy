// Audio marks: a keyed spread-spectrum pattern in how loud a sound is, moment
// to moment, in 45 bands between 310 Hz and 5.9 kHz. Every sound is looked at
// the same way, as mono at 16 kHz, its first 30 seconds at most (the canonical
// audio, which is all a browser sends to be checked). That is cut into cells
// of 32 ms × 125 Hz; neighbouring cells in time form pairs, and a bit nudges
// one cell of a pair up and the other down by a fraction of a decibel. A pair
// compares a sound with itself 32 ms later, so steady music says little and
// the nudge stands out; loudness and phase changes (volume, resampling, EQ,
// low-pass filters, lossy codecs) move both cells alike and leave the pair as
// it was. Each bit has 42 or 43 pairs in every 4.86 seconds, so 5 seconds
// carry the whole mark and longer clips repeat it, which makes it stronger.
// Like images, embedding measures what the sound already says about each bit
// and pushes harder only where it disagrees (informed embedding), block by
// block. A clip cut from a marked sound, or with time added in front, still
// reads (detection tries every place the cut could have fallen, to within
// 4 ms) once it holds a whole block: 15 seconds or more is safe, 10 mostly.
// Hot loops use local names only (Math too): see the note in image.ts.
import { MARK_BITS, markBits, readMark, type Detection } from './payload.ts';
import { layout, type Layout } from './keyed.ts';
import type { Audio } from './wav.ts';

export type { Audio };
export const AUDIO_RATE = 16000;
export const AUDIO_SECONDS = 30;

const FRAME = 512, HOP = 256;
// Bands of 4 FFT bins (125 Hz) from bin 10 (312.5 Hz).
const LOW_BIN = 10, BAND_BINS = 4, BANDS = 45;
// A cell is two hops (32 ms) and a pair two cells, so a pair is four hops.
const PAIR_HOPS = 4;
// Pairs before the layout repeats (4.86 s).
const PERIOD = 76;
// Informed embedding works block by block (two cycles, 9.7 s), so the first 30
// seconds (what's read) and any stretch holding a whole block read cleanly.
const BLOCK = 2 * PERIOD;
const SLOTS = PERIOD * BANDS;
// Each cell moves by about this much (dB) before informed embedding. However
// hard some bits must push, the change stays 30.5 dB below the sound (SNR) at
// strength 1.
const AMPLITUDE = 0.25, MAX_POWER = 10 ** -3.05;
const ROUNDS = 3;
// A level for silence, so it reads as nothing instead of minus infinity.
const FLOOR = 1e-6;
// Pair differences are softly limited to about this many dB.
const LIMIT = 0.6;
// A band at this fraction (-25 dB) of the average band energy of its moment,
// or of the 2.5 seconds either side if they're louder, counts half.
const QUIET = 10 ** -2.5, AROUND = 40;
// A reading from a shifted start must be clearly stronger: there are 608 of them.
const SHIFTED_THRESHOLD = 1.2;
const ZERO_CROSSINGS = 12;

function checkAudio(audio: Audio) {
  const { sampleRate, channels } = audio || ({} as Audio);
  if (!(sampleRate >= 4000 && sampleRate <= 768000) || !Array.isArray(channels) || !channels.length || channels.some(c => !c || c.length !== channels[0].length)) {
    throw new Error('Audio is a sample rate (4 to 768 kHz) and channels of equal length.');
  }
}

// Windowed-sinc resampling (Blackman window, 12 zero crossings each side,
// passband to 92% of the lower Nyquist), with exact phases for common rates.
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return Float32Array.from(input);
  const { floor, ceil, min, sin, cos, PI } = Math;
  let a = from, b = to;
  while (b) [a, b] = [b, a % b];
  const up = to / a, down = from / a, phases = min(up, 4096);
  const cutoff = 0.46 * min(1, to / from), half = ceil(ZERO_CROSSINGS / (2 * cutoff)), taps = 2 * half;
  const table = new Float32Array(phases * taps);
  for (let p = 0; p < phases; p++) {
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = k - half + 1 - p / phases, t = x / half;
      const window = t <= -1 || t >= 1 ? 0 : 0.42 + 0.5 * cos(PI * t) + 0.08 * cos(2 * PI * t);
      const v = (x === 0 ? 2 * cutoff : sin(2 * PI * cutoff * x) / (PI * x)) * window;
      table[p * taps + k] = v; sum += v;
    }
    for (let k = 0; k < taps; k++) table[p * taps + k] /= sum;
  }
  const length = floor((input.length * up) / down), out = new Float32Array(length), last = input.length;
  for (let n = 0; n < length; n++) {
    const at = n * down, i0 = floor(at / up), phase = floor(((at - i0 * up) * phases) / up), start = i0 - half + 1, row = phase * taps;
    let acc = 0;
    if (start >= 0 && start + taps <= last) for (let k = 0; k < taps; k++) acc += table[row + k] * input[start + k];
    else for (let k = 0; k < taps; k++) { const i = start + k; if (i >= 0 && i < last) acc += table[row + k] * input[i]; }
    out[n] = acc;
  }
  return out;
}

function mono(audio: Audio, frames: number) {
  const out = new Float32Array(frames), count = audio.channels.length;
  for (const channel of audio.channels) for (let i = 0; i < frames; i++) out[i] += channel[i] / count;
  return out;
}

// What a browser sends: mono, 16 kHz, the first 30 seconds at most.
export function canonicalAudio(audio: Audio): Float32Array {
  checkAudio(audio);
  const { sampleRate, channels } = audio;
  // A little past 30 s, so the filter has what it needs at the end.
  const frames = Math.min(channels[0].length, Math.ceil(sampleRate * (AUDIO_SECONDS + 0.05)));
  return resample(mono(audio, frames), sampleRate, AUDIO_RATE).slice(0, AUDIO_RATE * AUDIO_SECONDS);
}

// A 512-point complex FFT, in place, with its tables made once.
const FFT = (() => {
  const reverse = new Uint16Array(FRAME), cos = new Float64Array(FRAME / 2), sin = new Float64Array(FRAME / 2), window = new Float64Array(FRAME);
  for (let i = 0, bits = Math.log2(FRAME); i < FRAME; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reverse[i] = r;
  }
  for (let i = 0; i < FRAME / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / FRAME); sin[i] = Math.sin((2 * Math.PI * i) / FRAME); }
  // The square root of a periodic Hann window, for analysis and synthesis: at
  // half-frame hops its squares add up to exactly 1.
  for (let i = 0; i < FRAME; i++) window[i] = Math.sin((Math.PI * i) / FRAME);
  return { reverse, cos, sin, window };
})();
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const { reverse, cos, sin } = FFT, n = FRAME, flip = inverse ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const j = reverse[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < halfSize; k++) {
        const wr = cos[k * step], wi = -flip * sin[k * step], a = start + k, b = a + halfSize;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// The frame centred on sample `centre` (half a frame either side, windowed).
function loadFrame(x: Float32Array, centre: number, re: Float64Array, im: Float64Array) {
  const window = FFT.window, size = FRAME, start = centre - size / 2, length = x.length;
  for (let n = 0; n < size; n++) { const i = start + n; re[n] = i >= 0 && i < length ? x[i] * window[n] : 0; im[n] = 0; }
}

// The energy in each band of frames centred every `hop` samples from the
// first sample to past the last.
function bandEnergies(x: Float32Array, hop: number) {
  const frames = Math.floor((x.length - 1) / hop) + 2, bands = BANDS, width = BAND_BINS, low = LOW_BIN;
  const energy = new Float64Array(frames * bands), re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let f = 0; f < frames; f++) {
    loadFrame(x, f * hop, re, im);
    fft(re, im, false);
    for (let k = 0; k < bands; k++) {
      let sum = 0;
      for (let bin = low + k * width, end = bin + width; bin < end; bin++) sum += re[bin] * re[bin] + im[bin] * im[bin];
      energy[f * bands + k] = sum;
    }
  }
  return { energy, frames };
}

// Each pair's loudness difference (dB) in each band, the feature the bits
// ride on, from frames `first`, `first + stride`, ... of `bandEnergies`
// (four frames to a pair, so stride 1 on a 256-sample grid).
function pairFeatures(source: { energy: Float64Array; frames: number }, first = 0, stride = 1) {
  const { log10, tanh, min, max } = Math, bands = BANDS, limit = LIMIT, quiet = QUIET, floor = FLOOR, radius = AROUND;
  const pairs = max(0, Math.floor((Math.floor((source.frames - 1 - first) / stride) + 1) / PAIR_HOPS)), all = source.energy;
  // Cell energies (two frames each), then each pair's average band energy and
  // a running sum of it, for the average of the seconds around it.
  const cell = new Float64Array(pairs * 2 * bands);
  for (let c = 0; c < pairs * 2; c++) {
    for (let h = 0; h < 2; h++) {
      const row = (first + (2 * c + h) * stride) * bands;
      for (let k = 0; k < bands; k++) cell[c * bands + k] += all[row + k];
    }
  }
  const level = new Float64Array(pairs), sums = new Float64Array(pairs + 1);
  for (let p = 0; p < pairs; p++) {
    let sum = 0;
    for (let k = 0; k < 2 * bands; k++) sum += cell[2 * p * bands + k];
    level[p] = sum / (2 * bands);
    sums[p + 1] = sums[p] + level[p];
  }
  const out = new Float64Array(pairs * bands), d = new Float64Array(bands), w = new Float64Array(bands);
  for (let p = 0; p < pairs; p++) {
    const one = 2 * p * bands, two = one + bands, lo = max(0, p - radius), hi = min(pairs, p + radius + 1);
    // Bands far below the moment's average, and moments far below the
    // seconds around them, count less: noise added to the sound would decide them.
    const reference = quiet * max(level[p], (sums[hi] - sums[lo]) / (hi - lo)) + floor;
    let mean = 0, weight = 0;
    for (let k = 0; k < bands; k++) {
      const a = cell[one + k] + floor, b = cell[two + k] + floor, e = min(a, b);
      d[k] = 10 * log10(a / b);
      w[k] = e / (e + reference);
      mean += w[k] * d[k]; weight += w[k];
    }
    mean /= weight;
    // What all bands did together (a note fading, a drum hit) says nothing
    // about the bits; what's left is softly limited so one onset can't outvote
    // many small nudges.
    for (let k = 0; k < bands; k++) out[p * bands + k] = w[k] * limit * tanh((d[k] - mean) / limit);
  }
  return out;
}

// Each bit's mean signed feature in each block of pairs: what the sound says
// about that bit there. A short end joins the block before it.
const blockCount = (pairs: number) => Math.max(1, Math.floor(pairs / BLOCK));
function responses(features: Float64Array, lay: Layout) {
  const bands = BANDS, slots = SLOTS, block = BLOCK, bits = MARK_BITS, pairs = features.length / bands, blocks = blockCount(pairs);
  const sum = new Float64Array(blocks * bits), count = new Float64Array(blocks * bits), bit = lay.bit, chip = lay.chip;
  for (let i = 0; i < features.length; i++) {
    const s = i % slots, row = (i / bands / block) | 0, at = (row < blocks ? row : blocks - 1) * bits + bit[s];
    sum[at] += chip[s] * features[i]; count[at]++;
  }
  for (let i = 0; i < sum.length; i++) sum[i] = count[i] ? sum[i] / count[i] : 0;
  return sum;
}

// The change that applies each cell's gain (dB) to its part of the sound.
function change(x: Float32Array, cellGain: Float64Array) {
  const { pow } = Math, window = FFT.window, cells = cellGain.length / BANDS, bands = BANDS, width = BAND_BINS, low = LOW_BIN, size = FRAME, hop = HOP;
  const out = new Float32Array(x.length), re = new Float64Array(size), im = new Float64Array(size), scale = new Float64Array(size);
  for (let f = 0; f < cells * 2; f++) {
    loadFrame(x, f * hop, re, im);
    fft(re, im, false);
    scale.fill(0);
    const row = (f >> 1) * bands;
    for (let k = 0; k < bands; k++) {
      const g = pow(10, cellGain[row + k] / 20) - 1;
      for (let bin = low + k * width, end = bin + width; bin < end; bin++) { scale[bin] = g; scale[size - bin] = g; }
    }
    for (let n = 0; n < size; n++) { re[n] *= scale[n]; im[n] *= scale[n]; }
    fft(re, im, true);
    const start = f * hop - size / 2;
    for (let n = 0; n < size; n++) { const i = start + n; if (i >= 0 && i < out.length) out[i] += (re[n] / size) * window[n]; }
  }
  return out;
}

// The marked sound: same rate, channels and length. `strength` scales the
// change and its cap (1 by default: 32 to 37 dB SNR on music and speech; 2 is
// about 6 dB less).
export async function embedAudio(audio: Audio, mark: Uint8Array, key: string, options: { strength?: number } = {}): Promise<Audio> {
  checkAudio(audio);
  const { sampleRate, channels } = audio, length = channels[0].length;
  const strength = Math.min(4, Math.max(0.1, Number(options.strength ?? 1) || 1));
  const lay = await layout(key, 'audio v1', SLOTS);
  const sign = Array.from(markBits(mark), b => (b ? 1 : -1));
  const x = resample(mono(audio, length), sampleRate, AUDIO_RATE);
  const features = pairFeatures(bandEnergies(x, HOP)), host = responses(features, lay);
  const pairs = features.length / BANDS, blocks = blockCount(pairs), base = AMPLITUDE * strength;
  const amp = new Float64Array(blocks * MARK_BITS).fill(base);
  let delta = new Float32Array(0);
  for (let round = 0; round < ROUNDS; round++) {
    const bands = BANDS, period = PERIOD, block = BLOCK, bits = MARK_BITS, bit = lay.bit, chip = lay.chip, gain = new Float64Array(pairs * 2 * bands);
    for (let p = 0; p < pairs; p++) {
      const row = (((p / block) | 0) < blocks ? (p / block) | 0 : blocks - 1) * bits;
      for (let k = 0; k < bands; k++) {
        const s = (p % period) * bands + k, b = bit[s], g = amp[row + b] * sign[b] * chip[s];
        gain[2 * p * bands + k] = g; gain[(2 * p + 1) * bands + k] = -g;
      }
    }
    delta = change(x, gain);
    // Never louder than the cap, however hard the bits had to push.
    let signal = 0, power = 0;
    for (let i = 0; i < x.length; i++) { signal += x[i] * x[i]; power += delta[i] * delta[i]; }
    const scale = Math.min(1, Math.sqrt((MAX_POWER * strength * strength * signal) / (power || 1)));
    if (scale < 1) for (let i = 0; i < delta.length; i++) delta[i] *= scale;
    if (round === ROUNDS - 1) break;
    // What came through for each bit in each block, and how hard each must
    // push to reach the same clear level there.
    const marked = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) marked[i] = x[i] + delta[i];
    const got = responses(pairFeatures(bandEnergies(marked, HOP)), lay);
    for (let row = 0; row < blocks * MARK_BITS; row += MARK_BITS) {
      const through = sign.map((sb, b) => Math.max(0.05, (sb * (got[row + b] - host[row + b])) / amp[row + b]));
      const target = base * [...through].sort((p, q) => p - q)[MARK_BITS >> 1];
      for (let b = 0; b < MARK_BITS; b++) amp[row + b] = Math.min(base * 4, Math.max(base * 0.3, (target - sign[b] * host[row + b]) / through[b]));
    }
  }
  // Back at the sound's own rate, shared between channels by how loud each is
  // at the moment, so the mono mix gets the whole change and a quiet channel
  // isn't given more than it can hide.
  const full = resample(delta, AUDIO_RATE, sampleRate), span = 4096, spans = Math.ceil(length / span), count = channels.length;
  const level = channels.map(channel => {
    const out = new Float64Array(spans);
    for (let i = 0; i < length; i++) out[(i / span) | 0] += channel[i] * channel[i];
    return out.map(Math.sqrt);
  });
  return {
    sampleRate,
    channels: channels.map((channel, c) => {
      const out = new Float32Array(channel), mine = level[c], all = level;
      const weight = (j: number) => { let sum = 0; for (let o = 0; o < count; o++) sum += all[o][j]; return sum > 0 ? (count * mine[j]) / sum : 1; };
      for (let j = 0; j < spans; j++) {
        const w0 = weight(j), w1 = weight(Math.min(spans - 1, j + 1)), end = Math.min(length, (j + 1) * span, full.length);
        for (let i = j * span; i < end; i++) out[i] += full[i] * (w0 + ((w1 - w0) * (i - j * span)) / span);
      }
      return out;
    }),
  };
}

// Reads a mark from a sound or from its canonical audio (mono, 16 kHz). The
// clip may start anywhere in the marked sound: frames every 128 samples give
// the eight starts within a pair, and for each, the 76 places in the layout's
// cycle are tried. The unshifted reading needs the usual strength, a shifted
// one more.
export async function detectAudio(input: Audio | Float32Array, key: string): Promise<Detection> {
  const asAudio = input as Audio;
  const x = asAudio && Array.isArray(asAudio.channels) ? canonicalAudio(asAudio) : Float32Array.from(input as Float32Array);
  if (!x || x.length > AUDIO_RATE * (AUDIO_SECONDS + 1)) throw new Error(`Canonical audio is mono at 16 kHz, ${AUDIO_SECONDS} seconds at most.`);
  const finite = Number.isFinite;
  for (let i = 0; i < x.length; i++) if (!finite(x[i])) throw new Error('Canonical audio holds numbers only.');
  const lay = await layout(key, 'audio v1', SLOTS), bit = lay.bit, chip = lay.chip, bands = BANDS, period = PERIOD, slots = SLOTS;
  const energies = bandEnergies(x, HOP / 2), steps = PAIR_HOPS * 2;
  let unshifted: Detection | null = null, best: Detection | null = null, strongest = 0;
  for (let step = 0; step < steps; step++) {
    // Repeats of a place in the cycle are added up first: each place's sign is
    // one random choice, which is what makes an unmarked sound score like noise.
    const features = pairFeatures(energies, step, 2), place = new Float64Array(slots);
    for (let i = 0; i < features.length; i++) place[i % slots] += features[i];
    for (let shift = 0; shift < period; shift++) {
      const num = new Float64Array(MARK_BITS), den = new Float64Array(MARK_BITS);
      for (let p = 0; p < period; p++) {
        const from = p * bands, to = ((p + shift) % period) * bands;
        for (let k = 0; k < bands; k++) { const v = place[from + k], b = bit[to + k]; num[b] += chip[to + k] * v; den[b] += v * v; }
      }
      const scores = Array.from(num, (v, b) => (den[b] > 0 ? v / Math.sqrt(den[b]) : 0));
      const first = step === 0 && shift === 0, reading = readMark(scores, first ? undefined : SHIFTED_THRESHOLD);
      if (first) unshifted = reading;
      if (reading.found && reading.confidence >= strongest) { best = reading; strongest = reading.confidence; }
    }
  }
  return best || unshifted!;
}
