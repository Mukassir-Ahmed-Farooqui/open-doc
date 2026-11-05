# Backend architecture

One stateless FastAPI container plus Postgres (with pgvector) plus S3-compatible object storage. Nothing else to run, so it fits Railway (0.5-1 GB service), Google Cloud Run, Render or a laptop with `docker compose up`.

```
            ┌──────────────────────────── API container (uvicorn, 1 process) ────────────────────────────┐
 client ──► │ /api/v1 routes ─► services ─► SQLAlchemy async (asyncpg) ───────────────┐                  │
  (SSE)     │      │                                                                    │                  │
            │      ├─► RAGService: classify ─► reformulate* ─► HybridRetriever ─────────┤                  │
            │      │        dense (pgvector HNSW) ∥ sparse (tsvector GIN) ─► RRF ─► rerank (ONNX)          │
            │      │        ─► parent expansion ─► abstain? ─► LLM stream (Groq → Gemini) ─► cited sources │
            │      │                                                                    ▼                  │
            │      └─► upload ─► object storage (key = uuid) + documents row (queued) ─► Postgres          │
            │                                                                                              │
            │ IngestionWorker (asyncio task): claim job (SKIP LOCKED) ─► parse ─► chunk ─► embed ─► write   │
            └──────────────────────────────────────────────────────────────────────────────────────────────┘
                * only when the chat has history
```

## Layout

```
backend/
  app/
    config.py            pydantic-settings, every knob is an env var
    main.py              app factory, lifespan wiring, CORS, request-id + access-log middleware
    errors.py            error envelope and handlers
    logging_setup.py     JSON logs with request id
    ratelimit.py         in-memory sliding-window limiter (dependency)
    db/                  SQLAlchemy 2.0 models, async engine
    storage/             ObjectStorage protocol; local and S3 drivers
    auth/                bcrypt + PyJWT
    schemas/             Pydantic request/response models
    api/                 dependencies and routers (auth, documents, chats/messages/query, health)
    services/            document and chat persistence (owner-scoped queries)
    ingestion/           parsers (PyMuPDF, python-docx, md, txt), chunking, pipeline, worker
    providers/           embeddings (fastembed / Gemini), reranker (fastembed), LLM (Groq / Gemini)
    retrieval/           query classification + reformulation, RRF, hybrid retriever
    generation/          prompts, RAGService (answer / stream / cite / abstain)
  migrations/            Alembic (async env, advisory lock)
  tests/                 pytest: unit + API integration against real Postgres + pgvector
scripts/eval/            corpus fetcher, eval set builder, retrieval and generation benchmarks
```

## Data model

| Table | Purpose | Key points |
|---|---|---|
| `users` | accounts | email unique (lower-cased), bcrypt hash |
| `documents` | file metadata **and** the ingestion job | `status` queued/processing/ready/failed, `progress`, `error`, `attempts`, `next_attempt_at`, `processing_started_at`; `storage_key` (`documents/<uuid>`), `content_hash` unique per owner (dedup) |
| `sections` | parent units | heading, heading path, page range, full text (≤ `PARENT_MAX_TOKENS`) |
| `chunks` | child units, the retrieval index | `embedding vector(384)` with HNSW (cosine, m=16, ef_construction=64); `tsv` generated column (heading weight A, body weight B) with GIN; unique `(document_id, content_hash)` |
| `chats`, `messages` | conversation state | `selected_doc_ids` JSONB; citations stored as JSONB on the assistant message |
| `query_logs` | audit | question, type, chunks retrieved, abstained, model, timings; no document text |

**Tenancy.** `owner_id` is denormalised onto `sections` and `chunks`, and every SQL statement that touches user data filters on it directly, including the vector and full-text queries, in addition to the selected document ids. A request for another user's document or chat gets 404. Object keys are server-generated UUIDs, so the original filename is display-only and can never collide or traverse paths.

## Ingestion

1. `POST /upload` validates type by extension **and** magic bytes, enforces the size limit while streaming, hashes the bytes, dedups per user, writes the object, inserts a `queued` row, wakes the worker and returns 202.
2. The worker claims one job with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, so several instances can share the queue safely.
3. **Parse** (in a thread): PyMuPDF `get_text("dict")` gives spans with size and weight. The PDF TOC is used when present; otherwise headings come from font size relative to the body size, whole-line bold, and numbered/uppercase clause patterns. Running headers/footers (lines repeated on ≥50% of pages) and bare page numbers are dropped. DOCX uses heading styles, bold-only short paragraphs and tables (`a | b`). Markdown uses `#` headings; plain text uses blank-line paragraphs, uppercase/numbered headings and form feeds as page breaks. Corrupt, encrypted or text-less (scanned) files fail permanently with a readable error.
4. **Chunk**: consecutive headings fold into one ("ARTICLE II" + "TERM"), a heading stack gives each section a path, tiny sections (<15 tokens of body, e.g. runs of bold defined terms) merge into their predecessor, and sections over 1,200 tokens split at paragraph/sentence boundaries. Children are packed from sentences up to ~300 tokens with a ~50-token sentence-aligned overlap; fragments under 40 tokens are glued to a neighbour.
5. **Dedup**: children with identical normalised text in a document are embedded and stored once.
6. **Embed** in small batches (the embedding text is the last two heading levels + the passage, a cheap form of contextual retrieval) with progress updates.
7. **Write** in one transaction: delete the document's previous sections/chunks, insert new ones, mark `ready`. Re-running a job is therefore idempotent.
8. **Failures**: parse errors fail immediately; anything else is retried with exponential backoff (30 s, 60 s, …) up to `WORKER_MAX_ATTEMPTS`. Jobs left in `processing` longer than `WORKER_STALE_MINUTES` (instance killed) are requeued.

