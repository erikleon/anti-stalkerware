/**
 * The only place docket makes network requests to third parties, and only
 * from the OSINT checks a person starts by hand, behind the same gate as
 * every other OSINT tool. Every request is a plain GET of a public page,
 * public API, or public list. None carries message text, and none opens a
 * link from a message.
 *
 * `Fetcher` is injected everywhere so tests never touch the network.
 */
export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "follow" }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

// An ordinary browser identity. Several sites refuse or answer differently
// to non-browser clients, and a request should not announce docket to the
// sites it checks.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export type FetchTextResult = { ok: true; status: number; body: string } | { ok: false; error: string };

export async function fetchText(fetcher: Fetcher, url: string, timeoutMs = 10_000): Promise<FetchTextResult> {
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    return { ok: true, status: response.status, body: await response.text() };
  } catch (err) {
    const name = (err as Error).name;
    return { ok: false, error: name === "TimeoutError" ? "timed out" : (err as Error).message };
  }
}

/** Runs `tasks` with at most `limit` in flight, keeping results in order. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A response as fetchPage needs it: a status and a body it can read in chunks. */
export interface PageResponse {
  status: number;
  body: AsyncIterable<Uint8Array> | null;
}

export type PageFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; redirect: "manual"; signal: AbortSignal },
) => Promise<PageResponse>;

export interface PageRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export type PageResult = { ok: true; status: number; body: string } | { ok: false; error: string };

/**
 * True for a host a request may go to: a DNS name with at least one dot
 * that isn't an IP address, localhost, or a local-only name. Rules come
 * from outside data, and a redirect is chosen by the site; neither may
 * point a victim's request at their own network or machine.
 */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
}

/**
 * One request for a site rule. Redirects are never followed: like
 * WhatsMyName's own checker, the first response is the answer (75 rules
 * read a 3xx status as "found" or "missing"), and nothing a site sends
 * back can move the request to another host. The body is read in chunks
 * up to `maxBytes`. Never throws; a failure comes back as `{ ok: false }`
 * with a reason a person can read.
 */
export async function fetchPage(fetcher: PageFetcher, request: PageRequest, signal: AbortSignal, maxBytes = 1024 * 1024): Promise<PageResult> {
  try {
    const parsed = new URL(request.url);
    if (parsed.protocol !== "https:" || !isPublicHostname(parsed.hostname)) return { ok: false, error: "unsafe address" };

    const response = await fetcher(request.url, {
      method: request.method,
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...request.headers },
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: "manual",
      signal,
    });

    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > maxBytes) return { ok: false, error: "page too large" };
      chunks.push(chunk);
    }
    return { ok: true, status: response.status, body: new TextDecoder().decode(Buffer.concat(chunks)) };
  } catch (err) {
    const name = (err as Error).name;
    if (name === "AbortError") return { ok: false, error: signal.reason === "timeout" ? "out of time" : "stopped" };
    if (name === "TimeoutError") return { ok: false, error: "timed out" };
    return { ok: false, error: (err as Error).message };
  }
}
