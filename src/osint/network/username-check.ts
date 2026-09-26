import { fetchPage, fetchText, type Fetcher, type PageFetcher } from "./http";
import { buildRequest, classify, profileUrl, type LoadedWhatsMyName, type SiteRule } from "./whatsmyname";

/**
 * One username check: which sites to ask, and asking them.
 *
 *   selectSites ─► sites that passed verification
 *                  ∩ tier (the named major platforms, or all)
 *                  − sensitive categories unless the user opted in
 *                  − the remote skip list (remove-only)
 *   runCheck ────► scheduler ─► per site: build request ─► fetchPage ─► classify
 *                  (default tier: 8 at once; sweep: adaptive, jittered,
 *                  one request per website at a time), until done,
 *                  Stop, or the time limit
 */

export interface CheckRequest {
  handle: string;
  tier: "major" | "all";
  /** Adds dating, adult, health, and political sites (sweep only). */
  includeSensitive: boolean;
}

export interface NotChecked {
  name: string;
  reason: string;
}

export interface Selection {
  sites: SiteRule[];
  notChecked: NotChecked[];
}

export type SiteStatus = "found" | "not-found" | "unknown";

export interface SiteOutcome {
  site: string;
  category: string;
  profileUrl: string;
  status: SiteStatus;
  /** For "unknown": why. */
  detail?: string;
}

export function selectSites(loaded: LoadedWhatsMyName, skip: ReadonlySet<string>, request: Pick<CheckRequest, "tier" | "includeSensitive">): Selection {
  const passed = new Set(loaded.manifest.passList);
  const byName = new Map(loaded.rules.map((r) => [r.name, r]));
  const notChecked: NotChecked[] = [];
  const sites: SiteRule[] = [];

  const candidates =
    request.tier === "major"
      ? loaded.manifest.majorPlatforms.flatMap((name) => {
          const rule = byName.get(name);
          if (!rule) {
            notChecked.push({ name, reason: "no usable rule" });
            return [];
          }
          return [rule];
        })
      : loaded.rules;

  for (const rule of candidates) {
    if (!passed.has(rule.name)) {
      if (request.tier === "major") notChecked.push({ name: rule.name, reason: "didn't pass verification" });
      continue;
    }
    if (rule.sensitive && !(request.tier === "all" && request.includeSensitive)) continue;
    if (skip.has(rule.name)) {
      notChecked.push({ name: rule.name, reason: "turned off since this version shipped (stopped working)" });
      continue;
    }
    sites.push(rule);
  }
  return { sites, notChecked };
}

export const SKIP_LIST_URL = "https://raw.githubusercontent.com/erikleon/docket/main/models/whatsmyname-skip.json";

/**
 * The remote skip list: names only, so it can turn shipped rules off but
 * never add a site or change where a request goes. A failed download
 * isn't an error; the check runs on the bundled list and says so.
 */
export async function fetchSkipList(fetcher: Fetcher, url = SKIP_LIST_URL): Promise<{ names: Set<string>; note?: string }> {
  const response = await fetchText(fetcher, url, 5_000);
  if (!response.ok || response.status !== 200) {
    return { names: new Set(), note: `Couldn't get the latest list of broken sites (${response.ok ? `HTTP ${response.status}` : response.error}), so every verified site is included.` };
  }
  try {
    const parsed = JSON.parse(response.body) as { skip?: Array<{ name?: unknown }> };
    const names = (parsed.skip ?? []).map((s) => s.name).filter((n): n is string => typeof n === "string");
    return { names: new Set(names) };
  } catch {
    return { names: new Set(), note: "The latest list of broken sites couldn't be read, so every verified site is included." };
  }
}

export interface Schedule {
  initial: number;
  max: number;
  /** Random wait before each request, in ms. */
  jitterMs: [number, number];
  /** Clean answers in a row before allowing one more request at once. */
  stepUpAfter: number;
  /** Overall time limit, in ms. */
  deadlineMs: number;
}

export const MAJOR_SCHEDULE: Schedule = { initial: 8, max: 8, jitterMs: [0, 0], stepUpAfter: Infinity, deadlineMs: 60_000 };
export const SWEEP_SCHEDULE: Schedule = { initial: 4, max: 12, jitterMs: [100, 400], stepUpAfter: 10, deadlineMs: 180_000 };

