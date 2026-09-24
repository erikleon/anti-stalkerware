import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { decodeMetaString } from "./reader";

/**
 * The accounts someone blocked on Instagram, from the same export:
 *
 *   connections/followers_and_following/blocked_profiles.json
 *     { "relationships_blocked_users": [
 *         { "title": "username", "string_list_data": [{ "href": "https://www.instagram.com/username", "value"?: "username" }] } ] }
 *
 * The username sits in `value` in older exports and in `title` in newer
 * ones; the profile link is the last fallback. An entry with none of the
 * three is counted in `skipped`, not dropped silently.
 */
export interface InstagramBlockedResult {
  status: "ok" | "not-found";
  usernames: string[];
  skipped: number;
}

const BLOCKED_FILES = [
  ["connections", "followers_and_following", "blocked_profiles.json"],
  ["connections", "followers_and_following", "blocked_accounts.json"],
  ["followers_and_following", "blocked_accounts.json"],
];

export async function readInstagramBlocked(exportDir: string): Promise<InstagramBlockedResult> {
  const path = BLOCKED_FILES.map((parts) => join(exportDir, ...parts)).find((p) => existsSync(p));
  if (!path) return { status: "not-found", usernames: [], skipped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`couldn't read the Instagram block list at ${path}: ${(err as Error).message}`);
  }
  const root = parsed as Record<string, unknown>;
  const list = root["relationships_blocked_users"] ?? root["relationships_blocked_accounts"];
  if (!Array.isArray(list)) throw new Error(`the Instagram block list at ${path} has an unexpected layout`);

  const usernames: string[] = [];
  let skipped = 0;
  for (const item of list as Array<{ title?: unknown; string_list_data?: Array<{ href?: unknown; value?: unknown }> }>) {
    const data = item.string_list_data?.[0];
    const fromHref = typeof data?.href === "string" ? data.href.match(/instagram\.com\/(?:_u\/)?([^/?#]+)/)?.[1] : undefined;
    const candidate = [data?.value, item.title, fromHref].find((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (candidate) usernames.push(decodeMetaString(candidate.trim()));
    else skipped++;
  }
  return { status: "ok", usernames, skipped };
}
