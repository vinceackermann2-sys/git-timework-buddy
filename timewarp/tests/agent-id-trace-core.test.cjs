"use strict";
// Agent ID trace, the watermark core: a hidden mark in every image, sound and
// text an agent makes, read back with a secret key. Pictures and sounds are
// made here (gradients, shapes and texture; notes, a bass line and drums), and
// the mark has to survive what happens to media on the way: JPEG, resizing,
// brightness, resampling, volume, noise, a low-pass filter and 16-bit audio.
// What doesn't survive (cropping) is checked to fail safely: never a wrong mark.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const sharp = require(path.join(__dirname, "../node_modules/sharp"));
const { loadModule } = require("../scripts/agent-id-local.cjs");

const payload = loadModule("trace/payload.ts");
const png = loadModule("trace/png.ts");
const image = loadModule("trace/image.ts");
const wav = loadModule("trace/wav.ts");
const audio = loadModule("trace/audio.ts");
const text = loadModule("trace/text.ts");

const KEY = "trace-test-key-" + "k".repeat(24);
const OTHER_KEY = "another-test-key-" + "o".repeat(24);
const same = (a, b) => !!a && !!b && Buffer.from(a).equals(Buffer.from(b));
// Fixed marks keep every run the same (payload.newMark() is random).
const markOf = seed => { const rand = rng(seed * 7919); return Uint8Array.from({ length: 8 }, () => Math.floor(rand() * 256)); };
const ms = start => Math.round(performance.now() - start);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Pictures: sky, textured ground and shapes, with a little grain.

