import { parseWalHeader, readWalFrames } from "./wal-frames";
import { parseLeafPage, isUnparseableCell, type LeafCell } from "./leaf-page";
import type { ColumnValue } from "./record";

export interface RecoveredRow {
  rowid: number;
  /** Column values in table-definition order — the caller maps these to names via PRAGMA table_info. */
  columns: ColumnValue[];
  /** True if this cell's payload overflowed the page and couldn't be fully decoded. */
  incomplete: boolean;
}

/**
 * Walks every valid frame in a WAL file and returns every row version it
 * can decode from a table-leaf page — not just the current one. A page
 * can appear multiple times across a WAL file as it's rewritten by
 * successive transactions; each occurrence is a snapshot of that page at
 * that point in time, and an older one can still hold a row's pre-edit or
 * pre-retraction content even after a newer frame has superseded it.
 *
 * This has no idea which table a page belongs to — WAL frames only carry
 * page numbers, not table names. The caller matches rows back to known
 * message ROWIDs and a known column count/shape to decide which recovered
 * rows are plausibly from the `message` table.
 */
export function* recoverRowsFromWal(walBuffer: Buffer): Generator<RecoveredRow> {
  const header = parseWalHeader(walBuffer);
  if (!header) return;

  for (const frame of readWalFrames(walBuffer, header)) {
    const cells = parseLeafPage(frame.pageData, frame.pageNumber);
    if (!cells) continue;

    for (const cell of cells) {
      if (isUnparseableCell(cell)) {
        yield { rowid: cell.rowid, columns: [], incomplete: true };
      } else {
        yield { rowid: (cell as LeafCell).rowid, columns: (cell as LeafCell).columns, incomplete: false };
      }
    }
  }
}
