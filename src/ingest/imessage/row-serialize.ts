/**
 * Deterministic byte serialization of a raw SQL row, for hashing. This is
 * not a byte-for-byte disk capture — it's a canonical encoding of the
 * column values we read via a normal query. The hash over it proves those
 * values haven't changed since we read them, nothing more; see
 * vault/integrity.ts for what an acquisition-time hash does and doesn't
 * establish.
 */
export function serializeRow(row: Record<string, unknown>): Buffer {
  const keys = Object.keys(row).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of keys) {
    canonical[key] = encodeValue(row[key]);
  }
  return Buffer.from(JSON.stringify(canonical), "utf8");
}

function encodeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (Buffer.isBuffer(value)) {
    return { $hex: value.toString("hex") };
  }
  return value;
}