No LLM calls happen during ingestion. The old per-section summaries are gone; a document summary is available on demand (`GET /documents/{id}/summary`, one call, cached).

## Retrieval and generation

1. **Classify** (regex on whole words): `comparison` (compare / versus / difference … and 2+ documents), `summary` (summarise / overview / key terms …), else `fact`.
2. **Reformulate** a follow-up into a standalone query with one short LLM call, only when the chat has history. Failure falls back to the raw question.
3. **Retrieve** over the selected, ready, owned documents:
   * dense: `ORDER BY embedding <=> :q LIMIT 30` (HNSW; `hnsw.iterative_scan = relaxed_order` on pgvector ≥ 0.8 so filtered searches still return k rows)
   * sparse: `plainto_tsquery` with AND rewritten to OR (safe parsing, recall-oriented), ranked with `ts_rank`
   * **RRF** (k=60) over both lists, so a keyword-only match can enter the result set
   * optional **cross-encoder rerank** of the top 12 (heading + first 160 words)
   * comparison: retrieve per document and interleave so every document is represented; summary: opening passage of sections spread evenly through each document
4. **Abstain** when the best rerank score is below `MIN_RERANK_SCORE` (or the best cosine below `MIN_DENSE_SCORE` without a reranker). No LLM call is made.
5. **Expand** each child hit to its parent section (deduplicated, within `MAX_CONTEXT_TOKENS`), numbered `S1…Sn`, wrapped in `<source>` tags with document, page and section attributes.
6. **Generate** with Groq (OpenAI-compatible streaming over httpx). If Groq fails before the first token, Gemini takes over; a failure after the first token is reported, never spliced.
7. **Cite** by parsing `[S#]` markers. Only cited sources become citations (document, doc id, page, section, snippet, score). An abstention has none.

## Default retrieval configuration

Production uses **hybrid RRF + cross-encoder rerank over parent-child chunks** whenever a reranker is configured, and plain hybrid RRF when `RERANKER_PROVIDER=none`. These are the code defaults, so no environment variable is needed to get them:

| Where | Default |
|---|---|
| `HybridRetriever.retrieve()` | `mode="hybrid"`, `rerank=True` (rerank is skipped automatically when the reranker is `None`) |
| `Settings` | `RERANKER_PROVIDER=fastembed`, `RETRIEVAL_CANDIDATES=30`, `RRF_K=60`, `RERANK_CANDIDATES=12`, `RERANK_PASSAGE_WORDS=160`, `MIN_RERANK_SCORE=-9.0`, `MIN_DENSE_SCORE=0.50` |
| `ingest_document()` | `strategy="parent_child"` |

Why, from [BENCHMARKS.md](BENCHMARKS.md) (38 questions, 8 contracts):

* **Corpus-wide questions** are where configurations differ, and rerank wins clearly: R@1 0.605 vs 0.447 for hybrid RRF and 0.474 for dense, MRR@10 0.663 vs 0.547 and 0.493.
* **Abstention needs the rerank score.** On the calibration set the top rerank score of every out-of-scope question (max -9.555) is below every answerable one (min -8.155), so `MIN_RERANK_SCORE=-9.0` separates them. Top cosine scores overlap (29 of 72 negative scores are at or above 0.50), so the dense threshold used without a reranker is a weaker guard.
* **Sparse alone** has the best corpus R@10 (0.895) but R@1 of 0.447; fusing it with dense keeps its recall in the candidate pool for the reranker.
* **Costs accepted:** ~0.9 s per query on CPU and ~140 MB of RAM. Within a single selected document plain hybrid RRF is marginally better (MRR@10 0.873 vs 0.846), so this default trades a little single-document precision for corpus-wide accuracy and reliable abstention. A wider rerank (20 candidates, full passages) scores best in both scopes (MRR@10 0.691 corpus, 0.882 document) but roughly doubles rerank latency, so it is not the default; set `RERANK_CANDIDATES=20` and `RERANK_PASSAGE_WORDS=10000` to opt in.
* **512 MB hosts:** `RERANKER_PROVIDER=none` drops to hybrid RRF (corpus MRR@10 0.547, document 0.873) with dense-threshold abstention.

