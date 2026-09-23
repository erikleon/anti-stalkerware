# antistalker — Design System

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
--med-bg/-fg      #37301f / #d8b568     #fbecd0 / #92650b
--reviewed-fg     #7fa08a               #5f7a5a
```

Off-white on near-black (not pure white on pure black) and off-black on
off-white in both directions — reduces eye strain versus maximum-contrast
extremes while comfortably clearing WCAG 4.5:1 for normal text. Verify
exact ratios with a real contrast checker before shipping; these are
principled choices, not measured ones.

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

**Unlocked state:** ranked leads only, each showing its supporting signals
and a confidence label — never a bare name or verdict (D7/D22). A visible
"generates internet traffic" indicator (small pulsing dot, respects
`prefers-reduced-motion`) is present the entire time this screen is open,
per the eng plan's requirement that OSINT's network activity never be
silent. Explicit copy states results can't enter an evidence export —
matches the structural code-level barrier, not just a UI suggestion.

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

## Not yet designed

- Keyboard power-navigation (arrow keys / j-k through the message list) —
  logged in TODOS.md, not blocking. Basic tab/click accessibility works
  without it.
