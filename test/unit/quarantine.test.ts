import { describe, expect, it } from "vitest";
import { quarantine } from "../../src/ingest/quarantine";
import type { RawRecord } from "../../src/types/message";

function makeRawRecord(overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    id: "raw-1",
    source: "imessage",
    payload: Buffer.from("test"),
    acquiredAt: new Date("2026-01-01T00:00:00Z"),
    hash: "abc123",
    parserVersion: "1.0.0",
    ...overrides,
  };
}

describe("quarantine", () => {
  it("preserves the raw record's hash and source, never the payload", () => {
    const raw = makeRawRecord();
    const result = quarantine(raw, "imessage", "malformed edit-chronology bplist");

    expect(result.rawRecordHash).toBe(raw.hash);
    expect(result.source).toBe("imessage");
    expect(result.reason).toBe("malformed edit-chronology bplist");
    expect(result.quarantinedAt).toBeInstanceOf(Date);
  });
});