function valueNoise(w, h, rand, octaves) {
  const out = new Float32Array(w * h);
  for (const [cell, amp] of octaves) {
    const gw = Math.ceil(w / cell) + 2, grid = new Float32Array(gw * (Math.ceil(h / cell) + 2));
    for (let i = 0; i < grid.length; i++) grid[i] = rand() * 2 - 1;
    for (let y = 0; y < h; y++) {
      const gy = y / cell, iy = Math.floor(gy), fy = gy - iy, sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < w; x++) {
        const gx = x / cell, ix = Math.floor(gx), fx = gx - ix, sx = fx * fx * (3 - 2 * fx), i = iy * gw + ix;
        out[y * w + x] += amp * ((grid[i] * (1 - sx) + grid[i + 1] * sx) * (1 - sy) + (grid[i + gw] * (1 - sx) + grid[i + gw + 1] * sx) * sy);
      }
    }
  }
  return out;
}
function picture(w, h, seed) {
  const rand = rng(seed), s = Math.max(w, h) / 512;
  const fine = valueNoise(w, h, rand, [[64 * s, 30], [24 * s, 18], [9 * s, 12], [3.5 * s, 8], [1.5, 5]]);
  const clouds = valueNoise(w, h, rand, [[160 * s, 25], [60 * s, 10], [20 * s, 3]]);
  const horizon = h * (0.3 + rand() * 0.3);
  const sky = [90 + rand() * 60, 140 + rand() * 50, 200 + rand() * 40], ground = [60 + rand() * 80, 80 + rand() * 60, 30 + rand() * 50];
  const shapes = Array.from({ length: 9 }, () => ({ x: rand() * w, y: rand() * h, r: (0.04 + rand() * 0.15) * Math.min(w, h), color: [rand() * 255, rand() * 255, rand() * 255], round: rand() < 0.5 }));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, t = Math.min(1, Math.max(0, (y - horizon) / (2 * s) + 0.5));
      let rgb = sky.map((c, k) => c * (1 - t) + ground[k] * t - (1 - t) * (y / h) * 30 + (1 - t) * clouds[p] + t * fine[p]);
      for (const shape of shapes) {
        const d = shape.round ? Math.hypot(x - shape.x, y - shape.y) - shape.r : Math.max(Math.abs(x - shape.x), Math.abs(y - shape.y)) - shape.r;
        const a = Math.min(1, Math.max(0, 0.5 - d / (1.2 * s)));
        if (a > 0) rgb = rgb.map((c, k) => c * (1 - a) + a * (shape.color[k] + fine[p] * 0.7 + ((x - shape.x) / shape.r) * 15));
      }
      const grain = (rand() + rand() - 1) * 3;
      data.set([rgb[0] + grain, rgb[1] + grain, rgb[2] + grain, 255], p * 4);
    }
  }
  return { width: w, height: h, data };
}
function psnr(a, b) {
  let sum = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; sum += d * d; n++; }
  return 10 * Math.log10((255 * 255) / (sum / n));
}
const toSharp = im => sharp(Buffer.from(im.data.buffer, im.data.byteOffset, im.data.length), { raw: { width: im.width, height: im.height, channels: 4 } });
async function pixels(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

// ---------- Sounds: notes with harmonics and envelopes, a bass line, drums.

function music(seconds, seed, rate = 44100) {
  const rand = rng(seed), n = Math.round(seconds * rate), left = new Float32Array(n), right = new Float32Array(n);
  const scale = [0, 2, 4, 5, 7, 9, 11, 12], beat = 0.25 + rand() * 0.15, root = 196 * 2 ** (Math.floor(rand() * 6) / 12);
  for (let t0 = 0; t0 < seconds; t0 += beat) {
    for (let v = 1 + Math.floor(rand() * 3); v > 0; v--) {
      const f0 = root * 2 ** ((scale[Math.floor(rand() * 8)] + 12 * Math.floor(rand() * 2)) / 12);
      const dur = beat * (1 + Math.floor(rand() * 3)), pan = rand(), amp = 0.08 + rand() * 0.08;
      const start = Math.round(t0 * rate), len = Math.min(n - start, Math.round((dur + 0.15) * rate));
      const phase = Array.from({ length: 10 }, () => rand() * 6.28);
      for (let i = 0; i < len; i++) {
        const t = i / rate, env = Math.min(1, t / 0.01) * Math.exp(-t * 2.5) * (t > dur ? Math.exp(-(t - dur) * 30) : 1);
        let s = 0;
        for (let h = 1; h <= 10 && f0 * h < 9000; h++) s += Math.sin(2 * Math.PI * f0 * h * t + phase[h - 1]) / (h * h * 0.6 + 0.4);
        s *= amp * env;
        left[start + i] += s * (1 - pan * 0.6); right[start + i] += s * (0.4 + pan * 0.6);
      }
    }
    if (rand() < 0.6) {
      const f = (root / 2) * 2 ** (scale[Math.floor(rand() * 5)] / 12), start = Math.round(t0 * rate), len = Math.min(n - start, Math.round(beat * 1.5 * rate));
      for (let i = 0; i < len; i++) { const t = i / rate, s = 0.2 * Math.exp(-t * 4) * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)); left[start + i] += s; right[start + i] += s; }
    }
    const start = Math.round(t0 * rate), len = Math.min(n - start, Math.round(0.12 * rate)), loud = rand() < 0.3 ? 0.15 : 0.05;
    for (let i = 0, prev = 0; i < len; i++) {
      const w = rand() * 2 - 1, s = loud * (w - prev) * Math.exp((-i / rate) * (loud > 0.1 ? 25 : 60));
      prev = w; left[start + i] += s; right[start + i] += s * 0.9;
    }
  }
  for (let i = 0; i < n; i++) { const b = (rand() - 0.5) * 0.004; left[i] += b; right[i] += b; }
  let peak = 0;
  for (const c of [left, right]) for (const v of c) peak = Math.max(peak, Math.abs(v));
  for (const c of [left, right]) for (let i = 0; i < n; i++) c[i] *= 0.8 / peak;
  return { sampleRate: rate, channels: [left, right] };
}
const eachChannel = (a, fn) => ({ sampleRate: a.sampleRate, channels: a.channels.map(fn) });
function snr(a, b) {
  let signal = 0, error = 0;
  a.channels.forEach((c, k) => { for (let i = 0; i < c.length; i++) { signal += c[i] * c[i]; error += (b.channels[k][i] - c[i]) ** 2; } });
  return 10 * Math.log10(signal / error);
}
// Another resampler than the module's (Hann-windowed sinc, 16 zero crossings,
// cutoff at 90% of Nyquist, from a finely sampled kernel table).
function resampleOther(a, to) {
  const from = a.sampleRate, ratio = to / from, cutoff = 0.45 * Math.min(1, ratio), half = Math.ceil(16 / (2 * cutoff)), fine = 64;
  const kernel = new Float64Array(half * fine + 2);
  for (let i = 0; i < kernel.length; i++) { const d = i / fine; kernel[i] = d >= half ? 0 : (d === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * d) / (Math.PI * d)) * (0.5 + 0.5 * Math.cos((Math.PI * d) / half)); }
  return {
    sampleRate: to,
    channels: a.channels.map(x => {
      const out = new Float32Array(Math.floor(x.length * ratio));
      for (let n = 0; n < out.length; n++) {
        const pos = n / ratio, i0 = Math.floor(pos);
        let acc = 0, sum = 0;
        for (let i = i0 - half + 1; i <= i0 + half; i++) {
          const at = Math.abs(i - pos) * fine, j = Math.floor(at), h = kernel[j] + (kernel[j + 1] - kernel[j]) * (at - j);
          sum += h;
          if (i >= 0 && i < x.length) acc += h * x[i];
        }
        out[n] = acc / sum;
      }
      return out;
    }),
  };
}
// A 4th-order Butterworth low-pass as two biquads: a causal IIR filter, so it
// shifts phase and delays the sound as a real one does.
function lowpass(a, frequency) {
  return eachChannel(a, x => {
    let y = Float32Array.from(x);
    for (const q of [0.5412, 1.3066]) {
      const w = (2 * Math.PI * frequency) / a.sampleRate, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha;
      const b0 = (1 - cos) / 2 / a0, b1 = (1 - cos) / a0, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
      const out = new Float32Array(y.length);
      for (let i = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0; i < y.length; i++) {
        const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
      }
      y = out;
    }
    return y;
  });
}
// White noise `db` below the sound's own level.
function noise(a, db, seed) {
  const rand = rng(seed);
  return eachChannel(a, x => {
    let power = 0;
    for (const v of x) power += v * v;
    const spread = Math.sqrt(power / x.length) * 10 ** (db / 20) * Math.sqrt(3);
    return x.map(v => v + (rand() * 2 - 1) * spread);
  });
}
const pcm16 = a => wav.decodeWav(wav.encodeWav(a, { format: "pcm16" }));

