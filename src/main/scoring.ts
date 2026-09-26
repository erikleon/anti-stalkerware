import { loadToxicityModel, type LoadedToxicityModel } from "../score/toxicity-model";
import { rescoreUnscored, type RescoreResult } from "../score/rescore";
import type { Vault } from "../vault/vault";

export interface ScoringStatus {
  state: "idle" | "loading" | "scoring" | "ready" | "error";
  /** "<model id>@<revision>", once loaded. */
  modelVersion?: string;
  /** Why the model couldn't load or run. Shown in Settings. */
  error?: string;
  /** The most recent pass. */
  lastRun?: RescoreResult;
}

/**
 * Runs the toxicity model over the open vault in the background: after
 * unlock (a vault from before the model shipped, or after a model change)
 * and after every import. Import itself never waits on the model, and a
 * model that can't load never blocks an import; Settings shows why.
 *
 * One pass at a time. A request during a pass queues exactly one more
 * pass, so messages imported mid-pass are picked up. A pass stops between
 * messages if the vault locks or is replaced.
 */
export class ScoringService {
  private model: Promise<LoadedToxicityModel> | undefined;
  private running = false;
  private again = false;
  private current: ScoringStatus = { state: "idle" };

  constructor(
    private readonly modelsDir: string,
    private readonly getVault: () => Vault | undefined,
    private readonly onChange: (status: ScoringStatus) => void,
  ) {}

  status(): ScoringStatus {
    return this.current;
  }

  /** Scores whatever the current model hasn't scored yet. Returns once the pass (and any queued pass) is done; callers don't need to wait. */
  async scoreVault(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    let vault: Vault | undefined;
    try {
      do {
        this.again = false;
        vault = this.getVault();
        if (!vault) break;

        if (!this.model) {
          this.set({ state: "loading" });
          this.model = loadToxicityModel(this.modelsDir);
        }
        let model: LoadedToxicityModel;
        try {
          model = await this.model;
        } catch (err) {
          // Try loading again next time instead of remembering the failure forever.
          this.model = undefined;
          throw err;
        }

        this.set({ state: "scoring", modelVersion: model.version });
        const passVault = vault;
        const lastRun = await rescoreUnscored(passVault.scoring, model.classifier, model.version, () => this.getVault() === passVault);
        this.set({ state: "ready", modelVersion: model.version, lastRun });
      } while (this.again);
    } catch (err) {
      if (vault && this.getVault() !== vault) {
        // The vault locked mid-pass and its database closed under us: a
        // normal stop, not a failure. The next unlock picks up the rest.
        this.set({ state: "idle" });
        return;
      }
      console.error("toxicity scoring failed:", err);
      this.set({ state: "error", error: (err as Error).message });
    } finally {
      this.running = false;
    }
  }

  private set(status: ScoringStatus): void {
    this.current = status;
    this.onChange(status);
  }
}
