---
target: OpenDoc frontend (landing + app routes), main @ d5b1df2
date: 2026-11-06
total_score: 24
max_score: 40
na_heuristics: ""
audit_score: 12
audit_max: 20
p0_count: 1
p1_count: 4
---

⚠️ DEGRADED: single-context (run by a sub-agent with no sub-agent tool exposed; Assessment A was written from screenshots and source before the detector JSON was opened, then the two were merged).

# Critique + audit: BEFORE

Evidence used:

- Screenshots of landing, login, dashboard, library, chat (citations + abstain), viewer and settings at 1440 / 1024 / 768 / 390, light theme, rendered from a production build of `main` against the in-memory mock API (`frontend/e2e/mock/mock-api.mjs`). They're in `docs/screenshots/redesign/before/`.
- Impeccable detector v4.8.0, run as `impeccable detect --json frontend/src` (source) and through CDP against the same rendered routes (`frontend/scripts/redesign-detect.mjs`) at 1280×800 and 390×844.

## Detector findings (deterministic)

| Scan | Findings | Warning | Advisory | Rules hit |
|---|---:|---:|---:|---|
| Source `frontend/src` | 4 | 3 | 1 | side-tab (`.prose-doc blockquote border-l-2`), gradient-text (`landing.css`), codex-grid-background (`landing.css`), bounce-easing (`Messages.tsx` dots) |
| Rendered, 1280×800 (7 routes) | 97 | 78 | 19 | low-contrast 57, tiny-text 11, straggler 10, kicker-above-heading 8, radial-spotlight-glow 3, line-length 2, gradient-text 1, ai-color-palette 1, nested-cards 1, codex-grid-background 1, blinking-cursor 1, flat-type-hierarchy 1 |
| Rendered, 390×844 (7 routes) | 74 | 58 | 16 | low-contrast 37, tiny-text 14, straggler 8, kicker-above-heading 8, undersized-ui-text 2, gradient-text 1, radial-spotlight-glow 1, ai-color-palette 1, nested-cards 1, codex-grid-background 1 |

Per route at 1280: landing 47, login 0, dashboard 11, library 12, chat 11, viewer 7, settings 9.

What the detector found that the design review agrees with: the `--fg-subtle` token (`#7f7f86`, about 3.7–4.0:1 on the near-white surfaces) is the single cause of almost every low-contrast hit in the app. It's used for timestamps, group labels in the history, placeholders and helper text. The landing page has the full AI-SaaS kit: eyebrow chip above the hero, a gradient word ("verify."), radial orbs, a hairline grid background, a fake blinking cursor in the demo, and a mono eyebrow over every section.

False positives: `straggler` (single last word on a line) on short UI labels is noise. `flat-type-hierarchy` on the viewer's details panel is technically right but low-impact.

## Design health score (Nielsen)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | A Render cold start (about 1 min) shows "Could not reach the OpenDoc API. Check your connection or the API URL." and blames the user. There's no waking state and no automatic retry. The streaming dots use `animate-bounce`. |
| 2 | Match system / real world | 3 | Library and viewer language is clear. "Concise / Detailed / Highlights" is understandable. "Chunks" in the details panel is internal jargon. |
| 3 | User control and freedom | 3 | Stop generation, rename/delete chats, and URL-backed library filters are all there. The details panel on tablet overlays the page with no close affordance besides the toggle. |
| 4 | Consistency and standards | 3 | The token system is real, but button heights mix 28/32/40 px, and the landing uses its own button recipe (`btnPrimary` with a coloured glow) unrelated to the app's `Button`. |
| 5 | Error prevention | 3 | Client-side file validation, a confirm on delete, and the composer explains why it's disabled. |
| 6 | Recognition rather than recall | 2 | Citations are tiny 18 px chips with only a number. The source strip repeats the same filename three times ("services-agreement.pdf p.2 / p.1 / p.3") and wastes the row. The sources rail only appears after a chip is clicked, so evidence isn't visible by default. |
| 7 | Flexibility and efficiency | 3 | ⌘K palette, ⌘/ focus, arrow-key page nav. |
| 8 | Aesthetic and minimalist design | 2 | Generic "shadcn dashboard": Inter everywhere, four same-size stat cards, card-in-card sections, grey-on-grey. The chat is a ChatGPT layout (right-aligned grey bubble, answer column, round send button). Nothing says "research workspace". |
| 9 | Error recovery | 2 | Network errors give no diagnosis or recovery other than a manual "Try again". A stream failure after a cold start leaves the user to retry by hand. |
| 10 | Help and documentation | 1 | Shortcut list in settings and a disclaimer line under the composer. No first-run guidance beyond empty states. |
| **Total** | | **24/40** | **Acceptable** |

