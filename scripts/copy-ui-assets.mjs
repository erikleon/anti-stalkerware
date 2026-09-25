#!/usr/bin/env node
// Copies the renderer's static, non-compiled assets (HTML, CSS) into
// dist/ui alongside the compiled JS from renderer/tsconfig.json, so
// dist/ is the one complete, loadable output directory — matching how
// dist/main already holds compiled main-process JS.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcUiDir = join(repoRoot, "src", "ui");
const distUiDir = join(repoRoot, "dist", "ui");

mkdirSync(distUiDir, { recursive: true });
cpSync(srcUiDir, distUiDir, { recursive: true });

console.log(`copied ${srcUiDir} -> ${distUiDir}`);

// Browser ES modules from npm packages, copied as single files the
// renderer imports by relative path (no bundler). Each must have no
// imports of its own. Types come from renderer/vendor/*.d.ts.
const vendorDir = join(distUiDir, "vendor");
mkdirSync(vendorDir, { recursive: true });
const vendored = [["minisiwyg-editor/dist/index.js", "minisiwyg-editor.js"]];
for (const [from, to] of vendored) {
  cpSync(join(repoRoot, "node_modules", from), join(vendorDir, to));
  console.log(`copied node_modules/${from} -> dist/ui/vendor/${to}`);
}
