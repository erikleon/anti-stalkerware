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

## 4. ~~Keyboard power-navigation for the triage message list~~ DONE 2026-09-23

Built as a standard roving-tabindex list: ArrowDown/j and ArrowUp/k move
focus between row buttons, Enter opens the focused row (free — native
`<button>` behavior, no handler needed), r marks it reviewed, h hides it.
Focus survives a redraw — marking a row reviewed or hiding it removes it
from the list, and focus lands on the next available row rather than
getting stranded. No "space to select" — there's no multi-select/batch
action in the real triage screen (that was an aspirational detail from
the original TODO wording, not something DESIGN.md's built screens
actually have), so r/h act directly on the focused row instead.

Along the way, found and fixed a real bug: the row's open-control used
`display: contents` to avoid an extra layout box, which made it silently
unfocusable in this Chromium build — `.focus()` calls succeeded on the
element reference but `document.activeElement` never actually changed,
so keyboard nav would have done nothing at all. Fixed by giving it a
real (but still fully unstyled/transparent) flex box instead.

Verified end to end (`test/e2e/triage-keyboard-nav.spec.ts`): arrow/j/k
movement, Enter opening a thread, r and h against real seeded messages,
and bucket counts updating in response — closing the gap TODOS item 8
called out below.

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

## 7. ~~Settings UI for boundaries and tagged phrases~~ DONE 2026-09-23

Built in two parts. First, `triage/view.ts` was wired to actually run
`score/signals.ts`'s `StructuralSignalDetector` (all six detectors, not
just the two that need user input) across every vault message once per
list render, grouping fired signals by thread — a thread reaches
"medium" from a fired signal now, not just a toxicity score, and
`TriageRow.signalDetails` carries the human-readable reason. Second, a
real screen (`renderer/screens/boundaries.ts`, reached from Settings)
to author the boundaries and tagged phrases those detectors need,
stored in the vault via a new `UserContextStore`. Triage rows show the
fired reason as visible text, not a hover-only tooltip.

Verified end to end: tagging a phrase moves a real seeded message from
no badge to Medium with the reason shown, and removing the tag reverts
it (`test/e2e/boundaries-and-tagged-phrases.spec.ts`).

Surfaced a real bug along the way, since fixed: `.list-block` (used by
five other screens too — Settings sources, onboarding's candidate
picker, OSINT eligibility, export history, support resources) could
collapse to 0 height and silently swallow clicks on its rows, per a
non-obvious flexbox spec interaction with `overflow: hidden`. See the
fix's commit message and the comment on `.list-block` in `app.css` for
the mechanism — nothing about it was visible in a screenshot's text
content, only in an actual click landing somewhere else.

## 8. ~~Deeper e2e coverage with seeded vault data~~ DONE 2026-09-23

`test/e2e/lock-and-triage.spec.ts` covers first-run/unlock/lock-screen
flows against an empty vault. `test/e2e/onboarding.spec.ts` (added
2026-09-23) sidesteps the seeding problem entirely by seeding through
the app's own onboarding UI (an Android SMS export file) rather than
reaching into the vault directly from the test process — the ABI
mismatch this item originally worried about (the Playwright runner is
plain Node; the launched app is Electron's Node) never comes up,
because the test never touches better-sqlite3 itself.

`test/e2e/triage-keyboard-nav.spec.ts` (added 2026-09-23, alongside
item 4) closes the remaining gap: mark reviewed / hide against real
seeded messages, and bucket counts updating in response, are now
covered. ELECTRON_RUN_AS_NODE seeding turned out to be unnecessary
for this class of coverage entirely.

## 9. ~~Renderer isn't covered by the shared lint/typecheck-in-eslint setup~~ DONE 2026-09-23

`eslint.config.js` now has a second config block scoped to `renderer/**/*.ts`,
pointed at `renderer/tsconfig.json` (its own project, since it targets the
browser — DOM lib, ES module output — and can't share `tsconfig.eslint.json`
with src/test's Node/CommonJS project). `npm run lint` now runs `eslint src
test renderer`. Lint is clean except one expected warning (`no-console` on
the deliberate main-process-only log line in `vault-session.ts`).
