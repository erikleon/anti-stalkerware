import { parseBuffer } from "bplist-parser";
import { isKeyedArchive, resolveKeyedArchiveRoot } from "./keyed-archive";

export interface EditRevision {
  text: string;
  editedAt: Date;
}

export type SummaryInfoParseResult =
  | { ok: true; edits: EditRevision[] }
  | { ok: false; reason: string };

/**
 * Parses chat.db's message_summary_info blob for edit chronology. When a
 * message has been edited, prior revisions live under an "ec" key inside
 * this bplist, archived as an NSKeyedArchiver graph in current macOS
 * versions.
 *
 * The exact shape of each revision entry inside "ec" is not something this
 * codebase has verified against a real macOS-produced sample — public
 * forensic research confirms the field's existence and general purpose but
 * not its precise key names. This function is deliberately conservative:
 * it looks for recognizable text/timestamp fields and returns a typed
 * failure the caller must quarantine when the shape doesn't match, rather
 * than silently returning wrong or empty data. Treat every "ok: true"
 * result here as unverified until it's been checked against a real
 * captured fixture.
 */
export function parseSummaryInfo(blob: Buffer): SummaryInfoParseResult {
  let parsed: unknown;
  try {
    [parsed] = parseBuffer(blob);
  } catch (err) {
    return { ok: false, reason: `bplist parse failed: ${(err as Error).message}` };
  }

  const root = isKeyedArchive(parsed) ? resolveKeyedArchiveRoot(parsed) : parsed;
  if (typeof root !== "object" || root === null) {
    return { ok: false, reason: "root is not a dictionary" };
  }

  const ec = (root as Record<string, unknown>)["ec"];
  if (ec === undefined) {
    // No edit chronology present is normal — most messages were never edited.
    return { ok: true, edits: [] };
  }
  if (!Array.isArray(ec)) {
    return { ok: false, reason: "ec field is not an array" };
  }

  const edits: EditRevision[] = [];
  for (const entry of ec) {
    const revision = extractRevision(entry);
    if (revision === undefined) {
      return { ok: false, reason: "an ec entry did not match any known revision shape" };
    }
    edits.push(revision);
  }
  return { ok: true, edits };
}

function extractRevision(entry: unknown): EditRevision | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const dict = entry as Record<string, unknown>;
  const text = firstStringValue(dict, ["t", "text", "NS.string"]);
  const rawDate = firstNumberValue(dict, ["d", "date", "editDate"]);
  if (text === undefined || rawDate === undefined) {
    return undefined;
  }
  return { text, editedAt: new Date(rawDate) };
}

function firstStringValue(dict: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof dict[key] === "string") return dict[key] as string;
  }
  return undefined;
}

function firstNumberValue(dict: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (typeof dict[key] === "number") return dict[key] as number;
  }
  return undefined;
}
