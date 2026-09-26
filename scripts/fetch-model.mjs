#!/usr/bin/env node
// Downloads the toxicity model files listed in models/toxicity.json into
// models/toxicity/, from the pinned Hugging Face revision, and checks each
// file's SHA-256 against the manifest. A file that's already present with
// the right hash is left alone, so this is cheap to run before every build
// and test run. A hash mismatch fails loudly and deletes nothing it didn't
// just download.
//
// This runs on developer machines and in CI only. The packaged app bundles
// the files (electron-builder.cjs, extraResources) and never downloads
// anything.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "models", "toxicity.json"), "utf8"));
const destDir = join(root, "models", "toxicity");
mkdirSync(destDir, { recursive: true });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const file of manifest.files) {
  const dest = join(destDir, file.name);
  if (existsSync(dest) && sha256(readFileSync(dest)) === file.sha256) continue;

  const url = `https://huggingface.co/${manifest.id}/resolve/${manifest.revision}/${file.name}`;
  console.log(`downloading ${file.name} (${(file.bytes / 1e6).toFixed(1)} MB) from ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed for ${file.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  const actual = sha256(bytes);
  if (actual !== file.sha256) {
    throw new Error(`${file.name} does not match models/toxicity.json: expected sha256 ${file.sha256}, got ${actual}`);
  }
  const partial = `${dest}.partial`;
  writeFileSync(partial, bytes);
  rmSync(dest, { force: true });
  renameSync(partial, dest);
}
console.log(`toxicity model ready in models/toxicity (${manifest.id}@${manifest.revision.slice(0, 7)})`);
