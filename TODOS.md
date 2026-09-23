# TODOS

Deferred items from the v1 plan review (2026-09-22). Not blocking v1
implementation; pick up after the core ingest/vault/score/triage lanes land.

## 1. ~~Read Jigsaw Harassment Manager — retroactive check against the design~~ DONE 2026-09-23

Read the real component structure at `conversationai/harassment-manager`
(not just its README) and diffed it against `DESIGN.md`. Findings written
into `DESIGN.md`'s "Diff against Jigsaw's Harassment Manager" section. The
one real gap it surfaced — a dedicated crisis-resources / find-support
section, which their interviews with 27 journalists and activists apparently
found important enough to build as a first-class part of the app — is
TODO item 5 below.

## 2. Harden vault key management

`vault/crypto.ts` needs a concrete spec, not just "encrypted with a separate
passphrase": KDF choice and parameters (argon2id), locking decrypted material
in memory, an inactivity auto-lock timeout, clipboard clearing after copy, and
confirming SQLite's own WAL/journal files never leak plaintext outside the
encrypted container. The threat model is a live unlocked session under a
laptop-password-holding adversary, which is the more realistic attack window
than an offline file.

Depends on: `vault/crypto.ts` and `vault/store.ts` existing (parallelization
lane 2).

## 3. Design the shared-device / coerced-unlock safety flow

Not addressed by any decision in the plan review: what happens when the
abuser is physically present and demands the vault be unlocked, or the device
is genuinely shared. Options span a duress passphrase (opens a decoy-empty
vault — a known technique with real complexity and a way to fail under
pressure) to no special handling (refusal to unlock is itself a tell). This is
a documented pattern in DV tech-abuse literature and deserves its own design
pass, not a bolt-on.

Depends on: `vault/crypto.ts` (lane 2) and TODO 2 above, since a duress
mechanism is part of the same key-management design.

## 4. Keyboard power-navigation for the triage message list

Arrow keys (or j/k) to move focus through the message list, space to
toggle selection, enter to open detail — for triaging a large backlog
quickly without reaching for the mouse. Not blocking: real tab/click
accessibility already works (see `DESIGN.md`), this is a speed enhancement
for power users, not a gap.

The triage UI now exists (`renderer/screens/triage.ts`), so this is
unblocked — still not urgent, still a speed enhancement, not a gap.

## 5. ~~Crisis-resources / find-support section~~ DONE 2026-09-23

Designed and built: a fifth app-level nav icon ("Support and resources"),
listing three national US services verified against their own official
pages (National DV Hotline, Crisis Text Line, RAINN), plus a "Help" link
on the lock screen reachable before the passphrase — crisis help isn't
gated behind vault security. Full writeup in `DESIGN.md`'s "Support and
resources" section; screen is on the comparison board.

Left open, for later: whether the resource list should be configurable
(international users, regional resources) rather than hardcoded — a real
product question, not answered here.

## 6. ~~Onboarding: point an ingest adapter at a real source~~ DONE 2026-09-23

Built: Settings has a real Connect action per source, opening a wizard
(`renderer/screens/onboarding.ts`) — connect, scan (metadata only, no
vault write), DESIGN.md's D7 "before you continue" screen, a checkbox
picker, then connect + first sync in one step. Connection config lives
in the vault (`vault/source-config.ts`), not a plain settings file,
since it reveals exactly who's being monitored; the IMAP app password
goes through the existing `CredentialStore`. Verified end to end against
the real app (`test/e2e/onboarding.spec.ts`): connecting an Android SMS
export through the actual wizard UI, and the imported message showing
up in triage afterward.

Left open: no checkpoint persistence, so "Sync now" always re-scans the
whole source (correct — append() dedupes by hash — just not efficient
for a large mailbox or export). iMessage and IMAP onboarding are wired
identically but only unit-tested (real chat.db / IMAP server access
isn't available in this environment); Android SMS is the one path
verified through a real e2e run.

## 7. Settings UI for boundaries and tagged phrases

`score/signals.ts`'s structural detectors (contact after a marked
boundary, user-tagged phrases) need a `DetectionContext` built from
user-authored data, and there's no UI to author it. Right now
`src/triage/view.ts`'s band assignment (`bandOf()`) is driven by
toxicity score alone — a thread only reaches "medium" via the ONNX
classifier's score, never via a fired structural signal. Wiring the
detectors in once this UI exists is a small change to `bandOf()`/
`listTriageRows()`; the gap is the settings screen to collect the input.

Depends on: TODO 6's onboarding flow existing would make this more
useful but isn't a hard dependency — boundaries/tagged phrases don't
need a live source, only past vault data.

## 8. Deeper e2e coverage with seeded vault data

`test/e2e/lock-and-triage.spec.ts` covers first-run/unlock/lock-screen
flows against an empty vault. `test/e2e/onboarding.spec.ts` (added
2026-09-23) sidesteps the seeding problem entirely by seeding through
the app's own onboarding UI (an Android SMS export file) rather than
reaching into the vault directly from the test process — the ABI
mismatch this item originally worried about (the Playwright runner is
plain Node; the launched app is Electron's Node) never comes up,
because the test never touches better-sqlite3 itself.

Still not covered: mark reviewed / hide against a real message, and
bucket counts updating in response — the onboarding-seeded message
gets the triage screen a non-empty state, but no test yet interacts
with it there. Extending onboarding.spec.ts to do that is the natural
next step; ELECTRON_RUN_AS_NODE seeding is no longer necessary for
this class of coverage.

## 9. ~~Renderer isn't covered by the shared lint/typecheck-in-eslint setup~~ DONE 2026-09-23

`eslint.config.js` now has a second config block scoped to `renderer/**/*.ts`,
pointed at `renderer/tsconfig.json` (its own project, since it targets the
browser — DOM lib, ES module output — and can't share `tsconfig.eslint.json`
with src/test's Node/CommonJS project). `npm run lint` now runs `eslint src
test renderer`. Lint is clean except one expected warning (`no-console` on
the deliberate main-process-only log line in `vault-session.ts`).