// ---------- The mark itself.

test("a mark is 64 bits and a CRC-16: any one or two wrong bits are caught", () => {
  const mark = payload.newMark();
  const bits = Array.from(payload.markBits(mark));
  assert.equal(bits.length, 80);
  assert.ok(same(payload.markFromBits(bits), mark));
  for (let i = 0; i < 80; i++) {
    const one = bits.slice(); one[i] ^= 1;
    assert.equal(payload.markFromBits(one), null, `bit ${i}`);
    for (let j = i + 1; j < 80; j++) { const two = one.slice(); two[j] ^= 1; assert.equal(payload.markFromBits(two), null, `bits ${i}, ${j}`); }
  }
  assert.equal(payload.markFromBits(new Array(80).fill(0)), null, "all zeros (a blank input) never passes");
  const id = payload.markId(mark);
  assert.match(id, /^tr_[0-9a-f]{16}$/);
  assert.ok(same(payload.markFromId(id), mark));
  assert.equal(payload.markFromId("tr_123"), null);
  assert.throws(() => payload.markBits(new Uint8Array(7)), /8 bytes/);
});

// ---------- PNG.

test("PNG: RGBA round trip, sharp's PNGs in every colour type, interlaced refused", async () => {
  const rand = rng(1), data = new Uint8ClampedArray(37 * 23 * 4).map(() => rand() * 256);
  const original = { width: 37, height: 23, data };
  const encoded = await png.encodePng(original);
  const back = await png.decodePng(encoded);
  assert.equal(back.width, 37); assert.equal(back.height, 23);
  assert.ok(Buffer.from(back.data).equals(Buffer.from(data)));
  // sharp reads what we write.
  const seen = await pixels(Buffer.from(encoded));
  assert.ok(Buffer.from(seen.data).equals(Buffer.from(data)));

  const scene = picture(120, 80, 2);
  const base = () => toSharp(scene);
  const rgba = await pixels(await base().png().toBuffer());
  const variants = {
    rgba: [await base().png().toBuffer(), rgba.data],
    rgb: [await base().removeAlpha().png().toBuffer(), rgba.data],
    gray: [await base().removeAlpha().grayscale().png().toBuffer(), (await pixels(await base().removeAlpha().grayscale().png().toBuffer())).data],
    grayAlpha: [await base().grayscale().png().toBuffer(), (await pixels(await base().grayscale().png().toBuffer())).data],
    palette: [await base().png({ palette: true, colours: 64 }).toBuffer(), null],
    deep: [await base().toColourspace("rgb16").png().toBuffer(), null],
  };
  for (const [name, [file, expected]] of Object.entries(variants)) {
    const decoded = await png.decodePng(new Uint8Array(file));
    const reference = expected || (await pixels(file)).data;
    assert.equal(decoded.width, 120, name);
    let worst = 0;
    for (let i = 0; i < reference.length; i++) worst = Math.max(worst, Math.abs(decoded.data[i] - reference[i]));
    assert.ok(worst <= 1, `${name}: off by ${worst}`);
  }
  const interlaced = await base().png({ progressive: true }).toBuffer();
  await assert.rejects(png.decodePng(new Uint8Array(interlaced)), /Interlaced/);
  await assert.rejects(png.decodePng(new Uint8Array([1, 2, 3])), /not a PNG/);
});

