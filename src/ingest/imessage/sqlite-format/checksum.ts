/**
 * SQLite's WAL checksum algorithm, per the file format spec
 * (https://www.sqlite.org/fileformat2.html#walformat). Used both to
 * validate the WAL header and to carry a running checksum across frames —
 * a frame whose stored checksum doesn't match what we compute is not
 * trusted, full stop. Recovering a retracted message's text is only worth
 * doing if we're confident the bytes are genuine; a checksum mismatch
 * means we skip the frame rather than guess.
 */
export interface ChecksumState {
  s0: number;
  s1: number;
}

function add32(a: number, b: number): number {
  return (a + b) >>> 0;
}

/**
 * Runs the checksum over `data`, which must have a length that's a
 * multiple of 8 bytes. `bigEndian` comes from the WAL header's magic
 * number: 0x377f0683 means big-endian input words, 0x377f0682 means
 * little-endian. The output is always expressed as plain numbers, stored
 * big-endian by the caller when writing (we only ever read).
 */
export function walChecksum(data: Buffer, bigEndian: boolean, initial: ChecksumState = { s0: 0, s1: 0 }): ChecksumState {
  if (data.length % 8 !== 0) {
    throw new Error(`walChecksum input length must be a multiple of 8, got ${data.length}`);
  }
  let { s0, s1 } = initial;
  for (let offset = 0; offset < data.length; offset += 8) {
    const x0 = bigEndian ? data.readUInt32BE(offset) : data.readUInt32LE(offset);
    const x1 = bigEndian ? data.readUInt32BE(offset + 4) : data.readUInt32LE(offset + 4);
    s0 = add32(s0, add32(x0, s1));
    s1 = add32(s1, add32(x1, s0));
  }
  // `>>> 0`, not `& MASK`: JS's `&` converts operands to signed Int32, so a
  // mask would silently flip any value with the high bit set back negative.
  return { s0: s0 >>> 0, s1: s1 >>> 0 };
}
