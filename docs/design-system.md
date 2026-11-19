# Design system

One design: dark editorial on a 12-column Swiss grid. There is no light/dark pair and no theme switch (removed in
M11-B). Pages move to it one phase at a time; the landing is the first.

## Where it lives

`components/design-system/`

| File | What it holds |
|---|---|
| `tokens.css` | The Tailwind theme (`@theme`) and the CSS variables. Imported once by `app/globals.css`. |
| `tokens.ts` | The colours and radii of `tokens.css` as literals, for code that cannot read a variable (Clerk derives its shades from literal colours). `tokens.test.ts` fails when the two disagree, and checks the contrast ratios below. |
| `fonts.ts` | Host Grotesk through `next/font` (`--font-host-grotesk`). Fraunces and IBM Plex Mono load in the root layout. |
| `motion.ts` | Easings and durations for scripts (WAAPI, timers); `tokens.css` has the same values for CSS. |
| `StatusMark.tsx` | The requirement status square. |
| `Surface.tsx` | A solid panel with its edge. |
| `SectionHeading.tsx` | Number, title and lede on the grid. |
| `Button.tsx` | `buttonClass`, `ButtonLink`, `textLinkClass`. |
| `PageHeading.tsx` | A working page's head: the title over eight columns, a lede or a block in the right rail (M11-C). |
| `ConfirmDialog.tsx` | A destructive confirmation on Radix's alert dialog; it portals out of the page, so it carries `ed-root` and the font itself (M11-C). |
| `Logo.tsx` | The wordmark. |

Every token is prefixed `ed-` because the old light system still owns `paper`, `ink`, `line` and `signal` with other
meanings. When the last page migrates, the old tokens go and the prefix can be dropped in one rename.

## Tokens

