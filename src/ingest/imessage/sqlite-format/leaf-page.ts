import { readVarint } from "./varint";
import { decodeRecord, type ColumnValue } from "./record";

const LEAF_TABLE_PAGE_TYPE = 0x0d;

export interface LeafCell {
  rowid: number;
  columns: ColumnValue[];
}

export interface UnparseableCell {
  rowid: number;
  reason: "payload-overflows-page";
}

/**
 * Parses a table b-tree leaf page (type 0x0d) into its cells. Returns
 * `undefined` for anything that isn't a leaf table page — an interior
 * page, an index page, a freelist page, or simply a page we captured mid
 * write that doesn't parse as a sane header. Assumes zero reserved bytes
 * per page, which holds for chat.db (no page-level encryption extension
 * in use); a page whose declared cell offsets don't fit this assumption
 * fails the same way a wrong page type would.
 */
export function parseLeafPage(pageBuffer: Buffer, pageNumber: number): (LeafCell | UnparseableCell)[] | undefined {
  const headerStart = pageNumber === 1 ? 100 : 0;
  if (pageBuffer.length <= headerStart + 8) return undefined;

  const pageType = pageBuffer[headerStart];
  if (pageType !== LEAF_TABLE_PAGE_TYPE) return undefined;

  const cellCount = pageBuffer.readUInt16BE(headerStart + 3);
  const cellPointerArrayStart = headerStart + 8;
  const usableSize = pageBuffer.length;
  // Per the SQLite file format spec's table-leaf-cell overflow rule.
  const maxLocalPayload = usableSize - 35;

  const cells: (LeafCell | UnparseableCell)[] = [];
  for (let i = 0; i < cellCount; i++) {
    const pointerOffset = cellPointerArrayStart + i * 2;
    if (pointerOffset + 2 > pageBuffer.length) return undefined;
    const cellOffset = pageBuffer.readUInt16BE(pointerOffset);
    if (cellOffset === 0 || cellOffset >= pageBuffer.length) return undefined;

    try {
      const { value: payloadSize, length: payloadSizeLen } = readVarint(pageBuffer, cellOffset);
      const { value: rowid, length: rowidLen } = readVarint(pageBuffer, cellOffset + payloadSizeLen);
      const payloadStart = cellOffset + payloadSizeLen + rowidLen;

      if (payloadSize > maxLocalPayload) {
        cells.push({ rowid, reason: "payload-overflows-page" });
        continue;
      }

      const payload = pageBuffer.subarray(payloadStart, payloadStart + payloadSize);
      if (payload.length !== payloadSize) return undefined;

      cells.push({ rowid, columns: decodeRecord(payload) });
    } catch {
      // A cell we can't decode means this isn't really a leaf page in the
      // shape we expect — treat the whole page as unparseable rather than
      // return a partial, possibly-misaligned cell list.
      return undefined;
    }
  }
  return cells;
}

export function isUnparseableCell(cell: LeafCell | UnparseableCell): cell is UnparseableCell {
  return "reason" in cell;
}
