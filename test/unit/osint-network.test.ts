import { beforeEach, describe, expect, it } from "vitest";
import type { Fetcher } from "../../src/osint/network/http";
import { checkUsernamePresence, normalizeHandle, suggestHandles, SITES, type SiteCheck } from "../../src/osint/network/username-presence";
import { checkLinksOffline, checkLinksOnline, clearFeedCache, extractLinks, FEEDS, parseFeed } from "../../src/osint/network/link-safety";

/** A fetcher that answers from a table and records every URL it was asked for. */
function fakeFetcher(responses: Record<string, { status: number; body?: string } | "timeout">): Fetcher & { requested: string[] } {
  const requested: string[] = [];
  const fetcher = (async (url: string) => {
    requested.push(url);
    const response = responses[url];
    if (response === "timeout") {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }
    if (!response) return { status: 404, text: async () => "" };
    return { status: response.status, text: async () => response.body ?? "" };
  }) as Fetcher & { requested: string[] };
  fetcher.requested = requested;
  return fetcher;
}

describe("normalizeHandle", () => {
  it("accepts handles and strips a leading @", () => {
    expect(normalizeHandle("@alex_b.99")).toBe("alex_b.99");
  });

  it("refuses anything that could carry more than a handle into a URL", () => {
    for (const bad of ["a", "alex b", "alex/../../x", "alex?x=1", "alex#frag", "x".repeat(41), "", "-alex"]) {
      expect(normalizeHandle(bad)).toBeUndefined();
    }
  });
});

