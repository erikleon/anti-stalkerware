import { fetchText, mapLimited, type Fetcher } from "./http";

/**
 * Checks whether an account with a given handle exists on a set of public
 * sites, by asking each site directly. A "found" means only that the
 * handle is taken there, not that it's the same person — anyone can pick
 * any free handle. The UI says so next to every result.
 *
 * Each site below was checked on 2026-09-25 with two handles known to
 * exist and a random one, and kept only if it told them apart. Sites that
 * answer the same for every handle without a login (Instagram, TikTok,
 * Pinterest, Medium, Threads) or refuse non-logged-in requests (Reddit,
 * Facebook) aren't checked, and the UI lists them so nobody reads their
 * absence as "not found". Sites change; a site that starts answering
 * differently shows as "couldn't tell", never as a false "not found".
 */
export interface SiteCheck {
  name: string;
  /** What's requested. */
  requestUrl: (handle: string) => string;
  /** The public profile, shown to the user. */
  profileUrl: (handle: string) => string;
  /** found / not-found from the response, or undefined when the answer doesn't mean either. */
  read: (status: number, body: string) => boolean | undefined;
}

const byStatus = (status: number): boolean | undefined => (status === 200 ? true : status === 404 ? false : undefined);

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

export const SITES: readonly SiteCheck[] = [
  { name: "GitHub", requestUrl: (h) => `https://api.github.com/users/${h}`, profileUrl: (h) => `https://github.com/${h}`, read: byStatus },
  {
    name: "GitLab",
    requestUrl: (h) => `https://gitlab.com/api/v4/users?username=${h}`,
    profileUrl: (h) => `https://gitlab.com/${h}`,
    read: (status, body) => {
      const users = parseJson(body);
      return status === 200 && Array.isArray(users) ? users.length > 0 : undefined;
    },
  },
  { name: "YouTube", requestUrl: (h) => `https://www.youtube.com/@${h}`, profileUrl: (h) => `https://www.youtube.com/@${h}`, read: byStatus },
  { name: "X", requestUrl: (h) => `https://x.com/${h}`, profileUrl: (h) => `https://x.com/${h}`, read: byStatus },
  { name: "Snapchat", requestUrl: (h) => `https://www.snapchat.com/add/${h}`, profileUrl: (h) => `https://www.snapchat.com/add/${h}`, read: byStatus },
  {
    name: "Telegram",
    requestUrl: (h) => `https://t.me/${h}`,
    profileUrl: (h) => `https://t.me/${h}`,
    read: (status, body) => (status === 200 ? body.includes("tgme_page_title") : undefined),
  },
  { name: "Venmo", requestUrl: (h) => `https://account.venmo.com/u/${h}`, profileUrl: (h) => `https://account.venmo.com/u/${h}`, read: byStatus },
  {
    name: "Bluesky",
    requestUrl: (h) => `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${h}.bsky.social`,
    profileUrl: (h) => `https://bsky.app/profile/${h}.bsky.social`,
    read: (status) => (status === 200 ? true : status === 400 ? false : undefined),
  },
  {
    name: "Mastodon (mastodon.social)",
    requestUrl: (h) => `https://mastodon.social/api/v1/accounts/lookup?acct=${h}`,
    profileUrl: (h) => `https://mastodon.social/@${h}`,
    read: byStatus,
  },
  { name: "Tumblr", requestUrl: (h) => `https://${h}.tumblr.com/`, profileUrl: (h) => `https://${h}.tumblr.com/`, read: byStatus },
  { name: "Linktree", requestUrl: (h) => `https://linktr.ee/${h}`, profileUrl: (h) => `https://linktr.ee/${h}`, read: byStatus },
  { name: "Patreon", requestUrl: (h) => `https://www.patreon.com/${h}`, profileUrl: (h) => `https://www.patreon.com/${h}`, read: byStatus },
  { name: "SoundCloud", requestUrl: (h) => `https://soundcloud.com/${h}`, profileUrl: (h) => `https://soundcloud.com/${h}`, read: byStatus },
  { name: "DeviantArt", requestUrl: (h) => `https://www.deviantart.com/${h}`, profileUrl: (h) => `https://www.deviantart.com/${h}`, read: byStatus },
  {
    name: "Steam",
    requestUrl: (h) => `https://steamcommunity.com/id/${h}`,
    profileUrl: (h) => `https://steamcommunity.com/id/${h}`,
    read: (status, body) => (status === 200 ? !body.includes("The specified profile could not be found") : undefined),
  },
  { name: "Chess.com", requestUrl: (h) => `https://api.chess.com/pub/player/${h}`, profileUrl: (h) => `https://www.chess.com/member/${h}`, read: byStatus },
  { name: "Lichess", requestUrl: (h) => `https://lichess.org/api/user/${h}`, profileUrl: (h) => `https://lichess.org/@/${h}`, read: byStatus },
  {
    name: "Duolingo",
    requestUrl: (h) => `https://www.duolingo.com/2017-06-30/users?username=${h}`,
    profileUrl: (h) => `https://www.duolingo.com/profile/${h}`,
    read: (status, body) => {
      const users = (parseJson(body) as { users?: unknown[] } | undefined)?.users;
      return status === 200 && Array.isArray(users) ? users.length > 0 : undefined;
    },
  },
  {
    name: "Keybase",
    requestUrl: (h) => `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${h}`,
    profileUrl: (h) => `https://keybase.io/${h}`,
    read: (status, body) => {
      const them = (parseJson(body) as { them?: unknown[] } | undefined)?.them;
      return status === 200 && Array.isArray(them) ? them[0] != null : undefined;
    },
  },
];

