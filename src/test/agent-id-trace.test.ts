import { describe, expect, it } from "vitest";

import { createTraceClient, encodeWav, fileKind } from "@/lib/agent-id/trace";

describe("checking whether AI made something", () => {
  it("tells pictures, sound, video and text apart", () => {
    expect(fileKind({ type: "image/jpeg", name: "a.jpg" })).toBe("image");
    expect(fileKind({ type: "", name: "voice.MP3" })).toBe("audio");
    expect(fileKind({ type: "video/mp4", name: "clip.mp4" })).toBe("video");
    expect(fileKind({ type: "", name: "notes.md" })).toBe("text");
    expect(fileKind({ type: "application/pdf", name: "doc.pdf" })).toBeNull();
  });

  it("writes sound as 16-bit mono WAV", () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 0.5]), 16_000));
    const ascii = (offset: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(offset + i)));
    expect([ascii(0), ascii(8), ascii(36)]).toEqual(["RIFF", "WAVE", "data"]);
    expect([wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint16(34, true)]).toEqual([
      1, 16_000, 16,
    ]);
    expect(wav.byteLength).toBe(44 + 8);
    expect([wav.getInt16(46, true), wav.getInt16(48, true)]).toEqual([32767, -32768]);
  });

  it("sends the prepared bytes as they are, and reads the answer", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const client = createTraceClient({
      baseUrl: "https://api.test/agent-id",
      gatewayKey: "anon",
      fetch: async (url, init) => {
        sent.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ found: false, kind: "text" }), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(await client.check("Hello there", "text/plain; charset=utf-8")).toEqual({
      found: false,
      kind: "text",
    });
    expect(sent[0]?.url).toBe("https://api.test/agent-id/v1/trace/check");
    expect(sent[0]?.init.headers).toEqual({
      "Content-Type": "text/plain; charset=utf-8",
      apikey: "anon",
    });
    expect(sent[0]?.init.body).toBe("Hello there");
  });
});
