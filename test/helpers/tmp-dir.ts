import { rmSync } from "node:fs";

/**
 * Removes a mkdtempSync'd test directory. On Windows, unlike POSIX,
 * deleting a file with any open handle fails with EBUSY -- surfaced by CI
 * on windows-latest, and traced to an actual leak: sqlite-store.test.ts
 * opened ad-hoc inline `new Database(dbPath, { readonly: true })` handles
 * to inspect table contents directly and never closed them (fixed
 * separately, in that file). POSIX's unlink-while-open semantics made
 * the leak invisible there.
 *
 * The retry budget here is defense-in-depth for the residual, genuinely
 * transient case (antivirus briefly scanning a just-written file is the
 * most commonly reported cause of this exact flake on GitHub-hosted
 * Windows runners) now that the deterministic leak is gone -- not a
 * substitute for closing every handle a test opens. fs.rmSync's own
 * maxRetries/retryDelay options exist for exactly this class of
 * transient Windows EBUSY/EPERM; every test tearing down a directory
 * that held a vault/db file should go through this instead of calling
 * rmSync directly, so the one explanation lives in one place.
 */
export function removeTestDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
