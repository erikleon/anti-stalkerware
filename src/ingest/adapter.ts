import type { Message, QuarantinedRecord, RawRecord } from "../types/message";

/**
 * The contract every ingest source implements: chat.db, Android SMS export,
 * IMAP. Readers only ever produce raw + normalized records; they never
 * write to the vault directly. Keeping the vault write path in one place is
 * what keeps hashing, timestamping and quarantine handling consistent
 * across sources instead of drifting between three separate implementations.
 */
export interface IngestAdapter {
  readonly source: RawRecord["source"];

  /**
   * Pull new records since the last checkpoint. Scoped to the threads the
   * user selected during onboarding, not the whole message history — a full
   * scan of a large chat.db can take hours and puts unrelated conversations
   * in the vault for no reason.
   */
  acquire(sinceCheckpoint: string | undefined): AsyncIterable<IngestResult>;
}

export type IngestResult =
  | { kind: "message"; raw: RawRecord; message: Message }
  | { kind: "quarantined"; raw: RawRecord; quarantine: QuarantinedRecord };

/**
 * Cheap, content-free sweep over the full source: sender, frequency, and
 * time-of-day pattern only, no message text and no vault write. Used to
 * surface senders the user didn't think to select during onboarding
 * (an unknown number, a burner account) without paying the cost of
 * classifying their full history.
 */
export interface MetadataSweepResult {
  sender: string;
  messageCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
