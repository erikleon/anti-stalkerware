import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  // Electron e2e tests are inherently slower than a browser context — one
  // real app launch per test file — so keep this suite small and reserve it
  // for window-level behavior (panic-hide, destroy confirmation, batch
  // triage actions) that can't be verified any other way.
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
});
