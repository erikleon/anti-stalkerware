import { watch, statSync, type FSWatcher, type Stats } from "node:fs";
import { stat } from "node:fs/promises";

function tryStatSync(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

export interface WalWatcherOptions {
  walPath: string;
  onActivity: () => void;
  /** How often the safety poll checks the file, regardless of events. Default 20s, within the 15-30s range the design calls for. */
  pollIntervalMs?: number;
  /** Debounce window for coalescing a burst of fs.watch events into one onActivity call. */
  debounceMs?: number;
}

export interface WalWatcherHandle {
  stop(): void;
  /** Times the safety poll caught a change fs.watch's event didn't fire for — the metric that tells us whether FSEvents is actually reliable here. */
  missedEventCount(): number;
}

/**
 * Watches chat.db-wal for writes: fs.watch (backed by FSEvents on macOS)
 * as the primary, low-cost trigger, plus a slow safety poll as a backstop.
 * FSEvents is documented to coalesce or drop notifications under rapid
 * changes — exactly the condition that matters here, a burst of messages
 * arriving — so relying on it alone risks silently missing the moment we
 * needed to catch.
 */
export function watchWalFile(options: WalWatcherOptions): WalWatcherHandle {
  const pollIntervalMs = options.pollIntervalMs ?? 20_000;
  const debounceMs = options.debounceMs ?? 50;

  // Baseline from the file's state right now, not a sentinel — otherwise
  // the first check after start always looks like a change, since a file
  // that already existed with content never matches an unset -1 baseline.
  const initialStat = tryStatSync(options.walPath);
  let lastSeenSize = initialStat?.size ?? -1;
  let lastSeenMtimeMs = initialStat?.mtimeMs ?? -1;
  let missedEvents = 0;
  let debounceTimer: NodeJS.Timeout | undefined;
  let fsWatcher: FSWatcher | undefined;

  async function checkAndMaybeNotify(source: "event" | "poll"): Promise<void> {
    let stats;
    try {
      stats = await stat(options.walPath);
    } catch {
      // The WAL file doesn't exist between checkpoints, or momentarily
      // during a checkpoint's truncate — not an error, just nothing to do.
      return;
    }
    const changed = stats.size !== lastSeenSize || stats.mtimeMs !== lastSeenMtimeMs;
    if (!changed) return;

    if (source === "poll" && fsWatcher === undefined) {
      // fs.watch isn't even active (already stopped) — not a "missed" event.
    } else if (source === "poll") {
      missedEvents++;
    }

    lastSeenSize = stats.size;
    lastSeenMtimeMs = stats.mtimeMs;
    options.onActivity();
  }

  try {
    fsWatcher = watch(options.walPath, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void checkAndMaybeNotify("event"), debounceMs);
    });
  } catch {
    // The file may not exist yet at startup (WAL mode hasn't produced one).
    // The poll below will pick it up once it appears, but this watcher
    // instance stays poll-only from then on — it doesn't retry attaching
    // fs.watch later. Acceptable in practice: a WAL file created by SQLite
    // persists across checkpoints (TRUNCATE zeroes it, doesn't delete it),
    // so this only matters in the narrow window before the very first
    // write chat.db has ever made in WAL mode.
  }

  const pollTimer = setInterval(() => void checkAndMaybeNotify("poll"), pollIntervalMs);
  // Don't hold the process open just for this timer.
  pollTimer.unref?.();

  return {
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollTimer);
      fsWatcher?.close();
      fsWatcher = undefined;
    },
    missedEventCount() {
      return missedEvents;
    },
  };
}
