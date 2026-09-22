/**
 * Access logging at action granularity: acquisition, export, destroy, and
 * explicit integrity verification. Deliberately does NOT log individual
 * message reads. Logging every read would make each triage-list render a
 * batch of disk writes, and it would build a record of exactly which
 * messages the person reread and when — a log that helps no court case and
 * is actively dangerous if the person sharing the device finds it.
 */
export type IntegrityEventKind = "acquisition" | "export" | "destroy" | "verify";

export interface IntegrityEvent {
  kind: IntegrityEventKind;
  /** Hashes of the raw records this event covers. */
  recordHashes: string[];
  occurredAt: Date;
}

export interface IntegrityLog {
  append(event: IntegrityEvent): Promise<void>;
  list(): Promise<IntegrityEvent[]>;
}

/**
 * Verifies a raw record's payload still matches the hash taken at
 * acquisition. This proves the bytes we captured haven't changed since we
 * captured them — nothing more. It does not prove the source database was
 * authentic, that the device clock was correct, or that the record wasn't
 * altered before our app ever read it. Export documentation must say
 * exactly this and no more.
 */
export function verifyIntegrity(payload: Buffer, expectedHash: string, hashFn: (buf: Buffer) => string): boolean {
  return hashFn(payload) === expectedHash;
}
