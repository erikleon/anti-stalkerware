// Downloads the files a manifest in models/ lists, from a pinned source,
// and checks each one's SHA-256. Used by scripts/fetch-assets.mjs (every
// manifest) and tested by test/unit/fetch-assets.test.ts.
//
// A manifest decides what gets downloaded and where it's written, so it's
// validated strictly before anything happens: only two sources, a full
// commit hash, plain file names, a size limit per file, and every
// destination inside that manifest's own folder.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

const SOURCES = {
  huggingface: (m, name) => `https://huggingface.co/${m.repo}/resolve/${m.revision}/${name}`,
  github: (m, name) => `https://raw.githubusercontent.com/${m.repo}/${m.revision}/${name}`,
};

const MAX_BYTES = 200 * 1024 * 1024;

export function validateManifest(manifest, label) {
  const fail = (why) => {
    throw new Error(`${label}: ${why}`);
  };
  if (!Object.hasOwn(SOURCES, manifest.source)) fail(`source must be one of ${Object.keys(SOURCES).join(", ")}`);
  if (typeof manifest.repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repo)) fail("repo must be owner/name");
  if (typeof manifest.revision !== "string" || !/^[0-9a-f]{40}$/.test(manifest.revision)) fail("revision must be a full 40-character commit hash");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail("files must be a non-empty list");
  for (const file of manifest.files) {
    if (typeof file.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.name)) fail(`bad file name ${JSON.stringify(file.name)}`);
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) fail(`bad sha256 for ${file.name}`);
    if (!Number.isInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_BYTES) fail(`bad size for ${file.name}`);
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(fetchFn, url, limit) {
  const response = await fetchFn(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.url && !response.url.startsWith("https://")) throw new Error(`redirected to a non-https URL: ${response.url}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) throw new Error(`larger than the ${limit} bytes the manifest allows`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * Makes every file in one manifest present and correct. A file already
 * there with the right hash is left alone. Returns the names downloaded.
 */
export async function fetchManifest(manifestPath, { fetchFn = fetch, log = () => undefined } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const label = basename(manifestPath);
  validateManifest(manifest, label);

  const destDir = resolve(manifestPath.replace(/\.json$/, ""));
  mkdirSync(destDir, { recursive: true });
  const downloaded = [];

  for (const file of manifest.files) {
    const dest = resolve(destDir, file.name);
    if (!dest.startsWith(destDir + sep)) throw new Error(`${label}: ${file.name} would be written outside ${destDir}`);
    if (existsSync(dest) && sha256(readFileSync(dest)) === file.sha256) continue;

    const url = SOURCES[manifest.source](manifest, file.name);
    log(`downloading ${file.name} (${(file.bytes / 1e6).toFixed(1)} MB) from ${url}`);
    let bytes;
    try {
      bytes = await download(fetchFn, url, file.bytes);
    } catch (err) {
      throw new Error(`${label}: download failed for ${file.name}: ${err.message}`);
    }
    const actual = sha256(bytes);
    if (actual !== file.sha256) throw new Error(`${label}: ${file.name} doesn't match its sha256 (got ${actual})`);

    const partial = `${dest}.partial`;
    writeFileSync(partial, bytes);
    rmSync(dest, { force: true });
    renameSync(partial, dest);
    downloaded.push(file.name);
  }
  return downloaded;
}

