import type Database from "better-sqlite3";
import type { MetadataSweepResult } from "../adapter";
import { appleTimestampToDate } from "./schema";

interface SweepRow {
  handle_identifier: string | null;
  message_count: bigint;
  first_seen: bigint;
  last_seen: bigint;
}

/**
 * Scans every thread in chat.db, not just the ones the user selected —
 * sender identifier, message count, and first/last-seen time only. No
 * message text, no vault write. This is how an unknown number or a burner
 * account gets surfaced as worth adding, without paying the cost (in time
 * or in what ends up stored) of classifying a full history nobody asked
 * to import.
 */
export function sweepMessageMetadata(db: Database.Database): MetadataSweepResult[] {
  const rows = db
    .prepare(
      `
      SELECT
        h.id as handle_identifier,
        COUNT(*) as message_count,
        MIN(m.date) as first_seen,
        MAX(m.date) as last_seen
      FROM message m
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.is_from_me = 0 AND m.associated_message_type = 0
      GROUP BY h.id
    `,
    )
    .all() as SweepRow[];

  return rows
    .filter((row): row is SweepRow & { handle_identifier: string } => row.handle_identifier !== null)
    .map((row) => ({
      sender: row.handle_identifier,
      messageCount: Number(row.message_count),
      firstSeenAt: appleTimestampToDate(row.first_seen),
      lastSeenAt: appleTimestampToDate(row.last_seen),
    }));
}
