# Product

<!-- impeccable:product-schema 1 -->

> Written by the Impeccable `init` flow from the repository and an explicit project brief. No live interview was possible (a sub-agent ran this). Every statement below comes from the README, `docs/`, the code, or the brief. Assumptions are marked.

## Platform

web

## Users

- **People who need to answer questions from their own documents and be able to check the answer.** Examples: someone reviewing a contract's notice period, a student re-reading cited pages of course material, a person checking a policy or handbook. They upload a handful of files (the account limit is 5 documents, up to 10 MB and 50 pages each) and ask in plain language.
- **Developers and reviewers evaluating an open-source RAG system.** They arrive from GitHub, look at the retrieval design and the benchmark, and try the hosted demo.
- *Assumption:* most sessions are short and task-shaped (upload, ask 1 to 5 questions, open a cited page). Many first visits happen on a phone from a shared link.

## Product Purpose

OpenDoc answers questions from documents the user uploads. Each claim in an answer is pinned to the page and section it came from. When the documents don't contain the answer, OpenDoc says so instead of guessing. Success means the user trusts the answer because they verified it in one click, not because it sounded confident.

## Positioning

Verifiable answers rather than fluent ones. Hybrid retrieval (pgvector dense + Postgres full-text, fused with RRF) feeds an answer where every sentence carries a numbered source (`[S1]` or `【S1】`). Each source opens the exact page in the in-app viewer with the passage highlighted, and an explicit "not enough evidence" abstention replaces guesses. It is free and MIT-licensed open source, and it runs on one Postgres database with no extra infrastructure.

## Operating Context

- Documents: PDF, DOCX, Markdown and TXT. PDFs are cited to the page with a highlighted passage, while DOCX, Markdown and TXT are cited to the section or passage.
- The hosted demo runs the web app on Vercel and the API on Render's free tier, which **sleeps after 15 minutes idle and needs about 1 minute to wake**. The UI must treat that as normal, not as an outage.
- Answers stream over SSE (`meta` → `token`… → `done` | `error`). Uploads report byte progress, then ingestion moves through queued → processing % → ready or failed, which the UI polls.
- Generation uses Groq (`openai/gpt-oss-120b` in the benchmark). Quota is finite, so the UI shouldn't fire speculative LLM calls.

## Capabilities and Constraints

- Auth: email + password, JWT bearer. Routes: `/`, `/login`, `/register`, `/documents`, `/documents/:id?page=&q=`, `/chat/:chatId?`, `/settings`.
- Documents: upload (multipart), list, get, delete, on-demand summary, original file via a presigned `file-url` with `/download` fallback.
- Chats: create with a document scope, rename, change scope, delete, stream a message with an answer style (`executive` / `detailed` / `highlights`).
- Probes: `/health`, `/ready`.
- **Not available, do not design for:** sharing, teams, folders/tags, per-page thumbnails from the API, answer feedback, search across message text, billing.
- No new infrastructure. The frontend is React 19 + Vite + Tailwind v4 with radix, cmdk, sonner, react-pdf and lucide.

## Brand Commitments

- Name **OpenDoc** and the existing logo mark (an indigo rounded square holding a document with a magnifier).
- Indigo accent, roughly `#5B5BD6`.
- Voice: plain, specific and modest. It names what the system does ("cites the page", "says when it can't find support") and never makes claims beyond the benchmark.

## Evidence on Hand

- Benchmark (`docs/BENCHMARKS.md`, README): 46 generation questions on the live Groq API (38 answerable, 8 out of scope), **LLM-judged by the same model**. Faithfulness 97.3% (36/37), gold-cited rate 94.6% (35/37), abstention recall 8/8, false abstention 2.6%, TTFT p50 1.94 s.
- Demo content: `frontend/e2e/fixtures/services-agreement.pdf` (3 pages) and `handbook.md`.
- **Absent, never fabricate:** testimonials, customer logos, user counts, ratings, press, uptime or SLA claims.

## Product Principles

1. **Evidence before eloquence.** The source of a claim is always one click away and visible next to the answer.
2. **Honest states.** Abstention, waking server, processing and failure are first-class states with plain words, not errors or spinners.
3. **Quiet tool, clear reading.** The workspace stays out of the way. The answer and the document are the content.
4. **Truthful marketing.** Every number on the landing page traces to `docs/BENCHMARKS.md` with its caveat.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast ≥4.5:1 in both themes, 44 px touch targets on coarse pointers, full keyboard paths (⌘K palette, ⌘/ focus, arrow-key page nav), and `prefers-reduced-motion` honoured with reduced alternatives rather than a blanket kill.
