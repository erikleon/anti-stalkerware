#!/usr/bin/env node
// Verifies every WhatsMyName rule against the live sites, using the app's
// own compiled engine (run `npm run build` first).
//
//   node scripts/verify-whatsmyname.mjs          # after changing the pin:
//                                                # writes passList and verifiedAt
//                                                # into models/whatsmyname.json
//   node scripts/verify-whatsmyname.mjs --check  # weekly: leaves the manifest alone,
//                                                # adds shipped rules that now give
//                                                # WRONG answers to
//                                                # models/whatsmyname-skip.json
//
// The weekly run skips only rules that give wrong answers (a real account
// reported missing, a random name reported found). Rules that merely
// couldn't answer are left alone: GitHub's servers get blocked by far more
// sites than a home connection does (20 failures there vs 2 from a home
// connection on 2026-09-26), and in the app such a site shows an honest
// "couldn't tell" rather than a false answer.
//
// Either way it writes a report to models/whatsmyname-report.md (not
// committed) listing every failure and why.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { loadWhatsMyName } = require(join(root, "dist", "osint", "network", "whatsmyname.js"));
const { verifyRules } = require(join(root, "dist", "osint", "network", "verify-rules.js"));

const checkOnly = process.argv.includes("--check");
const modelsDir = join(root, "models");
const manifestPath = join(modelsDir, "whatsmyname.json");
const skipPath = join(modelsDir, "whatsmyname-skip.json");

const loaded = await loadWhatsMyName(modelsDir);
const rules = checkOnly ? loaded.rules.filter((r) => loaded.manifest.passList.includes(r.name)) : loaded.rules;
console.log(`verifying ${rules.length} rules (${checkOnly ? "shipped rules only" : "every valid rule"})…`);

const verdicts = await verifyRules(rules, fetch, {
  onProgress: (done, total) => {
    if (done % 25 === 0 || done === total) console.log(`  ${done}/${total}`);
  },
});
const failed = verdicts.filter((v) => !v.passed);
const passed = verdicts.filter((v) => v.passed).map((v) => v.name).sort((a, b) => a.localeCompare(b));
const today = new Date().toISOString().slice(0, 10);

writeFileSync(
  join(modelsDir, "whatsmyname-report.md"),
  [
    `# WhatsMyName verification, ${today}`,
    "",
    `Revision ${loaded.manifest.revision}. ${passed.length} passed, ${failed.length} failed, ${loaded.dropped.length} dropped before testing.`,
    "",
    "## Failed: wrong answers (skipped by --check)",
    ...failed.filter((v) => v.failure === "wrong").map((v) => `- ${v.name}: ${v.reason}`),
    "",
    "## Failed: no clear answer from where this ran (not skipped by --check)",
    ...failed.filter((v) => v.failure !== "wrong").map((v) => `- ${v.name}: ${v.reason}`),
    "",
    "## Dropped (validation)",
    ...loaded.dropped.map((d) => `- ${d.name}: ${d.reason}`),
    "",
  ].join("\n"),
);

if (checkOnly) {
  const skip = JSON.parse(readFileSync(skipPath, "utf8"));
  const already = new Set(skip.skip.map((s) => s.name));
  const wrong = failed.filter((v) => v.failure === "wrong");
  const added = wrong.filter((v) => !already.has(v.name)).map((v) => ({ name: v.name, reason: v.reason, since: today }));
  console.log(`${failed.length - wrong.length} shipped rules couldn't answer from here (not skipped; see the report).`);
  skip.skip.push(...added);
  writeFileSync(skipPath, JSON.stringify(skip, null, 2) + "\n");
  console.log(`${added.length} newly failing shipped rules added to the skip list.`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `added=${added.length}\n`, { flag: "a" });
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.passList = passed;
  manifest.verifiedAt = today;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${passed.length} rules pass; written to models/whatsmyname.json.`);
}
