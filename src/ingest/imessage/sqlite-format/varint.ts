/**
 * SQLite's variable-length integer encoding: up to 9 bytes, the high bit
 * of each of the first 8 bytes signals continuation, and all 8 bits of a
 * 9th byte are used if present. Returns the decoded value (as a plain JS
 * number — SQLite row counts and small integer columns never approach
 * Number.MAX_SAFE_INTEGER in practice here) and how many bytes it consumed.
 */
export function readVarint(buffer: Buffer, offset: number): { value: number; length: number } {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const byte = buffer[offset + i];
    if (byte === undefined) {
      throw new Error(`varint read past end of buffer at offset ${offset + i}`);
    }
    result = result * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value: result, length: i + 1 };
    }
  }
  const ninthByte = buffer[offset + 8];
  if (ninthByte === undefined) {
    throw new Error(`varint read past end of buffer at offset ${offset + 8}`);
  }
  result = result * 256 + ninthByte;
  return { value: result, length: 9 };
}
