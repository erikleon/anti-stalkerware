import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import type { IngestAdapter, IngestResult } from "../adapter";
import { openChatDbReadOnly, readNewMessages, getMessageColumns } from "./reader";
import { watchWalFile, type WalWatcherHandle } from "./wal-watcher";
import { extractMessageRowVersions } from "./message-row-versions";

export interface ImessageAdapterOptions {
  dbPath: string;
  /** chat_identifier values the user selected during onboarding — ingest is scoped, not full-history. */
  selectedThreadIdentifiers: string[];
}

/**
 * The pull-based half of iMessage ingest: catch-up reads of new messages
 * since the last checkpoint, satisfying the IngestAdapter contract shared
 * with the Android SMS and IMAP sources.
 */
export class ImessageAdapter implements IngestAdapter {
  readonly source = "imessage" as const;

  constructor(private readonly options: ImessageAdapterOptions) {}

  async *acquire(sinceCheckpoint: string | undefined): AsyncIterable<IngestResult> {
    const db = await openChatDbReadOnly(this.options.dbPath);
    try {
      const sinceRowId = sinceCheckpoint ? BigInt(sinceCheckpoint) : 0n;
      yield* readNewMessages(db, this.options.selectedThreadIdentifiers, sinceRowId);
    } finally {
      db.close();
    }
  }
}

export interface RecoveredRetraction {
  rowid: number;
  /** The row's columns as recovered from an older WAL frame, keyed by the message table's column names. */
  columns: Record<string, unknown>;
}

/**
 * The event-driven half: watches for retracted-message content that a
 * normal `acquire()` read can never see, because by the time a retraction
 * lands, the live database already shows the message as deleted. This
 * doesn't fit IngestAdapter's pull-based "new records since a checkpoint"
 * shape — it's fundamentally "something happened, go look" — so it's kept
 * as its own capability rather than bent to match an interface it isn't.
 *
 * Best-effort: only catches a retraction if this watcher was already
 * running when it happened, and only recovers rows whose payload didn't
 * overflow a page. See wal-watcher.ts and message-row-versions.ts for what
 * that leaves out.
 */
export interface WatchForRetractionsOptions {
  pollIntervalMs?: number;
  debounceMs?: number;
}

export function watchForRetractions(
  db: Database.Database,
  walPath: string,
  onRecovered: (rows: RecoveredRetraction[]) => void,
  options: WatchForRetractionsOptions = {},
): WalWatcherHandle {
  const columnNames = getMessageColumns(db);

  return watchWalFile({
    walPath,
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    onActivity: () => {
      let walBuffer: Buffer;
      try {
        walBuffer = readFileSync(walPath);
      } catch {
        return;
      }
      const versions = extractMessageRowVersions(walBuffer, columnNames);
      if (versions.length > 0) {
        onRecovered(versions.map((v) => ({ rowid: v.rowid, columns: v.columns })));
      }
    },
  });
}
