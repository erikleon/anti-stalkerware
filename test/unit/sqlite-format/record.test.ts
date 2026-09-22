import { describe, expect, it } from "vitest";
import { decodeRecord } from "../../../src/ingest/imessage/sqlite-format/record";

describe("decodeRecord — SQLite record header + body format", () => {
  it("decodes NULL, a small int, and a text column", () => {
    // header: size=4 (self + 3 single-byte serial types), then serial types 0 (NULL), 1 (int8), 17 (text len 2)
    // body: (nothing for NULL), 42, "hi"
    const record = Buffer.from([0x04, 0x00, 0x01, 0x11, 42, 0x68, 0x69]);
    expect(decodeRecord(record)).toEqual([null, 42, "hi"]);
  });

  it("decodes an 8-byte integer as bigint and a blob column", () => {
    const bigValue = 9_007_199_254_740_993n; // exceeds Number.MAX_SAFE_INTEGER
    const body = Buffer.alloc(9);
    body.writeBigInt64BE(bigValue, 0);
    body[8] = 0xab;
    // header: size=3 (self + serial 6 + serial 14), serial types 6 (int64), 14 (blob len 1)
    const record = Buffer.concat([Buffer.from([0x03, 0x06, 0x0e]), body]);

    const decoded = decodeRecord(record);
    expect(decoded[0]).toBe(bigValue);
    expect(Buffer.isBuffer(decoded[1])).toBe(true);
    expect((decoded[1] as Buffer)[0]).toBe(0xab);
  });

  it("decodes the constant-0 and constant-1 serial types (8 and 9) with no body bytes", () => {
    // header: size=3 (self + two single-byte serial types), serial types 8, 9
    const record = Buffer.from([0x03, 0x08, 0x09]);
    expect(decodeRecord(record)).toEqual([0, 1]);
  });

  it("decodes a multi-byte float (serial type 7)", () => {
    const body = Buffer.alloc(8);
    body.writeDoubleBE(3.5, 0);
    const record = Buffer.concat([Buffer.from([0x02, 0x07]), body]);
    expect(decodeRecord(record)).toEqual([3.5]);
  });
});
