import type Database from "better-sqlite3";
import type { AppendClassification } from "./store";

/**
 * Writes model scores to the message_scores table (schema in
 * sqlite-store.ts, which reads it). A score is derived metadata: running a
 * newer model replaces it, and nothing about the message or its evidence
 * hash changes. Kept out of SqliteVaultStore so that class has no way to
 * modify any row it stores.
 */
export class MessageScoreStore {
  constructor(private readonly db: Database.Database) {}

  set(messageId: string, rawRecordHash: string, classification: AppendClassification, scoredBy: string): void {
    this.db
      .prepare(
        `INSERT INTO message_scores (message_id, raw_record_hash, toxicity_score, crosses_abuse_threshold, label, scored_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (message_id, raw_record_hash) DO UPDATE SET
           toxicity_score = excluded.toxicity_score,
           crosses_abuse_threshold = excluded.crosses_abuse_threshold,
           label = excluded.label,
           scored_by = excluded.scored_by`,
      )
      .run(
        messageId,
        rawRecordHash,
        classification.toxicityScore ?? 0,
        classification.crossesAbuseThreshold ? 1 : 0,
        classification.label ?? null,
        scoredBy,
      );
  }
}
