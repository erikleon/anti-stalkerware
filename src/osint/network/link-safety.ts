import { fetchText, mapLimited, type Fetcher } from "./http";

/**
 * Checks links a sender wrote, without ever opening them. Harassers send
 * IP-logging links (Grabify, IPLogger, and dozens of look-alike domains):
 * opening one hands over the victim's IP address and rough location. So
 * a link is never fetched, expanded, or previewed here — even a
 * shortener's redirect is a click the link's owner can see.
 *
 *   1. On the device, no network: known IP-logger domains and link
 *      shorteners (built into this file).
 *   2. On request: download public lists (IP loggers, malware and phishing
 *      links) and match the links on the device. The lists are downloaded
 *      whole; no link from a message is sent anywhere.
 */

/**
 * The best-known IP-logger domains, confirmed against both public lists in
 * FEEDS. A floor for the offline check; the downloaded lists hold many
 * more.
 */
const CORE_IP_LOGGERS = [
  "grabify.link",
  "iplogger.org",
  "iplogger.com",
  "iplogger.ru",
  "iplogger.co",
  "iplogger.info",
  "iplogger.cn",
  "2no.co",
  "yip.su",
  "blasze.com",
  "ipgrabber.ru",
  "iplis.ru",
  "ezstat.ru",
];

/** Link shorteners hide where a link goes. Not malicious by themselves, and a common wrapper around an IP logger. */
const SHORTENERS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "ow.ly",
  "buff.ly",
  "rb.gy",
  "t.ly",
  "tiny.cc",
  "s.id",
  "bl.ink",
  "lnkd.in",
];

export type LinkFinding = "ip-logger" | "shortener" | "malicious" | "phishing";

export interface FoundLink {
  /** As written in the message. */
  text: string;
  host: string;
  /** Normalized for matching against URL lists. */
  normalized: string;
}

export interface LinkVerdict {
  link: FoundLink;
  findings: Array<{ kind: LinkFinding; source: string }>;
}

export interface FeedStatus {
  name: string;
  ok: boolean;
  /** Entries loaded, or why the download failed. */
  detail: string;
}

interface Feed {
  name: string;
  url: string;
  /** What a match on this list means, and whether it lists domains or full URLs. */
  kind: LinkFinding;
  matches: "domain" | "url";
}

/**
 * Public lists, downloaded when a person runs the online check. Kept as
 * URLs, not copied into this repository: the IP-logger lists are GPL, and
 * a downloaded list is also the current one.
 */
export const FEEDS: readonly Feed[] = [
  { name: "Grabify Blocklist (IP loggers)", url: "https://raw.githubusercontent.com/EsadCetiner/Grabify-Blocklist/main/blocklist.txt", kind: "ip-logger", matches: "domain" },
  {
    name: "AntiIPGrabber Blocklist (IP loggers)",
    url: "https://raw.githubusercontent.com/0n1cOn3/The-AntiIPGrabber-Blocklist/main/blocklist.txt",
    kind: "ip-logger",
    matches: "domain",
  },
  { name: "URLhaus malware hosts (abuse.ch)", url: "https://urlhaus.abuse.ch/downloads/hostfile/", kind: "malicious", matches: "domain" },
  { name: "URLhaus malware links (abuse.ch)", url: "https://urlhaus.abuse.ch/downloads/text_online/", kind: "malicious", matches: "url" },
  { name: "OpenPhish community feed", url: "https://openphish.com/feed.txt", kind: "phishing", matches: "url" },
];

// Explicit http(s) links, "www." links, and bare links on known IP-logger
// and shortener domains ("grabify.link/abc" with no scheme is still a link
// someone can tap).
const BARE_HOSTS = [...CORE_IP_LOGGERS, ...SHORTENERS].map((d) => d.replace(/\./g, "\\.")).join("|");
const LINK_PATTERN = new RegExp(`\\bhttps?:\\/\\/[^\\s<>"']+|\\bwww\\.[^\\s<>"']+|\\b(?:${BARE_HOSTS})\\/[^\\s<>"']*`, "gi");

/** Every distinct link in the texts, in order of first appearance. */
export function extractLinks(texts: readonly string[]): FoundLink[] {
  const seen = new Map<string, FoundLink>();
  for (const text of texts) {
    for (const match of text.matchAll(LINK_PATTERN)) {
      const raw = match[0].replace(/[.,!?;:)\]]+$/, "");
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
      } catch {
        continue;
      }
      const normalized = normalizeUrl(url);
      if (!seen.has(normalized)) seen.set(normalized, { text: raw, host: url.hostname, normalized });
    }
  }
  return [...seen.values()];
}

