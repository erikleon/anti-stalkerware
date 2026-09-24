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

## 2. ~~Harden vault key management~~ DONE 2026-09-23

Addressed the threat model directly (a live unlocked session under a
laptop-password-holding adversary, the more realistic attack window
than an offline file): real inactivity auto-lock, `Settings.autoLockMinutes`
(default 15, 0 disables), checked every 30s in `main/index.ts` and reset
on every IPC request via `VaultSession.touch()`. A manual "Lock now" in
Settings once the mechanism existed to back it. A new test confirms
message text and raw payloads never leak into the vault's `-wal` file
either, not just the checkpointed main db.

Two of the five original sub-items are a deliberate decision and an
accepted platform limitation, not silently dropped — see `vault/crypto.ts`'s
doc comment:
- **argon2id over scrypt**: declined. Would need a native/WASM dependency
  for a marginal hardening gain over scrypt already run at OWASP's
  recommended memory-hard cost — not worth the native-build fragility
  this project already got burned by once.
- **Locking key material out of swap**: not possible from Node/V8
  without a native addon. The inactivity timeout is the real mitigation
  for this specific threat — it shortens the window, since actually
  closing it isn't available on this stack.
- **Clipboard clearing**: moot — nothing in the app copies vault content
  to the clipboard today.

Verified: `VaultSession`'s idle logic is unit-tested with fake timers
(touch/isIdle/unlock-resets-clock/lock-clears-idle). The manual "Lock
now" flow has a real e2e test (`test/e2e/lock-now.spec.ts`). The actual
auto-lock timer firing was verified by hand against the real running
app (set `autoLockMinutes` to 1, waited ~70s, watched it lock) rather
than automated — a real e2e test for it would need a 60-100s run just
for this one mechanism, which isn't worth the CI cost given the
underlying logic is already covered by the fake-timer unit tests; this
is a deliberate coverage tradeoff, not an oversight.

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

## 10. ~~No client-side validation on onboarding connect forms~~ DONE 2026-09-23

Scan is now disabled until each source's required fields are filled in:
`dbPath` for iMessage (starts enabled — a real default path is pre-filled),
`exportFilePath` for Android SMS, and host/user/app-password for IMAP
(port, mailbox, and the secure toggle all have working defaults already).
Checked reactively on every keystroke via a `revalidate()` closure that
updates the Scan button directly, without a full re-render — the existing
fields already mutate state without redrawing to avoid losing focus
mid-type, so this follows the same pattern rather than introducing a new one.

This retired the e2e test that used to cover connectImap()'s own
defensive error for an all-blank submission, since that path isn't
reachable through the UI anymore — replaced with tests asserting the
disabled/enabled transitions themselves
(`test/e2e/onboarding-error-handling.spec.ts`).

Found during a /qa pass (2026-09-23) testing what happens when a form is
submitted empty; the sweep-then-scan flow always had this gap, it just
hadn't been exercised end to end before.

## 11. ~~Onboarding/settings showed raw Electron IPC error text~~ DONE 2026-09-23

Found during the same /qa pass: a bad chat.db path, or an IMAP scan with
blank fields, showed Electron's own wrapper verbatim ("Error invoking
remote method 'onboarding:sweepImessage': TypeError: ...") or a bare
"Error: " prefix. `renderer/dom.ts`'s `ipcErrorMessage()` strips both;
used in onboarding's scan/connect error handling and settings' sync-now
failure toast. Verified via `test/e2e/onboarding-error-handling.spec.ts`
— couldn't unit-test the helper directly since importing anything from
`renderer/` into `test/unit/` pulls it into `tsconfig.eslint.json`'s
program, which has no DOM lib.

## 12. Some full-width buttons look heavier than intended

"Lock now" (Settings), "Add boundary" / "Add tagged phrase" (Boundaries
screen) stretch to the full width of their container because they're
direct children of a `flex-direction: column` form wrapper with the
default `align-items: stretch` — same mechanism as the primary "Export
to file…" CTA, which is intentionally full-width, but these read as
heavier than a secondary action probably should. Purely cosmetic, found
during the same /qa pass; not fixed here since it's a judgment call
about which buttons should read as primary vs. secondary, not a bug.

## 13. ~~Packaged releases~~ DONE 2026-09-23

