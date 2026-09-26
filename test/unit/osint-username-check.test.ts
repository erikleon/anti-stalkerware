import { describe, expect, it } from "vitest";
import type { Fetcher, PageFetcher } from "../../src/osint/network/http";
import { parseRules, type LoadedWhatsMyName, type SiteRule } from "../../src/osint/network/whatsmyname";
import { fetchSkipList, runCheck, selectSites, type Schedule } from "../../src/osint/network/username-check";

function rule(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    uri_check: `https://${name.toLowerCase()}.example.com/u/{account}`,
    e_code: 200,
    e_string: "profile",
    m_code: 404,
    m_string: "",
    known: ["alice"],
    cat: "social",
    ...overrides,
  };
}

function loaded(sites: ReturnType<typeof rule>[], manifest: Partial<LoadedWhatsMyName["manifest"]> = {}): LoadedWhatsMyName {
  return {
    manifest: { revision: "r", files: [], majorPlatforms: [], passList: sites.map((s) => s.name), verifiedAt: "2026-09-26", ...manifest },
    ...parseRules({ sites }),
  };
}

describe("selectSites", () => {
  const data = loaded([rule("Big"), rule("Small"), rule("Dating", { cat: "dating" }), rule("Unverified")], {
    majorPlatforms: ["Big", "Unverified", "Gone"],
    passList: ["Big", "Small", "Dating"],
  });

  it("the major tier is the named sites that passed verification, with the rest listed as not checked", () => {
    const { sites, notChecked } = selectSites(data, new Set(), { tier: "major", includeSensitive: false });
    expect(sites.map((s) => s.name)).toEqual(["Big"]);
    expect(notChecked).toHaveLength(2);
    expect(notChecked).toEqual(
      expect.arrayContaining([
        { name: "Unverified", reason: "didn't pass verification" },
        { name: "Gone", reason: "no usable rule" },
      ]),
    );
  });

  it("the sweep is every verified site; sensitive ones only when opted in", () => {
    expect(selectSites(data, new Set(), { tier: "all", includeSensitive: false }).sites.map((s) => s.name)).toEqual(["Big", "Small"]);
    expect(selectSites(data, new Set(), { tier: "all", includeSensitive: true }).sites.map((s) => s.name)).toEqual(["Big", "Small", "Dating"]);
  });

  it("the skip list can only remove sites", () => {
    const { sites, notChecked } = selectSites(data, new Set(["Small", "Unverified", "Not a site"]), { tier: "all", includeSensitive: false });
    expect(sites.map((s) => s.name)).toEqual(["Big"]);
    expect(notChecked).toEqual([{ name: "Small", reason: "turned off since this version shipped (stopped working)" }]);
  });
});

describe("fetchSkipList", () => {
  const text = (status: number, body: string): Fetcher => async () => ({ status, text: async () => body });

  it("reads names only", async () => {
    const { names, note } = await fetchSkipList(text(200, JSON.stringify({ skip: [{ name: "A", reason: "x" }, { name: 5 }, {}] })));
    expect([...names]).toEqual(["A"]);
    expect(note).toBeUndefined();
  });

  it("falls back to no skips and says so when the list can't be fetched or read", async () => {
    expect((await fetchSkipList(text(404, ""))).note).toMatch(/HTTP 404/);
    expect((await fetchSkipList(text(200, "not json"))).note).toMatch(/couldn't be read/);
  });
});

const fast: Schedule = { initial: 2, max: 4, jitterMs: [0, 0], stepUpAfter: 2, deadlineMs: 10_000 };
const noSleep = async () => undefined;

/** A site answers after `delay` ms; "found" for handles starting with "alice". Records concurrency per host and overall. */
function slowSites(delay: number, answers: Record<string, number> = {}) {
  let inFlight = 0;
  let maxInFlight = 0;
  const perHost = new Map<string, number>();
  let maxPerHost = 0;
  const calls: string[] = [];
  const fetcher: PageFetcher = async (url, init) => {
    const host = new URL(url).hostname;
    calls.push(host);
    inFlight++;
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    maxInFlight = Math.max(maxInFlight, inFlight);
    maxPerHost = Math.max(maxPerHost, perHost.get(host)!);
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        init.signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
      const status = answers[host] ?? (url.includes("/alice") ? 200 : 404);
      return { status, body: (async function* () { yield Buffer.from(status === 200 ? "profile" : ""); })() };
    } finally {
      inFlight--;
      perHost.set(host, perHost.get(host)! - 1);
    }
  };
  return { fetcher, stats: () => ({ maxInFlight, maxPerHost, calls }) };
}

