# OpenDoc — web app

React 19 + Vite + TypeScript + Tailwind CSS v4 client for the OpenDoc v1 API (see `../docs/API.md`).

## Stack

| Concern | Choice |
|---|---|
| Routing | React Router 7 (`/`, `/documents`, `/documents/:docId?page=&q=`, `/chat/:chatId?`, `/settings`, `/login`, `/register`) |
| Server state | TanStack Query 5 (documents poll every 2 s while any is `queued`/`processing`) |
| API client | Hand-written, typed from `backend/app/schemas/*` with zod validation of every response (`src/lib/api`) |
| Streaming | `fetch` + incremental SSE parser (`src/lib/api/sse.ts`) for `POST /chats/{id}/messages/stream`; stop = `AbortController` |
| Citations | `[S#]` markers → interactive chips → source panel (snippet, page, section) → viewer at that page with the snippet highlighted |
| Viewer | `react-pdf` (pdf.js) for PDF, raw text for TXT/MD/DOCX (DOCX via `mammoth`), both lazy-loaded |
| UI | Radix primitives (dialog, menu), `cmdk` palette, `sonner` toasts, `lucide-react` icons, Inter + Geist Mono |

Design tokens (colours, type scale, radii, shadows, motion) live in `src/index.css`; light/dark swap through CSS variables.

## Develop

```bash
cp .env.example .env          # VITE_API_URL=http://localhost:8000
npm ci
npm run dev                   # http://localhost:5173
```

The backend must allow the frontend origin: `CORS_ORIGINS=http://localhost:5173` (already set in `docker-compose.yml`).

| Script | What it does |
|---|---|
| `npm run build` | `tsc -b` then `vite build` into `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint (typescript-eslint, react-hooks, react-refresh) |
| `npm test` | Vitest + Testing Library (API client, SSE parser, citation parsing, components) |
| `npm run screenshots` | Headless Chromium screenshots into `../docs/screenshots` (see that folder's README) |

## Configuration

| Variable | When | Meaning |
|---|---|---|
| `VITE_API_URL` | build time | API origin without `/api/v1`, e.g. `https://opendoc-api.up.railway.app`. Empty = same origin (put the SPA and API behind one reverse proxy that forwards `/api`, `/health`, `/ready`). |

## Deploy

**Docker (nginx static):**

```bash
docker build --build-arg VITE_API_URL=https://api.example.com -t opendoc-web ./frontend
docker run -p 8080:8080 opendoc-web
```

`nginx.conf` serves hashed assets as immutable, never caches `index.html`, and falls back to `index.html` for client routes.

**Vercel:** import the repo, set *Root Directory* to `frontend`, add `VITE_API_URL` as an environment variable. `vercel.json` adds the SPA rewrite.

**Cloudflare Pages:** build command `npm run build`, output `dist`, root `frontend`, env `VITE_API_URL`. `public/_redirects` provides the SPA fallback.

In every case add the deployed origin to the backend's `CORS_ORIGINS`.

## Keyboard

| Keys | Action |
|---|---|
| ⌘K / Ctrl+K | Command palette (navigate, search documents and chats, upload, theme, sign out) |
| ⌘/ / Ctrl+/ | Focus the page's main input (chat composer, library search) |
| Enter / Shift+Enter | Send / newline in the composer |
| ← / → | Previous / next page in the PDF viewer |

## Notes on the API contract

* Upload returns **202** (`queued`); the UI tracks byte progress (XHR) and then the server's ingestion status until `ready`/`failed`. Identical bytes return 200 + `duplicate: true` and the existing document is reused.
* Another user's resources answer **404**; the UI shows "not found" rather than "forbidden".
* An answer with `abstained: true`, or the fixed insufficient-evidence sentence, renders as an explicit *Not enough evidence* state with no citations.
* "Regenerate" re-asks the previous question as a new turn (the API has no regenerate endpoint).
* Stopping a stream aborts the request; per the API the user message is saved and the partial answer is not, and the UI says so.
* Session: the JWT and its `expires_in` are kept in `localStorage`; the session ends at expiry or on any 401.