## Design specificity verdict

**Category-interchangeable.** Swap the logo and this could be any AI chat or SaaS dashboard template: Inter at 14 px, a 256 px grey sidebar with a filled "New chat" pill, four KPI cards, a right-aligned grey question bubble, and an indigo-to-violet gradient word in the hero. OpenDoc's real differentiator (every claim is pinned to a page, and it abstains when the evidence is thin) shows up only as 18 px number chips and a yellow callout. Missed opportunity: answers should read like annotated research notes, with the evidence visible next to them, not like a chatbot reply.

## What's working

- **Solid engineering underneath.** It has zod-validated API contracts, an XHR upload with byte progress, SSE parsing with stop/abort, URL-backed filters, and lazy-loaded pdf.js/mammoth. A redesign can keep all of it.
- **The citation deep link is the right idea.** `viewerHref` carries page and snippet, and the PDF text layer highlights the passage. It just needs better staging.
- **Accessibility groundwork** is in place: skip link, labelled controls, `aria-pressed` chips, a radix dialog focus trap, and a reduced-motion media query.

## Priority issues

- **[P0] Cold start reads as an outage.** Render's free tier sleeps after 15 min. The first request fails or times out for about 60 s, and every surface shows "Could not reach the OpenDoc API". Login fails outright. **Fix:** retry with backoff in the API client for network errors, timeouts and 502/503/504. Show a "Waking up the server… (free tier, ~1 min)" banner while retrying, put the same treatment on the chat stream and initial loads, and add a keep-warm cron. *Commands: harden, clarify.*
- **[P1] Secondary text fails WCAG AA everywhere.** `--fg-subtle` measures 3.6–4.0:1 (57 rendered hits). **Fix:** re-derive the neutral ramp so the quietest text role is ≥4.6:1 on every surface in both themes. *Command: colorize / polish.*
- **[P1] Chat is a ChatGPT clone and hides the evidence.** **Fix:** render answers as research notes (serif reading face, question as a heading, inline numbered chips), keep a sources rail visible on wide screens with snippet, page and section, give "Not enough evidence" its own state, and make the streaming indicator name the phase (searching → writing). *Commands: bolder, layout.*
- **[P1] Landing is AI-SaaS boilerplate, and its benchmark copy drifts from the README.** Eyebrows on every section, gradient text, radial orbs, grid backdrop, blinking cursor. The benchmark block says "38-question contract set" and adds unrequested figures. **Fix:** strip the decorations, use one editorial type pairing, an interactive preview built from the real components, and an honest trust row (faithfulness 97.3%, gold-cited 94.6%, abstention 8/8 on 46 questions, LLM-judged by the same model). *Commands: distill, typeset.*
- **[P1] Touch targets on mobile are 28–32 px.** That covers `icon-sm` buttons, history row menus (24 px), the library filter tabs (28 px) and chat chips (18 px). **Fix:** 44 px minimum hit area on coarse pointers, with a mobile bottom nav for the four primary destinations. *Command: adapt.*
- **[P2] Type hierarchy is flat inside the app.** Base 14 px, page titles 24 px, everything else 12–13 px. Tiny text (11 px) shows up in 11–14 places. *Command: typeset.*

## Persona red flags

**Casey (distracted mobile user):** opens the app after it slept, sees a red "Could not reach the OpenDoc API" and leaves. Navigation hides behind a hamburger. Chips are 18 px. The sources drawer covers the answer completely.

