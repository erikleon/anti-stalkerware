# antistalker

A free, local-first desktop tool for people being harassed or stalked by an
ex or a stalker. Triages abusive messages, preserves evidence in a form that
survives a chain-of-custody challenge, and — gated, see below — attempts to
identify a suspected harasser from public signals.

The full plan, including 26 reviewed design decisions and an independent
adversarial critique, lives in `~/.claude/plans/2026-09-22-antistalker.md`.
Deferred work is tracked in `TODOS.md`.

## Status

Early scaffold. Module boundaries and types exist; the ingest, vault, score
and OSINT modules are stub interfaces, not working implementations yet.

## Setup

```
npm install
npm run typecheck
npm test
```

`better-sqlite3` is deliberately not yet a dependency — it needs a working
native C++ toolchain to build, and isn't used by any code yet. Add it back
when the SQLite-backed ingest/vault work actually starts.

## Structure

```
src/
  main/     Electron main process, IPC registration (OSINT handlers must
            register through registerGated, never registerHandler directly)
  ingest/   Per-source adapters (imessage, android-sms, imap) + quarantine
  vault/    Append-only store, encryption, credentials, integrity, destroy
  score/    Local toxicity classifier, structural signal detection, summarizer
  osint/    The unlock gate, evidence signals, ranking
  ui/       Renderer (placeholder)
  types/    Shared Message/RawRecord types
test/
  unit/     Vitest
  e2e/      Playwright, drives the real Electron app
```

## Design constraints worth knowing before touching this code

- Nothing in `ingest`, `score`, `vault`, or the triage UI ever makes a
  network call. Only `osint` does, and it must say so visibly when it runs.
- The vault has no delete method anywhere in its API. "Hide" is a UI-only
  view-state flag.
- The OSINT gate (`osint/unlock.ts`) is friction against casual misuse, not
  verification of anything. Its output can never enter an evidentiary
  export or be presented as a confirmed identity.
- No silent failures on ingest. A record that can't be parsed goes to
  quarantine, visibly, never a silent skip.
