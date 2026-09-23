import type Database from "better-sqlite3";

/**
 * Per-message triage view-state: reviewed and hidden flags. Deliberately a
 * separate class from SqliteVaultStore, sharing its connection rather than
 * living in its schema — this is UI state layered on top of the evidentiary
 * message log (see the architecture note on VaultStore in store.ts), not
 * evidence itself, so unlike a message it's allowed to be overwritten in
 * place. Marking a thread reviewed or hidden must never touch the
 * append-only `messages` table.
 *
 * Keyed by message_id, not thread_id: the triage screen always writes
 * against a thread's *current latest* message id, so a new message arriving
 * after a thread was marked reviewed naturally reopens it — there's no
 * separate "is this thread stale" check to keep in sync.
 */
export interface TriageState {
  reviewed: boolean;
  hidden: boolean;
}

const DEFAULT_STATE: TriageState = { reviewed: false, hidden: false };

export class TriageStateStore {
  constructor(private readonly db: Database.Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS triage_state (
        message_id TEXT PRIMARY KEY,
        reviewed INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  get(messageId: string): TriageState {
    const row = this.db.prepare(`SELECT reviewed, hidden FROM triage_state WHERE message_id = ?`).get(messageId) as
      | { reviewed: number; hidden: number }
      | undefined;
    return row ? { reviewed: row.reviewed === 1, hidden: row.hidden === 1 } : { ...DEFAULT_STATE };
  }

  /** Every stored state at once, for merging against a full thread/message list without one query per row. */
  getAll(): Map<string, TriageState> {
    const rows = this.db.prepare(`SELECT message_id, reviewed, hidden FROM triage_state`).all() as Array<{
      message_id: string;
      reviewed: number;
      hidden: number;
    }>;
    const map = new Map<string, TriageState>();
    for (const row of rows) {
      map.set(row.message_id, { reviewed: row.reviewed === 1, hidden: row.hidden === 1 });
    }
    return map;
  }

  setReviewed(messageId: string, reviewed: boolean): void {
    this.upsert(messageId, { reviewed });
  }

  setHidden(messageId: string, hidden: boolean): void {
    this.upsert(messageId, { hidden });
  }

  private upsert(messageId: string, patch: Partial<TriageState>): void {
    const next = { ...this.get(messageId), ...patch };
    this.db
      .prepare(
        `INSERT INTO triage_state (message_id, reviewed, hidden) VALUES (?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET reviewed = excluded.reviewed, hidden = excluded.hidden`,
      )
      .run(messageId, next.reviewed ? 1 : 0, next.hidden ? 1 : 0);
  }
}
