<div align="center">

<br />
<img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/scale.svg" alt="OpenDoc" width="80" />

# open-doc

### Citation-grounded Q&A over your own contracts and documents

OpenDoc lets each user upload PDFs, DOCX, Markdown or text files and ask questions across a chosen set of them. Answers stream back with numbered citations to the exact page and section, and the system says so instead of guessing when the documents do not contain the answer.

<br />

<p>
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/FastAPI-async-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Postgres-pgvector-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="Postgres + pgvector" />
  <img src="https://img.shields.io/badge/ONNX-fastembed-005CED?style=for-the-badge&logo=onnx&logoColor=white" alt="fastembed" />
  <img src="https://img.shields.io/badge/Groq-gpt--oss--120b-FF5500?style=for-the-badge" alt="Groq" />
  <img src="https://img.shields.io/badge/React-Vite-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
</p>

<p>
  <a href="https://open-doc-mocha.vercel.app"><b>Live demo</b></a> ·
  <a href="https://opendoc-api.onrender.com/docs">API docs</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/BENCHMARKS.md">Benchmarks</a>
</p>

<sub>Public beta on free tiers: the API sleeps after 15 idle minutes, so the first request can take about a minute.</sub>

</div>

---

## Architecture

One stateless FastAPI container, Postgres with pgvector, and S3-compatible object storage. No vector database, queue or graph runtime to run alongside it.

```mermaid
graph LR
    UI[React PWA on Vercel] -->|JWT, SSE| API
    UI -->|presigned GET, PDF viewer| S3

    subgraph API[FastAPI container on Render]
        R[/api/v1 routes/] --> Q[Quotas + kill switch]
        Q --> RAG[RAGService]
        RAG --> HR[HybridRetriever]
        HR -->|dense: HNSW cosine| PG
        HR -->|sparse: tsvector + GIN| PG
        HR --> RRF[RRF fusion] --> RR[cross-encoder rerank, ONNX, optional]
        RR --> EXP[parent-section expansion] --> LLM[Groq stream, Gemini fallback]
        R -->|upload 202| S3
        W[In-process ingestion worker, one job at a time] -->|claim job SKIP LOCKED| PG
        W -->|parse, chunk, embed| PG
    end

    PG[(Neon Postgres + pgvector)]
    S3[(Supabase Storage, S3 API)]
```

* **Ingestion.** Upload checks type by magic bytes, validates the file (encrypted or damaged PDFs, page count, DOCX zip bombs), deduplicates per user, stores it and returns 202. A Postgres-backed job queue feeds an asyncio worker in the same process: PyMuPDF / python-docx parsing with heading detection, structure-aware parent-child chunking, bge-small-en-v1.5 embeddings (fastembed, ONNX, no API key), one transactional write. Only one ingestion runs at a time across all instances (Postgres advisory lock), which keeps a 512 MB instance safe. Failures retry with backoff; stale jobs are requeued.
* **Retrieval.** Dense (pgvector HNSW) and sparse (Postgres full-text) candidates fused with Reciprocal Rank Fusion, then reranked by a MiniLM cross-encoder when memory allows. Comparison questions retrieve per document; summary questions sample sections across each document.
* **Generation.** Child hits expand to their parent sections, wrapped as `<source>` blocks. Groq (`openai/gpt-oss-120b`) streams the answer, and Gemini takes over if Groq fails before the first token. Only sources the model actually cites become `【S#】` citations. A low relevance score abstains without calling the LLM.
* **Files.** The PDF viewer loads the original file straight from storage through a short-lived presigned URL (`GET /documents/{id}/file-url`, 10 minutes), so large PDFs never stream through the API. `/download` stays as a fallback.
* **Tenancy.** Every query, including the vector and full-text searches, filters on the caller's `owner_id`. Another user's document or chat is a 404.

### Production deployment (public beta, ₹0)

| Part | Service | Notes |
|---|---|---|
| Frontend | Vercel (Hobby) | React + Vite PWA, landing page for signed-out visitors, installable from Chrome on Android |
| API + worker | Render free web service, Singapore | Docker, 512 MB, `WEB_CONCURRENCY=1`, `RERANKER_PROVIDER=none`, sleeps after 15 idle minutes |
| Database + vectors | Neon free, pgvector 0.8 | Documents, chunks, embeddings, job queue, usage counters |
| File storage | Supabase Storage, private bucket | S3-compatible API, presigned URLs for viewing |
| LLM | Groq free tier | Gemini optional fallback |

Measured on this setup (2026-11-04): a 50-page PDF ingested in about 6 minutes with peak memory 307 MB of 512 MB.

### Public beta limits

Limits are stored in Postgres, so they hold across restarts and instances. All are environment variables (see `.env.example`).