// ---------- Images.

test("image: invisible, and read back after PNG, JPEG 75 and 60, half and double size, +10% brightness, JPEG then resize", async t => {
  const original = picture(512, 512, 7), mark = markOf(1);
  const marked = await image.embedImage(original, mark, KEY);
  assert.equal(marked.width, 512);
  for (let i = 3; i < marked.data.length; i += 4) assert.equal(marked.data[i], original.data[i], "alpha untouched");
  const quality = psnr(original, marked);
  t.diagnostic(`PSNR ${quality.toFixed(2)} dB`);
  assert.ok(quality >= 38, `PSNR ${quality.toFixed(2)} dB`);

  const attacks = {
    "PNG round trip": async () => png.decodePng(await png.encodePng(marked)),
    "JPEG 75": async () => pixels(await toSharp(marked).jpeg({ quality: 75 }).toBuffer()),
    "JPEG 60": async () => pixels(await toSharp(marked).jpeg({ quality: 60 }).toBuffer()),
    "resize 50%": async () => pixels(await toSharp(marked).resize(256, 256).png().toBuffer()),
    "resize 200%": async () => pixels(await toSharp(marked).resize(1024, 1024).png().toBuffer()),
    "brightness +10%": async () => pixels(await toSharp(marked).modulate({ brightness: 1.1 }).png().toBuffer()),
    "JPEG 75, resize 60%, JPEG 80": async () => pixels(await sharp(await toSharp(marked).jpeg({ quality: 75 }).toBuffer()).resize(307).jpeg({ quality: 80 }).toBuffer()),
  };
  for (const [name, attack] of Object.entries(attacks)) {
    const result = await image.detectImage(await attack(), KEY);
    t.diagnostic(`${name}: found ${result.found}, confidence ${result.confidence}`);
    assert.ok(result.found && same(result.mark, mark), name);
  }
  // What a browser sends (the canonical grid) reads the same as the picture.
  const grid = image.canonicalImage(marked);
  assert.equal(grid.length, 256 * 256);
  assert.ok(same((await image.detectImage(grid, KEY)).mark, mark));
  assert.equal((await image.detectImage(marked, OTHER_KEY)).found, false, "wrong key");
  assert.equal((await image.detectImage(original, KEY)).found, false, "unmarked");
});

