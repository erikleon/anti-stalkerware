import { randomBytes } from "node:crypto";
import { fetchPage, mapLimited, type PageFetcher } from "./http";
import { buildRequest, classify, type SiteRule } from "./whatsmyname";

/**
 * Checks each WhatsMyName rule the way the app will use it, before it's
 * allowed to ship (scripts/verify-whatsmyname.mjs) and weekly afterwards
 * (.github/workflows/whatsmyname-weekly.yml). Runs on a developer's
 * machine or GitHub's servers, never a user's.
 *
 * A rule passes only if, in every run, a handle WhatsMyName lists as
 * existing comes back "found" and two random handles come back "missing".
 * Anything else, including "couldn't tell", fails it: a rule that can't
 * tell is no use to a user, and one that says "missing" for a real
 * account would be worse.
 */
export interface RuleVerdict {
  name: string;
  passed: boolean;
  /** Why it failed, for the report. */
  reason?: string;
  /**
   * How it failed. "wrong": the rule gave a false answer (a real account
   * reported missing, or a random name reported found) — it would mislead
   * a user. "unclear": no clear answer (blocked, rate limited, network
   * error, unexpected page) — often about where the test ran from; in the
   * app it shows as an honest "couldn't tell".
   */
  failure?: "wrong" | "unclear";
}

export interface VerifyOptions {
  runs?: number;
  concurrency?: number;
  timeoutMs?: number;
  /** Random handles to test "missing" with. Injected by tests. */
  randomHandle?: () => string;
  onProgress?: (done: number, total: number) => void;
}

/** 16 random lowercase letters and digits, starting with a letter: vanishingly unlikely to be a real account. */
export function randomHandle(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(16);
  return "z" + [...bytes.subarray(1)].map((b) => alphabet[b % alphabet.length]).join("");
}

async function ask(fetcher: PageFetcher, rule: SiteRule, handle: string, timeoutMs: number): Promise<string> {
  const request = buildRequest(rule, handle);
  if (!request) return "handle empty after the site's character rules";
  const page = await fetchPage(fetcher, request, AbortSignal.timeout(timeoutMs));
  if (!page.ok) return page.error;
  const result = classify(rule, page.status, page.body);
  return result.status === "unknown" ? result.reason : result.status;
}

async function verifyOne(fetcher: PageFetcher, rule: SiteRule, options: Required<Omit<VerifyOptions, "onProgress">>): Promise<RuleVerdict> {
  const known = rule.known.slice(0, 2);
  if (known.length === 0) return { name: rule.name, passed: false, failure: "unclear", reason: "no known handle to test with" };

  for (let run = 1; run <= options.runs; run++) {
    const answers: string[] = [];
    let found = false;
    for (const handle of known) {
      const answer = await ask(fetcher, rule, handle, options.timeoutMs);
      answers.push(`${handle}: ${answer}`);
      if (answer === "found") {
        found = true;
        break;
      }
    }
    if (!found) {
      // One known account can simply have been deleted. Every known account
      // answering "missing" means the rule would tell a user a real account
      // doesn't exist.
      const lied = answers.every((a) => a.endsWith(": not-found"));
      return { name: rule.name, passed: false, failure: lied ? "wrong" : "unclear", reason: `run ${run}: known handle not found (${answers.join("; ")})` };
    }

    for (let i = 0; i < 2; i++) {
      const handle = options.randomHandle();
      const answer = await ask(fetcher, rule, handle, options.timeoutMs);
      if (answer !== "not-found") {
        return { name: rule.name, passed: false, failure: answer === "found" ? "wrong" : "unclear", reason: `run ${run}: random handle ${handle} gave "${answer}"` };
      }
    }
  }
  return { name: rule.name, passed: true };
}

export async function verifyRules(rules: readonly SiteRule[], fetcher: PageFetcher, options: VerifyOptions = {}): Promise<RuleVerdict[]> {
  const settings = {
    runs: options.runs ?? 2,
    concurrency: options.concurrency ?? 8,
    timeoutMs: options.timeoutMs ?? 15_000,
    randomHandle: options.randomHandle ?? randomHandle,
  };
  let done = 0;
  return mapLimited(rules, settings.concurrency, async (rule) => {
    const verdict = await verifyOne(fetcher, rule, settings);
    options.onProgress?.(++done, rules.length);
    return verdict;
  });
}
