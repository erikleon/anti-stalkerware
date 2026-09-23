import Database from "better-sqlite3";
import type { Message, QuarantinedRecord, RawRecord } from "../types/message";
import type { AppendClassification, ThreadSummary, VaultStore } from "./store";
import type { VaultKey } from "./crypto";

/**
 * The concrete, encrypted-at-rest VaultStore. Message text, raw payloads,
 * and edit history are stored as ciphertext; everything else (sender,
 * thread, timestamps, whether a message crossed the abuse threshold) is
 * plain — see crypto.ts for what that trade-off does and doesn't protect.
 *
 * Schema is append-only by construction: this file contains no UPDATE or
 * DELETE statement anywhere, on any table. Re-appending an existing hash
 * is a no-op (INSERT OR IGNORE), not an overwrite. A message that's been
 * edited or retracted since it was first captured shows up as a second
 * row sharing the same message_id with a different raw_record_hash —
 * history accumulates, nothing is replaced.
 */
export class SqliteVaultStore implements VaultStore {
  /**
   * Takes an already-open connection rather than a file path, so the
   * store, the credential store and the integrity log can all share one
   * connection to the same vault database instead of each opening their
   * own. Callers that just want a standalone store can still do
   * `new SqliteVaultStore(new Database(dbPath), key)`.
   */
  constructor(private readonly db: Database.Database, private readonly key: VaultKey) {
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS raw_records (
        hash TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        payload BLOB NOT NULL,
        acquired_at TEXT NOT NULL,
        parser_version TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT NOT NULL,
        raw_record_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        from_self INTEGER NOT NULL,
        text BLOB NOT NULL,
        sent_at TEXT NOT NULL,
        provenance TEXT NOT NULL,
        edit_history BLOB,
        retracted_at TEXT,
        crosses_abuse_threshold INTEGER NOT NULL DEFAULT 0,
        toxicity_score REAL NOT NULL DEFAULT 0,
        appended_at TEXT NOT NULL,
        PRIMARY KEY (message_id, raw_record_hash),
        FOREIGN KEY (raw_record_hash) REFERENCES raw_records(hash)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender_abuse ON messages(sender, crosses_abuse_threshold);

      CREATE TABLE IF NOT EXISTS quarantine (
        raw_record_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        reason TEXT NOT NULL,
        quarantined_at TEXT NOT NULL
      );
    `);
  }

  async append(raw: RawRecord, message: Message, classification?: AppendClassification): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO raw_records (hash, source, payload, acquired_at, parser_version)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(raw.hash, raw.source, this.key.encrypt(raw.payload), raw.acquiredAt.toISOString(), raw.parserVersion);

    const editHistoryBlob = message.editHistory
      ? this.key.encrypt(Buffer.from(JSON.stringify(message.editHistory), "utf8"))
      : null;

    this.db
      .prepare(
        `INSERT OR IGNORE INTO messages
          (message_id, raw_record_hash, source, thread_id, sender, from_self, text, sent_at, provenance, edit_history, retracted_at, crosses_abuse_threshold, toxicity_score, appended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.rawRecordHash,
        message.source,
        message.threadId,
        message.sender,
        message.fromSelf ? 1 : 0,
        this.key.encrypt(Buffer.from(message.text, "utf8")),
        message.sentAt.toISOString(),
        message.provenance,
        editHistoryBlob,
        message.retractedAt ? message.retractedAt.toISOString() : null,
        classification?.crossesAbuseThreshold ? 1 : 0,
        classification?.toxicityScore ?? 0,
        new Date().toISOString(),
      );
  }

  async get(messageId: string): Promise<Message | undefined> {
    // Break ties on rowid, not just appended_at: two appends in the same
    // millisecond produce an identical timestamp string, and appended_at
    // alone can't then tell which one is actually more recent. rowid is
    // SQLite's own monotonically increasing insertion order.
    const row = this.db
      .prepare(`SELECT * FROM messages WHERE message_id = ? ORDER BY appended_at DESC, rowid DESC LIMIT 1`)
      .get(messageId) as MessageRow | undefined;
    return row ? this.rowToMessage(row) : undefined;
  }

  async list(threadId: string): Promise<Message[]> {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages m
         INNER JOIN (
           SELECT message_id, MAX(rowid) AS latest_rowid
           FROM messages WHERE thread_id = ?
           GROUP BY message_id
         ) latest ON latest.message_id = m.message_id AND latest.latest_rowid = m.rowid
         WHERE m.thread_id = ?
         ORDER BY m.sent_at ASC`,
      )
      .all(threadId, threadId) as MessageRow[];
    return rows.map((row) => this.rowToMessage(row));
  }

  async listThreads(): Promise<ThreadSummary[]> {
    // Two aggregates over the same table: one picks out the actual latest
    // row per thread (by rowid, same tie-break as get()/list()), the other
    // computes message_count/max toxicity/whether any message ever crossed
    // the threshold. Joined together so a thread's summary always reflects
    // its full history, not just its latest message's own classification.
    const rows = this.db
      .prepare(
        `SELECT
           m.thread_id AS thread_id,
           m.sender AS sender,
           m.message_id AS latest_message_id,
           m.text AS latest_text,
           m.sent_at AS latest_sent_at,
           agg.message_count AS message_count,
           agg.max_toxicity_score AS max_toxicity_score,
           agg.crosses_abuse_threshold AS crosses_abuse_threshold
         FROM messages m
         INNER JOIN (
           SELECT thread_id, MAX(rowid) AS latest_rowid
           FROM messages
           GROUP BY thread_id
         ) latest ON latest.thread_id = m.thread_id AND latest.latest_rowid = m.rowid
         INNER JOIN (
           SELECT thread_id,
                  COUNT(DISTINCT message_id) AS message_count,
                  MAX(toxicity_score) AS max_toxicity_score,
                  MAX(crosses_abuse_threshold) AS crosses_abuse_threshold
           FROM messages
           GROUP BY thread_id
         ) agg ON agg.thread_id = m.thread_id
         ORDER BY m.sent_at DESC`,
      )
      .all() as ThreadSummaryRow[];

    return rows.map((row) => ({
      threadId: row.thread_id,
      sender: row.sender,
      latestMessageId: row.latest_message_id,
      latestText: this.key.decrypt(row.latest_text).toString("utf8"),
      latestSentAt: new Date(row.latest_sent_at),
      messageCount: row.message_count,
      maxToxicityScore: row.max_toxicity_score,
      crossesAbuseThreshold: row.crosses_abuse_threshold === 1,
    }));
  }

  async getRawRecord(hash: string): Promise<RawRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM raw_records WHERE hash = ?`).get(hash) as RawRecordRow | undefined;
    if (!row) return undefined;
    return {
      id: row.hash,
      source: row.source as RawRecord["source"],
      payload: this.key.decrypt(row.payload),
      acquiredAt: new Date(row.acquired_at),
      hash: row.hash,
      parserVersion: row.parser_version,
    };
  }

