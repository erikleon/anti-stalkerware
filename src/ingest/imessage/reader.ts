import Database from "better-sqlite3";
import { parseBuffer } from "bplist-parser";
import type { Message, RawRecord } from "../../types/message";
import type { IngestResult } from "../adapter";
import { hashPayload } from "../hash";
import { quarantine } from "../quarantine";
import { serializeRow } from "./row-serialize";
import { appleTimestampToDate } from "./schema";
import { parseSummaryInfo } from "./summary-info";
import { resolveKeyedArchiveRoot, isKeyedArchive } from "./keyed-archive";

const LOCK_RETRY_DELAYS_MS = [50, 100, 250, 500, 1000];

/**
 * Opens chat.db read-only. Never opens it for writing — this app has no
 * legitimate reason to modify the person's Messages database, and doing
 * so read-write would risk corrupting it for Messages.app itself.
 *
 * Retries on SQLITE_BUSY: Messages.app can hold a brief exclusive lock
 * mid-write, and WAL mode's checkpoint operations can also briefly block a
 * reader. A locked database on one attempt is expected, not an error to
 * surface — it should just mean "try again shortly," not "ingest failed."
 */
export async function openChatDbReadOnly(dbPath: string): Promise<Database.Database> {
  let lastError: unknown;
  for (const delayMs of [0, ...LOCK_RETRY_DELAYS_MS]) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      db.defaultSafeIntegers(true);
      return db;
    } catch (err) {
      lastError = err;
      if (!isBusyError(err)) throw err;
    }
  }
  throw lastError;
}

function isBusyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "SQLITE_BUSY";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Column order for the `message` table, read at runtime rather than assumed — chat.db's schema can drift across OS versions. */
export function getMessageColumns(db: Database.Database): string[] {
  const rows = db.prepare("PRAGMA table_info(message)").all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

interface JoinedRow {
  ROWID: bigint;
  guid: string;
  text: string | null;
  attributedBody: Buffer | null;
  is_from_me: bigint;
  date: bigint;
  date_edited: bigint | null;
  is_deleted: bigint;
  message_summary_info: Buffer | null;
  associated_message_type: bigint;
  chat_identifier: string;
  handle_identifier: string | null;
}

/**
 * Reads messages newer than `sinceRowId` from the given chat threads only —
 * ingest is scoped to threads the user selected, not the whole message
 * history. Yields a `message` result for anything we can normalize, or a
 * `quarantined` result for anything we can't, in ROWID order so the caller
 * can checkpoint incrementally.
 */
export async function* readNewMessages(
  db: Database.Database,
  selectedThreadIdentifiers: string[],
  sinceRowId: bigint,
): AsyncGenerator<IngestResult> {
  if (selectedThreadIdentifiers.length === 0) return;

  const placeholders = selectedThreadIdentifiers.map(() => "?").join(",");
  const stmt = db.prepare(`
    SELECT
      m.ROWID, m.guid, m.text, m.attributedBody, m.is_from_me,
      m.date, m.date_edited, m.is_deleted, m.message_summary_info, m.associated_message_type,
      c.chat_identifier, h.id as handle_identifier
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    LEFT JOIN handle h ON h.ROWID = m.handle_id
    WHERE c.chat_identifier IN (${placeholders})
      AND m.ROWID > ?
      AND m.associated_message_type = 0
    ORDER BY m.ROWID ASC
  `);

  for (const row of stmt.iterate(...selectedThreadIdentifiers, sinceRowId) as IterableIterator<JoinedRow>) {
    yield normalizeRow(row);
  }
}

function normalizeRow(row: JoinedRow): IngestResult {
  const payload = serializeRow(row as unknown as Record<string, unknown>);
  const raw: RawRecord = {
    id: row.guid,
    source: "imessage",
    payload,
    acquiredAt: new Date(),
    hash: hashPayload(payload),
    parserVersion: "1",
  };

  const text = extractText(row);
  if (text === undefined) {
    return {
      kind: "quarantined",
      raw,
      quarantine: quarantine(raw, "imessage", "no text column and attributedBody did not resolve to a string"),
    };
  }

  const message: Message = {
    id: row.guid,
    rawRecordHash: raw.hash,
    source: "imessage",
    threadId: row.chat_identifier,
    sender: row.handle_identifier ?? "unknown",
    fromSelf: row.is_from_me === 1n,
    text,
    sentAt: appleTimestampToDate(row.date),
    provenance: "live",
  };

  if (row.is_deleted === 1n) {
    message.retractedAt = message.sentAt;
  }

  if (row.date_edited && row.date_edited > 0n && row.message_summary_info) {
    const parsed = parseSummaryInfo(row.message_summary_info);
    if (parsed.ok && parsed.edits.length > 0) {
      message.editHistory = parsed.edits.map((e) => ({ text: e.text, editedAt: e.editedAt }));
    }
    // A parse failure here doesn't quarantine the whole message — we still
    // have its current, valid text. It just means the prior revisions
    // before the last edit aren't recoverable from this field.
  }

  return { kind: "message", raw, message };
}

/**
 * Prefers the plain text column; falls back to the archived NSAttributedString
 * in attributedBody when a message stores rich content there instead.
 *
 * Deliberately narrow: looks only for the top-level NSString key an
 * archived NSAttributedString stores its plain text under, not a generic
 * "first string anywhere in the graph" search. The same archive also
 * holds an NSAttributes graph full of font names and paragraph styles —
 * walking the whole structure for any string risks silently returning a
 * font name as if it were the message. Returns undefined rather than
 * guess when the expected key isn't there.
 */
function extractText(row: JoinedRow): string | undefined {
  if (row.text !== null) return row.text;
  if (!row.attributedBody) return undefined;

  try {
    const [parsed] = parseBuffer(row.attributedBody);
    const root = isKeyedArchive(parsed) ? resolveKeyedArchiveRoot(parsed) : parsed;
    if (typeof root !== "object" || root === null) return undefined;
    const nsString = (root as Record<string, unknown>)["NSString"];
    return typeof nsString === "string" ? nsString : undefined;
  } catch {
    return undefined;
  }
}