const sites = (names: string[], sameHost = false): SiteRule[] =>
  parseRules({ sites: names.map((n) => rule(n, sameHost ? { uri_check: `https://shared.example.com/${n}/{account}` } : {})) }).rules;

describe("runCheck", () => {
  it("reports every site, with found / not found per site", async () => {
    const { fetcher } = slowSites(1);
    const seen: string[] = [];
    const results = await runCheck(sites(["A", "B", "C"]), "alice", fetcher, fast, new AbortController().signal, (o) => seen.push(o.site), { sleep: noSleep });
    expect(results.map((r) => [r.site, r.status]).sort()).toEqual([["A", "found"], ["B", "found"], ["C", "found"]]);
    expect(seen.sort()).toEqual(["A", "B", "C"]);
  });

  it("never sends two requests to the same website at once", async () => {
    const { fetcher, stats } = slowSites(5);
    await runCheck(sites(["A", "B", "C", "D"], true), "alice", fetcher, { ...fast, initial: 4 }, new AbortController().signal, () => undefined, { sleep: noSleep });
    expect(stats().maxPerHost).toBe(1);
  });

  it("allows more at once after clean answers, up to the limit", async () => {
    const { fetcher, stats } = slowSites(5);
    await runCheck(sites("ABCDEFGHIJKL".split("")), "alice", fetcher, fast, new AbortController().signal, () => undefined, { sleep: noSleep });
    expect(stats().maxInFlight).toBeGreaterThan(2);
    expect(stats().maxInFlight).toBeLessThanOrEqual(4);
  });

  it("backs off to one at a time when sites start rate limiting", async () => {
    const names = "ABCDEFGH".split("");
    const limited = Object.fromEntries(names.map((n) => [`${n.toLowerCase()}.example.com`, 429]));
    const { fetcher } = slowSites(2, limited);
    const results = await runCheck(sites(names), "alice", fetcher, { ...fast, initial: 4, stepUpAfter: Infinity }, new AbortController().signal, () => undefined, { sleep: noSleep });
    expect(results.every((r) => r.status === "unknown" && r.detail === "rate limited")).toBe(true);
  });

  it("waits a random delay within the schedule's range before each request", async () => {
    const waits: number[] = [];
    const { fetcher } = slowSites(0);
    await runCheck(sites(["A", "B"]), "alice", fetcher, { ...fast, jitterMs: [100, 400] }, new AbortController().signal, () => undefined, {
      sleep: async (ms) => void waits.push(ms),
      random: () => 0.5,
    });
    expect(waits).toEqual([250, 250]);
  });

  it("on Stop, in-flight and queued sites all end as 'couldn't tell (stopped)'", async () => {
    const { fetcher } = slowSites(1000);
    const stop = new AbortController();
    const pending = runCheck(sites(["A", "B", "C", "D", "E"]), "alice", fetcher, fast, stop.signal, () => undefined, { sleep: noSleep });
    setTimeout(() => stop.abort(), 10);
    const results = await pending;
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "unknown" && r.detail === "stopped")).toBe(true);
  });

  it("at the time limit, unfinished sites end as 'couldn't tell (out of time)'", async () => {
    const { fetcher } = slowSites(1000);
    const results = await runCheck(sites(["A", "B", "C"]), "alice", fetcher, { ...fast, deadlineMs: 20 }, new AbortController().signal, () => undefined, { sleep: noSleep });
    expect(results.map((r) => r.detail)).toEqual(["out of time", "out of time", "out of time"]);
  });

  it("finishes at once with nothing to check", async () => {
    const { fetcher } = slowSites(0);
    expect(await runCheck([], "alice", fetcher, fast, new AbortController().signal, () => undefined)).toEqual([]);
  });
});
