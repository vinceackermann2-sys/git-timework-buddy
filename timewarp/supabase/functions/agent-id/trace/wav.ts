// WAV in and out, as one Float32Array of samples (-1 to 1) per channel. Reads
// 8, 16, 24 and 32-bit PCM and 32 or 64-bit float, plain or "extensible";
// writes 16-bit PCM or 32-bit float.

export type Audio = { sampleRate: number; channels: Float32Array[] };

export function decodeWav(bytes: Uint8Array): Audio {
  const text = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (!bytes || bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('This is not a WAV file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = 0, count = 0, sampleRate = 0, depth = 0, data: Uint8Array | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = text(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true); count = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true); depth = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the subformat's first two bytes.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      // Streamed files may say 0 or 0xFFFFFFFF here: then the data runs to the end.
      data = bytes.subarray(body, size && body + size <= bytes.length ? body + size : bytes.length);
      break;
    }
    at = body + size + (size & 1);
  }
  const float = format === 3 && (depth === 32 || depth === 64), pcm = format === 1 && [8, 16, 24, 32].includes(depth);
  if (!data || !count || !sampleRate || !(float || pcm)) throw new Error('This WAV file has a format that is not supported (PCM or float only).');
  const step = depth / 8, frames = Math.floor(data.length / (step * count));
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  const samples = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let f = 0, at = 0; f < frames; f++) {
    for (let c = 0; c < count; c++, at += step) {
      channels[c][f] = float ? (depth === 32 ? samples.getFloat32(at, true) : samples.getFloat64(at, true))
        : depth === 8 ? (data[at] - 128) / 128
        : depth === 16 ? samples.getInt16(at, true) / 32768
        : depth === 24 ? ((data[at] | (data[at + 1] << 8) | (data[at + 2] << 16)) << 8 >> 8) / 8388608
        : samples.getInt32(at, true) / 2147483648;
    }
  }
  return { sampleRate, channels };
}

export function encodeWav(audio: Audio, options: { format?: 'pcm16' | 'float32' } = {}): Uint8Array {
  const { sampleRate, channels } = audio || ({} as Audio);
  if (!(sampleRate > 0) || !channels?.length || channels.some(c => c.length !== channels[0].length)) throw new Error('Audio is a sample rate and channels of equal length.');
  const float = options.format === 'float32', step = float ? 4 : 2, count = channels.length, frames = channels[0].length;
  const out = new Uint8Array(44 + frames * count * step), view = new DataView(out.buffer);
  const write = (at: number, value: string) => { for (let i = 0; i < 4; i++) out[at + i] = value.charCodeAt(i); };
  write(0, 'RIFF'); view.setUint32(4, out.length - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * step, true);
  view.setUint16(32, count * step, true); view.setUint16(34, step * 8, true);
  write(36, 'data'); view.setUint32(40, frames * count * step, true);
  const { round, max, min } = Math;
  for (let f = 0, at = 44; f < frames; f++) {
    for (let c = 0; c < count; c++, at += step) {
      const v = channels[c][f];
      if (float) view.setFloat32(at, v, true);
      else view.setInt16(at, max(-32768, min(32767, round((v || 0) * 32768))), true);
    }
  }
  return out;
}
