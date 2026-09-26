import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../helpers/tmp-dir";
import { fetchManifest, validateManifest, type FetchLike } from "../../scripts/fetch-assets-lib.mjs";

const REV = "a".repeat(40);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function manifestFor(files: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return {
    source: "github",
    repo: "owner/repo",
    revision: REV,
    files: Object.entries(files).map(([name, body]) => ({ name, sha256: sha(body), bytes: Buffer.byteLength(body) })),
    ...overrides,
  };
}

function fakeFetch(bodies: Record<string, string>): FetchLike & { requested: string[] } {
  const requested: string[] = [];
  const fn: FetchLike = async (url) => {
    requested.push(url);
    const body = bodies[url];
    if (body === undefined) return { ok: false, status: 404, url, body: (async function* () {})() };
    return { ok: true, status: 200, url, body: (async function* () { yield Buffer.from(body); })() };
  };
  return Object.assign(fn, { requested });
}

describe("fetchManifest", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docket-fetch-assets-"));
  });
  afterEach(() => removeTestDir(dir));

  const url = (name: string) => `https://raw.githubusercontent.com/owner/repo/${REV}/${name}`;

  it("downloads each file from the pinned commit into the manifest's own folder", async () => {
    writeFileSync(join(dir, "rules.json"), JSON.stringify(manifestFor({ "data.json": "{}" })));
    const fetchFn = fakeFetch({ [url("data.json")]: "{}" });
    expect(await fetchManifest(join(dir, "rules.json"), { fetchFn })).toEqual(["data.json"]);
    expect(readFileSync(join(dir, "rules", "data.json"), "utf8")).toBe("{}");
  });

  it("leaves a file alone when it's already there with the right hash", async () => {
    writeFileSync(join(dir, "rules.json"), JSON.stringify(manifestFor({ "data.json": "{}" })));
    const fetchFn = fakeFetch({ [url("data.json")]: "{}" });
    await fetchManifest(join(dir, "rules.json"), { fetchFn });
    expect(await fetchManifest(join(dir, "rules.json"), { fetchFn })).toEqual([]);
    expect(fetchFn.requested).toHaveLength(1);
  });

  it("refuses a download whose hash doesn't match, and writes nothing", async () => {
    writeFileSync(join(dir, "rules.json"), JSON.stringify(manifestFor({ "data.json": "{}" })));
    await expect(fetchManifest(join(dir, "rules.json"), { fetchFn: fakeFetch({ [url("data.json")]: "[]" }) })).rejects.toThrow(/doesn't match its sha256/);
    expect(existsSync(join(dir, "rules", "data.json"))).toBe(false);
  });

  it("refuses a download larger than the manifest allows", async () => {
    const m = manifestFor({ "data.json": "{}" });
    writeFileSync(join(dir, "rules.json"), JSON.stringify(m));
    await expect(fetchManifest(join(dir, "rules.json"), { fetchFn: fakeFetch({ [url("data.json")]: "x".repeat(100) }) })).rejects.toThrow(/larger than/);
  });
});

describe("validateManifest", () => {
  const ok = manifestFor({ "data.json": "{}" });
  it.each([
    [{ ...ok, source: "example" }, /source must be/],
    [{ ...ok, repo: "../../etc" }, /repo must be/],
    [{ ...ok, revision: "main" }, /full 40-character commit/],
    [{ ...ok, files: [{ ...ok.files[0], name: "../escape.json" }] }, /bad file name/],
    [{ ...ok, files: [{ ...ok.files[0], name: "sub/dir.json" }] }, /bad file name/],
    [{ ...ok, files: [{ ...ok.files[0], bytes: 10 ** 12 }] }, /bad size/],
    [{ ...ok, files: [] }, /non-empty/],
  ])("refuses an unsafe manifest (%#)", (manifest, error) => {
    expect(() => validateManifest(manifest, "m.json")).toThrow(error);
  });

  it("accepts both real manifests in models/", () => {
    for (const name of ["toxicity.json", "whatsmyname.json"]) {
      expect(() => validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "..", "models", name), "utf8")), name)).not.toThrow();
    }
  });
});
