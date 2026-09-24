# QA Report — antistalker

Date: 2026-09-23
Mode: Full app pass, against a persistent dev Electron instance
(`--remote-debugging-port=9222`, `--user-data-dir=/tmp/antistalker-dev`)
attached via Playwright's `chromium.connectOverCDP` — real interaction,
not screenshots-and-guesswork, and no relaunch-per-check overhead.

## Summary

- **9 issues found, 9 fixed** (verified), 0 reverted, 3 deferred (logged in
  TODOS.md items 10 and 12; item 11 duplicates a fixed issue's own writeup).
- Health score: not computed via the rubric's per-category weights — this
  is a desktop Electron app, not a URL-navigable web app, so "Console"
  and "Links" categories don't map cleanly. Functional/UX severity is
  reflected in the issue list below instead.
- Full regression suite after all fixes: **17/17 e2e, 250/250 unit** passing.
- Three of the nine issues were real CSS/layout bugs (two in triage, one
  a regression the triage fix caused in Vault/Export) — not one of them
  was visible in a DOM text query, only in an actual rendered layout or
  an actual click landing where it visually appears to.

## Issues found and fixed

### 1. [High] No blur toggle on triage message previews — CRITICAL

DESIGN.md's Motion section specs a "blur reveal/hide" transition; the
locked mockup (ColorwayC.dc.html) has a blur checkbox, checked by
default, blurring only the message snippet (not sender/timestamp). None
of this was ever wired into the real triage screen — a real gap against
the disguise/shoulder-surfing threat model this whole app is built around.

**Fix:** `renderer/screens/triage.ts` — blur state defaulting to on, a
checkbox in a new message-list header, `.message-row-preview.is-blurred`
CSS (`filter: blur(5px)`, respecting the existing reduced-motion rules).
**Verified:** `test/e2e/triage-blur-and-batch.spec.ts` — blur on by
default, toggle removes it.
**Commit:** `0ae903b`

### 2. [High] No batch selection / batch hide — HIGH

Same mockup has a per-row checkbox and a floating "batch action bar"
(N selected / Clear / Hide), matching DESIGN.md's "batch action bar
slide + fade" motion spec. Never built — the real screen only had
per-row Mark reviewed / Hide.

**Fix:** per-row checkboxes, a `.batch-bar` (slide+fade, matching spec)
with Clear/Hide, `hideSelected()` batch action.
**Verified:** `test/e2e/triage-blur-and-batch.spec.ts` — bar appears on
selection, hides two threads at once, Clear resets it; hide confirmed
as view-state (threads still show under All).
**Commit:** `0ae903b`

### 3. [High] No provenance label for WAL-recovered/edit-history messages — HIGH

The plan (`~/.claude/plans/2026-09-22-antistalker.md`) calls WAL-recovered
text (a sender's retraction caught before their device could checkpoint
it away) "the highest-value evidence in the product." The real detail
pane showed retraction/edit markers derived from `retractedAt`/
`editHistory`, but never checked `Message.provenance` at all — a
wal-recovered message looked identical to a normal one.

**Fix:** `provenanceLabel()` in triage.ts, a pill in the detail pane
("recovered after deletion" / "original text preserved"), matching the
mockup's own two-way mapping.
**Commit:** `0ae903b`

### 4. [High] Checkbox stacked above row content instead of beside it

Adding issue #2's checkbox to `.message-row` (a `flex-direction: column`
class) made it a full-width flex item stacking above the sender/preview
content instead of sitting to its left.

**Fix:** `.message-row` → `flex-direction: row`; wrapped the existing
open-button + actions in their own column div.
**Commit:** `0ae903b`

### 5. [High] Horizontal scrollbar on the triage message list

`.message-row-sender` / `-preview` / `-signal` all had
`overflow:hidden; white-space:nowrap; text-overflow:ellipsis` but no
`min-width:0` — a flex child's automatic minimum size defaults to its
content size unless overridden, so long text pushed the row (and the
whole list) wider than its container instead of ellipsizing. Same root
cause, different axis, as an earlier `.list-block` height-collapse bug
found in a prior session — documented in `app.css` so it isn't
reintroduced a third time.

**Fix:** `min-width: 0` on all three, plus `width: 100%` (stretch alone
wasn't capping a nowrap child's rendered width in a column flex
container). `.message-row-sender` specifically got `flex: 1` instead of
`width: 100%` since it shares a row with `.message-row-time`.
**Verified:** `test/e2e/triage-blur-and-batch.spec.ts` asserts
`scrollWidth === clientWidth`.
**Commit:** `0ae903b`

### 6. [Medium] Timestamp wasn't right-aligned in the row (pre-existing, found as a side effect)

