---
target: OpenDoc frontend (landing + app routes), feat/impeccable-redesign after P0–P5
date: 2026-11-06
total_score: 31
max_score: 40
na_heuristics: ""
audit_score: 16
audit_max: 20
p0_count: 0
p1_count: 0
before: { total_score: 24, audit_score: 12, detector_src: 4, detector_1280: 97, detector_390: 74 }
---

⚠️ DEGRADED: single-context (run by a sub-agent with no sub-agent tool exposed; the design review was written from the after screenshots and source, then merged with the detector JSON).

# Critique + audit: AFTER

Evidence used:

- Screenshots of landing, login, dashboard, library, chat (citations + abstain), viewer and settings at 1440 / 1024 / 768 / 390, light theme, from a production build (`VITE_API_URL=` empty) against the in-memory mock API (`frontend/e2e/mock/mock-api.mjs`), taken with `frontend/scripts/redesign-shots.mjs`. They're in `docs/screenshots/redesign/after/`.
- Impeccable detector v4.8.0, same method as before: `impeccable detect --json frontend/src` (source → `after-detect-src.json`) and through CDP against the same seven rendered routes with `frontend/scripts/redesign-detect.mjs` at 1280×800 and 390×844 (→ `after-detect-rendered.json`).
- `npx vitest run` (76/76), `tsc -b` + eslint + `vite build` clean, and `e2e/mocked.spec.ts` (11/11 Playwright flows on Chromium 150 arm64).

## Before → after summary

| Measure | Before | After |
|---|---:|---:|
| Critique (Nielsen, /40) | 24 | **31** |
| Audit (technical, /20) | 12 | **16** |
| Detector, source `frontend/src` | 4 | **0** |
| Detector, rendered @1280 (7 routes) | 97 | **3** |
| Detector, rendered @390 (7 routes) | 74 | **6** (5 are PDF text-layer false positives) |

## Detector findings (deterministic)

| Scan | Findings | Warning | Advisory | Rules hit |
|---|---:|---:|---:|---|
| Source `frontend/src` | 0 | 0 | 0 | — (side-tab, gradient-text, grid background and bounce easing are all gone) |
| Rendered, 1280×800 | 3 | 1 | 2 | line-length 1 (landing benchmarks intro `p.mt-6.max-w-2xl`, ~103 ch on 2 lines), straggler 1 (landing feature `dd`, "run."), flat-type-hierarchy 1 (viewer, advisory) |
| Rendered, 390×844 | 6 | 5 | 1 | tiny-text 3 + undersized-ui-text 2 (all inside `.react-pdf__Page__textContent` / `mark.pdf-hl`), straggler 1 (landing feature `dd`, "menu.") |

Per route at 1280: landing 2, login 0, dashboard 0, library 0, chat 0, viewer 1, settings 0. At 390: landing 1, viewer 5, everything else 0.

**False positives.** The five viewer@390 hits (6.8 px / 9.8 px "body text") are pdf.js's transparent text layer, scaled to match the canvas at the fit-to-width zoom on a phone. That text is invisible selection/highlight geometry; what the user reads is the canvas at the zoom they choose. Not fixable without breaking text selection and the citation highlight, and not a real legibility issue. The two `straggler` hits are advisory, on short feature descriptions.

**Real but minor.** The landing benchmarks intro paragraph runs ~103 characters per line at 1280 (should be ≤75ch). The viewer's chrome uses 13/14/15 px for body/h2/h1, so the detector reads it as flat; weight separates the roles and the document itself is the dominant content, so it's low impact.

All 57 low-contrast hits from before are gone: `--fg-subtle` was re-derived (light `oklch(0.5 0.014 275)`, dark `oklch(0.68 0.012 278)`) to clear 4.5:1 on every surface. Kicker-above-heading (8), radial glows, gradient text, AI palette, nested cards, grid backdrop and blinking cursor are all gone.

## Design health score (Nielsen)

| # | Heuristic | Before | After | Key issue now |
|---|---|---:|---:|---|
| 1 | Visibility of system status | 2 | 3 | Cold start now retries with backoff and shows "Waking up the server…"; streaming names its phase; upload shows bytes then indexing %. Verified against the mock only, not against a real sleeping Render instance. |
| 2 | Match system / real world | 3 | 3 | "Chunks" became "Indexed passages". "Sections" in the viewer details is still slightly internal. |
| 3 | User control and freedom | 3 | 3 | Stop, rename/delete, closeable sources rail and sheet, "Clear" on the cited passage. Nothing new beyond that. |
| 4 | Consistency and standards | 3 | 4 | Landing and app share one `Button` and token system; one height scale with a 44 px coarse-pointer floor. |
| 5 | Error prevention | 3 | 3 | Unchanged: client-side type validation, delete confirmation, composer explains disabled state. |
| 6 | Recognition rather than recall | 2 | 4 | Answers carry numbered chips plus a filename/page strip, and the sources rail shows snippet, page and section next to the answer by default on wide screens. |
| 7 | Flexibility and efficiency | 3 | 3 | ⌘K palette, ⌘/ focus, keyboard page nav; composer shows its shortcuts. |
| 8 | Aesthetic and minimalist design | 2 | 3 | Editorial serif + sans pairing, research-note chat, a calm dashboard. The viewer header is the least considered screen (flat chrome, "Ask  this document" label has a doubled gap from the flex `gap` plus `&nbsp;`). |
| 9 | Error recovery | 2 | 3 | Automatic retry for network/timeouts/502–504 and on the stream; explicit "Not enough evidence" state. Manual retry still needed after the retry budget runs out. |
| 10 | Help and documentation | 1 | 2 | First-run dashboard leads with upload → ask; landing has a live preview built from the real components. Still no in-app help beyond shortcuts. |
| **Total** | | **24** | **31/40** | **Good** |