Built with electron-builder: `npm run dist:mac/win/linux` locally, or
`.github/workflows/release.yml` on any `vX.Y.Z` tag push, which builds all
three on their native runners and attaches the artifacts to a matching
GitHub Release. Verified locally end to end on macOS — built a real `.dmg`,
installed the unpacked `.app`, and confirmed it launches without the
Electron ABI mismatch README already warns about (electron-builder's
`npmRebuild` step handles the better-sqlite3 rebuild automatically, same
as `npm start`'s own `prestart` hook).

Two real decisions, not defaults:
- **Unsigned.** Neither an Apple Developer ID nor a Windows code-signing
  certificate exists for this project, and both cost money someone would
  have to commit to. Shipping unsigned means a real, one-time Gatekeeper/
  SmartScreen warning on first launch instead of a silent block — annoying
  but honest, and documented in the README rather than hidden. Signing can
  be added later without changing anything else in the build config.
- **Product name "Notes."** D5's neutral-name-and-icon requirement finally
  has somewhere to attach: `package.json`'s `build.productName` is what
  Electron actually names the installed app (Applications folder, Dock,
  Start menu, `~/Library/Application Support/<name>` for the vault path)
  — not the internal `antistalker` package name, which only ever showed up
  in dev. The icon (`build/icon.svg`, rendered to `.icns`/`.ico`/`.png` via
  `qlmanage`'s QuickLook thumbnailer — no image-generation tool was needed)
  reuses the same page-with-lines glyph already on the marketing site.

Found and fixed along the way: electron-builder's default `files` handling
bundles `onnxruntime-node`'s prebuilt native binary for every platform
(darwin/linux/win32) into every build, not just the target one — an
easy-to-miss size bloat specific to packages that ship prebuilt binaries
per-platform. Fixed with a `files` exclude scoped to each of `mac`/`win`/
`linux` in the electron-builder config, verified locally by confirming only
the darwin `.node` file survived in a macOS `--dir` build's
`app.asar.unpacked`.

Left open: mac builds are single-arch (whatever `macos-latest`'s runner is
— currently Apple Silicon), not a universal binary; cross-arch/universal
support would need both `better-sqlite3` and `onnxruntime-node` rebuilt for
both architectures, which needs actual CI verification, not just local
guesswork on one machine's arch.

## 14. ~~Cross-platform test coverage~~ DONE 2026-09-24

Prompted by a request to make the app "work across multiple devices and
platforms." A `/plan-eng-review` pass split that into two questions:
whether "multiple devices" meant syncing one vault across machines a
person owns (it doesn't — that's a real, unscoped architecture project
that conflicts with the no-cloud/no-account design and wasn't what was
being asked for) versus just making sure the app genuinely works on
whichever OS someone has (it does, mostly, but nothing had ever verified
that beyond assumption). Landed on the second, narrower reading.

Added `.github/workflows/test.yml`: typecheck, lint, unit, and e2e (via
`xvfb-run` on Linux, since Electron needs a display server even for CI)
across macos-latest/windows-latest/ubuntu-latest, on every push to main
and every PR — separate from `release.yml`, which only builds and
publishes installers and never ran the test suite at all.

Auditing the codebase for platform-specific risk before trusting that CI
surfaced two real, pre-existing bugs, both fixed here rather than just
flagged:

- **The iMessage onboarding form's pre-filled default path never
  worked.** `~/Library/Messages/chat.db` was never expanded — Node/
  Electron don't do shell-style `~` expansion, and there's no shell
  between a text field and `better-sqlite3`'s `new Database()`. Verified
  directly: `path.resolve("~/Library/Messages/chat.db")` from this repo
  returns `<cwd>/~/Library/Messages/chat.db`. Clicking Scan with the
  untouched default always failed with "no such file or directory," on
  every install — the existing e2e test only checked the Scan button's
  enabled/disabled state, never actually clicked Scan on the unedited
  default. Fixed with a new `expandHome()` in `src/main/paths.ts`, called
  at the two points a raw `dbPath` enters the main process
  (`onboarding.ts`'s `sweepImessage`/`connectImessage`); unit-tested
  directly since it's a plain function with no Electron/DOM dependency.
- **The panic-hide hotkey's registration failure was silently
  swallowed.** `globalShortcut.register()`'s boolean return (whether the
  OS actually granted the shortcut) was discarded. This is a documented
  weak spot on Linux under Wayland, and can fail on any OS if another app
  already owns the key combo — and DESIGN.md calls this hotkey "the
  actual first line of defense." Fixed by threading the boolean through
  `registerHandlers` to a new `support:hotkeyStatus` IPC channel (not
  vault-gated, since Support is reachable pre-passphrase), surfaced as a
  plain status line on the Support screen — the same screen that already
  explains this hotkey and the no-coerced-unlock decision, rather than a
  toast that could be seen over someone's shoulder. Verified end to end
  in `test/e2e/lock-and-triage.spec.ts`.

Left open: mac/Windows/Linux binaries in CI build for whatever
architecture each GitHub-hosted runner uses (currently arm64 for
macos-latest) — same single-arch caveat item 13 already logged.

## 15. Instagram DM export adapter

A new `src/ingest/instagram/` adapter (mirroring android-sms's shape:
adapter.ts + metadata-sweep.ts + reader.ts) parsing the JSON export from
Instagram's "Download Your Information" tool
(`your_instagram_activity/messages/inbox/<person>/message_1.json`).
Closes a real, named harassment vector nothing in the app covers today,
using an export path that needs no live API/OAuth — consistent with D3/
D8's no-live-platform-API stance. Instagram gives personal accounts no
DM-reading API at all; the export is the only legitimate path in.

Two real caveats to design around, not just implement around: deleted/
unsent messages are NOT in the export (unlike the app's iMessage
WAL-recovery flagship feature — onboarding copy needs to say so, not
imply parity), and Meta's own export can take up to 30 days to prepare
with a 4-day download window, which rules out a "click Scan and go" flow
like Android SMS's.

Deferred 2026-09-24 (`/plan-eng-review`): scoped and researched, not
built — "social media, payment apps, email, and others" as one plan was
3-4 new adapters at once, which is exactly the complexity this kind of
review is supposed to catch before it starts. No dependency on any other
open item.

## 16. Payment-app (Venmo/PayPal/Cash App) transaction-note adapter

A new ingest adapter parsing the CSV/statement export these apps already
offer, extracting the public transaction-note field as message-like
content — financial harassment via payment notes (threats sent disguised
as small payment memos) is a real, documented DV-tech-abuse pattern nothing
in the app covers, and distinct from every existing vector, which are all
conversational. None of the three expose a harassment-relevant API; all
three support CSV/statement export instead, matching the existing
"parse a file the user exported" pattern (Venmo's own CSV export caps at
90 days, PayPal's at 3 months, though Venmo's separate "Request Your
Data" full export has no such cap).

Real open question, not just an ingest question: a transaction note is a
few words, not a conversation, so it needs its own presentation in
triage rather than being shoehorned into the existing thread view as-is.
Whoever picks this up should treat that as a small design pass, not an
implementation detail.

Deferred 2026-09-24 (`/plan-eng-review`), same reasoning as item 15.
