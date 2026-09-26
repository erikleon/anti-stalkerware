import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../helpers/tmp-dir";
import { buildRequest, classify, loadWhatsMyName, parseRules, profileUrl, type SiteRule } from "../../src/osint/network/whatsmyname";
import { fetchPage, isPublicHostname, type PageFetcher } from "../../src/osint/network/http";

const MODELS_DIR = join(__dirname, "..", "..", "models");

function wmnRule(overrides: Record<string, unknown> = {}) {
  return {
    name: "Example",
    uri_check: "https://example.com/u/{account}",
    e_code: 200,
    e_string: "profile-header",
    m_code: 404,
    m_string: "",
    known: ["alice"],
    cat: "social",
    ...overrides,
  };
}

function onlyRule(overrides: Record<string, unknown> = {}): SiteRule {
  const { rules, dropped } = parseRules({ sites: [wmnRule(overrides)] });
  expect(dropped).toEqual([]);
  return rules[0]!;
}

describe("parseRules", () => {
  it.each([
    [{ valid: false }, "marked broken upstream"],
    [{ protection: ["cloudflare"] }, "behind bot protection (cloudflare)"],
    [{ uri_check: "http://example.com/u/{account}" }, "not https"],
    [{ uri_check: "https://127.0.0.1/u/{account}" }, "not a public host"],
    [{ uri_check: "https://localhost/u/{account}" }, "not a public host"],
    [{ uri_check: "https://router.lan/u/{account}" }, "not a public host"],
    [{ uri_check: "https://{account}/u" }, "not a public host"],
    [{ uri_check: "https://example.{account}.com/u" }, "handle in the host"],
    [{ uri_check: "https://user:pw@example.com/{account}" }, "credentials in the URL"],
    [{ uri_pretty: "http://example.com/{account}" }, "profile link: not https"],
    [{ headers: { Cookie: "session=1" } }, "needs a header docket doesn't send (Cookie)"],
    [{ headers: { Host: "internal" } }, "needs a header docket doesn't send (Host)"],
    [{ post_body: "{\"q\":\"fixed\"}", headers: { "Content-Type": "application/json" } }, "POST body without the handle"],
  ])("drops an unsafe or unusable rule: %j", (overrides, reason) => {
    const { rules, dropped } = parseRules({ sites: [wmnRule(overrides)] });
    expect(rules).toEqual([]);
    expect(dropped).toEqual([{ name: "Example", reason }]);
  });

  it("keeps a rule whose only protection is a user-agent check (docket sends a browser one)", () => {
    expect(onlyRule({ protection: ["user-agent"] }).name).toBe("Example");
  });

  it("keeps a handle in the host only as a subdomain of a fixed domain", () => {
    expect(onlyRule({ uri_check: "https://{account}.tumblr.com/" }).uriCheck).toBe("https://{account}.tumblr.com/");
  });

  it("marks dating, adult, health, and political sites as sensitive", () => {
    expect(onlyRule({ cat: "dating" }).sensitive).toBe(true);
    expect(onlyRule({ cat: "xx NSFW xx" }).sensitive).toBe(true);
    expect(onlyRule({ cat: "coding" }).sensitive).toBe(false);
  });

  it("refuses data without a sites list", () => {
    expect(() => parseRules({})).toThrow(/no sites list/);
  });
});

describe("buildRequest", () => {
  it("fills the handle into a GET URL, encoded", () => {
    expect(buildRequest(onlyRule(), "alex_b.9")).toEqual({ url: "https://example.com/u/alex_b.9", method: "GET", headers: {} });
  });

  it("fills the handle into a POST body with the rule's headers", () => {
    const rule = onlyRule({ post_body: '{"username":"{account}"}', headers: { "Content-Type": "application/json" } });
    expect(buildRequest(rule, "alex")).toEqual({
      url: "https://example.com/u/alex",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"username":"alex"}',
    });
  });

  it("removes the site's disallowed characters, and gives up if nothing is left", () => {
    const rule = onlyRule({ strip_bad_char: "._" });
    expect(buildRequest(rule, "a.b_c")?.url).toBe("https://example.com/u/abc");
    expect(buildRequest(rule, "._")).toBeUndefined();
    expect(profileUrl(onlyRule({ uri_pretty: "https://example.com/@{account}" }), "alex")).toBe("https://example.com/@alex");
    // A POST API with no profile page gets no link, not the API's address.
    expect(profileUrl(onlyRule({ post_body: '{"u":"{account}"}', headers: { "Content-Type": "application/json" } }), "alex")).toBeUndefined();
  });
});