test("image: any size and shape, and cropping fails safely (never a wrong mark)", async t => {
  const original = picture(768, 432, 8), mark = markOf(2);
  const marked = await image.embedImage(original, mark, KEY);
  const squeezed = await pixels(await sharp(await toSharp(marked).jpeg({ quality: 70 }).toBuffer()).resize(400, 400, { fit: "fill" }).png().toBuffer());
  assert.ok(same((await image.detectImage(squeezed, KEY)).mark, mark), "JPEG 70, then stretched to a square");
  for (const [name, box] of Object.entries({ "1% crop": { left: 0, top: 0, width: 760, height: 428 }, "10% crop": { left: 38, top: 22, width: 691, height: 389 } })) {
    const result = await image.detectImage(await pixels(await toSharp(marked).extract(box).png().toBuffer()), KEY);
    t.diagnostic(`${name}: found ${result.found} (cropping moves the grid; not survived)`);
    assert.ok(!result.found || same(result.mark, mark), `${name} gave a wrong mark`);
  }
});

test("image: graphics too: a diagram and a text screenshot, as made and after JPEG 75", async t => {
  const draw = (w, h, color) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...color(x, y), 255], (y * w + x) * 4);
    return { width: w, height: h, data };
  };
  const box = (x, y) => x > 300 && x < 500 && y > 100 && y < 200 && (x < 304 || x > 496 || y < 104 || y > 196);
  const diagram = draw(640, 480, (x, y) => (Math.abs(x - 200) < 2 || Math.abs(y - 240) < 2 || box(x, y) ? [20, 20, 120] : [250, 250, 250]));
  const textShot = draw(800, 600, (x, y) => {
    const line = Math.floor(y / 18), ink = y % 18 > 4 && y % 18 < 15 && (x * 7 + line * 13) % 11 < 6 && x > 40 && x < 760 && (Math.floor(x / 60) + line) % 7 !== 0;
    return ink ? [30, 30, 30] : [255, 255, 255];
  });
  for (const [name, original, seed] of [["diagram", diagram, 9], ["text screenshot", textShot, 10]]) {
    const mark = markOf(seed), marked = await image.embedImage(original, mark, KEY), quality = psnr(original, marked);
    const plain = await image.detectImage(marked, KEY), jpeg = await image.detectImage(await pixels(await toSharp(marked).jpeg({ quality: 75 }).toBuffer()), KEY);
    t.diagnostic(`${name}: PSNR ${quality.toFixed(2)} dB, as made ${plain.confidence}, JPEG 75 ${jpeg.confidence}`);
    assert.ok(quality >= 38, `${name} PSNR ${quality.toFixed(2)} dB`);
    assert.ok(plain.found && same(plain.mark, mark), `${name} as made`);
    assert.ok(jpeg.found && same(jpeg.mark, mark), `${name} after JPEG 75`);
  }
});

test("image: no false finds on 50 unmarked pictures, or a marked one read with 50 wrong keys", async () => {
  const pictures = [];
  for (let seed = 100; seed < 135; seed++) pictures.push(picture(160 + (seed % 5) * 40, 160 + (seed % 3) * 50, seed));
  for (let seed = 0; seed < 10; seed++) { const rand = rng(seed); pictures.push({ width: 200, height: 150, data: new Uint8ClampedArray(200 * 150 * 4).map((_, i) => (i % 4 === 3 ? 255 : rand() * 256)) }); }
  for (const level of [0, 128, 255]) pictures.push({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(level) });
  pictures.push({ width: 300, height: 200, data: new Uint8ClampedArray(300 * 200 * 4).map((_, i) => (i % 4 === 3 ? 255 : ((i >> 2) % 300) * 0.85)) });
  pictures.push({ width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i >> 2) % 256 > 120 ? 230 : 20)) });
  assert.equal(pictures.length, 50);
  for (const [i, picture] of pictures.entries()) assert.equal((await image.detectImage(picture, KEY)).found, false, `picture ${i}`);
  const marked = await image.embedImage(picture(320, 240, 9), markOf(3), KEY);
  const grid = image.canonicalImage(marked);
  for (let i = 0; i < 50; i++) assert.equal((await image.detectImage(grid, `wrong-key-${i}-${"w".repeat(20)}`)).found, false, `wrong key ${i}`);
});

