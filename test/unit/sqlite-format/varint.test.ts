import { describe, expect, it } from "vitest";
import { readVarint } from "../../../src/ingest/imessage/sqlite-format/varint";

describe("readVarint — SQLite's varint encoding, per fileformat2.html examples", () => {
  it("decodes single-byte values", () => {
    expect(readVarint(Buffer.from([0x00]), 0)).toEqual({ value: 0, length: 1 });
    expect(readVarint(Buffer.from([0x7f]), 0)).toEqual({ value: 127, length: 1 });
  });

  it("decodes the two-byte example from the spec: 0x81 0x00 = 128", () => {
    expect(readVarint(Buffer.from([0x81, 0x00]), 0)).toEqual({ value: 128, length: 2 });
  });

  it("decodes the two-byte example from the spec: 0xFF 0x7F = 16383", () => {
    expect(readVarint(Buffer.from([0xff, 0x7f]), 0)).toEqual({ value: 16383, length: 2 });
  });

  it("reads starting at a nonzero offset without consuming preceding bytes", () => {
    const buffer = Buffer.from([0xaa, 0xbb, 0x7f]);
    expect(readVarint(buffer, 2)).toEqual({ value: 127, length: 1 });
  });

  it("throws rather than read past the end of the buffer", () => {
    expect(() => readVarint(Buffer.from([0x81]), 0)).toThrow(/past end of buffer/);
  });
});
