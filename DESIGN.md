# docket — Design System

Produced via `/plan-design-review` on 2026-09-22/23. Locked colorway:
**C — Quiet Utility**. Interactive comparison board (11 screens: 5 colorway/
lock-screen explorations plus the full screen set — triage, vault/export,
OSINT locked/unlocked, settings, destroy confirmation — all in the locked
colorway) lives at https://claude.ai/artifact/UbyVgyfQwzPY4exVa9W17S.

## Why this direction

Dark, near-monochrome, JetBrains Mono throughout, sharp corners. Reads like
a plain-text editor or terminal tool — the opposite of anything that would
draw a second look on a shared device, in a dock, or over someone's
shoulder. This is a functional requirement (D5 in the eng plan: neutral
name/icon so the app doesn't stand out), not just an aesthetic preference —
every other explored direction (institutional blue, warm sage, and
especially a bright "Barbie" palette) was weighed against how loud it would
be on-screen, and this was the quietest.

## Color tokens

Dark is the default (matches the "quiet utility" concept); light tokens are
specified in full since some users will have their OS set to light mode and
the app must not force a theme.

```
                  DARK (default)         LIGHT
--bg              #17191d               #f4f5f2
--surface         #1e2126               #ffffff
--surface-hover   #262a30               #ececea
--border          #2d3138               #dcdcd8
--text            #d7dbe0               #1c1e21
--text-dim        #868e99               #6b7178
--accent          #7b8794               #4a525e
--accent-contrast #17191d               #ffffff
--focus-ring      #9aa4b1               #4a525e
--high-bg/-fg     #3a2422 / #e2897d     #fbe3e6 / #a5324a
--med-bg/-fg      #37301f / #d8b568     #fbecd0 / #8f630b
--reviewed-fg     #7fa08a               #5c7657
```

Off-white on near-black (not pure white on pure black) and off-black on
off-white in both directions — reduces eye strain versus maximum-contrast
extremes. **Verified** (not just principled) against the real WCAG relative-
luminance formula for every text/background pair used in the app, both
themes — 21 pairs checked, all pass their required ratio (4.5:1 normal
text, 3:1 for the UI-component focus ring). Two light-mode values failed
on first pass and were corrected here:

- `--med-fg` (light): `#92650b` → `#8f630b` (was 4.41:1 on `--med-bg`, now 4.55:1)
- `--reviewed-fg` (light): `#5f7a5a` → `#5c7657` (was 4.34:1 on `--bg`, now 4.59:1)

Both are light-mode only in the current mockup (light theme was specified but
never rendered on the comparison board), so this correction lives here in
the spec, not in a mockup file. Verification script: `scripts/check-contrast.mjs`
— run it after changing any color token; a value that looks fine isn't the
same as one that passes.

## Typography

**JetBrains Mono**, one typeface, both UI chrome and data (sender names,
timestamps, message text). Deliberate: reinforces the plain-text-tool
disguise, and a monospace grid gives timestamps and metadata a legible,
scannable rhythm without a second typeface to load or maintain.

Sizes in use: 11px (dim metadata), 12-12.5px (body/list text), 14-15px
(message text, pane headers), nothing larger — this is a dense information
tool, not an editorial layout.

## Spacing & radius

Spacing follows a loose 4px rhythm (8, 10, 11, 12, 16, 18, 20, 28, 32px seen
in the mockup — not yet snapped to a strict token scale; do that when the
real component library is built, not before).

Radius: 2-3px everywhere. Sharp, not rounded — part of what distinguishes
this direction from the warmer alternatives explored and rejected.

## Motion

**Functional only, never ambient or decorative** (D8). Every animation
ties to a user-triggered state change:

- Row background transitions on hover/select: 120ms ease
- Batch action bar slide + fade in/out: 160ms ease
- Blur reveal/hide: 150ms ease

`prefers-reduced-motion: reduce` disables all of the above via a single
media query — never build a transition without pairing it with this.
Nothing on this app auto-plays, idles, or moves without a click.

## Accessibility requirements

- **Minimum 24×24px hit target** on every interactive control (checkboxes,
  icon buttons), per WCAG 2.5.8 — applies to pointer/mouse interfaces, not
  just touch. The triage mockup's checkboxes need this fixed before build
  (currently 16-18px visual size; pad the hit area, the visual size can
  stay smaller than the hit area).
- Real semantic elements only: `<button>`, `<input>` + `<label>`,
  `<a href>`. Never a `div` with `onClick`.
- `:focus-visible` outline (2px, `--focus-ring`) on every interactive
  element, never suppressed.
- `aria-label` on every icon-only button.
- `aria-current="true"` on the active bucket-nav item.
- Landmark regions: `<nav aria-label="Message buckets">` and
  `<nav aria-label="App sections">` (both in the mockup); add `role="main"`
  on the detail/content pane when it's built.

## App-level navigation

A 48px icon-only strip, left of the bucket rail, present on every screen
(D5): Triage (home), Vault/Export, OSINT, Settings — in that order, OSINT
showing a lock glyph when nothing is unlocked. `aria-current="true"` marks
the active section; each icon is a real `<a href>`, not a div.

## Layout

Desktop only, 3-pane on triage: icon strip (48px) → bucket rail (216px) →
message list (420px) → detail pane (flexible width). Other screens vary
(vault/export is 2-pane; settings and destroy confirmation are single-column
forms). **Minimum window size 900×600**
(`BrowserWindow({ minWidth: 900, minHeight: 600 })`, D9) — below that, the
OS simply refuses to shrink the window further, rather than building
responsive collapse logic for a desktop app.

## Disguise vs. loud features

Not everything in this app can be quiet. OSINT (per the eng plan) makes
real outbound network calls and is explicitly the one loud exception — the
UI must show a visible "generates internet traffic" indicator whenever it's
active, per the eng plan. Nothing else in the app should ever need one.

## Interaction states (triage screen)

See the full table from the design review for loading/empty/error/success/
partial specs per feature. Key decisions:

- Onboarding can be skipped; triage shows a genuine empty state rather than
  blocking entry (D6).
- Wrong passphrase and a corrupted vault show the **identical** message
  (D19 from the eng review) — this is a security property, not a UI
  oversight if it looks "unhelpful."
- Quarantine count is a small link, not a badge — visible, not alarming.
- No toast by default for Hide/Mark-reviewed actions; the state change
  itself (row disappears, count updates) is the confirmation. A settings
  toggle can enable a toast for users whose threat model doesn't require
  disguise (D10).

## Onboarding

Thread/contact selection gets a "before you continue" screen first (D7) —
plain language naming that the next screen shows their contact list, with
an explicit "I'm ready" action, rather than the contact list appearing with
no preparation.

## Vault / export

Two-pane: a searchable/filterable list of every vault message (not scoped
to needs-review) with checkboxes, and a content pane carrying the honest
export disclosure — what the acquisition-time hash proves and doesn't
(matches D25/eng-plan language exactly, doesn't oversell it) — plus an
export history list (ties to the integrity log's action-granularity
events). No blur toggle here; by the time someone is exporting, blur has
served its purpose.

## OSINT — locked and unlocked

**Locked state:** lists vault senders with their gate eligibility (crossed
the abuse threshold, or not), and states plainly that this unlock check is
"friction against casual misuse, not proof someone is your abuser" (D22's
own language) — the UI doesn't let the gate imply more certainty than it
has.

**Unlocked state (verify-mode, decided 2026-09-24 — see TODOS.md item
18):** a form, not an automatic list. The user names one candidate they
already suspect — a label plus optionally a known username, email,
phone, and/or a pasted writing sample — and the app checks only that
hypothesis against messages already in the vault. There is deliberately
no "find out who this is" affordance: given a bare identifier with no
human-supplied candidate, the app has nothing to search. This was a real
fork considered explicitly — the alternative (search-mode: given a raw
identifier, go find where else it appears) is the same architecture as a
people-search site or a Sherlock-style username search, with the vault
gate limiting who can trigger it but not what a triggered search could
find about whoever it's pointed at. Rejected for that reason.

Results still never collapse to a bare name or verdict (D7/D22) — each
checked candidate shows its actual supporting signals and their
confidence, or plainly says no signals were found. There is no "generates
internet traffic" indicator on this screen: verify-mode's four shipped
signal kinds (username/email/phone-reuse, writing-style) run entirely
against vault data already on the device, so showing a network-activity
claim here would be false, not just unnecessary — the opposite of the
transparency this indicator was meant to serve elsewhere in the plan.
`profile-photo-match` (graph.ts's one still-unbuilt signal kind) is the
one path that would need a real network surface or facial recognition if
ever built, and is treated as its own future decision, not bundled here.
Explicit copy states results can't enter an evidence export — matches the
structural code-level barrier, not just a UI suggestion.

**Known accounts (added 2026-09-24 — see TODOS.md item 19):** the most
common pattern this app sees is not a stranger. It is someone the user
already blocked who comes back from a new number or a new account. So
the locked OSINT screen also holds a known-accounts list: numbers,
emails, and usernames the user knows belong to someone harassing them,
each tagged with a person name. Accounts with the same person name are
compared as one person. The list comes only from the user: typed in, or
imported from their own block lists (this Mac's Messages block list, or
the block list inside an Instagram export). Onboarding marks blocked
senders with a "Blocked on this Mac" / "Blocked on Instagram" badge,
lists them first, and pre-selects them, because their messages from
before the block are the writing baseline.

The unlocked screen then has two tools, in this order: "Compare with
your known accounts" (one button, one lead per person, only leads with a
supporting signal are listed, with a count of the rest), then the older
"Check someone you suspect" form. Compare stays inside verify-mode: the
set of people is the user's own list, and each comparison is identifier
reuse plus writing style against that person's own messages already in
the vault. Block-list entries are imported one person per entry, never
merged automatically — a block list mixes spam numbers with real people,
and only the user knows which entries are the same person.

## Settings

Sources list (connection status per ingest adapter), the D10
confirmation-toast toggle (off by default, real working state in the
mockup), and a "danger zone" linking to destroy confirmation — visually
separated (warm-tinted background) from the rest of the screen without
being alarming.

## Destroy confirmation

Built against the actual code in `vault/destroy.ts`: the exact
`DESTROY_CONFIRMATION_PHRASE` ("REMOVE LOCAL APP DATA") and
`DESTROY_DISCLOSURE_TEXT` strings, with real typed-match logic — the
destroy button stays disabled and visually inert until the typed text
matches exactly, matching `confirmationMatches()`'s behavior.

## Support and resources

A fifth app-level nav icon (question-mark-in-circle, not a heart or an
alarm shape — calm, standard "help" symbol, not an emotional one), sitting
in the main nav group rather than exiled to Settings. Lists three
verified national US services, each checked against its own official page,
not assumed from memory:

- National Domestic Violence Hotline — 1-800-799-7233, text START to
  88788, thehotline.org
- Crisis Text Line — text HOME to 741741 (not DV-specific; covers any crisis)
- RAINN National Sexual Assault Hotline — 1-800-656-4673, text HOPE to
  64673, rainn.org/hotline

States plainly these are US national services and that international
users need a local equivalent — no claim of coverage that wasn't verified.

**Reachable from the lock screen, before the passphrase** — a deliberate
decision, not an oversight: crisis help and vault security are two
different needs, and gating one behind the other is a mistake regardless
of how careful the rest of the security model is. Labeled just "Help" on
the lock screen (not "Get help" or anything crisis-specific) so it reads
as an ordinary app-support link and doesn't undermine the disguise (D5) —
the honest framing lives on the resources screen itself, once inside.

These three numbers are stable, long-standing national services —
reasonable to hardcode. Whether to make the list configurable (for
international users, or regional resources) is a real product question
for later, not decided here.

## Coerced unlock (TODOS item 3 — decided 2026-09-23)

What happens when an abuser is physically present and demands the vault
be unlocked. Considered against real DV-tech-abuse literature, which
documents a specific failure mode for the tempting-sounding fix: a duress
passphrase that opens a decoy or empty vault protects someone only as
long as the abuser doesn't know the pattern exists or doesn't notice
something's off about an oddly-sparse "real" vault — and a noticed decoy
can escalate a dangerous situation rather than defuse it. A one-way
duress-wipe passphrase avoids that specific failure but destroys the
evidence the instant it's used, which conflicts with the vault's whole
purpose and has no undo.

**Decided: no special handling.** There is no second passphrase, no
decoy state, no duress wipe. Typing the real passphrase opens the real
vault; anything else fails the same way a wrong passphrase always has
(D19). The app says this plainly on the Support and resources screen —
reachable both pre-passphrase from the lock screen's "Help" link and
from the main app nav — rather than leaving it undiscovered until
someone needs it under pressure.

The actual first line of defense is the existing panic-hide hotkey
(Cmd+Shift+Esc on macOS; Ctrl+Shift+Alt+H elsewhere — Ctrl+Shift+Esc,
the obvious Windows analog, is Windows' own reserved Task Manager
shortcut and confirmed by real CI not to register there, see TODOS item
14's addendum; `main/index.ts`'s PANIC_HOTKEY): never being caught
with the vault open is a stronger safety property than anything a
duress mechanism inside an already-open, already-demanded-open app
could offer. The Support screen shows whichever combo actually
registered on the running platform rather than a hardcoded one, and
says so plainly if registration failed. It also states without
hedging that if someone is physically forcing a device unlock,
complying is the reasonable choice — this app's contents are not worth
more than the person's safety.

## Diff against Jigsaw's Harassment Manager

Retroactive check per TODOS.md item 1 — read the real component structure
at `conversationai/harassment-manager` (not just its README) and diffed it
against this design. Two findings:

**Real gap, worth adding — DONE 2026-09-23:** Jigsaw has a dedicated
`find-support` section (crisis resources / support organizations) built
directly into the harassment-management flow — not an afterthought, a
first-class part of the app. That came out of their actual interviews with
27 journalists and activists, not something general trauma-informed design
research surfaced as a concrete UI element. Built and added to the
comparison board — see "Support and resources" below.

**Structural difference, not necessarily a fix:** Jigsaw's model is
"filter comments → build a discrete Report → export/share it"
(`create-report`, `review-report`, `report-pdf` as real, separate steps).
This design uses a continuous "Needs review / Reviewed / All" bucket
instead of a discrete report-building step. Different IA philosophy, not
a clear improvement either way — noting it rather than redoing the
already-built and already-locked IA on the strength of one comparison.

**Smaller, lower-priority notes:** Jigsaw filters by a toxicity *range*
(slider) rather than fixed High/Medium badges, and has a structured
date-range picker where this design's Vault/Export screen has a plain
search box. Neither is wrong; both are reasonable future refinements, not
logged as TODOS given how minor they are relative to the find-support gap.

## Not yet designed

- Keyboard power-navigation (arrow keys / j-k through the message list) —
  logged in TODOS.md, not blocking. Basic tab/click accessibility works
  without it.
