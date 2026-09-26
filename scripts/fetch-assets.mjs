#!/usr/bin/env node
// Downloads every pinned asset listed by a manifest in models/ (the
// toxicity model, the WhatsMyName site rules) and checks each file's
// SHA-256. Files already present with the right hash are left alone, so
// this is cheap to run before every build and test run.
//
// Runs on developer machines and in CI only. Installers bundle the files
// (electron-builder.cjs, extraResources); the installed app never
// downloads them.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchManifest } from "./fetch-assets-lib.mjs";

const modelsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
// Only the pinned-asset manifests: "<name>.json" files, not the skip list.
const manifests = readdirSync(modelsDir).filter((f) => f.endsWith(".json") && !f.endsWith("-skip.json"));

for (const file of manifests) {
  await fetchManifest(join(modelsDir, file), { log: console.log });
  console.log(`${file}: ready`);
}
