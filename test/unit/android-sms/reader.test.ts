import { describe, expect, it } from "vitest";
import { normalizePhoneNumber, parseAndroidSmsExport } from "../../../src/ingest/android-sms/reader";

function buildExport(smsRows: string, mmsRows = ""): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<smses count="1">\n${smsRows}${mmsRows}</smses>`,
    "utf8",
  );
}

describe("normalizePhoneNumber", () => {
  it("strips formatting punctuation", () => {
    expect(normalizePhoneNumber("555.123.4567")).toBe("5551234567");
  });

  it("drops a leading US/Canada country code so it matches the same number without one", () => {
    expect(normalizePhoneNumber("+1 (555) 123-4567")).toBe("5551234567");
    expect(normalizePhoneNumber("+1 (555) 123-4567")).toBe(normalizePhoneNumber("555-123-4567"));
  });

  it("leaves a non-NANP 11-digit number alone rather than assuming a country code", () => {
    // Doesn't start with 1, so no digit is dropped.
    expect(normalizePhoneNumber("+44207123456")).toBe("44207123456");
  });
});

describe("parseAndroidSmsExport", () => {
  it("parses a received message scoped to a selected address", () => {
    const xml = buildExport(
      `<sms protocol="0" address="+15551234567" date="1700000000000" type="1" body="you can't hide from me" readable_date="Nov 14, 2023" contact_name="(Unknown)" />\n`,
    );

    const results = [...parseAndroidSmsExport(xml, ["+15551234567"])];
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("you can't hide from me");
      expect(results[0].message.fromSelf).toBe(false);
      expect(results[0].message.sentAt.getTime()).toBe(1700000000000);
      expect(results[0].message.threadId).toBe("5551234567");
    }
  });

  it("marks a sent message (type=2) as fromSelf", () => {
    const xml = buildExport(`<sms address="5551234567" date="1700000000000" type="2" body="leave me alone" />\n`);

    const results = [...parseAndroidSmsExport(xml, ["5551234567"])];
    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.fromSelf).toBe(true);
    }
  });

  it("only returns messages from selected addresses, matching by digits regardless of formatting", () => {
    const xml = buildExport(
      `<sms address="+1 (555) 123-4567" date="1700000000000" type="1" body="in scope" />\n` +
        `<sms address="5559999999" date="1700000000000" type="1" body="not selected" />\n`,
    );

    const results = [...parseAndroidSmsExport(xml, ["555-123-4567"])];
    expect(results).toHaveLength(1);
    if (results[0]?.kind === "message") {
      expect(results[0].message.text).toBe("in scope");
    }
  });

  it("quarantines a row missing a required field", () => {
    const xml = buildExport(`<sms address="5551234567" date="1700000000000" type="1" />\n`);

    const results = [...parseAndroidSmsExport(xml, ["5551234567"])];
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("quarantined");
  });

  it("quarantines a row with an unparseable date", () => {
    const xml = buildExport(`<sms address="5551234567" date="not-a-number" type="1" body="hi" />\n`);

    const results = [...parseAndroidSmsExport(xml, ["5551234567"])];
    expect(results[0]?.kind).toBe("quarantined");
  });

  it("quarantines MMS elements rather than silently dropping them", () => {
    const xml = buildExport(
      `<sms address="5551234567" date="1700000000000" type="1" body="in scope" />\n`,
      `<mms address="5551234567" date="1700000000000" msg_box="1" />\n`,
    );

    const results = [...parseAndroidSmsExport(xml, ["5551234567"])];
    const mmsResult = results.find((r) => r.raw.source === "android-sms" && r.kind === "quarantined");
    expect(mmsResult).toBeDefined();
  });

  it("throws for a file that isn't valid XML at all", () => {
    expect(() => [...parseAndroidSmsExport(Buffer.from("not xml at all <<<"), ["5551234567"])]).toThrow();
  });

  it("every raw record's hash is reproducible", async () => {
    const xml = buildExport(`<sms address="5551234567" date="1700000000000" type="1" body="check hash" />\n`);
    const [result] = [...parseAndroidSmsExport(xml, ["5551234567"])];
    const { hashPayload } = await import("../../../src/ingest/hash");
    expect(hashPayload(result!.raw.payload)).toBe(result!.raw.hash);
  });
});
