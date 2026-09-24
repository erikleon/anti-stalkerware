/**
 * Shared types for the ingest -> score -> vault pipeline.
 *
 * A message exists in two forms on purpose. RawRecord is the source bytes
 * exactly as read from the phone's database or an email, hashed the moment
 * we read them. Message is our normalized, parsed view of that record. If
 * we only kept the normalized form, a hash over it would only prove our own
 * parser's output was unchanged, not that the original was. Keeping both
 * lets an export prove derivation from an unmodified source and lets a
 * future parser fix re-derive everything from what we originally captured.
 */

export type SourceKind = "imessage" | "android-sms" | "imap" | "instagram";

/** The source bytes as acquired, before any parsing. */
export interface RawRecord {
  id: string;
  source: SourceKind;
  /** Opaque source-specific payload: a raw chat.db row, a raw RFC822 message, etc. */
  payload: Buffer;
  acquiredAt: Date;
  /** SHA-256 of `payload`, taken at the moment of acquisition. */
  hash: string;
  /** Version of the parser that will read this record, so normalization is reproducible. */
  parserVersion: string;
}

export type MessageProvenance =
  /** Read directly from the live source at normal parse time. */
  | "live"
  /** Reconstructed from an edit-chronology field (e.g. iMessage's edit history). */
  | "edit-history"
  /** Recovered from a write-ahead log before the source database checkpointed it away. */
  | "wal-recovered";

export interface Message {
  id: string;
  /** Hash of the RawRecord this message was derived from. */
  rawRecordHash: string;
  /** Which ingest source this came from — needed to detect a sender switching channels (e.g. texting, then suddenly emailing). */
  source: SourceKind;
  threadId: string;
  sender: string;
  /** True if the app's own account sent this message. */
  fromSelf: boolean;
  text: string;
  sentAt: Date;
  provenance: MessageProvenance;
  /** Set when this message was later edited; holds the prior text and when the edit landed. */
  editHistory?: Array<{ text: string; editedAt: Date }>;
  /** Set when the sender retracted this message after sending it. */
  retractedAt?: Date;
}

/** A record that failed to parse. Never dropped silently — always visible and countable. */
export interface QuarantinedRecord {
  rawRecordHash: string;
  source: SourceKind;
  reason: string;
  quarantinedAt: Date;
}
