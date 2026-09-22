/**
 * chat.db's relevant columns. Only what we read — this is not a full
 * schema. Verified against public forensic research on the iOS 16+ /
 * macOS Sonoma+ layout; a future OS update can change this without
 * warning, which is why reader.ts quarantines rows it can't make sense of
 * instead of assuming this shape holds forever.
 *
 * date/date_edited are nanoseconds since Apple's 2001 epoch. For any
 * message sent after 2001, that value exceeds Number.MAX_SAFE_INTEGER —
 * roughly 7.9e17 for a 2026 timestamp against a ~9e15 safe-integer ceiling
 * — so these fields are bigint, read with better-sqlite3's safe-integers
 * mode. Silently losing precision here would corrupt every message's
 * timestamp, not just an edge case.
 */
export interface MessageRow {
  ROWID: number;
  guid: string;
  /** Plain text body. Null for messages that store rich content in attributedBody instead. */
  text: string | null;
  /** Archived NSAttributedString (bplist) holding rich text when `text` is null. */
  attributedBody: Buffer | null;
  handle_id: number;
  is_from_me: number;
  date: bigint;
  /** The message's most recent edit time, or 0/null if never edited. */
  date_edited: bigint | null;
  /** 1 if the sender retracted (unsent) this message. */
  is_deleted: number;
  /** bplist blob holding edit chronology (message_summary_info.ec) among other summary data. */
  message_summary_info: Buffer | null;
  /** Non-zero for tapbacks/reactions rather than an actual message. */
  associated_message_type: number;
}

export interface HandleRow {
  ROWID: number;
  /** Phone number or email identifying the sender. */
  id: string;
}

export interface ChatRow {
  ROWID: number;
  guid: string;
  chat_identifier: string;
}

/** Seconds between the Unix epoch and Apple's Cocoa epoch (2001-01-01T00:00:00Z). */
const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200n;

/** Converts a chat.db Apple-epoch-nanoseconds timestamp to a JS Date. */
export function appleTimestampToDate(appleNs: bigint | number): Date {
  const ns = typeof appleNs === "bigint" ? appleNs : BigInt(Math.trunc(appleNs));
  const unixMs = ns / 1_000_000n + APPLE_EPOCH_OFFSET_SECONDS * 1000n;
  return new Date(Number(unixMs));
}
