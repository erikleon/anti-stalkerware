import type { MetadataSweepResult } from "../adapter";
import { decodeMetaString, type InstagramExport } from "./reader";

/**
 * Every sender in the export except the owner — message count and
 * first/last-seen time only, no text, no vault write. Same contract as
 * the other sources' sweeps. For a one-to-one thread, the thread folder
 * name is attached as an alias: it's often the other person's username,
 * which is what a blocked-accounts list holds.
 */
export function sweepInstagramExport(exp: InstagramExport): MetadataSweepResult[] {
  const bySender = new Map<string, { count: number; first: number; last: number; aliases: Set<string> }>();

  for (const thread of exp.threads) {
    const others = thread.participants.filter((p) => p !== exp.ownerName);
    for (const message of thread.messages) {
      if (typeof message.sender_name !== "string" || typeof message.timestamp_ms !== "number") continue;
      const sender = decodeMetaString(message.sender_name);
      if (sender === exp.ownerName) continue;
      const entry = bySender.get(sender) ?? { count: 0, first: Infinity, last: -Infinity, aliases: new Set<string>() };
      entry.count++;
      entry.first = Math.min(entry.first, message.timestamp_ms);
      entry.last = Math.max(entry.last, message.timestamp_ms);
      if (others.length === 1 && thread.folderAlias.length > 0) entry.aliases.add(thread.folderAlias);
      bySender.set(sender, entry);
    }
  }

  return [...bySender.entries()].map(([sender, v]) => ({
    sender,
    messageCount: v.count,
    firstSeenAt: new Date(v.first),
    lastSeenAt: new Date(v.last),
    ...(v.aliases.size > 0 ? { aliases: [...v.aliases] } : {}),
  }));
}