test("image: timing for a 1024 × 1024 PNG", async t => {
  const file = await png.encodePng(picture(1024, 1024, 10));
  let start = performance.now();
  const decoded = await png.decodePng(file);
  const decodeTime = ms(start);
  start = performance.now();
  const marked = await image.embedImage(decoded, markOf(4), KEY);
  const embedTime = ms(start);
  start = performance.now();
  await png.encodePng(marked);
  const encodeTime = ms(start);
  start = performance.now();
  const grid = image.canonicalImage(marked);
  const canonicalTime = ms(start);
  start = performance.now();
  assert.ok((await image.detectImage(grid, KEY)).found);
  const detectTime = ms(start);
  t.diagnostic(`decode ${decodeTime} ms, embed ${embedTime} ms, encode ${encodeTime} ms (stored, not deflated: no CompressionStream here), canonical ${canonicalTime} ms, detect ${detectTime} ms`);
});

// ---------- WAV.

test("WAV: 16-bit and float round trips, 24-bit read", () => {
  const rand = rng(3), left = new Float32Array(1000).map(() => rand() * 1.8 - 0.9), right = left.map(v => -v / 2);
  const float = wav.decodeWav(wav.encodeWav({ sampleRate: 48000, channels: [left, right] }, { format: "float32" }));
  assert.equal(float.sampleRate, 48000);
  assert.ok(Buffer.from(float.channels[1].buffer).equals(Buffer.from(right.buffer)));
  const fixed = wav.decodeWav(wav.encodeWav({ sampleRate: 44100, channels: [left] }));
  assert.equal(fixed.channels.length, 1);
  for (let i = 0; i < left.length; i++) assert.ok(Math.abs(fixed.channels[0][i] - left[i]) < 1 / 32000);
  // A hand-made 24-bit mono file with a LIST chunk before the data.
  const samples = [0, 0x7fffff, -0x800000, 0x123456];
  const bytes = Buffer.alloc(12 + 24 + 12 + 8 + samples.length * 3);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(24000, 28); bytes.writeUInt16LE(3, 32); bytes.writeUInt16LE(24, 34);
  bytes.write("LIST", 36); bytes.writeUInt32LE(4, 40); bytes.write("INFO", 44);
  bytes.write("data", 48); bytes.writeUInt32LE(samples.length * 3, 52);
  samples.forEach((s, i) => bytes.writeIntLE(s, 56 + i * 3, 3));
  const deep = wav.decodeWav(new Uint8Array(bytes));
  assert.deepEqual(Array.from(deep.channels[0], v => Math.round(v * 8388608)), samples);
  assert.throws(() => wav.decodeWav(new Uint8Array(12)), /not a WAV/);
});

// ---------- Audio.

test("audio: inaudible, and read back after 16 kHz, half volume, noise at -35 dB, a 7 kHz low-pass, 16-bit, and all at once", async t => {
  const original = music(8, 21), mark = markOf(5);
  const marked = await audio.embedAudio(original, mark, KEY);
  assert.equal(marked.channels[0].length, original.channels[0].length);
  const quality = snr(original, marked);
  t.diagnostic(`SNR ${quality.toFixed(2)} dB`);
  assert.ok(quality >= 30, `SNR ${quality.toFixed(2)} dB`);
  const attacks = {
    "as made": () => marked,
    "resampled 44.1 to 16 kHz": () => resampleOther(marked, 16000),
    "volume × 0.5": () => eachChannel(marked, x => x.map(v => v * 0.5)),
    "white noise at -35 dB": () => noise(marked, -35, 5),
    "low-pass at 7 kHz": () => lowpass(marked, 7000),
    "16-bit WAV": () => pcm16(marked),
    "all of them": () => pcm16(resampleOther(noise(eachChannel(lowpass(marked, 7000), x => x.map(v => v * 0.5)), -35, 6), 16000)),
  };
  for (const [name, attack] of Object.entries(attacks)) {
    const result = await audio.detectAudio(attack(), KEY);
    t.diagnostic(`${name}: found ${result.found}, confidence ${result.confidence}`);
    assert.ok(result.found && same(result.mark, mark), name);
  }
  const canonical = audio.canonicalAudio(marked);
  assert.equal(canonical.length, 8 * 16000);
  assert.ok(same((await audio.detectAudio(canonical, KEY)).mark, mark), "what a browser sends");
  assert.equal((await audio.detectAudio(marked, OTHER_KEY)).found, false, "wrong key");
  assert.equal((await audio.detectAudio(original, KEY)).found, false, "unmarked");
});