- **Colour** (`bg-ed-*`, `text-ed-*`, `border-ed-*`): `ed-bg #0C0D0F` (page), `ed-panel #121316` (surface),
  `ed-raise #17181C` (raised or hovered), `ed-sheet #131417` (a document: the CV sheet), `ed-line #24262B` and
  `ed-line-2 #34363C` (dividers and frames), `ed-field #6B6E75` (a form control's edge), `ed-ink #EDEDEA`,
  `ed-ink-2 #A3A6AD`, `ed-ink-3`, `ed-signal #3EDC8A` with `ed-signal-wash` (8 %), and the danger pair below.
- **Contrast on the four grounds** (WCAG 2.x ratio; `tokens.test.ts` holds the floors):

  | Token | bg | panel | raise | sheet | Floor |
  |---|---|---|---|---|---|
  | `ed-danger-text #FF7F71` | 7.89 | 7.54 | 7.20 | 7.48 | 7:1, text |
  | `ed-field #6B6E75` | 3.81 | 3.64 | 3.47 | 3.61 | 3:1, a control's edge (1.4.11) |
  | `ed-line-2 #34363C` | 1.61 | 1.54 | 1.47 | 1.53 | none: a divider, never a control's edge |
  | `ed-danger #B4382A` | 3.28 | 3.13 | 2.99 | 3.10 | none: a fill, never text |
- **ink-3 depends on what it sits on.** On the open page (`.ed-root`) it equals ink-2, because text there may lie over
  a lit ground; inside a surface (`.ed-surface`) or the chrome (`.ed-chrome`: header, footer) it is the quieter
  `#8A8E96`. Both pass AA on their ground.
- **The signal colour only where the CV proves something** (a met requirement, a proof line). The logo square and
  every other mark are ink.
- **Type** (`text-ed-*`, line height and tracking included): `h1` clamp(52–116 px), `h2` clamp(34–64 px), `h3` 20,
  `title` 32, `lede` clamp(16.5–17.5), `body` 16, `small` 14.5, `micro` 13, `cap` 12 (with the `ed-cap` utility:
  uppercase, 0.08 em, semibold). Faces: `font-ed-display` (Fraunces; `ed-display` sets weight 300 and optical size
  144), `font-ed-text` (Host Grotesk), `font-ed-mono` (Plex Mono; `ed-mono` adds tabular figures).
- **Space**: `ed-gutter` 24 px, `ed-pad` clamp(16–64 px) page padding, `ed-section` clamp(72–136 px) between
  sections, `ed-header` 64 px; `max-w-ed` 1312 px; `ed-wrap` (centred, padded) and `ed-grid` (12 columns, children
  span all columns until a breakpoint places them).
- **Radii**: `ed-surface` 10, `ed-field` 6, `ed-kbd` 5; buttons are pills.
- **Surfaces**: panel fill, 1 px `ed-line-2` edge, radius 10 and a short tight shadow (`shadow-ed-surface`). Content
  never sits on a moving ground. `shadow-ed-proof` is the 2 px signal bar on a proof line.
- **Status marks** (shape first, colour second): met = filled signal, partly met = signal outline half filled, not
  met = ink-3 outline, not shown in your CV = dashed ink-2 outline. 11 px, always with the status written next to it.
- **Focus**: 2 px ink outline, 3 px offset, following the element's own radius, on every focusable element under `.ed-root`.
- **Danger**: `ed-danger` and `ed-danger-hover` are fills, only for ending a live call (white text on them is
  5.93:1 and 7.14:1). Danger as text (an error message, a field in error) is `ed-danger-text`: the same hue,
  lightened to 7:1 or more on every ground. Filled, it takes `ed-bg` text (7.89:1), never white (2.5:1). A message
  in it still says what went wrong in words; colour is never the only cue.
- **Form controls**: an input, select or textarea draws its edge in `ed-field` (`border-ed-field`), never
  `ed-line-2`; hover goes to ink-2, focus to the ink ring, an error to `ed-danger-text`.
- **Motion**: `ease-ed-out` (entrances), `ease-ed-settle` (open and close), `ease-ed-story` (the story's object);
  durations 200 / 380 / 600 ms; `animate-ed-rise` and `animate-ed-fade`. Every motion has a reduced-motion path.

## The landing (`screens/Home/`)

`HomeScreen.tsx` composes sections and nothing else. Each section lives in
`components/<section>/`, with its strings in its own namespace
(`landing<Section>`; the example case, loader and closing in `landing`). The
header and the footer are the app shell's (below):

| Folder | What it holds |
|---|---|
| `hero/` | Headline, lede, start action; the figure (requirements wired to CV lines): `HeroFigure` picks 3D or HTML, `FlatFigure` is the HTML one, `useHeroSequence` the timing. |
| `hero/scene/` | The three.js scene, loaded with `next/dynamic` and no SSR: three, @react-three/fiber and drei exist only in this chunk. Desktop only; phones, reduced motion, no WebGL and software rendering get the HTML figure. |
| `background/` | The silk ground: a shader that runs while the hero is on screen, clamped to a luminance ceiling, with a WebP still for every case it cannot draw. |
| `story/` | One ledger carried through the pipeline in six steps: a sticky object on large screens, still figures on phones and under reduced motion. `layout.ts` is pure and tested. |
| `analysis/`, `pricing/`, `faq/` | The example analysis (verdict counted like the app's), plans with every figure from `lib/plans.ts` and the catalog, questions that open smoothly in every engine. |
| `interview/` | The app's own room (`RoomView`) and report (`InterviewReport`) playing an eight-line call: `talk.ts` turns the script into the room's view model (the same turn rule), `exampleReport.ts` into the report's data. No copies of either screen. Sound is off by default and no audio is requested until it is turned on. Audio in `public/landing/voice/{en,es}/`. |
| `loader/` | The full-page loader (below). |
| `closing/` | The last call to action. |

`utils/exampleCase.ts` is the invented case as data (ids, statuses, line
numbers); every word of it is under `landing:case.*`. `utils/readiness.ts`
carries the loader's signals.

### The loader

On a full load of `/` only, the inline boot script in the root layout
(`lib/bootScript.ts`) sets `data-loading` on `<html>` before first paint and
arms a 2.5 s cap. Six marks fill, one per real signal: fonts, the hero's data,
the 3D chunk, the scene's first frame, the silk's first frame, critical images
decoded (a part that is not used reports at once). When all six are in, the
row travels into the hero's legend while the page appears around it; under
reduced motion it simply appears. Without JavaScript the attribute is never
set and nothing is hidden. A client-side return to the home shows no loader:
the chunks are cached and the hero runs its own entrance. A screen reader
hears one "Loading".

### Language

On the landing, the language menu saves the choice (cookie and `User.locale`)
and reloads, so the loader and the hero's entrance play again in the new
language. Every other page switches in place.

## The app shell (M11-C)

- **One header**, `components/navbar/SiteHeader.tsx`, `variant="app" | "marketing"`. App (every page under
  `app/(root)`): signed in, Analyses, Interviews, New analysis, the account menu; signed out, How it works and
  Pricing. Marketing (the landing): the five sections as anchors. Both: sign in and start free when signed out; the
  language menu (`LocaleSwitch`, in place, or by reload on the landing); a mobile sheet (a native modal `<dialog>`).
  64 px plus a 1 px rule; the room depends on that height. It carries its own `ed-root ed-chrome` and font, so it
  reads as a dark band over the pages not migrated yet.
- **One footer**, `components/layout/Footer.tsx`, under every page; `FooterGate` hides it in the interview room,
  which fills the viewport.
- **Clerk** (`lib/clerkAppearance.ts`, applied once by the root `ClerkProvider`) and the **toasts** (sonner on its
  dark theme, `components/providers/Providers.tsx`) are in the dark design. Clerk takes literal colours: they come
  from `components/design-system/tokens.ts`, which a test keeps equal to `tokens.css`; the card's shadow is the CSS
  variable itself. Clerk draws an input's edge as a 1 px box-shadow at 11 % of its border colour (1.03:1 on the
  card): the appearance replaces it on `input[data-variant="default"]` with `ed-field`, ink-2 on hover, a 2 px ink
  ring on focus and `ed-danger-text` in error (Clerk's `data-feedback="error"`). Its error text is `colorDanger`,
  the danger text token; its filled danger buttons (the profile's "Remove" forms) get `ed-bg` text.
- **No paper grain.** The old system's noise layer (`body::before`, multiply at 4.5 %) is gone from every page, the
  ones not migrated yet included.
- **404**: `app/not-found.tsx` → `screens/NotFound`, with the shell's header and footer (the root not-found sits
  above `app/(root)/layout.tsx`).
- A migrated page under `app/(root)` makes its `ed-root` element `flex-1`, so the dark canvas reaches the footer.

## Translations on a page (`components/i18n/`)

The analysis page and the interview feedback page share three pieces, drawn in the system with no overrides:

- `TranslationPending` (client) and `TranslationNotice` (server) are the page's **status line**
  (`TranslationStatus.tsx`): body-size text in ink-2 behind a 6 px ink-2 square centred on the first line. The
  square pulses while the translation runs (`motion-safe:` only: still under reduced motion) and is never the signal
  green, which marks only what a CV proves. The "Show the original" link is ink with an ink-3 underline and a 44 px
  target. A screen passes `className` for its spacing and nothing else; which component shows, and with which
  action, is the screen's call (the analysis page's `TranslationLine`).
- `Prose` renders model prose, or its skeleton while the translation is on its way: bars on `ed-line-2` that pulse
  only when motion is allowed, `data-prose-pending`, hidden from assistive tech.

## The interview screens (M11-D, `components/interview/`)

The room, the feedback page and the landing's interview section are the same components:

- `room/RoomView.tsx`: the room as a view model and slots (status, turn, meter, clock, facts, panel, lines, notice,
  action), every part marked `data-room-part` in the order of `ROOM_PARTS`. No SDK, no server: `InterviewAgent`
  computes the view model from the call, the landing from its script. App-only panels (the offers with checkout,
  the drop panel, the start cap) go in the `panel` slot.
- `room/turn.ts`: who holds the turn (interviewer, waiting, candidate), pure. The interviewer keeps it 1.2 s after
  its audio stops, so a pause between two sentences or the moment after an answer is never "Your turn".
- `room/VoiceMeter.tsx`: the speaking indicator. Two channels of thin ink bars from the real output and input
  levels; whoever holds the turn is full ink. No glow and no green; still under reduced motion; `aria-hidden`,
  because the turn is also said in words.
- `feedback/InterviewReport.tsx`: the report as one tree with no hooks, rendered on the server by the feedback page
  (no client JS) and on the client by the landing, each passing its own `t`. Outcome marks are shapes in ink
  (filled, half, empty, dashed): an answer in a rehearsal is not a CV proof, so never the signal green.
- `TranscriptLines.tsx`: a call's lines (who, time, words, the resumed-call marker) for the live room, the feedback
  transcript and the landing.
- `ui.ts`: the eyebrow, its tick and the thin scrollbar as classes.

The room preview (`/dev/room-preview?state=<name>`, dev tools only) renders every state through the real room;
the names are in `screens/Interview/RoomPreviewScreen.tsx`.

## The account pages (M11-E, `components/account/`)

`/account` (the plan, this period's usage, the language, Clerk's sign-in settings, deleting the account) and
`/account/billing` (the subscription and its portal, the packs, a checkout being confirmed) are two siblings under
one tab row (`AccountTabs`), each a ledger of numbered sections on the grid (`AccountSection`: number and title in
the left four columns, content over the right eight; `UsageRow`, `Figure`, `Cells`, `RowNote` for the figures).

- **Standing**: one of seven states (`lib/accountStanding.ts`, pure: free, ended, paused, comp, active, past due,
  ending) with a `Mark` by shape in ink: filled (Pro in force), half (Pro ending or at risk), empty (no Pro); dashed
  for a trial the account cannot have. Never green: nothing here is a CV proof. `standingCopy` gives its label and
  sentence, dates in full.
- **Figures**: a small allowance (Free's analyses, Pro's interviews) is a row of cells, filled for what is left,
  beside the figure in mono; Pro's analyses are named as "up to 50", never counted, until the cap is reached; Free
  shows its trial instead of a period of interviews.
- **The billing buttons** (`components/billing/`) are the system's pill (`buttonClass`, mapping the callers' old
  `default`/`outline` and sizes) with the focus ring stated on the button (`buttonStyle.ts`); the portal's error is
  `ed-danger-text`; Paddle's overlay opens in its dark theme. The language menu (`components/i18n/LocaleMenu.tsx`)
  is a pill drawn as a form control (`ed-field` edge) with the header's menu surface.
- **Deleting the account**: a ghost pill in `ed-danger-text`, the lists of what goes and what Paddle keeps on a
  surface, and the system's `ConfirmDialog`.

## The verdict rule

One copy, in `common:verdictRule` (`weak`, `fair`, `strong`, `notShown`, and `term` for the label before each
sentence): the analysis page lists it under "How it's counted" and the landing's example prints it as one
paragraph. The verdict words are `common:score.fit.*`.

## Migrated pages and the rest

Migrated: the landing (M11-B); the shell, the upload page, the analysis page, the analyses list and the 404
(M11-C); the interviews list, the room and the feedback page (M11-D). Not yet: pricing, account and the legal pages
(M11-E). Those keep the old light look (paper, ink, red signal; Schibsted Grotesk) under the dark header and
footer until their phase.

## Verifying a page

The rules of the design lab apply to every page (CLAUDE.md, "Verificación en el navegador"): verify in `next dev`
the way the owner runs it (Strict Mode), in Brave and Chrome launched without the automation flag, not only in a
production build or Playwright's Chromium; never write under a running dev server; leave nothing running; canvases
survive Strict Mode and always have a designed fallback.
