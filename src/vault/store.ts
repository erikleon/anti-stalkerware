import type { Message, QuarantinedRecord, RawRecord } from "../types/message";

/**
 * The vault's storage interface. There is deliberately no delete method
 * anywhere on this type. "Hide" in the UI is a view-state flag layered on
 * top of this store, never a call into it — a message a person hides from
 * their own view must still be here if a court needs it later. The only way
 * to remove data is the separate, explicit action in destroy.ts.
 */
export interface AppendClassification {
  /** Whether this message crossed the abuse threshold — see score/classifier.ts. Drives isAbusiveSender, which the OSINT gate depends on. */
  crossesAbuseThreshold: boolean;
  /** Raw score backing crossesAbuseThreshold, kept alongside it so the triage UI can show a High/Medium band instead of a single cutoff. Optional so existing callers that only know the boolean don't break; defaults to 0 when absent. */
  toxicityScore?: number;
}

/**
 * At-a-glance summary of one thread's most recent activity, for the bucket
 * rail and message list — the triage screen groups by thread, not by
 * individual message. `latestMessageId` is the key the triage screen writes
 * reviewed/hidden state against (see vault/triage-state.ts): a thread is
 * "needs review" whenever its latest message hasn't been marked reviewed or
 * hidden, so new activity on an already-reviewed thread reopens it.
 */
export interface ThreadSummary {
  threadId: string;
  sender: string;
  latestMessageId: string;
  latestText: string;
  latestSentAt: Date;
  messageCount: number;
  maxToxicityScore: number;
  crossesAbuseThreshold: boolean;
}

export interface VaultStore {
  /** Appends a message and its raw source record. Never overwrites an existing hash. `classification` is optional so ingest can append before scoring runs; a message appended without one never counts toward isAbusiveSender. */
  append(raw: RawRecord, message: Message, classification?: AppendClassification): Promise<void>;

  get(messageId: string): Promise<Message | undefined>;

  list(threadId: string): Promise<Message[]>;

  /** One row per thread, most recent activity first. The only way the triage UI discovers which threads exist. */
  listThreads(): Promise<ThreadSummary[]>;

  /** Returns the preserved raw record a message was derived from, for export or re-parsing. */
  getRawRecord(hash: string): Promise<RawRecord | undefined>;

  /** True if this sender has at least one message that crossed the abuse threshold. Used by the OSINT gate. */
  isAbusiveSender(sender: string): Promise<boolean>;

  /** Persists a record ingest couldn't parse, so the quarantine count in the UI survives a restart instead of only existing for the current session. */
  recordQuarantine(record: QuarantinedRecord): Promise<void>;

  listQuarantined(): Promise<QuarantinedRecord[]>;
}
