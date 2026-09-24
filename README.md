# antistalker

A free, local-first desktop tool for people being harassed or stalked by an
ex or a stalker. Triages abusive messages, preserves evidence in a form that
survives a chain-of-custody challenge, and — gated, see below — attempts to
identify a suspected harasser from public signals.

An informational site (not the app itself — the app runs entirely on your
own machine) is at **https://erikleon.github.io/anti-stalkerware/**, built
from `docs/`.

The full plan, including 26 reviewed design decisions and an independent
adversarial critique, lives in `~/.claude/plans/2026-09-22-antistalker.md`.
Deferred and completed-since-the-plan work is tracked in `TODOS.md`, and
design decisions (the locked color/typography system, plus later ones like
the coerced-unlock stance) live in `DESIGN.md`.

## Status

Ingest (iMessage, Android SMS export, IMAP), the encrypted vault, and the
SCORE module (ONNX classifier + structural signal detectors) are built and
tested. The Electron app runs a real flow end to end:

- **Onboarding** (Settings → Connect) — a real wizard per source: connect,
  a metadata-only scan (no vault write yet), a "before you continue" screen
  naming how many senders were found, then a checkbox picker before
  anything is actually imported. Required fields are validated client-side
  before Scan is even clickable.
- **Triage** — buckets into Needs review / Reviewed / All, with keyboard
  power-navigation (arrow keys or j/k, Enter, r, h), per-row and batch
  hide/mark-reviewed, previews blurred by default (a real privacy shield,
  not just a toggle that does nothing), and a visible reason — not just a
  score — when a thread is flagged: the ONNX classifier for overt toxicity,
  or a structural signal (contact after a boundary you've marked, a tagged
  phrase, escalating frequency, a channel switch) for patterns that don't
  read as toxic on their own. Boundaries and tagged phrases are authored
  from Settings.
- **Vault auto-lock** — configurable inactivity timeout (default 15
  minutes, 0 disables it), plus a manual "Lock now."
- **Export, the OSINT gate, and remove-local-app-data** are real.
- **No live OSINT signal-gathering collector** exists yet (deliberately
  deferred — see the plan). The gate is real; the ranked-leads list is
  honestly empty until a collector is built, rather than showing anything
  fabricated.
- **No coerced-unlock / duress-passphrase mechanism**, deliberately — see
  DESIGN.md's "Coerced unlock" section for why a decoy vault or a duress
  wipe were both considered and turned down, and what the actual mitigation
  is instead (the panic-hide hotkey, disclosed plainly on the Support
  screen rather than left undiscovered until someone needs it).

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
            export, plus the separate (mutable, non-evidentiary) stores:
            triage view-state, onboarding source config, and user-authored
            boundaries/tagged phrases for the structural detectors
  score/    Local toxicity classifier, structural signal detection, summarizer
  triage/   Composes vault threads + view-state + fired signals into
            bucketed, banded rows for the UI
  pipeline/ Runs an ingest adapter against the vault, classifying each message
  osint/    The unlock gate, eligibility listing, evidence signals, ranking
  ui/       Static renderer assets (index.html, tokens.css, app.css)
  types/    Shared Message/RawRecord types
renderer/   Renderer TypeScript (compiled separately — browser ES modules,
            not the CommonJS main process build; see renderer/tsconfig.json).
            One file per screen under screens/ — lock, triage, onboarding,
            vault-export, osint, settings, boundaries, destroy, support.
docs/       The informational site above (GitHub Pages, served from here on
            main) — not part of the app; nothing in it runs on a user's device
test/
  unit/     Vitest
  e2e/      Playwright, drives the real compiled Electron app (dist/) —
            run `npm run build` first
qa-reports/ Test plans and dated /qa pass reports
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
