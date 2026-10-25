// Checking whether a picture, a voice or a text was made by an agent with an
// Agent ID (the API's open /v1/trace/check). The browser decodes the file
// itself and sends a small, plain version: a PNG at most 1024 pixels wide or
// high, or the first 30 seconds of sound as 16 kHz mono WAV. Agent ID looks
// for its mark there and answers with the agent and who answers for it.
import { AgentIdError, buildUrl, errorFromResponse } from "./client";
import type { AgentModel } from "./types";

export type TraceKind = "image" | "audio" | "text" | "code" | "video" | "other";

export type TraceRecord = {
  id: string;
  kind: TraceKind;
  createdAt: string;
  agent: {
    name: string;
    handle: string;
    mascot?: "orbit" | "nova" | "cosmo";
    model?: AgentModel;
    status: string;
  };
  // Who answers for it: a verified business by name, a person never by name.
  owner: {
    verified: boolean;
    type: "person" | "business";
    name: string | null;
    country: string | null;
  };
  // The app and model it was made through, as the agent reported them.
  app: { app: string; label: string } | null;
  model: string | null;
};

export type TraceCheck =
  | {
      found: true;
      kind: TraceKind;
      match: "mark" | "fingerprint" | "exact";
      similarity?: number;
      trace: TraceRecord;
    }
  | { found: false; kind: TraceKind };

export function createTraceClient(options: {
  baseUrl: string;
  gatewayKey?: string | undefined;
  fetch?: typeof fetch;
}) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    // The prepared bytes (preparePicture, prepareSound) or the text as typed.
    async check(body: Blob | string, type: string): Promise<TraceCheck> {
      if (!options.baseUrl)
        throw new AgentIdError(0, "not_configured", "Agent ID isn't configured on this site.");
      const headers: Record<string, string> = { "Content-Type": type };
      if (options.gatewayKey) headers["apikey"] = options.gatewayKey;
      let response: Response;
      try {
        response = await doFetch(buildUrl(options.baseUrl, "/v1/trace/check"), {
          method: "POST",
          headers,
          body,
        });
      } catch {
        throw new AgentIdError(
          0,
          "network",
          "Can't reach Agent ID. Check your connection and try again.",
        );
      }
      if (!response.ok) throw await errorFromResponse(response);
      return (await response.json()) as TraceCheck;
    },
  };
}

// --- Preparing a file in the browser ---------------------------------------------

export const MAX_PICTURE_SIDE = 1024;
export const SOUND_RATE = 16_000;
export const SOUND_SECONDS = 30;

// A picture, drawn at most 1024 pixels on its longest side, as PNG.
export async function preparePicture(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't read pictures.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't read the picture."))),
      "image/png",
    ),
  );
}

// Sound, as the first 30 seconds at 16 kHz in one channel, as 16-bit WAV.
export async function prepareSound(file: Blob): Promise<Blob> {
  const data = await file.arrayBuffer();
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decoder = new Context();
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(data);
  } finally {
    void decoder.close();
  }
  const seconds = Math.min(SOUND_SECONDS, decoded.duration);
  const length = Math.max(1, Math.round(seconds * SOUND_RATE));
  const offline = new OfflineAudioContext(1, length, SOUND_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob([encodeWav(rendered.getChannelData(0), SOUND_RATE)], { type: "audio/wav" });
}

// Mono samples (-1…1) as a 16-bit PCM WAV file.
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// What a file is, by its type and, when the browser doesn't say, its name.
export function fileKind(file: {
  type: string;
  name: string;
}): "image" | "audio" | "video" | "text" | null {
  const type = file.type.toLowerCase();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (
    type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"].includes(ext)
  )
    return "image";
  if (
    type.startsWith("audio/") ||
    ["wav", "mp3", "m4a", "ogg", "flac", "aac", "opus"].includes(ext)
  )
    return "audio";
  if (type.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (
    type.startsWith("text/") ||
    ["txt", "md", "js", "ts", "py", "json", "html", "css"].includes(ext)
  )
    return "text";
  return null;
}
