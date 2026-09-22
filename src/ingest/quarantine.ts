import type { QuarantinedRecord, RawRecord, SourceKind } from "../types/message";

/**
 * Anything an adapter can't parse goes here instead of being dropped.
 * A locked chat.db, a malformed edit-chronology blob, a schema an OS
 * update changed underneath us — all of these must be visible and
 * countable, never a silent skip. Silent skip here means silent loss of
 * evidence someone may need for a restraining order.
 */
export function quarantine(
  raw: RawRecord,
  source: SourceKind,
  reason: string,
): QuarantinedRecord {
  return {
    rawRecordHash: raw.hash,
    source,
    reason,
    quarantinedAt: new Date(),
  };
}