test("audio: a 5 second clip, and clips cut from a longer marked sound", async t => {
  const mark = markOf(6);
  const marked = await audio.embedAudio(music(5, 22), mark, KEY);
  const attacked = pcm16(resampleOther(noise(lowpass(marked, 7000), -35, 7), 16000));
  const result = await audio.detectAudio(attacked, KEY);
  t.diagnostic(`5 s, all attacks: found ${result.found}, confidence ${result.confidence}`);
  assert.ok(result.found && same(result.mark, mark));

  // A 40 s sound: what's read is its first 30 s, a stretch from the middle,
  // or the sound with its start trimmed or silence added in front.
  const long = await audio.embedAudio(music(40, 23), mark, KEY);
  const rate = long.sampleRate, slice = (from, seconds) => ({ sampleRate: rate, channels: long.channels.map(c => c.slice(Math.round(from * rate), Math.round((from + seconds) * rate))) });
  const clips = {
    "the whole 40 s": long,
    "15 s from 13.37 s": slice(13.37, 15),
    "0.3 s trimmed off the start": slice(0.3, 20),
    "0.5 s of silence in front": { sampleRate: rate, channels: long.channels.map(c => { const out = new Float32Array(c.length + rate / 2); out.set(c, rate / 2); return out; }) },
  };
  for (const [name, clip] of Object.entries(clips)) {
    const read = await audio.detectAudio(pcm16(clip), KEY);
    t.diagnostic(`${name}: found ${read.found}, confidence ${read.confidence}`);
    assert.ok(read.found && same(read.mark, mark), name);
  }
});

test("audio: no false finds on unmarked clips or with wrong keys", async () => {
  for (let seed = 30; seed < 40; seed++) {
    const clip = audio.canonicalAudio(music(5, seed));
    for (let k = 0; k < 4; k++) assert.equal((await audio.detectAudio(clip, `key-${seed}-${k}-${"u".repeat(20)}`)).found, false, `clip ${seed}, key ${k}`);
  }
  const marked = audio.canonicalAudio(await audio.embedAudio(music(10, 41), markOf(7), KEY));
  for (let k = 0; k < 10; k++) assert.equal((await audio.detectAudio(marked, `wrong-key-${k}-${"w".repeat(20)}`)).found, false, `wrong key ${k}`);
  const silence = new Float32Array(5 * 16000);
  assert.equal((await audio.detectAudio(silence, KEY)).found, false, "silence");
});

test("audio: timing for a 30 second clip", async t => {
  const clip = music(30, 50);
  let start = performance.now();
  const marked = await audio.embedAudio(clip, markOf(8), KEY);
  const embedTime = ms(start);
  start = performance.now();
  const canonical = audio.canonicalAudio(marked);
  const canonicalTime = ms(start);
  start = performance.now();
  const result = await audio.detectAudio(canonical, KEY);
  const detectTime = ms(start);
  assert.ok(result.found);
  t.diagnostic(`SNR ${snr(clip, marked).toFixed(2)} dB, embed ${embedTime} ms, canonical ${canonicalTime} ms, detect ${detectTime} ms`);
});

// ---------- Text.

const INVISIBLE = new RegExp("[" + String.fromCharCode(0x200b, 0x200c, 0x2060) + "]", "g");
const visible = s => s.replace(INVISIBLE, "");

