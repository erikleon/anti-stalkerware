# TODOS

Deferred items from the v1 plan review (2026-09-22). Not blocking v1
implementation; pick up after the core ingest/vault/score/triage lanes land.

## 1. Read Jigsaw Harassment Manager before building the triage UI

Spend a day reading Jigsaw's open-source Harassment Manager (Apache-2) before
writing `src/ui/triage`. Not reusing its code (different stack), but its
bucketing/batch-hide/documentation UX came from interviews with 27 journalists
and activists — real user research we don't have budget to redo. Reference
only, not a dependency.

Depends on: nothing. Do before UI work starts.

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
