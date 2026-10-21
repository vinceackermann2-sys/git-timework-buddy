import { describe, expect, it } from "vitest";

import {
  dataCodewords,
  encodeData,
  formatBits,
  qrMatrix,
  qrPath,
  reedSolomonDivisor,
  reedSolomonRemainder,
} from "@/lib/agent-id/qr";

describe("QR encoder", () => {
  it("computes Reed–Solomon error correction (1-M HELLO WORLD example)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("writes the standard format strings for level M", () => {
    const table = [
      "101010000010010",
      "101000100100101",
      "101111001111100",
      "101101101001011",
      "100010111111001",
      "100000011001110",
      "100111110010111",
      "100101010100000",
    ];
    table.forEach((bits, mask) =>
      expect(formatBits(mask).toString(2).padStart(15, "0")).toBe(bits),
    );
  });

  it("knows each version's data capacity at level M", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(dataCodewords)).toEqual([
      16, 28, 44, 64, 86, 108, 124, 154, 182, 216,
    ]);
  });

  it("pads byte-mode data the standard way", () => {
    const codewords = encodeData([...new TextEncoder().encode("hi")], 1);
    expect(codewords).toHaveLength(16);
    // 0100 | 00000010 | 'h' 'i' | 0000, then 0xEC 0x11 padding.
    expect(codewords.slice(0, 4)).toEqual([0x40, 0x26, 0x86, 0x90]);
    expect(codewords.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11]);
  });

  it("draws finder patterns and the dark module", () => {
    const address = "0x" + "ab".repeat(20);
    const m = qrMatrix(address);
    expect(m).toHaveLength(29); // version 3
    const finderRow = [true, true, true, true, true, true, true, false];
    expect(m[0]!.slice(0, 8)).toEqual(finderRow);
    expect(m[0]!.slice(-7)).toEqual(finderRow.slice(0, 7));
    expect(m[3]!.slice(0, 7)).toEqual([true, false, true, true, true, false, true]);
    expect(m[m.length - 8]![8]).toBe(true);
    // Timing pattern between the finders alternates.
    expect(m[6]!.slice(8, 21)).toEqual(Array.from({ length: 13 }, (_, i) => i % 2 === 0));
  });

  it("grows the version with the data and adds a quiet zone", () => {
    expect(qrMatrix("x".repeat(100))).toHaveLength(41); // version 6
  });

  it("makes an SVG path", () => {
    const { size, path } = qrPath("0x1234");
    expect(size).toBe(21 + 8);
    expect(path.startsWith("M4,4h1v1h-1z")).toBe(true);
  });
});