| Limit | Default | Response when hit |
|---|---|---|
| File size | 10 MB | 413 |
| Pages per PDF | 50 | 422 |
| Documents per user | 5 | 429 |
| Storage per user | 25 MB | 429 |
| AI questions per user | 5 per minute, 30 per day | 429 with `Retry-After` |
| AI questions across all users | 300 per day | 429 with `Retry-After` |
| Sign-ups per IP | 3 per day | 429 |
| Kill switch | `AI_ENABLED=false` | 503 on AI routes; documents stay available |

Daily windows reset at UTC midnight. A question that fails on the LLM side is refunded.

Details, the data model and the rejected alternatives (Qdrant, LangGraph, docling, Redis queues, GraphRAG) are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Retrieval quality

Measured on 38 labelled questions over 8 contracts, all documents selected ([full results](docs/BENCHMARKS.md)):

| Configuration | R@1 | R@5 | MRR@10 | nDCG@10 | p50 latency |
|---|---|---|---|---|---|
| Dense only | 0.474 | 0.500 | 0.493 | 0.519 | 17.2 ms |
| Hybrid RRF | 0.447 | 0.684 | 0.547 | 0.614 | 54.6 ms |
| **Hybrid RRF + rerank (default on 1 GB)** | **0.605** | **0.763** | **0.663** | **0.695** | 900.2 ms |

Production on 512 MB runs without the reranker, which corresponds to the Hybrid RRF row.

Generation, 46 questions on the live Groq API (38 answerable, 8 out of scope), judged by the same model, so treat these as indicative:

| Faithfulness | Gold-cited rate | Abstention recall | False abstention | TTFT p50 / p95 |
|---|---|---|---|---|
| 97.3% | 94.6% | 100% (8/8) | 2.6% | 1.94 s / 3.75 s |

## Repository layout

```
backend/            FastAPI app, Alembic migrations, tests, Dockerfile
frontend/           React + Vite PWA (landing, library, chat, PDF viewer), deployed on Vercel
scripts/eval/       corpus fetcher, eval-set builder, retrieval and generation benchmarks
tests/evaluation/   labelled questions; tests/fixtures/ sample contract
docs/               ARCHITECTURE.md, API.md, BENCHMARKS.md, DEPLOY.md
docker-compose.yml  local stack: Postgres + pgvector, MinIO, API
```

## Local development

### Quickstart (Docker)

```bash
git clone https://github.com/Mukassir-Ahmed-Farooqui/open-doc.git
cd open-doc
echo "GROQ_API_KEY=<your key>" > .env      # optional: GEMINI_API_KEY for fallback
docker compose up --build
```

This starts Postgres with pgvector, MinIO (an S3-compatible bucket named `opendoc`) and the API, runs the migrations and serves:

* API docs: http://localhost:8000/docs
* Health: http://localhost:8000/health and http://localhost:8000/ready
* MinIO console: http://localhost:9001 (`opendoc` / `opendoc-secret`)

Without an LLM key, upload and ingestion work but questions return an error.

### Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173, talks to VITE_API_URL (default http://localhost:8000)
```

### Backend without Docker

Needs Python 3.12 and a Postgres with the `vector` extension (for example `docker compose up db`).

```bash
cp .env.example .env                       # edit DATABASE_URL, GROQ_API_KEY
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Every setting is an environment variable; `.env.example` lists them all with comments.

### Tests and lint

```bash
cd backend
TEST_DATABASE_URL=postgresql://opendoc:opendoc@localhost:5432/postgres python -m pytest -q
ruff check .. && ruff format --check ..
```

The integration tests need a real Postgres with pgvector. CI (`.github/workflows/backend-ci.yml`) runs lint plus the full suite against a `pgvector/pgvector:pg17` service.

### Benchmarks

```bash
python scripts/eval/fetch_corpus.py                  # CUAD contracts, pinned revision
EVAL_DATABASE_URL=postgresql://... python scripts/eval/run_retrieval.py all
GROQ_API_KEY=... python scripts/eval/run_generation.py
```

## Deployment

The live setup is Vercel + Render free + Neon + Supabase Storage, described above. Railway and Google Cloud Run also work. Step-by-step guides, every environment variable, migrations and health checks are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data model, ingestion and retrieval pipelines, decisions and rejected alternatives, known limits |
| [docs/API.md](docs/API.md) | Endpoints, error envelope, streaming format, contract changes vs the previous backend |
| [docs/BENCHMARKS.md](docs/BENCHMARKS.md) | Retrieval results for every chunking x retrieval x scope configuration, abstention calibration, ingest timings, memory |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Render + Supabase (live setup), Railway and Cloud Run guides, environment variables, migrations, health checks |

## License

[MIT](LICENSE). The benchmark corpus comes from CUAD (CC BY 4.0, The Atticus Project).
