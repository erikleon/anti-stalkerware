import { describe, expect, it } from "vitest";
import type { PageFetcher } from "../../src/osint/network/http";
import { parseRules } from "../../src/osint/network/whatsmyname";
import { randomHandle, verifyRules } from "../../src/osint/network/verify-rules";

const rule = parseRules({
  sites: [
    { name: "Example", uri_check: "https://example.com/u/{account}", e_code: 200, e_string: "profile", m_code: 404, m_string: "", known: ["gone", "alice"], cat: "social" },
  ],
}).rules[0]!;

/** Answers by handle: "found", "missing", "blocked", or a sequence per call. */
function siteFetcher(answers: Record<string, string | string[]>): PageFetcher & { calls: string[] } {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const fn: PageFetcher = async (url) => {
    const handle = url.split("/").pop()!;
    calls.push(handle);
    const spec = answers[handle] ?? "missing";
    const n = counts.get(handle) ?? 0;
    counts.set(handle, n + 1);
    const answer = Array.isArray(spec) ? spec[Math.min(n, spec.length - 1)]! : spec;
    const page = answer === "found" ? { status: 200, text: "<div>profile</div>" } : answer === "blocked" ? { status: 403, text: "captcha" } : { status: 404, text: "" };
    return { status: page.status, body: (async function* () { yield Buffer.from(page.text); })() };
  };
  return Object.assign(fn, { calls });
}

let n = 0;
const fixedRandom = () => `random${n++}`;

describe("verifyRules", () => {
  it("passes a rule that finds a known handle and misses two random ones, in both runs", async () => {
    const fetcher = siteFetcher({ gone: "missing", alice: "found" });
    const [verdict] = await verifyRules([rule], fetcher, { randomHandle: fixedRandom });
    expect(verdict).toEqual({ name: "Example", passed: true });
    // Per run: "gone" (missing), then "alice" (found), then two random handles.
    expect(fetcher.calls.filter((c) => c === "alice")).toHaveLength(2);
    expect(fetcher.calls.filter((c) => c.startsWith("random"))).toHaveLength(4);
  });

  it("fails when no known handle is found", async () => {
    const [verdict] = await verifyRules([rule], siteFetcher({}), { randomHandle: fixedRandom });
    expect(verdict).toMatchObject({ passed: false, reason: expect.stringContaining("known handle not found") });
  });

  it("fails when a random handle comes back found (the rule can't tell accounts apart)", async () => {
    const found = parseRules({
      sites: [{ name: "Loose", uri_check: "https://example.com/u/{account}", e_code: 200, e_string: "", m_code: 404, m_string: "", known: ["alice"], cat: "social" }],
    }).rules[0]!;
    const fetcher: PageFetcher = async () => ({ status: 200, body: (async function* () { yield Buffer.from("anything"); })() });
    const [verdict] = await verifyRules([found], fetcher, { randomHandle: fixedRandom });
    expect(verdict).toMatchObject({ passed: false, reason: expect.stringContaining('gave "found"') });
  });

  it("fails a rule that is blocked, rather than passing it on a technicality", async () => {
    const [verdict] = await verifyRules([rule], siteFetcher({ alice: "blocked", gone: "blocked" }), { randomHandle: fixedRandom });
    expect(verdict).toMatchObject({ passed: false, reason: expect.stringContaining("blocked by bot protection") });
  });

  it("fails a rule that only works once (the second run catches flukes)", async () => {
    const [verdict] = await verifyRules([rule], siteFetcher({ gone: "missing", alice: ["found", "blocked"] }), { randomHandle: fixedRandom });
    expect(verdict).toMatchObject({ passed: false, reason: expect.stringContaining("run 2") });
  });

  it("fails a rule with no known handles instead of skipping the test", async () => {
    const bare = parseRules({ sites: [{ name: "Bare", uri_check: "https://example.com/u/{account}", e_code: 200, e_string: "", m_code: 404, m_string: "", known: [], cat: "social" }] }).rules[0]!;
    const [verdict] = await verifyRules([bare], siteFetcher({}));
    expect(verdict).toEqual({ name: "Bare", passed: false, reason: "no known handle to test with" });
  });
});

describe("randomHandle", () => {
  it("is 16 characters a handle can use, and differs each time", () => {
    const a = randomHandle();
    expect(a).toMatch(/^z[a-z0-9]{15}$/);
    expect(randomHandle()).not.toBe(a);
  });
});
