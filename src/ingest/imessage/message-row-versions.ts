import { recoverRowsFromWal } from "./sqlite-format/wal-recovery";
import type { ColumnValue } from "./sqlite-format/record";

export interface RecoveredMessageRow {
  rowid: number;
  columns: Record<string, ColumnValue>;
}

/**
 * Extracts every historical version of every `message` table row found in
 * a WAL file. A WAL frame only carries a page number, not a table name, so
 * rows are matched to the `message` table by column count — the same
 * disambiguation the wal-recovery tests rely on, since ROWIDs are per-table
 * and a coincidental match against, say, sqlite_master's row 1 is otherwise
 * indistinguishable by rowid alone. Not airtight (another table with the
 * same column count would also pass), but combined with the caller
 * checking the recovered rowid against message IDs it already knows about,
 * it's a reasonable filter for what's meant to be a best-effort recovery
 * path, not a database migrator.
 */
export function extractMessageRowVersions(walBuffer: Buffer, messageColumnNames: string[]): RecoveredMessageRow[] {
  const results: RecoveredMessageRow[] = [];
  for (const row of recoverRowsFromWal(walBuffer)) {
    if (row.incomplete) continue;
    if (row.columns.length !== messageColumnNames.length) continue;

    const columns: Record<string, ColumnValue> = {};
    messageColumnNames.forEach((name, i) => {
      columns[name] = row.columns[i] ?? null;
    });
    results.push({ rowid: row.rowid, columns });
  }
  return results;
}
