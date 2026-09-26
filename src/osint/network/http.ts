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
