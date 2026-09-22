import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchWalFile, type WalWatcherHandle } from "../../../src/ingest/imessage/wal-watcher";

async function waitUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("watchWalFile", () => {
  let dir: string;
  let walPath: string;
  let handle: WalWatcherHandle | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "antistalker-wal-watch-test-"));
    walPath = join(dir, "chat.db-wal");
    writeFileSync(walPath, "initial");
  });

  afterEach(() => {
    handle?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("notifies when the WAL file changes", async () => {
    let notifications = 0;
    // Short poll interval so the test has a guaranteed backstop even in an
    // environment where native file-change events are unreliable — the
    // point under test is "a change is eventually noticed," not which
    // specific mechanism noticed it.
    handle = watchWalFile({ walPath, onActivity: () => notifications++, pollIntervalMs: 150, debounceMs: 10 });

    await new Promise((resolve) => setTimeout(resolve, 50));
    appendFileSync(walPath, "more data");

    await waitUntil(() => notifications > 0, 2000);
    expect(notifications).toBeGreaterThan(0);
  });

  it("does not notify when nothing has changed", async () => {
    let notifications = 0;
    handle = watchWalFile({ walPath, onActivity: () => notifications++, pollIntervalMs: 50, debounceMs: 10 });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(notifications).toBe(0);
  });

  it("tolerates the WAL file not existing yet", async () => {
    const missingPath = join(dir, "does-not-exist-yet-wal");
    let notifications = 0;
    handle = watchWalFile({ walPath: missingPath, onActivity: () => notifications++, pollIntervalMs: 50, debounceMs: 10 });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(notifications).toBe(0);

    writeFileSync(missingPath, "now it exists");
    await waitUntil(() => notifications > 0, 2000);
  });

  it("stop() prevents further notifications", async () => {
    let notifications = 0;
    handle = watchWalFile({ walPath, onActivity: () => notifications++, pollIntervalMs: 50, debounceMs: 10 });
    handle.stop();

    appendFileSync(walPath, "written after stop");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(notifications).toBe(0);
  });

  it("exposes a missed-event count that starts at zero", () => {
    handle = watchWalFile({ walPath, onActivity: () => {}, pollIntervalMs: 50, debounceMs: 10 });
    expect(handle.missedEventCount()).toBe(0);
  });
});
