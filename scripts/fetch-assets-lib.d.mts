// Types for fetch-assets-lib.mjs, for the tests that import it.
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  url?: string;
  body: AsyncIterable<Uint8Array>;
}
export type FetchLike = (url: string, init: { redirect: "follow" }) => Promise<FetchResponseLike>;
export function validateManifest(manifest: unknown, label: string): void;
export function fetchManifest(manifestPath: string, options?: { fetchFn?: FetchLike; log?: (line: string) => void }): Promise<string[]>;