describe("checkUsernamePresence", () => {
  const github = SITES.find((s) => s.name === "GitHub")!;
  const telegram = SITES.find((s) => s.name === "Telegram")!;

  it("reports found, not found, and couldn't tell per site, with the profile link", async () => {
    const fetcher = fakeFetcher({
      "https://api.github.com/users/alex_b": { status: 200 },
      "https://t.me/alex_b": { status: 200, body: "<html>no such page</html>" },
    });
    const flaky: SiteCheck = { name: "Flaky", requestUrl: () => "https://flaky.example/alex_b", profileUrl: () => "https://flaky.example/alex_b", read: () => undefined };
    const results = await checkUsernamePresence("@alex_b", fetcher, [github, telegram, flaky]);
    expect(results).toEqual([
      { site: "GitHub", profileUrl: "https://github.com/alex_b", status: "found" },
      { site: "Telegram", profileUrl: "https://t.me/alex_b", status: "not-found" },
      { site: "Flaky", profileUrl: "https://flaky.example/alex_b", status: "unknown", detail: "unexpected answer (HTTP 404)" },
    ]);
  });

  it("calls a timeout 'couldn't tell', never 'not found'", async () => {
    const fetcher = fakeFetcher({ "https://api.github.com/users/alex_b": "timeout" });
    const [result] = await checkUsernamePresence("alex_b", fetcher, [github]);
    expect(result).toMatchObject({ status: "unknown", detail: "timed out" });
  });

  it("refuses an invalid handle before sending anything", async () => {
    const fetcher = fakeFetcher({});
    await expect(checkUsernamePresence("not a handle", fetcher)).rejects.toThrow(/isn't a username/);
    expect(fetcher.requested).toEqual([]);
  });

  it("only ever requests the site's own URL for the handle", async () => {
    const fetcher = fakeFetcher({});
    await checkUsernamePresence("alex_b", fetcher);
    expect(fetcher.requested).toHaveLength(SITES.length);
    expect(fetcher.requested.every((url) => url.includes("alex_b"))).toBe(true);
  });
});

describe("suggestHandles", () => {
  it("offers @mentions, a handle-like sender, and known usernames, but not emails or phone numbers", () => {
    expect(
      suggestHandles("Alex_B", ["follow me @new_acct_2, or email me at x@example.com", "@new_acct_2 again"], ["old_handle"]),
    ).toEqual(["Alex_B", "new_acct_2", "old_handle"]);
    expect(suggestHandles("+15551234567", [], [])).toEqual([]);
    expect(suggestHandles("ex@example.com", [], [])).toEqual([]);
  });
});

describe("extractLinks", () => {
  it("finds explicit, www., and bare IP-logger and shortener links, once each", () => {
    const links = extractLinks([
      "look at this https://example.com/a?x=1). and www.site.org/page",
      "tap grabify.link/ABC123 now, or bit.ly/3xyz!",
      "again: https://EXAMPLE.com/a?x=1",
    ]);
    expect(links.map((l) => l.text)).toEqual(["https://example.com/a?x=1", "www.site.org/page", "grabify.link/ABC123", "bit.ly/3xyz"]);
    expect(links[2]).toMatchObject({ host: "grabify.link" });
  });

  it("finds nothing in text without links", () => {
    expect(extractLinks(["see you at 5:30. Thanks!"])).toEqual([]);
  });
});

describe("checkLinksOffline", () => {
  it("flags built-in IP loggers (including subdomains) and shorteners, with no network", () => {
    const verdicts = checkLinksOffline(extractLinks(["https://iplogger.org/abc https://x.grabify.link/y https://tinyurl.com/q https://example.com"]));
    expect(verdicts.map((v) => v.findings.map((f) => f.kind))).toEqual([["ip-logger"], ["ip-logger"], ["shortener"], []]);
  });
});

describe("parseFeed", () => {
  it("reads hosts files, plain domain lists, and adblock-style lines", () => {
    const entries = parseFeed("# comment\n127.0.0.1 bad.example\n0.0.0.0\tworse.example\nplain.example\n||adblock.example^\n! note\n", "domain");
    expect([...entries].sort()).toEqual(["adblock.example", "bad.example", "plain.example", "worse.example"]);
  });

  it("normalizes URL lists the same way as message links", () => {
    expect([...parseFeed("HTTPS://Evil.Example/login/\n# header\nnot a url\n", "url")]).toEqual(["evil.example/login"]);
  });
});

describe("checkLinksOnline", () => {
  beforeEach(() => clearFeedCache());

  const feedUrl = (namePart: string) => FEEDS.find((f) => f.name.includes(namePart))!.url;

  it("matches links against downloaded lists on the device and never requests a message's link", async () => {
    const fetcher = fakeFetcher({
      [feedUrl("Grabify")]: { status: 200, body: "spottyfly.com\nbit.ly\n" },
      [feedUrl("AntiIPGrabber")]: { status: 200, body: "" },
      [feedUrl("URLhaus malware hosts")]: { status: 200, body: "127.0.0.1 malware-host.example\n" },
      [feedUrl("URLhaus malware links")]: { status: 200, body: "http://drop.example/payload.apk\n" },
      [feedUrl("OpenPhish")]: { status: 200, body: "https://login-bank.example/verify\n" },
    });
    const links = extractLinks([
      "https://spottyfly.com/track https://malware-host.example/x http://drop.example/payload.apk https://login-bank.example/verify/ https://bit.ly/abc https://fine.example",
    ]);
    const { verdicts, feeds } = await checkLinksOnline(links, fetcher, 1_000);

    expect(verdicts.map((v) => v.findings.map((f) => f.kind))).toEqual([["ip-logger"], ["malicious"], ["malicious"], ["phishing"], ["shortener"], []]);
    expect(feeds.every((f) => f.ok)).toBe(true);
    // Only the five public lists were requested.
    expect([...fetcher.requested].sort()).toEqual(FEEDS.map((f) => f.url).sort());
  });

  it("reports a list that failed to download instead of implying it was checked", async () => {
    const fetcher = fakeFetcher({ [feedUrl("OpenPhish")]: "timeout" });
    const { feeds } = await checkLinksOnline(extractLinks(["https://fine.example"]), fetcher, 1_000);
    expect(feeds.find((f) => f.name.includes("OpenPhish"))).toMatchObject({ ok: false, detail: "timed out" });
    expect(feeds.find((f) => f.name.includes("Grabify"))).toMatchObject({ ok: false, detail: "HTTP 404" });
  });

  it("reuses downloaded lists for an hour, but retries when one had failed", async () => {
    const all = Object.fromEntries(FEEDS.map((f) => [f.url, { status: 200, body: "x.example\n" }]));
    const fetcher = fakeFetcher(all);
    await checkLinksOnline([], fetcher, 0);
    await checkLinksOnline([], fetcher, 30 * 60 * 1000);
    expect(fetcher.requested).toHaveLength(FEEDS.length);
    await checkLinksOnline([], fetcher, 61 * 60 * 1000);
    expect(fetcher.requested).toHaveLength(FEEDS.length * 2);
  });
});
