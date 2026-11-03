# Deploying the backend

The API is one Docker image (`backend/Dockerfile`) plus two managed services:

* **Postgres 15+ with the `pgvector` extension.** Neon's free tier is the default recommendation. The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`, so the database user needs permission to create it (Neon, Railway's pgvector Postgres and Supabase allow this).
* **S3-compatible object storage** for uploaded files: a Railway bucket, Cloudflare R2, Google Cloud Storage (S3 interoperability with HMAC keys), AWS S3 or MinIO. `STORAGE_BACKEND=local` works too, but every host below has an ephemeral filesystem, so uploads would be lost on each redeploy or restart.

The image bakes in the ONNX models (`/opt/models`, `HF_HUB_OFFLINE=1`), so a cold start never downloads anything. It runs as a non-root user and listens on `$PORT`.

## Sizing

The measured RSS figures are in [BENCHMARKS.md](BENCHMARKS.md#memory): 104 MB idle with lazy models, 374 MB with both models warmed, 476 MB peak while ingesting a PDF with the reranker enabled.

| Instance memory | Settings |
|---|---|
| **1 GB (recommended)** | Defaults. Hybrid retrieval + cross-encoder rerank, rerank-based abstention |
| **512 MB** | `RERANKER_PROVIDER=none`. Retrieval falls back to hybrid RRF without rerank, and abstention uses `MIN_DENSE_SCORE`, which separates answerable from out-of-scope questions less well (see BENCHMARKS) |

In both cases keep `WEB_CONCURRENCY=1` (each uvicorn worker loads its own models), `ONNX_MEM_ARENA=false` and `WARM_MODELS_ON_STARTUP=false` unless you have spare memory and want to avoid the first-request model load.

## Migrations

`backend/start.sh` runs `alembic upgrade head` before uvicorn starts, unless `RUN_MIGRATIONS=false`. The Alembic environment takes a Postgres advisory lock, so several instances starting together apply migrations once.

To run them by hand (for example with `RUN_MIGRATIONS=false` on many instances):

```bash
# from a checkout, with the production DATABASE_URL exported
cd backend && pip install -r requirements.txt && alembic upgrade head

# or with the image
docker run --rm -e DATABASE_URL="$DATABASE_URL" <image> alembic upgrade head
```

## Health checks

| Path | Use it for | Behaviour |
|---|---|---|
| `GET /health` | liveness | Always 200 `{"status":"ok","version":...}` while the process serves; touches no dependency |
| `GET /ready` | readiness / deploy health check | 200 only when the database answers, the `vector` extension is installed, storage is reachable and (if enabled) the ingestion worker is running; otherwise 503 with per-check detail. Also reports whether an LLM key is configured, without failing on it |

Both live at the root, not under `/api/v1`. The Docker `HEALTHCHECK` calls `/health`.

## Environment variables

Every variable maps to a field in `backend/app/config.py`; `.env.example` lists all of them with comments. Variables marked **required** have no usable default in production.

### Must set

| Variable | Notes |
|---|---|
| `APP_ENV` | `production` (the image already sets it). Enables the secret-key guard |
| `DATABASE_URL` | **required**. `postgres://`, `postgresql://` and `postgresql+asyncpg://` are all accepted. Neon's `?sslmode=require&channel_binding=require` is translated for asyncpg (`ssl=require`; `channel_binding` dropped). Prefer Neon's direct (non `-pooler`) host: the app keeps its own small pool |
| `JWT_SECRET_KEY` | **required**, 32+ random characters (`python -c "import secrets; print(secrets.token_urlsafe(48))"`). Startup fails in production without it |
| `CORS_ORIGINS` | Comma-separated frontend origins, e.g. `https://opendoc.vercel.app` |
| `GROQ_API_KEY` | Primary LLM. At least one of `GROQ_API_KEY` / `GEMINI_API_KEY` is needed to answer questions; with neither, uploads and ingestion work but chat requests fail with "No LLM provider configured" |
| `STORAGE_BACKEND` | `s3` on every host below |
| `S3_BUCKET` | **required** when `STORAGE_BACKEND=s3` |
| `S3_ENDPOINT_URL` | Railway: the bucket's `ENDPOINT`; R2: `https://<account_id>.r2.cloudflarestorage.com`; GCS: `https://storage.googleapis.com`; leave empty for AWS |
| `S3_REGION` | `auto` for R2 and Railway buckets; the bucket region for AWS/GCS |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Bucket credentials |

### Optional

| Group | Variables (default) |
|---|---|
| LLM fallback | `GEMINI_API_KEY` (unset: no fallback), `GEMINI_MODEL` (`gemini-2.0-flash`), `GROQ_MODEL` (`llama-3.3-70b-versatile`), `LLM_TIMEOUT_SECONDS` (60), `LLM_MAX_TOKENS` (1024), `LLM_TEMPERATURE` (0.1), `GROQ_BASE_URL`, `GEMINI_BASE_URL` |
| Memory | `RERANKER_PROVIDER` (`fastembed`; `none` on 512 MB), `WARM_MODELS_ON_STARTUP` (false), `ONNX_MEM_ARENA` (false), `ONNX_THREADS` (2), `EMBEDDING_BATCH_SIZE` (4), `EMBEDDING_CACHE_SIZE` (512) |
| Embeddings | `EMBEDDING_PROVIDER` (`fastembed`; `gemini` needs `GEMINI_API_KEY`), `EMBEDDING_MODEL` (`BAAI/bge-small-en-v1.5`), `EMBEDDING_DIM` (384; changing it needs a migration and re-ingest), `EMBEDDING_QUERY_PREFIX` (BGE instruction), `GEMINI_EMBEDDING_MODEL`, `FASTEMBED_CACHE_DIR` (`/opt/models` in the image), `RERANKER_MODEL` |
| Retrieval | `RETRIEVAL_CANDIDATES` (30), `RERANK_CANDIDATES` (12), `RERANK_PASSAGE_WORDS` (160), `CONTEXT_TOP_K` (6), `RRF_K` (60), `MIN_RERANK_SCORE` (-9.0), `MIN_DENSE_SCORE` (0.50), `MAX_CONTEXT_TOKENS` (3500), `HISTORY_TURNS` (6), `SUMMARY_MAX_SECTIONS` (12) |
| Chunking | `CHILD_TARGET_TOKENS` (300), `CHILD_OVERLAP_TOKENS` (50), `CHILD_MIN_TOKENS` (40), `SECTION_MIN_TOKENS` (15), `PARENT_MAX_TOKENS` (1200) |
| Worker | `WORKER_ENABLED` (true), `WORKER_CONCURRENCY` (1), `WORKER_POLL_SECONDS` (5), `WORKER_MAX_ATTEMPTS` (3), `WORKER_STALE_MINUTES` (15) |
| Limits | `MAX_UPLOAD_MB` (20), `RATE_LIMIT_AUTH` (`10/minute`), `RATE_LIMIT_QUERY` (`30/minute`), `RATE_LIMIT_UPLOAD` (`30/hour`); limits are per instance |
| Database pool | `DB_POOL_SIZE` (5), `DB_MAX_OVERFLOW` (5), `DB_ECHO` (false) |
| Auth | `JWT_ALGORITHM` (`HS256`), `JWT_EXPIRE_MINUTES` (60) |
| Logging | `LOG_LEVEL` (`INFO`), `LOG_JSON` (true), `APP_NAME`, `APP_VERSION` |
| Container | `PORT` (set by the host), `WEB_CONCURRENCY` (1), `RUN_MIGRATIONS` (true), `MALLOC_ARENA_MAX` (2, set in the image) |

## Railway (Hobby plan)

1. **Database.** Create a Neon project, run nothing on it (migrations run on deploy), and copy the direct connection string. A Railway Postgres service built from a pgvector image also works.
2. **Storage.** In the Railway project, *Create → Bucket*. Its Credentials tab gives `BUCKET`, `ENDPOINT`, `REGION`, `ACCESS_KEY_ID` and `SECRET_ACCESS_KEY`. (Or create a Cloudflare R2 bucket and an API token with object read/write.)
3. **Service.** *New → GitHub repo* → this repo. In the service settings:
   * **Root Directory:** `/backend`
   * **Config file path:** `/backend/railway.json` (Railway does not look for the config file inside the root directory on its own). It selects the Dockerfile builder, health check `/ready` with a 120 s timeout, restart on failure, and only redeploys on changes under `/backend/**`.
   * **Memory:** 1 GB, or 512 MB with `RERANKER_PROVIDER=none`.
4. **Variables** (reference the bucket's variables so rotating credentials needs no edit):

   ```
   DATABASE_URL=<neon connection string>
   JWT_SECRET_KEY=<48+ random chars>
   CORS_ORIGINS=https://<your-frontend>
   GROQ_API_KEY=<key>
   STORAGE_BACKEND=s3
   S3_BUCKET=${{Bucket.BUCKET}}
   S3_ENDPOINT_URL=${{Bucket.ENDPOINT}}
   S3_REGION=${{Bucket.REGION}}
   S3_ACCESS_KEY_ID=${{Bucket.ACCESS_KEY_ID}}
   S3_SECRET_ACCESS_KEY=${{Bucket.SECRET_ACCESS_KEY}}
   ```

   Replace `Bucket` with your bucket service's name. Railway sets `PORT`.
5. **Domain.** *Settings → Networking → Generate Domain*, then point the frontend's API URL at it.

The in-process worker runs continuously on Railway (no CPU throttling), so background ingestion needs nothing extra.

## Google Cloud Run (free tier)

Cloud Run's default request-based billing throttles the CPU to almost nothing between requests. The ingestion worker is an asyncio task inside the API process, so with throttling an uploaded file sits in `processing` until the next request arrives. Deploy with **instance-based billing** (`--no-cpu-throttling`) so the worker keeps running while the instance is up.

```bash
gcloud run deploy opendoc-api \
  --source backend \
  --region us-central1 \
  --memory 1Gi --cpu 1 \
  --no-cpu-throttling \
  --min-instances 0 --max-instances 1 \
  --concurrency 20 --timeout 300 \
  --set-env-vars APP_ENV=production,STORAGE_BACKEND=s3,S3_REGION=auto,CORS_ORIGINS=https://<your-frontend> \
  --set-secrets DATABASE_URL=opendoc-db-url:latest,JWT_SECRET_KEY=opendoc-jwt:latest,GROQ_API_KEY=opendoc-groq:latest,S3_BUCKET=opendoc-s3-bucket:latest,S3_ENDPOINT_URL=opendoc-s3-endpoint:latest,S3_ACCESS_KEY_ID=opendoc-s3-key:latest,S3_SECRET_ACCESS_KEY=opendoc-s3-secret:latest \
  --allow-unauthenticated
```

* `--source backend` builds `backend/Dockerfile` with Cloud Build. Create the secrets first in Secret Manager and grant the service account `roles/secretmanager.secretAccessor`.
* **Storage:** Cloudflare R2, or a GCS bucket through S3 interoperability (*Cloud Storage → Settings → Interoperability → HMAC key*, endpoint `https://storage.googleapis.com`, region = bucket region).
* **Health:** set the startup probe to HTTP `GET /ready` (console: *Edit & deploy new revision → Container → Health checks*) and, optionally, a liveness probe on `/health`.
* **`--min-instances 0` tradeoff:** free when idle, but the first request after idle pays a cold start (image pull, migrations, Postgres connection; models load lazily on the first query or upload). And when the instance scales to zero, an ingestion still in progress stops; the job is requeued after `WORKER_STALE_MINUTES` (15) the next time an instance runs. `--min-instances 1` removes both problems but bills an always-on instance, which leaves the free tier.
* `--max-instances 1` keeps the per-instance rate limits and query cache coherent and keeps usage inside the free allowance. Check current free-tier allowances for instance-based billing on the [Cloud Run pricing page](https://cloud.google.com/run/pricing) before relying on them.

## Render (free)

Render's free web service is 0.1 CPU / 512 MB, spins down after 15 minutes without traffic and takes about a minute to wake ([Render free tier docs](https://render.com/docs/free)). It works for demos with these settings:

1. *New → Web Service* → this repo, **Runtime: Docker**, **Root Directory:** `backend`, **Dockerfile path:** `./Dockerfile`, **Instance type:** Free.
2. **Health check path:** `/ready`.
3. Environment: the "Must set" variables above plus `RERANKER_PROVIDER=none` (512 MB). Use Neon for Postgres: Render's free Postgres expires 30 days after creation. Use R2 or another S3 bucket: the free instance has no persistent disk.

Expect slow ingestion on 0.1 CPU, and a stopped worker while the service is asleep. A file uploaded just before spin-down is requeued after `WORKER_STALE_MINUTES` once the service wakes.

## After deploying

```bash
curl https://<api-host>/health     # {"status":"ok",...}
curl https://<api-host>/ready      # {"status":"ready","checks":{"database":"ok","pgvector":"0.8.x","storage":"ok","worker":"ok","llm":"configured"}}
```

Then open `https://<api-host>/docs`, register a user, upload a PDF and watch `GET /api/v1/documents/{id}` move from `queued` to `ready`.
