---
name: OpenDoc
description: An editorial research workspace for asking your documents questions and checking every answer against the page.
colors:
  bg: "oklch(0.986 0.0025 275)"
  surface: "oklch(1 0 0)"
  surface-2: "oklch(0.966 0.004 275)"
  surface-3: "oklch(0.935 0.006 275)"
  line: "oklch(0.9 0.006 275)"
  line-strong: "oklch(0.82 0.009 275)"
  ink: "oklch(0.205 0.018 275)"
  ink-muted: "oklch(0.42 0.016 275)"
  ink-subtle: "oklch(0.5 0.014 275)"
  indigo: "#5b5bd6"
  indigo-hover: "#4c4cc4"
  indigo-soft: "oklch(0.95 0.025 280)"
  indigo-soft-ink: "oklch(0.44 0.17 280)"
  evidence: "oklch(0.94 0.1 98)"
  evidence-strong: "oklch(0.86 0.15 92)"
  success: "oklch(0.5 0.12 155)"
  warning: "oklch(0.52 0.12 65)"
  danger: "oklch(0.52 0.19 25)"
  dark-bg: "oklch(0.18 0.009 278)"
  dark-surface: "oklch(0.21 0.01 278)"
  dark-ink: "oklch(0.955 0.004 278)"
  dark-indigo: "oklch(0.7 0.14 280)"
typography:
  display:
    fontFamily: "Source Serif 4 Variable, Iowan Old Style, Georgia, serif"
    fontSize: "clamp(2.6rem, 6vw, 4.5rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "2.125rem"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.015em"
  note:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0em"
  body:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  label:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
    letterSpacing: "0em"
  meta:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: "0em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "14px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "16": "64px"
  "24": "96px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-hover}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
  citation-chip:
    backgroundColor: "{colors.indigo-soft}"
    textColor: "{colors.indigo-soft-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.xs}"
    height: "20px"
  citation-chip-active:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.surface}"
  evidence-mark:
    backgroundColor: "{colors.evidence}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "40px"
---

# Design System: OpenDoc

## Overview

**An editorial research workspace.** OpenDoc should feel like a well-kept reading desk: paper-cool neutrals, ink text, a serif for anything you *read* (answers, page titles, documents) and a precise sans for anything you *operate*. One indigo accent marks actions and citations. One highlighter tone marks evidence. Nothing glows, floats or gradients.

Modes: the app (dashboard, library, viewer, chat, settings) is **Operate**. It's restrained, consistent and dense where scanning matters. The landing page is **Persuade**. It uses the same world at a larger scale and is led by the real product UI, not illustration.

The signature move is the **research note**. A question is set as a heading, the answer is set in the serif with numbered citation chips, and the sources sit next to it like margin notes. Each source opens the exact page with the passage marked in highlighter.

## Colors

All colours are CSS variables in `frontend/src/index.css` (`:root` light, `.dark` dark), exposed to Tailwind as `bg-surface`, `text-fg-muted`, `border-line`, `bg-evidence` and so on.

### Primary
- **Indigo** `#5b5bd6` (dark: `oklch(0.7 0.14 280)`). Primary buttons, active citation chips, focus ring, progress. White on indigo measures 5.4:1.
- **Indigo soft / soft ink.** Resting citation chips, selected rows, the user's avatar initial. Soft ink on soft measures 7.1:1.

### Evidence
- **Highlighter** `oklch(0.94 0.1 98)` (strong `0.86 0.15 92` for the PDF text layer). Only ever used behind a cited passage: viewer highlights, source snippets, the auth-page sample. Never decoration, never a button.

### Neutral
- `bg` → `surface` → `surface-2` → `surface-3` step from page to raised to inset. `line` and `line-strong` are hairlines.
- Text: `fg` (ink), `fg-muted`, `fg-subtle`. **Every text role, including `fg-subtle`, is ≥4.5:1 on `bg`, `surface` and `surface-2` in both themes** (light subtle is 5.4:1 on surface-2, dark subtle is 6.0:1).

### Status
`success` / `warning` / `danger` with `*-soft` grounds, all ≥4.6:1 as text on their grounds. A status always pairs colour with a word.

### Named rules
- **One accent, one highlighter.** No second brand hue. Indigo means "you can act" or "this is a source". Yellow means "this is the evidence".
- **No gradients, glass or glows.** Surfaces are flat. Depth comes from the neutral steps and, for floating layers only, a soft offset shadow.

## Typography

- **Source Serif 4** (variable, optical sizes; self-hosted via `@fontsource-variable/source-serif-4`) for display, page titles, empty-state titles, the answer body, and markdown headings.
- **Instrument Sans** (variable; `@fontsource-variable/instrument-sans`) for UI: navigation, labels, buttons, tables, forms, body copy on marketing sections.
- **Geist Mono** (variable) only for code, metadata and measurements: page and section references, file sizes, timings, benchmark figures, keyboard keys.

