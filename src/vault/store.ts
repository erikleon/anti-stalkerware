import type { Message, RawRecord } from "../types/message";

/**
 * The vault's storage interface. There is deliberately no delete method
 * anywhere on this type. "Hide" in the UI is a view-state flag layered on
 * top of this store, never a call into it — a message a person hides from
 * their own view must still be here if a court needs it later. The only way
 * to remove data is the separate, explicit action in destroy.ts.
 */
export interface VaultStore {
  /** Appends a message and its raw source record. Never overwrites an existing hash. */
  append(raw: RawRecord, message: Message): Promise<void>;

  get(messageId: string): Promise<Message | undefined>;

  list(threadId: string): Promise<Message[]>;

  /** Returns the preserved raw record a message was derived from, for export or re-parsing. */
  getRawRecord(hash: string): Promise<RawRecord | undefined>;

  /** True if this sender has at least one message that crossed the abuse threshold. Used by the OSINT gate. */
  isAbusiveSender(sender: string): Promise<boolean>;
}