  async isAbusiveSender(sender: string): Promise<boolean> {
    const row = this.db
      .prepare(`SELECT 1 FROM messages WHERE sender = ? AND crosses_abuse_threshold = 1 LIMIT 1`)
      .get(sender);
    return row !== undefined;
  }

  async recordQuarantine(record: QuarantinedRecord): Promise<void> {
    this.db
      .prepare(`INSERT INTO quarantine (raw_record_hash, source, reason, quarantined_at) VALUES (?, ?, ?, ?)`)
      .run(record.rawRecordHash, record.source, record.reason, record.quarantinedAt.toISOString());
  }

  async listQuarantined(): Promise<QuarantinedRecord[]> {
    const rows = this.db.prepare(`SELECT * FROM quarantine ORDER BY quarantined_at ASC`).all() as QuarantineRow[];
    return rows.map((row) => ({
      rawRecordHash: row.raw_record_hash,
      source: row.source as QuarantinedRecord["source"],
      reason: row.reason,
      quarantinedAt: new Date(row.quarantined_at),
    }));
  }

  private rowToMessage(row: MessageRow): Message {
    const message: Message = {
      id: row.message_id,
      rawRecordHash: row.raw_record_hash,
      source: row.source as Message["source"],
      threadId: row.thread_id,
      sender: row.sender,
      fromSelf: row.from_self === 1,
      text: this.key.decrypt(row.text).toString("utf8"),
      sentAt: new Date(row.sent_at),
      provenance: row.provenance as Message["provenance"],
    };
    if (row.edit_history) {
      const decoded = JSON.parse(this.key.decrypt(row.edit_history).toString("utf8")) as Array<{
        text: string;
        editedAt: string;
      }>;
      message.editHistory = decoded.map((e) => ({ text: e.text, editedAt: new Date(e.editedAt) }));
    }
    if (row.retracted_at) {
      message.retractedAt = new Date(row.retracted_at);
    }
    return message;
  }
}

interface MessageRow {
  message_id: string;
  raw_record_hash: string;
  source: string;
  thread_id: string;
  sender: string;
  from_self: number;
  text: Buffer;
  sent_at: string;
  provenance: string;
  edit_history: Buffer | null;
  retracted_at: string | null;
  crosses_abuse_threshold: number;
  toxicity_score: number;
  appended_at: string;
}

interface RawRecordRow {
  hash: string;
  source: string;
  payload: Buffer;
  acquired_at: string;
  parser_version: string;
}

interface QuarantineRow {
  raw_record_hash: string;
  source: string;
  reason: string;
  quarantined_at: string;
}

interface ThreadSummaryRow {
  thread_id: string;
  sender: string;
  latest_message_id: string;
  latest_text: Buffer;
  latest_sent_at: string;
  message_count: number;
  max_toxicity_score: number;
  crosses_abuse_threshold: number;
}