test("text: the mark rides after the first word of prose, never in code or links", () => {
  const mark = markOf(11);
  const reply = "Sure, here is the fix.\n\n```js\nconst answer = 42;\n```\n\nRun it with `node fix.js` and check https://example.com/docs for more.";
  const marked = text.embedText(reply, mark);
  assert.equal(visible(marked), reply);
  assert.ok(marked.startsWith("Sure" + String.fromCharCode(0x2060)), "after the first word");
  assert.ok(marked.includes("```js\nconst answer = 42;\n```"), "code fence untouched");
  assert.ok(same(text.extractText(marked), mark));
  assert.ok(same(text.extractText("Quoted: " + marked + " (from a chat)"), mark), "survives copying into other text");
  assert.equal(text.stripMarks(marked), reply);
  assert.equal(text.extractText(text.stripMarks(marked)), null);
  // Embedding again replaces the mark.
  const other = markOf(12);
  assert.ok(same(text.extractText(text.embedText(marked, other)), other));
  // Nothing that reads as code gets one.
  for (const code of ["import os\nprint(os.getcwd())\n", "{\"name\": \"agent\"}", "title: Hello world\nauthor: An agent\n", "```\nnotes in a fence only\n```", "OK"]) {
    assert.equal(text.embedText(code, mark), code, JSON.stringify(code));
  }
  // A mark cut short is no mark.
  const cut = marked.slice(0, 20) + marked.slice(40);
  assert.equal(text.extractText(cut), null);
  assert.equal(visible(text.stripMarks(cut)), visible(cut));
});

test("text: fingerprints match edited copies and not other texts, for prose and code", async () => {
  const prose = "The quarterly report shows that revenue grew by twelve percent compared to the same period last year. Most of the growth came from the new subscription tier, which launched in March and quickly became the most popular option among small teams. Customer churn fell slightly, although support tickets increased as more people tried the advanced reporting features. The team plans to hire two more support engineers before the end of the year and to publish a set of guides that explain the reporting tools in plain language.";
  const edited = prose.replace("twelve", "thirteen").replace("quickly became", "soon became").replace("two more", "three more").replace(/\. /g, ".\n\n  ").toUpperCase();
  const unrelated = "Bake the bread at two hundred degrees for forty minutes, then let it cool on a rack before slicing. A good crust needs steam during the first ten minutes, so put a tray of water on the bottom shelf of the oven. If the dough is too sticky, add flour one spoon at a time until it comes together into a smooth ball that springs back when pressed.";
  const code = "function parseConfig(text) {\n  const lines = text.split(\"\\n\");\n  const result = {};\n  for (const line of lines) {\n    const [key, value] = line.split(\"=\");\n    if (!key || value === undefined) continue;\n    result[key.trim()] = value.trim();\n  }\n  return result;\n}\n\nmodule.exports = { parseConfig };\n";
  const codeEdited = code.replace(/ {2}/g, "\t").replace("const result = {}", "const out = {}").replace("result[key.trim()]", "out[key.trim()]").replace("return result", "return out");
  const otherCode = "async function fetchUsers(client, limit = 10) {\n  const response = await client.get(\"/users\", { params: { limit } });\n  if (response.status !== 200) throw new Error(\"Request failed\");\n  return response.data.map(user => ({ id: user.id, name: user.name }));\n}\n\nmodule.exports = { fetchUsers };\n";
  const [a, b, c, d, e, f, m] = await Promise.all([prose, edited, unrelated, code, codeEdited, otherCode, text.embedText(prose, markOf(13))].map(text.fingerprint));
  assert.match(a.exact, /^[0-9a-f]{64}$/);
  assert.equal(m.exact, a.exact, "the invisible mark doesn't change the fingerprint");
  assert.equal(text.similarity(a, m), 1);
  const scores = { edited: text.similarity(a, b), unrelated: text.similarity(a, c), codeEdited: text.similarity(d, e), otherCode: text.similarity(d, f), proseAndCode: text.similarity(a, d) };
  assert.ok(scores.edited >= 0.6, `edited prose ${scores.edited}`);
  assert.ok(scores.codeEdited >= 0.6, `edited code ${scores.codeEdited}`);
  assert.ok(scores.unrelated <= 0.1, `unrelated prose ${scores.unrelated}`);
  assert.ok(scores.otherCode <= 0.1, `unrelated code ${scores.otherCode}`);
  assert.ok(scores.proseAndCode <= 0.1);
  assert.equal(text.similarity(a.shingles, b.shingles), scores.edited, "takes shingles too");
});
