import type { Fetcher, PageFetcher } from "../osint/network/http";
import { loadWhatsMyName, type LoadedWhatsMyName } from "../osint/network/whatsmyname";
import { normalizeHandle } from "../osint/network/username-presence";
import {
  fetchSkipList,
  MAJOR_SCHEDULE,
  runCheck,
  selectSites,
  SWEEP_SCHEDULE,
  type CheckRequest,
  type NotChecked,
  type SiteOutcome,
} from "../osint/network/username-check";
import type { Vault } from "../vault/vault";

/** What the screen shows before a check: who would be contacted, and where the rules come from. */
export interface UsernameCheckInfo {
  majorSites: string[];
  majorNotChecked: NotChecked[];
  allCount: number;
  sensitiveCount: number;
  /** Sites per category in the sweep, sensitive ones excluded. */
  categories: Record<string, number>;
  attribution: { source: string; license: string; revision: string; verifiedAt: string | null };
}

export interface UsernameProgress {
  checkId: number;
  done: number;
  total: number;
  outcome?: SiteOutcome;
  finished: boolean;
}

export interface StartedCheck {
  checkId: number;
  total: number;
  notChecked: NotChecked[];
  /** Set when the remote skip list couldn't be used. */
  note?: string;
}

/**
 * Runs username checks for the OSINT screen, one at a time. A check
 * stops when the user presses Stop, starts another check, leaves the
 * screen (the renderer calls stop), or when the vault locks — checked
 * every second while a check runs, since a lock doesn't wait for sites to
 * answer. Progress goes to the renderer as each site answers.
 */
export class UsernameCheckService {
  private data: Promise<LoadedWhatsMyName> | undefined;
  private current: { id: number; controller: AbortController; watch: ReturnType<typeof setInterval> } | undefined;
  private nextId = 1;

  constructor(
    private readonly modelsDir: string,
    private readonly getVault: () => Vault | undefined,
    private readonly send: (progress: UsernameProgress) => void,
    private readonly fetchers: { page: PageFetcher; text: Fetcher },
  ) {}

  private load(): Promise<LoadedWhatsMyName> {
    if (!this.data) {
      this.data = loadWhatsMyName(this.modelsDir).catch((err: unknown) => {
        // Try again next time instead of remembering the failure forever.
        this.data = undefined;
        throw err;
      });
    }
    return this.data;
  }

  async info(): Promise<UsernameCheckInfo> {
    const data = await this.load();
    const major = selectSites(data, new Set(), { tier: "major", includeSensitive: false });
    const all = selectSites(data, new Set(), { tier: "all", includeSensitive: false });
    const withSensitive = selectSites(data, new Set(), { tier: "all", includeSensitive: true });
    const categories: Record<string, number> = {};
    for (const site of all.sites) categories[site.category] = (categories[site.category] ?? 0) + 1;
    return {
      majorSites: major.sites.map((s) => s.name),
      majorNotChecked: major.notChecked,
      allCount: all.sites.length,
      sensitiveCount: withSensitive.sites.length - all.sites.length,
      categories,
      attribution: {
        source: "WhatsMyName (github.com/WebBreacher/WhatsMyName)",
        license: "CC BY-SA 4.0",
        revision: data.manifest.revision,
        verifiedAt: data.manifest.verifiedAt,
      },
    };
  }

  async start(request: CheckRequest): Promise<StartedCheck> {
    const handle = normalizeHandle(request.handle);
    if (!handle) throw new Error(`"${request.handle}" isn't a username that can be checked (letters, numbers, dots, dashes, and underscores only)`);
    this.stopCurrent();

    const data = await this.load();
    const skip = await fetchSkipList(this.fetchers.text);
    const { sites, notChecked } = selectSites(data, skip.names, request);

    const id = this.nextId++;
    const controller = new AbortController();
    const vault = this.getVault();
    const watch = setInterval(() => {
      if (this.getVault() !== vault) controller.abort();
    }, 1_000);
    this.current = { id, controller, watch };

    const schedule = request.tier === "major" ? MAJOR_SCHEDULE : SWEEP_SCHEDULE;
    let done = 0;
    void runCheck(sites, handle, this.fetchers.page, schedule, controller.signal, (outcome) => {
      this.send({ checkId: id, done: ++done, total: sites.length, outcome, finished: false });
    })
      .catch((err: unknown) => {
        console.error("username check failed:", err);
      })
      .finally(() => {
        clearInterval(watch);
        if (this.current?.id === id) this.current = undefined;
        this.send({ checkId: id, done, total: sites.length, finished: true });
      });

    return { checkId: id, total: sites.length, notChecked, ...(skip.note ? { note: skip.note } : {}) };
  }

  stop(checkId: number): void {
    if (this.current?.id === checkId) this.stopCurrent();
  }

  private stopCurrent(): void {
    if (!this.current) return;
    clearInterval(this.current.watch);
    this.current.controller.abort();
    this.current = undefined;
  }
}
