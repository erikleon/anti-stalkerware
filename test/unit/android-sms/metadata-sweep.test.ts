import { describe, expect, it } from "vitest";
import { sweepAndroidSmsExport } from "../../../src/ingest/android-sms/metadata-sweep";

function buildExport(smsRows: string): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="1">\n${smsRows}</smses>`,
    "utf8",
  );
}

describe("sweepAndroidSmsExport", () => {
  it("aggregates message count and first/last seen per address, unfiltered", () => {
    const xml = buildExport(
      `<sms address="+15551234567" date="1700000000000" type="1" body="a" />\n` +
        `<sms address="+15551234567" date="1700003600000" type="1" body="b" />\n` +
        `<sms address="5559999999" date="1700000000000" type="1" body="c" />\n`,
    );

    const results = sweepAndroidSmsExport(xml);
    expect(results).toHaveLength(2);

    const first = results.find((r) => r.sender === "+15551234567");
    expect(first?.messageCount).toBe(2);
    expect(first?.firstSeenAt.getTime()).toBe(1700000000000);
    expect(first?.lastSeenAt.getTime()).toBe(1700003600000);
  });

  it("groups addresses that normalize to the same number even if formatted differently", () => {
    const xml = buildExport(
      `<sms address="+1 (555) 123-4567" date="1700000000000" type="1" body="a" />\n` +
        `<sms address="555-123-4567" date="1700000001000" type="1" body="b" />\n`,
    );

    const results = sweepAndroidSmsExport(xml);
    expect(results).toHaveLength(1);
    expect(results[0]?.messageCount).toBe(2);
  });

  it("returns an empty list for an export with no messages", () => {
    expect(sweepAndroidSmsExport(buildExport(""))).toEqual([]);
  });
});
