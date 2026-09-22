import { XMLParser } from "fast-xml-parser";
import type { Message, RawRecord } from "../../types/message";
import type { IngestResult } from "../adapter";
import { hashPayload } from "../hash";
import { quarantine } from "../quarantine";

/**
 * Parses the XML export format used by "SMS Backup & Restore" (SyncTech) —
 * the de facto standard Android SMS export, and the only realistic way to
 * get SMS history off an Android phone without a live device API. MMS
 * (multipart messages, attachments) is out of scope for v1; an <mms>
 * element is quarantined rather than silently dropped.
 */

interface RawSmsElement {
  address?: string;
  date?: string;
  type?: string;
  body?: string;
}

/**
 * Phone numbers arrive in wildly different formats across carriers and
 * export tools; compare on digits only, dropping a leading US/Canada
 * country code (1) when present so "+1 555-123-4567" and "555.123.4567"
 * match. This is a deliberately narrow simplification, not general E.164
 * parsing — a full phone-number library is more than this needs.
 */
export function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

export function* parseAndroidSmsExport(xml: Buffer, selectedAddresses: string[]): Generator<IngestResult> {
  const normalizedSelected = new Set(selectedAddresses.map(normalizePhoneNumber));

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    isArray: (name) => name === "sms" || name === "mms",
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml.toString("utf8"));
  } catch (err) {
    // The whole file failed to parse as XML — nothing in it is recoverable
    // as individual records, so there's nothing to quarantine per-row.
    // The caller sees an empty result and should surface the file-level error.
    throw new Error(`android SMS export is not valid XML: ${(err as Error).message}`);
  }

  const root = (parsed as { smses?: { sms?: RawSmsElement[]; mms?: unknown[] } })?.smses;
  const smsElements = root?.sms ?? [];
  const mmsElements = root?.mms ?? [];

  for (const [index, raw] of smsElements.entries()) {
    const address = raw.address ? normalizePhoneNumber(raw.address) : undefined;
    if (address === undefined || !normalizedSelected.has(address)) continue;
    yield normalizeSms(raw, index);
  }

  for (const [index, raw] of mmsElements.entries()) {
    const rawRecord = buildRawRecord(raw, `mms-${index}`);
    yield {
      kind: "quarantined",
      raw: rawRecord,
      quarantine: quarantine(rawRecord, "android-sms", "MMS is not supported in v1 — SMS text only"),
    };
  }
}

function normalizeSms(raw: RawSmsElement, index: number): IngestResult {
  const rawRecord = buildRawRecord(raw, `sms-${index}`);

  if (raw.body === undefined || raw.date === undefined || raw.address === undefined) {
    return {
      kind: "quarantined",
      raw: rawRecord,
      quarantine: quarantine(rawRecord, "android-sms", "missing required field (address, date, or body)"),
    };
  }

  const dateMs = Number(raw.date);
  if (!Number.isFinite(dateMs)) {
    return {
      kind: "quarantined",
      raw: rawRecord,
      quarantine: quarantine(rawRecord, "android-sms", `unparseable date value: ${raw.date}`),
    };
  }

  const message: Message = {
    id: rawRecord.id,
    rawRecordHash: rawRecord.hash,
    source: "android-sms",
    threadId: normalizePhoneNumber(raw.address),
    sender: raw.address,
    // type 2 = sent by the device owner; anything else (1 = received, etc.) is from the other party.
    fromSelf: raw.type === "2",
    text: raw.body,
    sentAt: new Date(dateMs),
    provenance: "live",
  };

  return { kind: "message", raw: rawRecord, message };
}

function buildRawRecord(raw: unknown, id: string): RawRecord {
  const payload = Buffer.from(JSON.stringify(raw), "utf8");
  return {
    id,
    source: "android-sms",
    payload,
    acquiredAt: new Date(),
    hash: hashPayload(payload),
    parserVersion: "1",
  };
}