### Hierarchy
Scale (rem at 16 px), roughly 1.25 steps: 12 · 13 · 14 · **15 (UI base)** · **17 (reading)** · 20 · 26 · 34 · 46 · 60.
- Display: serif 600, `clamp(2.6rem, 6vw, 4.5rem)`, tracking −0.02em, landing hero only.
- Page title: serif 600, 34–46 px, tracking −0.015em.
- Note (answers): serif 400, 17 px / 1.7, measure ≤ 68ch.
- UI body: sans 15 px / 1.6. Labels: sans 500, 14 px. Meta: mono 12 px.

### Named rules
- **Read in serif, operate in sans.** If the user reads it for meaning, it's serif. If they click, scan or fill it, it's sans.
- **No kickers.** Never put a small uppercase or tracked label above a heading. The heading carries the section.
- **12 px is the floor.** Nothing smaller ships.

## Layout

- App shell: a 256 px sidebar on `surface-2` (md+), and the content column on `bg`. Pages max out at 1024 px (`max-w-5xl`), with 16 px gutters on mobile and 32 px from `sm`.
- Mobile: a top bar (logo + history drawer) plus a **bottom nav** (Home, Library, Ask, Settings; 56 px plus the home-indicator inset). It's hidden on chat and viewer, which have their own bottom controls. The shell uses `100dvh`, `viewport-fit=cover`, and `env(safe-area-inset-*)` on every edge that touches the screen.
- Chat: a reading column ≤ 46rem, and a sources rail of 22rem at ≥1280 px that becomes a sheet below that.
- Sections are separated by space and a single hairline heading rule, not by boxes. Tight groups (4–8 px), generous separation (40–64 px), and more space above a heading than below it.

## Elevation & Depth

Flat by default. Containers use **either** a hairline border **or** a shadow, never both, except the floating layers (menus, dialogs, sheets, the waking banner), which earn both.
- `shadow-xs` / `shadow-sm`: inputs and the composer at rest.
- `shadow-lg` `0 18px 40px -16px` plus `0 3px 8px -2px`: floating layers only.

## Shapes

Radii 4 / 6 / 8 / 12 / 14 px. Controls use 8 px, cards and panels 12 px, citation chips 4 px. Pills (999 px) are reserved for tiny status dots and the avatar. No nested cards: a panel's children are rows split by hairlines.

## Components

### Buttons
`Button` (`components/ui/Button.tsx`) is the only recipe, also exported as `buttonClass()` for links, including on the landing page. Variants: primary (indigo), secondary (surface-2), outline, ghost, danger. Heights are 32 / 36 / 44 px, and **every size becomes 44 px on `pointer: coarse`**. Press feedback is a 1 px nudge. There are no glows.

### Citation chip (signature)
Inline mono number, 20 px tall, 4 px radius, indigo-soft at rest and solid indigo when active. On touch it gets a 36 px invisible hit area (`.hit`). Clicking it focuses the source in the rail or sheet, and the source links to `/documents/:id?page=N&q=snippet`.

### Research note (signature)
`AssistantMessage`: the question as a serif heading, the answer in `.prose-note`, then footnote-style sources grouped by document ("services-agreement.pdf · 1 p.2 · 2 p.1"). Then a mono meta line (sources · latency · model) and quiet actions (copy, ask again).
- **Streaming:** a phase line ("Searching 2 documents…" then "Writing from 3 sources…") over an indeterminate hairline scan bar, plus a soft caret at the end of the text.
- **Abstain:** a "Not enough evidence" note with a dashed hairline frame, the model's sentence, and concrete next steps (rephrase, widen the scope, open the library).

### Sources rail
A numbered list. Each item shows document, page and section in mono, the snippet on an evidence ground, and "Open page N". The active source is expanded.

### Inputs
40 px (44 px touch), 8 px radius, a `line-strong` border that turns indigo on focus. Labels sit above, with hints on the label row's right edge.

### Navigation
Sidebar items are 36 px (44 px touch). The active item is `surface-3` with ink text. The bottom nav uses icon plus label, with the active item in indigo-soft ink.

### Waking banner
A top-centre floating status: "Waking up the server… (free tier, ~1 min)", elapsed seconds in mono, and an easing progress hairline. It's `role=status`, and it appears only after 4 s or on a retry.

## Do's and Don'ts

### Do
- Put the evidence next to the claim, and make the page one click away.
- Use plain words for system states: "Indexing 42%", "Waking up the server", "Not enough evidence".
- Label every number on the landing page with what was measured and how it was judged.
- Honour `prefers-reduced-motion` by swapping movement for fades, not by deleting feedback.

### Don't
- Don't use gradients, gradient text, glassmorphism, radial glows, grid backdrops or decorative blinking cursors.
- Don't use eyebrow/kicker labels, rows of same-size icon cards, or hero-metric templates.
- Don't put cards inside cards.
- Don't invent testimonials, logos, user counts or uptime claims.
- Don't use Inter (or any single face) for everything.