**Jordan (first-timer):** the dashboard leads with four zero-value stat cards instead of the one action that matters (upload, then ask). "Chunks", "sections" and "Processing 0 failed" are internal vocabulary.

**Sam (accessibility-dependent):** grey helper text below AA, decorative motion on the landing (word-by-word reveal, parallax orbs), and an 11 px mono kicker.

## Minor observations

- Dashboard stat "Processing 1 · 0 failed" pairs unrelated facts.
- The library dropzone repeats on the dashboard. That's fine, but the two are styled as nested cards.
- Settings "System status" dumps raw readiness checks without explaining them.
- `theme-color` meta is `#0b0b0d`/`#ffffff` and the manifest's colours don't match the app surfaces.

---

# Audit (technical): BEFORE

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | `--fg-subtle` below 4.5:1 (57 hits at 1280). Reduced motion is a global 0.01 ms kill that also removes useful progress feedback. 11 px text. |
| 2 | Performance | 3 | Good code-splitting (landing, app shell, pages, pdf.js, mammoth all lazy). The landing still ships parallax scroll handlers and large blurred orbs. |
| 3 | Theming | 3 | Real CSS-var tokens with light/dark. Landing-only colours (`--landing-glow-*`) and hard-coded `bg-white` / `text-white` in places. |
| 4 | Responsive design | 2 | Works down to 390 px, but touch targets are 24–32 px. No bottom nav. The `100dvh` shell is fine, but the details panel uses `fixed mt-12`, a magic number. |
| 5 | Implementation integrity | 2 | Detector: gradient text, AI palette, radial glows, grid backdrop, kicker labels ×8, nested cards. The landing metric copy diverges from `docs/BENCHMARKS.md` scope. |
| **Total** | | **12/20** | **Acceptable** |

## Findings by severity

- **[P0] Cold start shows a hard failure.** *Location:* `src/lib/api/errors.ts` `networkError()`, `client.ts raw()`, `stream.ts`. *Category:* resilience/UX. *Impact:* the first visit after 15 min idle fails every request for about 60 s. *Fix:* retry with backoff plus a waking-server state, and a keep-warm workflow.
- **[P1] Contrast.** *Location:* `src/index.css` `--fg-subtle` light `oklch(0.6 0.01 286)`. *Standard:* WCAG 1.4.3. *Fix:* darken to ≥4.6:1 on `--surface-2`.
- **[P1] Touch targets.** *Location:* `Button` sizes `icon-sm` (28 px), `ConversationList` menu (24 px), library tabs (28 px), `CitationChip` (18 px). *Standard:* WCAG 2.5.8 (24 px minimum), the project brief asks for 44 px. *Fix:* coarse-pointer sizing plus hit-area padding.
- **[P1] Slop patterns on the landing.** *Location:* `landing.css` (gradient text, orbs, grid), `LandingPage.tsx` (8 kickers, eyebrow chip). *Fix:* remove them and rebuild the sections.
- **[P2] Reduced-motion handling is a blanket kill.** *Location:* `index.css` base layer. *Fix:* per-animation reduced alternatives (keep opacity fades, drop translation and parallax).
- **[P2] Theme colour and manifest drift.** *Location:* `index.html`, `public/manifest.webmanifest`. *Fix:* derive both from the new `--bg` tokens.
- **[P3] `animate-bounce` typing dots.** *Location:* `Messages.tsx:125`. *Fix:* a phase label with a calm progress mark.

## Patterns and systemic issues

- One token (`--fg-subtle`) causes most a11y failures, so fixing the ramp fixes about 90% of detector hits in the app.
- The marketing page and the app are two different design systems (landing buttons, glows, mono kickers versus app `Button`).
- Sizes are tuned for mouse first. Nothing adapts to `pointer: coarse`.

## Positive findings

- Lazy routes and viewers, zod at the boundary, an abortable SSE stream with stop, and XHR upload progress.
- Radix primitives give correct focus management for dialogs and menus.
- URL state for library filters and viewer page/snippet makes citation links shareable.