## Decisions and rejected alternatives

| Decision | Why | Rejected |
|---|---|---|
| **Postgres + pgvector for vectors** | One managed service for relational data, vectors and full text, so ownership filters, deletes and joins are transactional. Free tiers exist (Neon, Supabase, Railway). HNSW is fast at this scale (a 2-3 ms filtered query on the eval corpus) | **Qdrant**: a second stateful service to host, back up and keep consistent with Postgres; the old code could leave orphan vectors and needed extra scrolls per query. Its strengths (billions of vectors, quantisation) do not matter at this scale |
| **Postgres full-text search for sparse retrieval** | Same database and transaction, a generated `tsvector` column plus GIN, no index to rebuild in memory. Benchmarked as the strongest single retriever on this legal corpus | In-memory **BM25** (`rank_bm25`): must be rebuilt per process and per document set, and the old version only re-sorted dense hits. **SPLADE / learned sparse**: extra model and RAM |
| **RRF fusion** | Parameter-light, robust to the different score scales of cosine and `ts_rank` | Weighted score blending (needs per-corpus normalisation and tuning) |
| **In-process asyncio worker + Postgres job table** | Upload returns at once, status and retries are visible in the same database, `SKIP LOCKED` makes it multi-instance safe, and a crashed job is requeued. No extra service on a 3-service free plan | **Redis + Celery/RQ/arq**: another always-on service and more RAM for a queue that sees a few jobs an hour. Revisit if ingestion volume needs separate workers |
| **PyMuPDF + python-docx** | Fast, ~110 MB installed, gives font sizes/flags for heading detection and page numbers, no ML models | **docling**: pulls torch and layout/OCR models (multi-GB image, >2 GB RAM), and the old code built its pipeline options without using them. **unstructured**: similar weight. OCR for scanned PDFs is out of scope for the free-tier target |
| **fastembed (ONNX) bge-small-en-v1.5** as default embeddings | No API key, no network at query time, 384-d vectors keep the index small, ~65 MB model, no torch | **sentence-transformers** (torch, ~1 GB+). Gemini embeddings stay available behind `EMBEDDING_PROVIDER=gemini` |
| **fastembed cross-encoder reranker, on by default** | Biggest single gain on corpus-wide questions (R@1 0.447 to 0.605) and the only score that cleanly separates answerable from out-of-scope questions (abstention) | Hosted rerank APIs (extra key, network hop). Can be turned off (`RERANKER_PROVIDER=none`) on 512 MB hosts, see BENCHMARKS |
| **Plain httpx clients for Groq and Gemini** | Streaming SSE in ~150 lines, retries/backoff on 429/5xx under our control, a few MB of dependencies | Four vendor SDKs plus LangChain wrappers in the old requirements |
| **Plain async Python pipeline** | Retrieval → decide → generate is a straight line with one branch (abstain); code is easy to test and step through | **LangGraph**: graph runtime and state machinery for a linear flow, more dependencies, and the old graph hid the `.strip()`-on-dict bug behind broad exception handling. **LangChain**: wrappers over things done here in a few lines |
| **Structure-aware parent-child chunks** | Small children rank precisely; parents give the LLM the whole clause and section heading for citations | Fixed recursive splitting (kept as the benchmark baseline); semantic chunking (needs embeddings at chunk time, unclear gain on clause-structured contracts) |
| **No GraphRAG / LightRAG** | They need many LLM calls per document to extract entities and relations (cost and rate limits on free tiers), a graph store, and they target corpus-wide "global" questions. Questions here are scoped to a few selected documents and answered from specific clauses | Could be revisited for cross-document analytics |
| **Regex query classification** | Deterministic, free, testable; misclassification only changes how context is gathered | An LLM classifier call per question (latency, cost) |
| **In-memory rate limiter** | Abuse protection without Redis; limits are per instance | slowapi (was installed but unused; needs `request` in every signature); Redis-backed limits |
| **Hard deletes** | A user deleting a document expects the file and its text gone | Soft delete that kept files on disk |

## Prompt-injection stance

Document text is data. It is placed inside `<source>` tags (a literal `</source>` in the text is neutralised), and the system prompt says to ignore instructions inside sources. Nothing is filtered out of the context: the old filter dropped any chunk containing "act as", a common legal phrase, silently losing evidence.

## Known limits

* Scanned PDFs (no text layer) are rejected; there is no OCR.
* DOCX has no fixed pagination, so DOCX citations report page 1.
* Beta quotas (AI questions, sign-ups, documents, storage) are in Postgres and shared across instances. The auth and upload burst limits and the query-embedding cache are per process.
* One ingestion runs at a time, so on the free tier a queue of large PDFs takes several minutes each.
* The worker runs inside the API process. On Cloud Run with request-based billing the CPU is throttled between requests, so background ingestion needs instance-based billing (see DEPLOY.md).
* Changing the embedding model's dimension needs a migration and re-ingestion.
