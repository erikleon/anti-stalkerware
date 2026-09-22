import { walChecksum, type ChecksumState } from "./checksum";

const WAL_HEADER_SIZE = 32;
const FRAME_HEADER_SIZE = 24;
const MAGIC_BIG_ENDIAN = 0x377f0683;
const MAGIC_LITTLE_ENDIAN = 0x377f0682;

export interface WalHeader {
  bigEndianChecksums: boolean;
  pageSize: number;
  salt1: number;
  salt2: number;
}

export interface WalFrame {
  pageNumber: number;
  /** Non-zero (the DB size in pages after commit) if this frame ends a transaction. */
  commitDbSizePages: number;
  pageData: Buffer;
}

/**
 * Parses a WAL file's 32-byte header and validates its own checksum. A
 * mismatch here means the bytes we have aren't a well-formed WAL header —
 * we refuse to read anything further from the file rather than guess at a
 * page size or salt that might be garbage.
 */
export function parseWalHeader(buffer: Buffer): WalHeader | undefined {
  if (buffer.length < WAL_HEADER_SIZE) return undefined;

  const magic = buffer.readUInt32BE(0);
  let bigEndianChecksums: boolean;
  if (magic === MAGIC_BIG_ENDIAN) {
    bigEndianChecksums = true;
  } else if (magic === MAGIC_LITTLE_ENDIAN) {
    bigEndianChecksums = false;
  } else {
    return undefined;
  }

  const pageSize = buffer.readUInt32BE(8);
  const salt1 = buffer.readUInt32BE(16);
  const salt2 = buffer.readUInt32BE(20);
  const expectedChecksum1 = buffer.readUInt32BE(24);
  const expectedChecksum2 = buffer.readUInt32BE(28);

  const { s0, s1 } = walChecksum(buffer.subarray(0, 24), bigEndianChecksums);
  if (s0 !== expectedChecksum1 || s1 !== expectedChecksum2) {
    return undefined;
  }

  return { bigEndianChecksums, pageSize, salt1, salt2 };
}

/**
 * Iterates every valid frame in a WAL file, in file order — including
 * older, superseded versions of a page, not just the current one. This is
 * the point: a page's earlier version, still physically present in the
 * WAL before a checkpoint truncates it away, can hold a message's text
 * from before it was retracted.
 *
 * Stops at the first frame that fails checksum or salt validation, which
 * is the normal, expected way a WAL file ends — either a partially
 * written trailing frame from a transaction still in progress, or the
 * boundary of a checkpoint generation.
 */
export function* readWalFrames(buffer: Buffer, header: WalHeader): Generator<WalFrame> {
  let checksum: ChecksumState = walChecksum(buffer.subarray(0, 24), header.bigEndianChecksums);
  let offset = WAL_HEADER_SIZE;
  const frameSize = FRAME_HEADER_SIZE + header.pageSize;

  while (offset + frameSize <= buffer.length) {
    const frameHeader = buffer.subarray(offset, offset + FRAME_HEADER_SIZE);
    const pageNumber = frameHeader.readUInt32BE(0);
    const commitDbSizePages = frameHeader.readUInt32BE(4);
    const salt1 = frameHeader.readUInt32BE(8);
    const salt2 = frameHeader.readUInt32BE(12);
    const expectedChecksum1 = frameHeader.readUInt32BE(16);
    const expectedChecksum2 = frameHeader.readUInt32BE(20);

    if (salt1 !== header.salt1 || salt2 !== header.salt2) {
      return;
    }

    const pageData = buffer.subarray(offset + FRAME_HEADER_SIZE, offset + frameSize);
    checksum = walChecksum(frameHeader.subarray(0, 8), header.bigEndianChecksums, checksum);
    checksum = walChecksum(pageData, header.bigEndianChecksums, checksum);

    if (checksum.s0 !== expectedChecksum1 || checksum.s1 !== expectedChecksum2) {
      return;
    }

    yield { pageNumber, commitDbSizePages, pageData };
    offset += frameSize;
  }
}
