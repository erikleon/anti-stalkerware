import type Database from "better-sqlite3";

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

interface IntegrityRow {
  kind: string;
  record_hashes: string;
  occurred_at: string;
}

/**
 * Shares the vault's SQLite database — not encrypted, deliberately: this
 * log records which actions happened and when, not message content, so
 * there's nothing here that needs the same confidentiality as the
 * messages themselves. Append-only in the same sense as sqlite-store.ts:
 * no UPDATE or DELETE on this table either.
 */
export class SqliteIntegrityLog implements IntegrityLog {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS integrity_log (
        kind TEXT NOT NULL,
        record_hashes TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
    `);
  }

  async append(event: IntegrityEvent): Promise<void> {
    this.db
      .prepare(`INSERT INTO integrity_log (kind, record_hashes, occurred_at) VALUES (?, ?, ?)`)
      .run(event.kind, JSON.stringify(event.recordHashes), event.occurredAt.toISOString());
  }

  async list(): Promise<IntegrityEvent[]> {
    const rows = this.db.prepare(`SELECT * FROM integrity_log ORDER BY occurred_at ASC`).all() as IntegrityRow[];
    return rows.map((row) => ({
      kind: row.kind as IntegrityEventKind,
      recordHashes: JSON.parse(row.record_hashes) as string[],
      occurredAt: new Date(row.occurred_at),
    }));
  }
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