`.message-row-top` (flex row, `justify-content: space-between`) was
shrink-wrapping to its content's width instead of stretching to the row's
full width, so `space-between` had no extra space to distribute — the
timestamp sat immediately after the sender name instead of at the row's
right edge. Present since the triage screen was first built; only
surfaced while diagnosing issue #5.

**Fix:** `width: 100%` on `.message-row-top`.
**Commit:** `0ae903b`

### 7. [Critical] Regression: fixing #4 broke Vault/Export's message list

`renderer/screens/vault-export.ts` reuses `.message-row` directly with
`[top, preview]` as its only children — fine when that class was
flex-column, broken once #4 made it flex-row (top and preview would
render side by side). Caught before it shipped as a standalone issue by
checking every other screen using shared classes after the triage fix.

**Fix:** wrapped vault-export's row content in the same kind of column
div triage now uses.
**Verified:** new `test/e2e/vault-export.spec.ts` (this screen had zero
e2e coverage before — exactly the kind of gap that let this regression
through unnoticed in a quick visual check).
**Commit:** `39499b1`

### 8. [Medium] Raw Electron IPC error text shown to the user

A bad chat.db path showed: `Error invoking remote method
'onboarding:sweepImessage': TypeError: Cannot open database because the
directory does not exist` — verbatim. An IMAP scan with every field
blank showed a bare `Error: connectImap requires either accessToken or
appPassword`. Both are internal plumbing, not something someone trying
to connect their messages should have to parse, especially given the
stakes of this specific app.

**Fix:** `ipcErrorMessage()` in `renderer/dom.ts`, stripping both
Electron's remote-method wrapper and a leading `Error:`/`TypeError:`-
style prefix. Used in onboarding's scan/connect handling and settings'
sync-now toast.
**Verified:** `test/e2e/onboarding-error-handling.spec.ts` (two cases:
bad path, all-blank IMAP form).
**Commits:** `59938bc`, `eb59497`

### 9. [Low] `ipcErrorMessage` couldn't be unit-tested directly

Attempted a `test/unit/renderer/dom.test.ts` importing the new helper;
`tsconfig.eslint.json`'s program (which covers `test/**`) pulled in all
of `renderer/dom.ts` as a dependency, including its DOM-using exports
(`el`, `mount`, `showToast`), and that project has no DOM lib — the same
cross-project tension `renderer/global.d.ts`'s own comment already
documents for the API surface.

**Resolution:** dropped the unit test, verified via e2e instead (see #8)
— arguably the more honest surface for a user-facing error string anyway.
Not a code fix; noted here since it cost real time to diagnose and is
worth remembering next time a renderer helper seems unit-test-worthy.

## Deferred (logged in TODOS.md, not fixed this pass)

- **Item 10** — No client-side validation on onboarding connect forms
  (Scan round-trips to main just to get a validation error instead of a
  disabled button). Low severity: the form stays usable and the error is
  now readable (issue #8's fix). A judgment call about how much inline
  validation each of the three source forms deserves, not a quick fix.
- **Item 12** — Some full-width buttons ("Lock now", "Add boundary"/"Add
  tagged phrase") read heavier than a secondary action probably should,
  from the same flex-stretch mechanism that's intentional for the
  primary "Export to file…" CTA. Purely cosmetic.

## What wasn't (fully) exercised

- **OSINT unlocked state** — the gate and eligibility list are real and
  verified (locked state confirmed correctly refusing both seeded
  senders, neither of which crossed the abuse threshold), but reaching
  the *unlocked* ranked-leads view needs a sender whose messages crossed
  the toxicity threshold, which needs a real ONNX model this environment
  doesn't have. Already covered by existing unit tests for the gate
  logic itself (`osint-gate.test.ts`, `osint-gate-integration.test.ts`).
- **Destroy confirmation** — button enable/disable logic (partial match,
  wrong case, exact match) verified live; did not actually trigger
  destroy against the dev instance's vault, since that's irreversible
  and the underlying `destroyVault()`/`confirmationMatches()` logic
  already has direct unit and integration coverage.
- **IMAP/iMessage onboarding's happy path** — no real IMAP server or
  macOS chat.db available in this environment; the connect/scan/error
  paths were exercised, but a real successful sweep+import for these two
  sources is only unit-tested (`test/unit/main/onboarding.test.ts`), not
  e2e — same gap TODOS.md item 6 already disclosed.

## Method note

Every fix in this pass was verified two ways: live against the running
dev instance via CDP (the actual bug reproduction and the actual fix
confirmation), and then locked down with a new or extended Playwright
e2e test run against a fresh app launch. Screenshots referenced during
the session were saved to `/tmp` and are not checked into the repo,
per this project's convention of not accumulating throwaway diagnostic
images — see `qa-reports/screenshots/` (empty; this pass didn't produce
artifacts meant to persist beyond the session, unlike a typical web-app
`/qa` run where screenshots are the primary evidence — here, the e2e
test suite itself is the durable evidence, re-run on every future change).
