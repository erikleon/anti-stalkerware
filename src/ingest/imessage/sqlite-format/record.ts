import { readVarint } from "./varint";

/**
 * A decoded SQLite record column value. 8-byte integers (serial type 6) are
 * bigint — chat.db's nanosecond timestamps exceed Number.MAX_SAFE_INTEGER,
 * so silently narrowing to a JS number would corrupt them.
 */
export type ColumnValue = null | number | bigint | string | Buffer;

/**
 * Decodes a SQLite record (the record-header + body format used inside a
 * table cell's payload) into an ordered list of column values, per
 * https://www.sqlite.org/fileformat2.html#record_format.
 */
export function decodeRecord(payload: Buffer): ColumnValue[] {
  const { value: headerSize, length: headerSizeLen } = readVarint(payload, 0);
  const serialTypes: number[] = [];
  let offset = headerSizeLen;
  while (offset < headerSize) {
    const { value, length } = readVarint(payload, offset);
    serialTypes.push(value);
    offset += length;
  }

  const values: ColumnValue[] = [];
  let bodyOffset = headerSize;
  for (const serialType of serialTypes) {
    const { value, size } = decodeSerialValue(payload, bodyOffset, serialType);
    values.push(value);
    bodyOffset += size;
  }
  return values;
}

function decodeSerialValue(buffer: Buffer, offset: number, serialType: number): { value: ColumnValue; size: number } {
  switch (serialType) {
    case 0:
      return { value: null, size: 0 };
    case 1:
      return { value: buffer.readInt8(offset), size: 1 };
    case 2:
      return { value: buffer.readInt16BE(offset), size: 2 };
    case 3:
      return { value: readInt24BE(buffer, offset), size: 3 };
    case 4:
      return { value: buffer.readInt32BE(offset), size: 4 };
    case 5:
      return { value: readInt48BE(buffer, offset), size: 6 };
    case 6:
      return { value: buffer.readBigInt64BE(offset), size: 8 };
    case 7:
      return { value: buffer.readDoubleBE(offset), size: 8 };
    case 8:
      return { value: 0, size: 0 };
    case 9:
      return { value: 1, size: 0 };
    default: {
      if (serialType >= 12 && serialType % 2 === 0) {
        const size = (serialType - 12) / 2;
        return { value: buffer.subarray(offset, offset + size), size };
      }
      if (serialType >= 13 && serialType % 2 === 1) {
        const size = (serialType - 13) / 2;
        return { value: buffer.toString("utf8", offset, offset + size), size };
      }
      throw new Error(`unsupported or reserved serial type ${serialType}`);
    }
  }
}

function readInt24BE(buffer: Buffer, offset: number): number {
  const unsigned = (buffer[offset]! << 16) | (buffer[offset + 1]! << 8) | buffer[offset + 2]!;
  return unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
}

function readInt48BE(buffer: Buffer, offset: number): number {
  const high = buffer.readInt16BE(offset);
  const low = buffer.readUInt32BE(offset + 2);
  return high * 2 ** 32 + low;
}
