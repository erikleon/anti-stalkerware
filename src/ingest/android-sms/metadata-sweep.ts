import type { MetadataSweepResult } from "../adapter";
import { normalizePhoneNumber, parseSmsXml } from "./reader";

/**
 * Scans every SMS in the export file, not just addresses the user has
 * already selected — sender, message count, and first/last-seen time
 * only. Mirrors imessage/metadata-sweep.ts's contract: no message text,
 * no vault write. This is how onboarding shows "here's everyone in this
 * export" before the user picks who to actually import.
 */
export function sweepAndroidSmsExport(xml: Buffer): MetadataSweepResult[] {
  const { smsElements } = parseSmsXml(xml);

  const byAddress = new Map<string, { rawAddress: string; count: number; first: number; last: number }>();
  for (const sms of smsElements) {
    if (!sms.address || !sms.date) continue;
    const normalized = normalizePhoneNumber(sms.address);
    const dateMs = Number(sms.date);
    if (!Number.isFinite(dateMs)) continue;

    const existing = byAddress.get(normalized);
    if (existing) {
      existing.count++;
      existing.first = Math.min(existing.first, dateMs);
      existing.last = Math.max(existing.last, dateMs);
    } else {
      byAddress.set(normalized, { rawAddress: sms.address, count: 1, first: dateMs, last: dateMs });
    }
  }

  return [...byAddress.values()].map((v) => ({
    sender: v.rawAddress,
    messageCount: v.count,
    firstSeenAt: new Date(v.first),
    lastSeenAt: new Date(v.last),
  }));
}
