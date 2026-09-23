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

## 6. Onboarding: point an ingest adapter at a real source

`src/ingest/*/adapter.ts` and `src/pipeline/run-ingest.ts` are real and
tested, but nothing in the app lets a user select a chat.db file, an
Android SMS export, or enter IMAP credentials. Settings currently shows
every source as honestly "not connected" (`settings:listSources` in
`src/main/handlers.ts`) rather than fabricating a status. Needs its own
design pass — this is the point where a user hands the app access to
their actual messages, which deserves more care than a file picker.

Depends on: nothing blocking; the pipeline it plugs into already exists.

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
flows against an empty vault. Testing the actual triage interactions
(mark reviewed, hide, bucket counts updating) against a real message
needs seed data written through the same better-sqlite3 native ABI the
launched Electron process uses — the Playwright test runner itself runs
under plain Node, so it can't just `import` vault.ts directly without
hitting the same NODE_MODULE_VERSION mismatch documented in the README.
The fix is running the seed script under Electron's own Node runtime
(`ELECTRON_RUN_AS_NODE=1`) rather than the test runner's, not yet built.

## 9. Renderer isn't covered by the shared lint/typecheck-in-eslint setup

`eslint.config.js` type-aware lints against `tsconfig.eslint.json`, which
only includes `src/**` and `test/**` — `renderer/**` compiles and
typechecks on its own (`renderer/tsconfig.json`, run separately in
`npm run typecheck`) but `npm run lint` never touches it. Low priority:
renderer code is small and typechecked, just not linted.
