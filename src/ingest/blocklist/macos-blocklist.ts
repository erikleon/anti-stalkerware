import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseBuffer } from "bplist-parser";

/**
 * Reads the contacts a person blocked in Messages/FaceTime/Phone on this
 * Mac. macOS keeps that list (synced from iCloud, so it usually matches
 * the iPhone's too) in a binary plist owned by CMFSyncAgent:
 *
 *   __kCMFBlockListStoreTopLevelKey
 *     └─ __kCMFBlockListStoreArrayKey: [ item, item, ... ]
 *          item = { __kCMFItemPhoneNumberUnformattedKey: "+15551234567", ... }
 *               | { __kCMFItemEmailUnformattedKey: "person@example.com", ... }
 *
 * Read-only: this never writes to the plist, and the app never blocks or
 * unblocks anyone. An item with neither key (a business chat ID, a
 * format a later macOS adds) is counted in `skipped`, not dropped
 * silently, so the UI can say that some entries weren't read.
 */
// DOCKET_MACOS_BLOCKLIST_PATH points the e2e tests at a fixture instead
// of the real block list of whoever runs them. Read-only either way.
export const DEFAULT_MACOS_BLOCKLIST_PATH =
  process.env["DOCKET_MACOS_BLOCKLIST_PATH"] ?? join(homedir(), "Library", "Preferences", "com.apple.cmfsyncagent.plist");

export interface BlockedIdentifier {
  kind: "phone" | "email";
  value: string;
}

export interface ParsedBlocklist {
  entries: BlockedIdentifier[];
  skipped: number;
}

export type BlocklistReadResult =
  | { status: "unsupported-platform" }
  /** No block list file: nobody was ever blocked on this Mac, or iCloud never synced one here. */
  | { status: "not-found" }
  | ({ status: "ok" } & ParsedBlocklist);

const PHONE_KEY = "__kCMFItemPhoneNumberUnformattedKey";
const EMAIL_KEY = "__kCMFItemEmailUnformattedKey";

export function parseMacosBlocklist(plist: Buffer): ParsedBlocklist {
  let root: unknown;
  try {
    [root] = parseBuffer(plist);
  } catch (err) {
    throw new Error(`the macOS block list is not a readable property list: ${(err as Error).message}`);
  }

  const store = (root as Record<string, unknown> | undefined)?.["__kCMFBlockListStoreTopLevelKey"] as Record<string, unknown> | undefined;
  const items = store?.["__kCMFBlockListStoreArrayKey"];
  if (!Array.isArray(items)) {
    throw new Error("the macOS block list has an unexpected layout (no block list array found)");
  }

  const entries: BlockedIdentifier[] = [];
  let skipped = 0;
  for (const item of items as Array<Record<string, unknown>>) {
    const phone = item?.[PHONE_KEY];
    const email = item?.[EMAIL_KEY];
    if (typeof phone === "string" && phone.trim().length > 0) {
      entries.push({ kind: "phone", value: phone.trim() });
    } else if (typeof email === "string" && email.trim().length > 0) {
      entries.push({ kind: "email", value: email.trim() });
    } else {
      skipped++;
    }
  }
  return { entries, skipped };
}

export async function readMacosBlocklist(
  plistPath: string = DEFAULT_MACOS_BLOCKLIST_PATH,
  platform: NodeJS.Platform = process.platform,
): Promise<BlocklistReadResult> {
  if (platform !== "darwin") return { status: "unsupported-platform" };

  let plist: Buffer;
  try {
    plist = await readFile(plistPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { status: "not-found" };
    throw new Error(`couldn't read the macOS block list at ${plistPath}: ${(err as Error).message}`);
  }
  return { status: "ok", ...parseMacosBlocklist(plist) };
}