const THROTTLED = new Set(["rate limited", "blocked by bot protection"]);

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

const sleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

async function checkSite(fetcher: PageFetcher, rule: SiteRule, handle: string, signal: AbortSignal): Promise<SiteOutcome> {
  const base = { site: rule.name, category: rule.category, profileUrl: profileUrl(rule, handle) };
  const request = buildRequest(rule, handle);
  if (!request) return { ...base, status: "unknown", detail: "this site doesn't allow the characters in that name" };
  const page = await fetchPage(fetcher, request, signal);
  if (!page.ok) return { ...base, status: "unknown", detail: page.error };
  const result = classify(rule, page.status, page.body);
  return result.status === "unknown" ? { ...base, status: "unknown", detail: result.reason } : { ...base, status: result.status };
}

function hostOf(rule: SiteRule): string {
  return new URL(rule.uriCheck.replaceAll("{account}", "x")).hostname;
}

/**
 * Asks every site, reporting each outcome as it arrives. Ends when every
 * site has answered, or `signal` aborts (Stop, leaving the screen, the
 * vault locking) or the schedule's time limit passes; sites not reached by
 * then are reported as "couldn't tell" with that reason, so the result
 * always covers every selected site.
 */
export async function runCheck(
  sites: readonly SiteRule[],
  handle: string,
  fetcher: PageFetcher,
  schedule: Schedule,
  signal: AbortSignal,
  onOutcome: (outcome: SiteOutcome) => void,
  options: { sleep?: Sleep; random?: () => number } = {},
): Promise<SiteOutcome[]> {
  const wait = options.sleep ?? sleep;
  const random = options.random ?? Math.random;
  const controller = new AbortController();
  const abortWith = (reason: string) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  if (signal.aborted) abortWith("stop");
  signal.addEventListener("abort", () => abortWith("stop"), { once: true });
  const deadline = setTimeout(() => abortWith("timeout"), schedule.deadlineMs);

  const results: SiteOutcome[] = [];
  const report = (outcome: SiteOutcome) => {
    results.push(outcome);
    onOutcome(outcome);
  };
  const queue = [...sites];
  const busyHosts = new Set<string>();
  let running = 0;
  let limit = schedule.initial;
  let clean = 0;

  try {
    await new Promise<void>((resolve) => {
      const finishIfDone = () => {
        if (controller.signal.aborted && running === 0) {
          const why = controller.signal.reason === "timeout" ? "out of time" : "stopped";
          for (const rule of queue.splice(0)) {
            report({ site: rule.name, category: rule.category, profileUrl: profileUrl(rule, handle), status: "unknown", detail: why });
          }
        }
        if (queue.length === 0 && running === 0) resolve();
      };

      const launch = (rule: SiteRule, host: string) => {
        running++;
        busyHosts.add(host);
        void (async () => {
          const [low, high] = schedule.jitterMs;
          await wait(low + random() * (high - low), controller.signal);
          const outcome = controller.signal.aborted
            ? { site: rule.name, category: rule.category, profileUrl: profileUrl(rule, handle), status: "unknown" as const, detail: controller.signal.reason === "timeout" ? "out of time" : "stopped" }
            : await checkSite(fetcher, rule, handle, controller.signal);
          running--;
          busyHosts.delete(host);
          report(outcome);
          if (outcome.detail && THROTTLED.has(outcome.detail)) {
            limit = Math.max(1, Math.floor(limit / 2));
            clean = 0;
          } else if (++clean >= schedule.stepUpAfter) {
            limit = Math.min(schedule.max, limit + 1);
            clean = 0;
          }
          pump();
        })();
      };

      const pump = () => {
        while (!controller.signal.aborted && running < limit) {
          const index = queue.findIndex((rule) => !busyHosts.has(hostOf(rule)));
          if (index === -1) break;
          const rule = queue.splice(index, 1)[0]!;
          launch(rule, hostOf(rule));
        }
        finishIfDone();
      };

      controller.signal.addEventListener("abort", () => finishIfDone(), { once: true });
      pump();
    });
  } finally {
    clearTimeout(deadline);
  }
  return results;
}