describe("classify", () => {
  const rule = onlyRule({ e_code: 200, e_string: "profile-header", m_code: 404, m_string: "" });

  it("found needs both the status and the string", () => {
    expect(classify(rule, 200, "<div class=profile-header>")).toEqual({ status: "found" });
    expect(classify(rule, 200, "<div>nothing here</div>")).toMatchObject({ status: "unknown" });
  });

  it("an empty missing-string means the status alone decides", () => {
    expect(classify(rule, 404, "anything")).toEqual({ status: "not-found" });
  });

  it("matching both is 'couldn't tell', not whichever came first", () => {
    const both = onlyRule({ e_code: 200, e_string: "", m_code: 200, m_string: "" });
    expect(classify(both, 200, "x")).toEqual({ status: "unknown", reason: "the answer matched both found and missing" });
  });

  it("names rate limits and bot-block pages instead of guessing", () => {
    expect(classify(rule, 429, "")).toEqual({ status: "unknown", reason: "rate limited" });
    expect(classify(rule, 200, "<title>Just a moment...</title>")).toEqual({ status: "unknown", reason: "blocked by bot protection" });
    expect(classify(rule, 500, "")).toEqual({ status: "unknown", reason: "unexpected answer (HTTP 500)" });
  });

  it("matches strings case-sensitively, like the upstream checker", () => {
    expect(classify(rule, 200, "PROFILE-HEADER")).toMatchObject({ status: "unknown" });
  });

  it("reads a redirect status as the answer when a rule expects one", () => {
    const redirecting = onlyRule({ e_code: 200, e_string: "", m_code: 302, m_string: "" });
    expect(classify(redirecting, 302, "")).toEqual({ status: "not-found" });
  });
});

describe("loadWhatsMyName", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-wmn-"));
  });
  afterEach(() => removeTestDir(dir));

  it("loads the pinned bundled data and validates its rules", async () => {
    const loaded = await loadWhatsMyName(MODELS_DIR);
    expect(loaded.rules.length).toBeGreaterThan(500);
    expect(loaded.rules.some((r) => r.name === "tumblr")).toBe(true);
    expect(loaded.dropped.every((d) => d.reason.length > 0)).toBe(true);
  });

  it("refuses data that doesn't match its pinned hash", async () => {
    cpSync(join(MODELS_DIR, "whatsmyname.json"), join(dir, "whatsmyname.json"));
    cpSync(join(MODELS_DIR, "whatsmyname"), join(dir, "whatsmyname"), { recursive: true });
    writeFileSync(join(dir, "whatsmyname", "wmn-data.json"), '{"sites":[]}');
    await expect(loadWhatsMyName(dir)).rejects.toThrow(/doesn't match models\/whatsmyname.json/);
  });

  it("says how to get the data when it's missing", async () => {
    cpSync(join(MODELS_DIR, "whatsmyname.json"), join(dir, "whatsmyname.json"));
    await expect(loadWhatsMyName(dir)).rejects.toThrow(/missing .*npm run fetch-assets/);
  });
});

function pageFetcher(status: number, body = "", onCall?: (url: string, init: Parameters<PageFetcher>[1]) => void): PageFetcher {
  return async (url, init) => {
    onCall?.(url, init);
    return { status, body: (async function* () { yield Buffer.from(body); })() };
  };
}

describe("fetchPage", () => {
  const signal = new AbortController().signal;

  it("never follows a redirect: the 3xx status is the answer", async () => {
    const calls: string[] = [];
    const result = await fetchPage(pageFetcher(302, "", (url, init) => {
      calls.push(url);
      expect(init.redirect).toBe("manual");
    }), { url: "https://example.com/u/a", method: "GET", headers: {} }, signal);
    expect(result).toEqual({ ok: true, status: 302, body: "" });
    expect(calls).toEqual(["https://example.com/u/a"]);
  });

  it("refuses an unsafe address before sending anything", async () => {
    let called = false;
    const result = await fetchPage(pageFetcher(200, "", () => (called = true)), { url: "https://10.0.0.1/x", method: "GET", headers: {} }, signal);
    expect(result).toEqual({ ok: false, error: "unsafe address" });
    expect(called).toBe(false);
  });

  it("stops reading a page larger than the limit", async () => {
    const result = await fetchPage(pageFetcher(200, "x".repeat(2000)), { url: "https://example.com/", method: "GET", headers: {} }, signal, 1000);
    expect(result).toEqual({ ok: false, error: "page too large" });
  });

  it("sends a rule's headers over the defaults, and a POST body", async () => {
    let seen: Parameters<PageFetcher>[1] | undefined;
    await fetchPage(pageFetcher(200, "", (_u, init) => (seen = init)), {
      url: "https://example.com/api",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: '{"u":"a"}',
    }, signal);
    expect(seen).toMatchObject({ method: "POST", body: '{"u":"a"}', headers: { "Content-Type": "application/json", Accept: "application/json" } });
    expect(seen!.headers["User-Agent"]).toMatch(/Mozilla/);
  });

  it("says 'stopped' or 'out of time' when aborted", async () => {
    const hang: PageFetcher = (_u, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const stop = new AbortController();
    const stopped = fetchPage(hang, { url: "https://example.com/", method: "GET", headers: {} }, stop.signal);
    stop.abort("stop");
    expect(await stopped).toEqual({ ok: false, error: "stopped" });
    const timer = new AbortController();
    const timedOut = fetchPage(hang, { url: "https://example.com/", method: "GET", headers: {} }, timer.signal);
    timer.abort("timeout");
    expect(await timedOut).toEqual({ ok: false, error: "out of time" });
  });
});

describe("isPublicHostname", () => {
  it.each([
    ["example.com", true],
    ["a.b.example.co.uk", true],
    ["localhost", false],
    ["printer.local", false],
    ["192.168.1.1", false],
    ["::1", false],
    ["intranet", false],
    ["1.0.0.127.in-addr.arpa", false],
  ])("%s → %s", (host, expected) => {
    expect(isPublicHostname(host)).toBe(expected);
  });
});
