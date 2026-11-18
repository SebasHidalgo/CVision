# Design system

One design: dark editorial on a 12-column Swiss grid. There is no light/dark pair and no theme switch (removed in
M11-B). Pages move to it one phase at a time; the landing is the first.

## Where it lives

`components/design-system/`

| File | What it holds |
|---|---|
| `tokens.css` | The Tailwind theme (`@theme`) and the CSS variables. Imported once by `app/globals.css`. |
| `fonts.ts` | Host Grotesk through `next/font` (`--font-host-grotesk`). Fraunces and IBM Plex Mono load in the root layout. |
| `motion.ts` | Easings and durations for scripts (WAAPI, timers); `tokens.css` has the same values for CSS. |
| `StatusMark.tsx` | The requirement status square. |
| `Surface.tsx` | A solid panel with its edge. |
| `SectionHeading.tsx` | Number, title and lede on the grid. |
| `Button.tsx` | `buttonClass`, `ButtonLink`, `textLinkClass`. |
| `Kbd.tsx`, `Logo.tsx` | A key hint; the wordmark. |

Every token is prefixed `ed-` because the old light system still owns `paper`, `ink`, `line` and `signal` with other
meanings. When the last page migrates, the old tokens go and the prefix can be dropped in one rename.

## Tokens

- **Colour** (`bg-ed-*`, `text-ed-*`, `border-ed-*`): `ed-bg #0C0D0F` (page), `ed-panel #121316` (surface),
  `ed-raise #17181C` (raised or hovered), `ed-sheet #131417` (a document: the CV sheet), `ed-line #24262B` and
  `ed-line-2 #34363C` (edges), `ed-ink #EDEDEA`, `ed-ink-2 #A3A6AD`, `ed-ink-3`, and `ed-signal #3EDC8A` with
  `ed-signal-wash` (8 %).
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
- **Danger** (`ed-danger`, `ed-danger-hover`): only for ending a live call. White text on it is 6.4:1.
- **Motion**: `ease-ed-out` (entrances), `ease-ed-settle` (open and close), `ease-ed-story` (the story's object);
  durations 200 / 380 / 600 ms; `animate-ed-rise` and `animate-ed-fade`. Every motion has a reduced-motion path.

## The landing (`screens/Home/`)

`HomeScreen.tsx` composes sections and nothing else. Each section lives in
`components/<section>/`, with its strings in its own namespace
(`landing<Section>`; the header, example case, loader, closing and footer in
`landing`):

| Folder | What it holds |
|---|---|
| `header/` | Signed out: section anchors, sign in, sign up. Signed in: the app's pages, a new analysis, the account menu. The language menu that reloads. |
| `hero/` | Headline, lede, start action; the figure (requirements wired to CV lines): `HeroFigure` picks 3D or HTML, `FlatFigure` is the HTML one, `useHeroSequence` the timing. |
| `hero/scene/` | The three.js scene, loaded with `next/dynamic` and no SSR: three, @react-three/fiber and drei exist only in this chunk. Desktop only; phones, reduced motion, no WebGL and software rendering get the HTML figure. |
| `background/` | The silk ground: a shader that runs while the hero is on screen, clamped to a luminance ceiling, with a WebP still for every case it cannot draw. |
| `story/` | One ledger carried through the pipeline in six steps: a sticky object on large screens, still figures on phones and under reduced motion. `layout.ts` is pure and tested. |
| `analysis/`, `pricing/`, `faq/` | The example analysis (verdict counted like the app's), plans with every figure from `lib/plans.ts` and the catalog, questions that open smoothly in every engine. |
| `interview/` | Replicas of the room and the feedback page playing an eight-line call. Sound is off by default and no audio is requested until it is turned on. Audio in `public/landing/voice/{en,es}/`. |
| `loader/` | The full-page loader (below). |
| `closing/`, `footer/` | The last call to action and the footer. |

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

## Pages not migrated yet

They keep the old light look (paper, ink, red signal; Schibsted Grotesk) exactly as before, minus the dark theme.
They do not load Host Grotesk. The app header, the toasts and Clerk's modals are still in the old style; a Clerk
modal or a toast opened from the landing therefore shows light.

## Verifying a page

The rules of the design lab apply to every page (CLAUDE.md, "Verificación en el navegador"): verify in `next dev`
the way the owner runs it (Strict Mode), in Brave and Chrome launched without the automation flag, not only in a
production build or Playwright's Chromium; never write under a running dev server; leave nothing running; canvases
survive Strict Mode and always have a designed fallback.
