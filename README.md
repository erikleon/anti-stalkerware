# antistalker

A free, local-first desktop tool for people being harassed or stalked by an
ex or a stalker. Triages abusive messages, preserves evidence in a form that
survives a chain-of-custody challenge, and — gated, see below — attempts to
identify a suspected harasser from public signals.

The full plan, including 26 reviewed design decisions and an independent
adversarial critique, lives in `~/.claude/plans/2026-09-22-antistalker.md`.
Deferred work is tracked in `TODOS.md`.

## Status

Ingest (iMessage, Android SMS export, IMAP), the encrypted vault, and the
SCORE module (ONNX classifier + structural signal detectors) are built and
tested. The Electron app itself — main-process wiring, IPC, and the
renderer — now runs a real triage flow end to end: create/unlock a vault,
triage threads into Needs review / Reviewed / All, export, OSINT gate,
settings, and remove-local-app-data. No live OSINT signal-gathering
collector exists yet (deliberately deferred — see the plan); the OSINT
screen's gate is real, its ranked-leads list is honestly empty until one is
built. Onboarding (pointing an ingest adapter at a real chat.db, Android
export, or IMAP account) doesn't exist yet either — Settings shows every
source as "not connected."

## Setup

```
npm install
npm run typecheck
npm test
```

### Native module ABI: Node vs Electron

`better-sqlite3` is a native addon, not N-API-stable — it's compiled
against a specific V8/Node ABI. `npm install` builds it for whatever
`node` is on your PATH, which is what `npm test` (Vitest, running under
plain Node) needs. Electron bundles its own Node build with a different
ABI, so running the actual app needs the same addon rebuilt against
Electron's ABI instead, or you'll see every vault unlock silently fail
with "That passphrase didn't work" regardless of the passphrase (the
real error — a NODE_MODULE_VERSION mismatch — only shows up in the main
process's own stderr, never in the renderer, by design: see
`vault-session.ts`'s unlock() doc comment on why a real failure and a
wrong passphrase must look identical to the UI).

`npm start` and `npm run test:e2e` rebuild automatically for Electron's
ABI via their `pre*` npm hooks; `npm test` rebuilds back for plain Node
the same way. If you ever run the underlying commands directly (bypassing
npm's pre-hooks), rebuild manually first: `npm run rebuild:electron` or
`npm run rebuild:node`.

## Structure

```
src/
  main/     Electron main process, IPC registration (OSINT handlers must
            register through registerGated, never registerHandler directly),
            vault session lifecycle, settings storage
  ingest/   Per-source adapters (imessage, android-sms, imap) + quarantine
  vault/    Append-only store, encryption, credentials, integrity, destroy,
            export, and the separate (mutable) triage view-state store
  score/    Local toxicity classifier, structural signal detection, summarizer
  triage/   Composes vault threads + view-state into bucketed rows for the UI
  pipeline/ Runs an ingest adapter against the vault, classifying each message
  osint/    The unlock gate, eligibility listing, evidence signals, ranking
  ui/       Static renderer assets (index.html, tokens.css, app.css)
  types/    Shared Message/RawRecord types
renderer/   Renderer TypeScript (compiled separately — browser ES modules,
            not the CommonJS main process build; see renderer/tsconfig.json)
test/
  unit/     Vitest
  e2e/      Playwright, drives the real compiled Electron app (dist/) —
            run `npm run build` first
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
