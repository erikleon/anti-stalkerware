import { describe, expect, it } from "vitest";
import { join } from "node:path";
import type { Fetcher, PageFetcher } from "../../../src/osint/network/http";
import { UsernameCheckService, type UsernameProgress } from "../../../src/main/username-check-service";
import type { Vault } from "../../../src/vault/vault";

const MODELS_DIR = join(__dirname, "..", "..", "..", "models");
const vaultA = {} as Vault;

const everyoneMissing: PageFetcher = async () => ({ status: 404, body: (async function* () {})() });
const skipList = (body: string, status = 200): Fetcher => async () => ({ status, text: async () => body });

function service(options: { page?: PageFetcher; text?: Fetcher; getVault?: () => Vault | undefined } = {}) {
  const progress: UsernameProgress[] = [];
  const svc = new UsernameCheckService(MODELS_DIR, options.getVault ?? (() => vaultA), (p) => progress.push(p), {
    page: options.page ?? everyoneMissing,
    text: options.text ?? skipList('{"skip":[]}'),
  });
  const finished = () =>
    new Promise<UsernameProgress[]>((resolve) => {
      const t = setInterval(() => {
        if (progress.some((p) => p.finished)) {
          clearInterval(t);
          resolve(progress);
        }
      }, 5);
    });
  return { svc, progress, finished };
}

describe("UsernameCheckService", () => {
  it("describes the major tier and the sweep from the bundled, verified data", async () => {
    const info = await service().svc.info();
    expect(info.majorSites).toContain("GitHub (User)");
    expect(info.majorNotChecked.some((n) => n.name === "Instagram")).toBe(true);
    expect(info.allCount).toBeGreaterThan(200);
    expect(info.sensitiveCount).toBeGreaterThan(0);
    expect(info.attribution).toMatchObject({ license: "CC BY-SA 4.0", revision: expect.stringMatching(/^[0-9a-f]{40}$/) });
  });

  it("runs the major tier and reports every site, then a final 'finished' event", async () => {
    const { svc, finished } = service();
    const started = await svc.start({ handle: "@alex_b", tier: "major", includeSensitive: false });
    const events = await finished();
    const outcomes = events.filter((e) => e.outcome);
    expect(outcomes).toHaveLength(started.total);
    // Every site answers an empty 404. Rules that also need a "missing"
    // text on the page can't tell; none may say "found".
    expect(outcomes.some((e) => e.outcome!.status === "found")).toBe(false);
    expect(events.at(-1)).toMatchObject({ checkId: started.checkId, finished: true, done: started.total });
  });

  it("applies the remote skip list, and says so when it can't be fetched", async () => {
    const skipped = await service({ text: skipList('{"skip":[{"name":"GitHub (User)"}]}') }).svc.start({ handle: "alex", tier: "major", includeSensitive: false });
    expect(skipped.notChecked).toContainEqual({ name: "GitHub (User)", reason: "turned off since this version shipped (stopped working)" });
    const offline = await service({ text: skipList("", 503) }).svc.start({ handle: "alex", tier: "major", includeSensitive: false });
    expect(offline.note).toMatch(/Couldn't get the latest list/);
  });

  it("refuses an invalid handle before contacting anything", async () => {
    let contacted = false;
    const { svc } = service({ text: async () => ((contacted = true), { status: 200, text: async () => "{}" }) });
    await expect(svc.start({ handle: "not a handle", tier: "major", includeSensitive: false })).rejects.toThrow(/isn't a username/);
    expect(contacted).toBe(false);
  });

  it("stops when asked, ending every unfinished site as 'stopped'", async () => {
    const hang: PageFetcher = (_u, init) =>
      new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" }))));
    const { svc, finished } = service({ page: hang });
    const started = await svc.start({ handle: "alex", tier: "major", includeSensitive: false });
    svc.stop(started.checkId);
    const events = await finished();
    expect(events.filter((e) => e.outcome).every((e) => e.outcome!.detail === "stopped")).toBe(true);
  });

  it("stops by itself when the vault locks", async () => {
    let vault: Vault | undefined = vaultA;
    const hang: PageFetcher = (_u, init) =>
      new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" }))));
    const { svc, finished } = service({ page: hang, getVault: () => vault });
    await svc.start({ handle: "alex", tier: "major", includeSensitive: false });
    vault = undefined;
    const events = await finished();
    expect(events.at(-1)?.finished).toBe(true);
  }, 10_000);

  it("starting a second check stops the first", async () => {
    const hang: PageFetcher = (_u, init) =>
      new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" }))));
    const { svc, progress } = service({ page: hang });
    const first = await svc.start({ handle: "alex", tier: "major", includeSensitive: false });
    await svc.start({ handle: "sam", tier: "major", includeSensitive: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(progress.some((p) => p.checkId === first.checkId && p.finished)).toBe(true);
  });
});
