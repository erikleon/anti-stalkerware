import { describe, expect, it } from "vitest";
import { walChecksum } from "../../../src/ingest/imessage/sqlite-format/checksum";

function u32be(...words: number[]): Buffer {
  const buf = Buffer.alloc(words.length * 4);
  words.forEach((w, i) => buf.writeUInt32BE(w, i * 4));
  return buf;
}

describe("walChecksum — SQLite's WAL checksum algorithm", () => {
  it("returns (0,0) for all-zero input", () => {
    expect(walChecksum(u32be(0, 0), true)).toEqual({ s0: 0, s1: 0 });
  });

  it("matches a hand-computed vector for one pair of words", () => {
    // s0 = 0 + 1 + 0 = 1 ; s1 = 0 + 2 + 1 = 3
    expect(walChecksum(u32be(1, 2), true)).toEqual({ s0: 1, s1: 3 });
  });

  it("carrying state across two calls matches doing it in one call", () => {
    const wholeInput = u32be(1, 2, 3, 4);
    const oneShot = walChecksum(wholeInput, true);

    const first = walChecksum(u32be(1, 2), true);
    const carried = walChecksum(u32be(3, 4), true, first);

    expect(carried).toEqual(oneShot);
  });

  it("big-endian and little-endian interpretations of the same bytes differ", () => {
    const bytes = u32be(1, 2);
    const be = walChecksum(bytes, true);
    const le = walChecksum(bytes, false);
    expect(be).not.toEqual(le);
  });

  it("rejects input that isn't a multiple of 8 bytes", () => {
    expect(() => walChecksum(Buffer.alloc(5), true)).toThrow(/multiple of 8/);
  });

  it("wraps on 32-bit overflow instead of producing an unsafe JS number", () => {
    const nearMax = u32be(0xffffffff, 0xffffffff);
    const result = walChecksum(nearMax, true);
    expect(result.s0).toBeLessThanOrEqual(0xffffffff);
    expect(result.s1).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isSafeInteger(result.s0)).toBe(true);
    expect(Number.isSafeInteger(result.s1)).toBe(true);
  });
});
