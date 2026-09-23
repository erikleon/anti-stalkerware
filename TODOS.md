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

Depends on: the triage UI existing.

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
