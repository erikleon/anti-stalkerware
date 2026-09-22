import { UID } from "bplist-parser";

/**
 * Resolves an NSKeyedArchiver object graph, as decoded by bplist-parser,
 * into plain JS values. Both `attributedBody` and `message_summary_info`
 * in chat.db are typically archived this way rather than as plain bplist
 * dictionaries: a top-level `$objects` array of encoded objects, a `$top`
 * entry pointing at the root, and every reference between objects stored
 * as a `UID` index into `$objects` instead of being inlined.
 *
 * This resolver is generic NSKeyedArchiver decoding, not specific to
 * iMessage's schema — the same graph-of-UIDs structure NSKeyedArchiver
 * produces for any Cocoa object.
 */

interface RawArchive {
  $version?: number;
  $archiver?: string;
  $top?: Record<string, unknown>;
  $objects?: unknown[];
}

export function isKeyedArchive(value: unknown): value is RawArchive {
  return (
    typeof value === "object" &&
    value !== null &&
    "$archiver" in value &&
    (value as RawArchive).$archiver === "NSKeyedArchiver" &&
    Array.isArray((value as RawArchive).$objects)
  );
}

/** Resolves the archive's root object (`$top.root`, falling back to the first `$top` entry). */
export function resolveKeyedArchiveRoot(archive: RawArchive): unknown {
  const objects = archive.$objects ?? [];
  const top = archive.$top ?? {};
  const rootRef = "root" in top ? top.root : Object.values(top)[0];
  return resolveValue(rootRef, objects, new Set());
}

function resolveValue(value: unknown, objects: unknown[], seen: Set<number>): unknown {
  if (value instanceof UID) {
    return resolveObjectAt(value.UID, objects, seen);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, objects, seen));
  }
  return value;
}

function resolveObjectAt(index: number, objects: unknown[], seen: Set<number>): unknown {
  if (seen.has(index)) {
    // A cycle in the object graph. Cocoa archives can legitimately contain
    // back-references; returning a marker instead of recursing forever.
    return "$circular-reference";
  }
  const raw = objects[index];
  if (raw === "$null" || raw === undefined) {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || raw instanceof UID) {
    return resolveValue(raw, objects, seen);
  }

  const nextSeen = new Set(seen).add(index);
  const dict = raw as Record<string, unknown>;

  // NSString / NSMutableString archive their content under NS.string.
  if (typeof dict["NS.string"] === "string") {
    return dict["NS.string"];
  }

  // NSArray / NSMutableArray archive elements under NS.objects, each a UID.
  if (Array.isArray(dict["NS.objects"]) && !("NS.keys" in dict)) {
    return (dict["NS.objects"] as unknown[]).map((entry) => resolveValue(entry, objects, nextSeen));
  }

  // NSDictionary / NSMutableDictionary archive parallel NS.keys / NS.objects UID arrays.
  if (Array.isArray(dict["NS.keys"]) && Array.isArray(dict["NS.objects"])) {
    const keys = (dict["NS.keys"] as unknown[]).map((k) => resolveValue(k, objects, nextSeen));
    const values = (dict["NS.objects"] as unknown[]).map((v) => resolveValue(v, objects, nextSeen));
    const result: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      if (typeof key === "string") {
        result[key] = values[i];
      }
    });
    return result;
  }

  // A generic archived object: resolve every field, drop the $class
  // reference since callers care about data, not the Cocoa class name.
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(dict)) {
    if (key === "$class") continue;
    result[key] = resolveValue(val, objects, nextSeen);
  }
  return result;
}
