import type { VaultStore } from "./store";
import type { Message } from "../types/message";
import { zonedTimestamp } from "../time/local-time";

/** Every message across every thread, for the Vault/Export screen — vault.list() is scoped to one thread at a time, so this fans out over listThreads(). */
export async function listAllMessages(vault: VaultStore): Promise<Message[]> {
  const threads = await vault.listThreads();
  const all: Message[] = [];
  for (const thread of threads) {
    all.push(...(await vault.list(thread.threadId)));
  }
  return all;
}

/** Canonical wording for what an export's acquisition-time hash proves and doesn't — see integrity.ts's verifyIntegrity doc comment. Every export screen and file must carry this exact text, not a paraphrase that risks overselling it. */
export const EXPORT_DISCLOSURE_TEXT =
  "This export's acquisition-time hash proves the captured bytes haven't changed since capture. " +
  "It does not prove the original source was authentic, that the sending device's clock was correct, " +
  "or that this export is complete. Treat it as a preserved copy, not a certified record.";

export interface ExportPayload {
  disclosure: string;
  exportedAt: string;
  /** The IANA time zone the `*Local` fields are written in: the exporting machine's. */
  timeZone: string;
  messages: Array<{
    id: string;
    threadId: string;
    sender: string;
    fromSelf: boolean;
    text: string;
    /** UTC, exactly as stored. */
    sentAt: string;
    /** The same instant as the local time it was on this device, with offset and zone ("2026-09-23T21:00:00.000-04:00[America/New_York]"). Absent only before 1970. */
    sentAtLocal?: string;
    provenance: string;
    rawRecordHash: string;
  }>;
}

/** Pure transform from vault messages to the on-disk export shape, kept separate from actually writing the file so it's testable without touching a filesystem or Electron's save dialog. */
export function buildExportPayload(messages: Message[], timeZone: string): ExportPayload {
  return {
    disclosure: EXPORT_DISCLOSURE_TEXT,
    exportedAt: new Date().toISOString(),
    timeZone,
    messages: messages.map((m) => {
      const sentAtLocal = zonedTimestamp(m.sentAt, timeZone);
      return {
        id: m.id,
        threadId: m.threadId,
        sender: m.sender,
        fromSelf: m.fromSelf,
        text: m.text,
        sentAt: m.sentAt.toISOString(),
        ...(sentAtLocal ? { sentAtLocal } : {}),
        provenance: m.provenance,
        rawRecordHash: m.rawRecordHash,
      };
    }),
  };
}