function normalizeUrl(url: URL): string {
  return `${url.hostname}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
}

/** `host` is `domain` or a subdomain of it. */
function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** "a.b.example.com" → ["a.b.example.com", "b.example.com", "example.com", "com"], for set lookups. */
function hostSuffixes(host: string): string[] {
  const parts = host.split(".");
  return parts.map((_, i) => parts.slice(i).join("."));
}

/** The offline check: built-in IP-logger and shortener domains. No network. */
export function checkLinksOffline(links: readonly FoundLink[]): LinkVerdict[] {
  return links.map((link) => {
    const findings: LinkVerdict["findings"] = [];
    if (CORE_IP_LOGGERS.some((d) => onDomain(link.host, d))) findings.push({ kind: "ip-logger", source: "built-in list" });
    if (SHORTENERS.some((d) => onDomain(link.host, d))) findings.push({ kind: "shortener", source: "built-in list" });
    return { link, findings };
  });
}

interface LoadedFeed {
  feed: Feed;
  entries: Set<string>;
}

/** One list's entries: domains from a hosts file or a plain domain list, or normalized URLs. */
export function parseFeed(body: string, matches: "domain" | "url"): Set<string> {
  const entries = new Set<string>();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    if (matches === "url") {
      try {
        entries.add(normalizeUrl(new URL(line)));
      } catch {
        // A line that isn't a URL in a URL list is a header or junk; nothing to match.
      }
      continue;
    }
    // Hosts-file lines ("127.0.0.1 example.com") or bare domains ("example.com", "||example.com^").
    const token = line.split(/\s+/).pop()!.replace(/^\|\|/, "").replace(/\^$/, "");
    try {
      entries.add(new URL(`http://${token}`).hostname);
    } catch {
      // Not a domain; skip it like a comment.
    }
  }
  return entries;
}

const FEED_CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; loaded: LoadedFeed[]; statuses: FeedStatus[] } | undefined;

async function loadFeeds(fetcher: Fetcher, now: number): Promise<{ loaded: LoadedFeed[]; statuses: FeedStatus[] }> {
  if (cache && now - cache.at < FEED_CACHE_MS && cache.statuses.every((s) => s.ok)) return cache;
  const results = await mapLimited(FEEDS, 3, async (feed) => {
    const response = await fetchText(fetcher, feed.url, 30_000);
    if (!response.ok) return { feed, error: response.error };
    if (response.status !== 200) return { feed, error: `HTTP ${response.status}` };
    return { feed, entries: parseFeed(response.body, feed.matches) };
  });
  const loaded: LoadedFeed[] = [];
  const statuses: FeedStatus[] = [];
  for (const r of results) {
    if ("entries" in r && r.entries) {
      loaded.push({ feed: r.feed, entries: r.entries });
      statuses.push({ name: r.feed.name, ok: true, detail: `${r.entries.size} entries` });
    } else {
      statuses.push({ name: r.feed.name, ok: false, detail: "error" in r ? r.error : "no entries" });
    }
  }
  cache = { at: now, loaded, statuses };
  return cache;
}

/** Test hook: forget downloaded lists. */
export function clearFeedCache(): void {
  cache = undefined;
}

/**
 * The offline check plus every public list that downloaded. A list that
 * fails to download is reported in `feeds`, so "nothing found" is never
 * shown for a check that didn't happen.
 */
export async function checkLinksOnline(
  links: readonly FoundLink[],
  fetcher: Fetcher,
  now: number = Date.now(),
): Promise<{ verdicts: LinkVerdict[]; feeds: FeedStatus[] }> {
  const verdicts = checkLinksOffline(links);
  const { loaded, statuses } = await loadFeeds(fetcher, now);
  for (const verdict of verdicts) {
    for (const { feed, entries } of loaded) {
      // A shortener already carries its own warning. Some IP-logger lists
      // include big shorteners (bit.ly), which would label every short
      // link an IP logger.
      if (feed.kind === "ip-logger" && SHORTENERS.some((d) => onDomain(verdict.link.host, d))) continue;
      const hit =
        feed.matches === "url" ? entries.has(verdict.link.normalized) : hostSuffixes(verdict.link.host).some((suffix) => entries.has(suffix));
      if (hit && !verdict.findings.some((f) => f.kind === feed.kind && f.source === feed.name)) {
        verdict.findings.push({ kind: feed.kind, source: feed.name });
      }
    }
  }
  return { verdicts, feeds: statuses };
}
