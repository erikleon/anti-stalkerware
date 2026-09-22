import { createHash } from "node:crypto";

/**
 * Hashes a raw record's payload at the moment of acquisition. This proves
 * the bytes we captured haven't changed since we captured them — nothing
 * more. It does not prove the source database was authentic, that the
 * device clock was correct, or that the record wasn't altered before our
 * app ever read it. Export documentation must say exactly this and no more.
 */
export function hashPayload(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}
