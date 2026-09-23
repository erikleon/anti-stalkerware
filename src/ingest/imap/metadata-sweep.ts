import type { MetadataSweepResult } from "../adapter";
import type { MessageFetcher } from "./reader";

/**
 * Scans every message in the mailbox for its sender and date only —
 * envelope data, never the message source/body — so onboarding can show
 * "here's everyone who's emailed this account" before the user picks who
 * to actually import. Mirrors imessage/metadata-sweep.ts and
 * android-sms/metadata-sweep.ts's contract: no content, no vault write.
 */
export async function sweepImapSenders(client: MessageFetcher, range = "1:*"): Promise<MetadataSweepResult[]> {
  const byAddress = new Map<string, { count: number; first: Date; last: Date }>();

  for await (const msg of client.fetch(range, { uid: false, source: false, envelope: true })) {
    const from = msg.envelope?.from?.[0];
    if (!from?.address) continue;
    const address = from.address.toLowerCase();
    const date = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();

    const existing = byAddress.get(address);
    if (existing) {
      existing.count++;
      if (date < existing.first) existing.first = date;
      if (date > existing.last) existing.last = date;
    } else {
      byAddress.set(address, { count: 1, first: date, last: date });
    }
  }

  return [...byAddress.entries()].map(([sender, v]) => ({
    sender,
    messageCount: v.count,
    firstSeenAt: v.first,
    lastSeenAt: v.last,
  }));
}
