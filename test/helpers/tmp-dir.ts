import { rmSync } from "node:fs";

/**
 * Removes a mkdtempSync'd test directory, tolerating the transient lock
 * Windows can leave on a just-closed SQLite WAL/SHM file for a moment
 * after better-sqlite3's close() returns (memory-mapped file cleanup
 * lagging the close call itself) -- surfaced by CI on windows-latest as
 * EBUSY: resource busy or locked, unlink '...vault.db'. POSIX allows
 * unlinking an open file, so this never showed up on macOS/Linux.
 * fs.rmSync's own maxRetries/retryDelay options exist for exactly this
 * class of transient Windows EBUSY/EPERM -- every test tearing down a
 * directory that held a vault/db file should go through this instead of
 * calling rmSync directly, so the one explanation lives in one place.
 */
export function removeTestDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