/** Named in the UI so their absence from the results is never read as "not found". */
export const UNCHECKABLE_SITES = ["Instagram", "Facebook", "TikTok", "Reddit", "Threads", "Pinterest", "Medium"] as const;

export type PresenceStatus = "found" | "not-found" | "unknown";

export interface PresenceResult {
  site: string;
  profileUrl: string;
  status: PresenceStatus;
  /** For "unknown": why (a timeout, an error, or an answer that means neither). */
  detail?: string;
}

/**
 * A handle as the checks will send it, or undefined if it can't be one.
 * Strict on purpose: only characters handles actually use, so nothing
 * else from a message can ride along into a URL.
 */
export function normalizeHandle(input: string): string | undefined {
  const handle = input.trim().replace(/^@/, "");
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(handle) ? handle : undefined;
}

export async function checkUsernamePresence(handle: string, fetcher: Fetcher, sites: readonly SiteCheck[] = SITES): Promise<PresenceResult[]> {
  const normalized = normalizeHandle(handle);
  if (!normalized) throw new Error(`"${handle}" isn't a username that can be checked (letters, numbers, dots, dashes, and underscores only)`);

  return mapLimited(sites, 5, async (site) => {
    const profileUrl = site.profileUrl(normalized);
    const response = await fetchText(fetcher, site.requestUrl(normalized));
    if (!response.ok) return { site: site.name, profileUrl, status: "unknown", detail: response.error };
    const found = site.read(response.status, response.body);
    if (found === undefined) return { site: site.name, profileUrl, status: "unknown", detail: `unexpected answer (HTTP ${response.status})` };
    return { site: site.name, profileUrl, status: found ? "found" : "not-found" };
  });
}

/**
 * Handles worth offering as suggestions: @mentions in the sender's own
 * messages, the sender's identifier when it looks like a handle, and
 * usernames from the known-accounts list. The person still picks one and
 * starts the check; nothing is checked automatically.
 */
export function suggestHandles(senderIdentifier: string, senderTexts: readonly string[], knownUsernames: readonly string[]): string[] {
  const found = new Set<string>();
  const add = (value: string) => {
    const handle = normalizeHandle(value);
    if (handle) found.add(handle);
  };
  if (!/^[+\d\s().-]+$/.test(senderIdentifier) && !senderIdentifier.includes("@")) add(senderIdentifier);
  for (const text of senderTexts) for (const match of text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9._-]{2,40})/g)) add(match[1]!);
  for (const username of knownUsernames) add(username);
  return [...found];
}