## Design specificity verdict

**Authored, mostly.** The product's differentiator is now the layout: the chat reads as an annotated research note (question as a serif heading, inline numbered citations, a visible sources rail with highlighted passages), and the viewer opens on the cited page with the passage marked and quoted above it. The landing dropped the AI-SaaS kit for an editorial hero and a working preview of that same flow. What's still generic: the sidebar shell (filled primary "New question", grey rail) and the viewer chrome could belong to any document app.

## What's working

- **Evidence is visible by default.** Chat at 1440 shows answer and sources side by side; at 390 sources open as a bottom sheet with 44 px targets.
- **Cold start is a state, not an error.** Retry-with-backoff in the client plus the waking banner, covered by an e2e test, and a keep-warm workflow (runs only once merged).
- **One design system.** Tokens, type and buttons are shared by landing and app; theme-color meta now follows the in-app theme toggle.

## Priority issues

No P0 or P1 remains from the before list.

- **[P2] Landing benchmarks intro is too wide.** `p.mt-6.max-w-2xl` runs ~103 ch at 1280. *Fix:* cap at `max-w-[65ch]`. *Command: typeset.*
- **[P2] Viewer chrome hierarchy is flat** (13/14/15 px) and the "Ask this document" button has a doubled gap. *Fix:* one stronger title step; drop the `&nbsp;` or the flex gap. *Command: typeset / polish.*
- **[P3] Help is thin.** No empty-state hints for citations or abstention inside the app beyond the composer disclaimer. *Command: clarify / onboard.*

## Persona red flags

**Casey (distracted mobile user):** now gets a bottom nav, 44 px targets and a "waking up" banner instead of an error. Remaining risk: the PDF viewer at 390 renders at fit-width, so small print needs pinch/zoom.

**Jordan (first-timer):** dashboard opens with upload and "New question" as the two actions; stats are reduced to three plain numbers. Fine.

**Sam (accessibility-dependent):** contrast now passes AA on all text roles; reduced motion keeps fades and drops translation. Not yet checked with a real screen reader.

## Minor observations

- Straggler words on two short landing feature descriptions (advisory).
- Dark theme wasn't re-screenshotted in this pass; tokens were re-derived for it but it's verified by code, not by eye.

---

# Audit (technical): AFTER

| # | Dimension | Before | After | Key finding |
|---|---|---:|---:|---|
| 1 | Accessibility | 2 | 3 | Contrast fixed (0 low-contrast hits, was 57), 44 px coarse-pointer targets, per-animation reduced motion. No screen-reader or axe pass in this run. |
| 2 | Performance | 3 | 3 | Routes, pdf.js (634 kB, lazy) and mammoth stay code-split; landing parallax/orbs removed. No Lighthouse run. |
| 3 | Theming | 3 | 3 | Landing-only colours gone, theme-color/manifest derived from `--bg`. Dark mode not re-verified visually. |
| 4 | Responsive design | 2 | 4 | Bottom nav, sources sheet, viewer header fixed at 768, verified at 1440/1024/768/390 and by the mobile e2e flow. |
| 5 | Implementation integrity | 2 | 3 | Detector source 0; remaining rendered hits are one line-length, one flat-hierarchy advisory, and PDF text-layer false positives. |
| **Total** | | **12** | **16/20** | **Good** |

## Findings by severity

- **[P2] Line length.** *Location:* `src/pages/landing/LandingPage.tsx` benchmarks section intro. *Fix:* `max-w-[65ch]`.
- **[P2] Flat viewer chrome.** *Location:* `src/pages/DocumentPage.tsx` header. *Fix:* stronger title step; fix the doubled gap on line 87.
- **[P3] Unverified areas.** Screen reader, Lighthouse, dark theme screenshots, and the real (non-mock) API.

## Verified vs. untested

| Verified | Untested |
|---|---|
| Unit/component tests 76/76; typecheck, lint, production build | Real backend (Render) cold start; only mocked |
| 11/11 mocked Playwright flows (register, upload, citations → viewer, abstain, delete, palette, cold start, mobile sheet) | Screen reader / axe; Lighthouse |
| Screenshots at 4 widths × 8 screens, light theme | Dark theme screenshots |
| Detector at source, 1280 and 390 | Vercel preview against the API (blocked by CORS) |
