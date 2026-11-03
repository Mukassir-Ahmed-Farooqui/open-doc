"""Retrieval benchmark: chunking x retrieval configurations, no LLM needed.

Ingests the fixture corpus once per chunking strategy (``recursive`` baseline vs production
``parent_child``) into a scratch Postgres database, then scores every retrieval mode
(dense, sparse, hybrid RRF, hybrid RRF + cross-encoder rerank) on the labelled eval set.

Metrics (binary relevance, see dataset.py for labelling):
  Recall@k  - share of questions with at least one relevant chunk in the top k (hit rate; each
              question has a single gold evidence span)
  P@5       - relevant chunks in the top 5 / 5
  MRR@10    - mean reciprocal rank of the first relevant chunk
  nDCG@10   - ideal DCG computed from all relevant chunks of that document
  latency   - wall time of one retrieve() call with the query-embedding cache cleared (p50/p95)

Scopes: ``corpus`` (all 8 documents selected: harder, discriminates configs) and
``document`` (only the question's own document selected, which is how the app is used).

The work is split into resumable steps so it can run under short time limits:
  python scripts/eval/run_retrieval.py all                 # everything, sequentially
  python scripts/eval/run_retrieval.py ingest --strategy parent_child
  python scripts/eval/run_retrieval.py query --strategy parent_child --config hybrid_rrf_rerank
  python scripts/eval/run_retrieval.py calibrate
  python scripts/eval/run_retrieval.py report
Environment: EVAL_DATABASE_URL (admin URL; a database ``opendoc_eval`` is created on it).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import statistics
import subprocess
import sys
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(REPO))

import asyncpg  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from scripts.eval.dataset import EvalItem, build, corpus_files  # noqa: E402

ADMIN_URL = os.environ.get("EVAL_DATABASE_URL", "postgresql://postgres@/postgres?host=/tmp&port=5433")
EVAL_DB = "opendoc_eval"
RESULTS = Path(__file__).parent / "results"
ROWS = RESULTS / "rows"
STORAGE_DIR = RESULTS / ".objects"
TOP_K = 10
STRATEGIES = ("recursive", "parent_child")
# name -> (mode, rerank, settings overrides). Defaults come from app.config.Settings.
CONFIGS: dict[str, tuple[str, bool, dict]] = {
    "dense": ("dense", False, {}),
    "dense_no_query_prefix": ("dense", False, {"embedding_query_prefix": ""}),
    "sparse": ("sparse", False, {}),
    "hybrid_rrf": ("hybrid", False, {}),
    "hybrid_rrf_rerank": ("hybrid", True, {}),
    "hybrid_rrf_rerank20_full": ("hybrid", True, {"rerank_candidates": 20, "rerank_passage_words": 10_000}),
}


def _dsn(url: str) -> dict:
    u = make_url(url.replace("postgresql+asyncpg://", "postgresql://"))
    kw: dict = {"user": u.username, "password": u.password, "database": u.database}
    if host := (u.query.get("host") or u.host):
        kw["host"] = host
    if port := (u.query.get("port") or u.port):
        kw["port"] = int(port)
    return kw


def eval_db_url() -> str:
    url = make_url(ADMIN_URL.replace("postgresql+asyncpg://", "postgresql://")).set(database=EVAL_DB)
    return url.render_as_string(hide_password=False)


async def ensure_db(reset: bool) -> str:
    conn = await asyncpg.connect(**_dsn(ADMIN_URL))
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", EVAL_DB)
        if reset and exists:
            await conn.execute(f'DROP DATABASE "{EVAL_DB}" WITH (FORCE)')
            exists = False
        if not exists:
            await conn.execute(f'CREATE DATABASE "{EVAL_DB}"')
    finally:
        await conn.close()
    env = os.environ | {"DATABASE_URL": eval_db_url()}
    await asyncio.to_thread(
        subprocess.run,
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        check=True,
        env=env,
        capture_output=True,
    )
    return eval_db_url()


def owner_for(strategy: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"opendoc-eval/{strategy}")


def dcg(rels: list[bool]) -> float:
    return sum(1.0 / math.log2(i + 2) for i, r in enumerate(rels) if r)


def score(rels: list[bool], total_relevant: int) -> dict[str, float]:
    first = next((i for i, r in enumerate(rels) if r), None)
    ideal = dcg([True] * min(max(total_relevant, 1), TOP_K))
    return {
        "recall@1": float(any(rels[:1])),
        "recall@5": float(any(rels[:5])),
        "recall@10": float(any(rels[:10])),
        "p@5": sum(rels[:5]) / 5,
        "mrr@10": 0.0 if first is None else 1.0 / (first + 1),
        "ndcg@10": dcg(rels[:TOP_K]) / ideal,
    }


def pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))]


class Ctx:
    def __init__(self, db_url: str, **overrides: object) -> None:
        from app.config import Settings
        from app.db.session import Database
        from app.providers.embeddings import FastEmbedEmbeddings
        from app.providers.rerank import FastEmbedReranker
        from app.retrieval.retriever import HybridRetriever
        from app.storage.local import LocalStorage

        self.settings = Settings(
            database_url=db_url,
            local_storage_dir=str(STORAGE_DIR),
            worker_enabled=False,
            context_top_k=TOP_K,
            **overrides,
        )
        self.db = Database(self.settings)
        self.storage = LocalStorage(str(STORAGE_DIR))
        self.embedder = FastEmbedEmbeddings(self.settings)
        self.reranker = FastEmbedReranker(self.settings)
        self.retriever = HybridRetriever(self.settings, self.embedder, self.reranker)

    async def doc_ids(self, strategy: str) -> dict[str, uuid.UUID]:
        from app.db.models import Document, DocumentStatus

        async with self.db.sessionmaker() as s:
            rows = await s.execute(
                select(Document.filename, Document.id).where(
                    Document.owner_id == owner_for(strategy), Document.status == DocumentStatus.READY
                )
            )
            return {r.filename: r.id for r in rows}


async def cmd_ingest(strategy: str, budget_s: float, reset: bool) -> None:
    from app.db.models import Document, DocumentStatus, User
    from app.ingestion.pipeline import ingest_document

    ctx = Ctx(await ensure_db(reset))
    owner = owner_for(strategy)
    sm = ctx.db.sessionmaker
    async with sm() as s:
        if await s.get(User, owner) is None:
            s.add(User(id=owner, email=f"{strategy}@eval.local", hashed_password="x"))
            await s.commit()
    done = await ctx.doc_ids(strategy)
    timings_path = ROWS / f"ingest__{strategy}.json"
    timings = json.loads(timings_path.read_text()) if timings_path.exists() else {}
    started = time.perf_counter()
    for name, path in corpus_files().items():
        if name in done:
            continue
        if time.perf_counter() - started > budget_s:
            break
        data = path.read_bytes()
        doc_id = uuid.uuid4()
        key = f"documents/{doc_id.hex}"
        await ctx.storage.put(key, data, "application/pdf")
        async with sm() as s:
            s.add(
                Document(
                    id=doc_id,
                    owner_id=owner,
                    filename=name,
                    content_type="application/pdf",
                    file_size_bytes=len(data),
                    storage_key=key,
                    content_hash=f"{strategy}-{doc_id.hex}",
                    status=DocumentStatus.PROCESSING,
                )
            )
            await s.commit()
        t0 = time.perf_counter()
        await ingest_document(
            doc_id=doc_id,
            sessionmaker=sm,
            storage=ctx.storage,
            embedder=ctx.embedder,
            settings=ctx.settings,
            strategy=strategy,
        )
        timings[name] = round(time.perf_counter() - t0, 2)
        print(f"ingested {name[:40]} in {timings[name]}s", flush=True)
    timings_path.write_text(json.dumps(timings, indent=2))
    remaining = len(corpus_files()) - len(await ctx.doc_ids(strategy))
    print(f"{strategy}: {remaining} documents remaining", flush=True)
    await ctx.db.dispose()


async def relevant_totals(ctx: Ctx, strategy: str, items: list[EvalItem]) -> dict[str, int]:
    from app.db.models import Chunk, Document

    async with ctx.db.sessionmaker() as s:
        rows = await s.execute(
            select(Document.filename, Chunk.text)
            .join(Document, Document.id == Chunk.document_id)
            .where(Chunk.owner_id == owner_for(strategy))
        )
        chunks = [(r.filename, r.text) for r in rows]
    return {it.qid: sum(it.is_relevant(fn, t) for fn, t in chunks if fn == it.filename) for it in items}


async def cmd_query(strategy: str, config: str, scopes: tuple[str, ...]) -> None:
    es = build()
    mode, rerank, overrides = CONFIGS[config]
    ctx = Ctx(eval_db_url(), **overrides)
    ids = await ctx.doc_ids(strategy)
    if len(ids) != len(corpus_files()):
        raise SystemExit(f"{strategy}: corpus not fully ingested ({len(ids)} docs); run ingest first")
    ctx.embedder.warm()
    ctx.reranker.warm()
    totals = await relevant_totals(ctx, strategy, es.items)
    owner = owner_for(strategy)
    for scope in scopes:
        metrics, latencies, ranks, top_scores = [], [], {}, []
        for item in es.items:
            doc_ids = list(ids.values()) if scope == "corpus" else [ids[item.filename]]
            ctx.embedder.cache.clear()
            async with ctx.db.sessionmaker() as s:
                t0 = time.perf_counter()
                res = await ctx.retriever.retrieve(
                    s, owner, doc_ids, item.question, mode=mode, rerank=rerank, top_k=TOP_K
                )
                latencies.append((time.perf_counter() - t0) * 1000)
            rels = [item.is_relevant(h.filename, h.text) for h in res.hits]
            metrics.append(score(rels, totals[item.qid]))
            ranks[item.qid] = rels.index(True) + 1 if any(rels) else None
            top_scores.append(res.top_rerank if rerank else res.top_dense)
        row = {
            "chunking": strategy,
            "retrieval": config,
            "scope": scope,
            **{k: round(statistics.mean(m[k] for m in metrics), 3) for k in metrics[0]},
            "latency_p50_ms": round(pct(latencies, 0.5), 1),
            "latency_p95_ms": round(pct(latencies, 0.95), 1),
            "first_relevant_rank": ranks,
            "top1_scores": [None if x is None else round(x, 4) for x in top_scores],
            "questions_without_relevant_chunk": [q for q, n in totals.items() if n == 0],
        }
        (ROWS / f"{strategy}__{config}__{scope}.json").write_text(json.dumps(row, indent=2))
        print(json.dumps({k: v for k, v in row.items() if not isinstance(v, (dict, list))}), flush=True)
    await ctx.db.dispose()


async def cmd_calibrate() -> None:
    """Top-1 scores of out-of-scope questions (negatives), parent_child chunks.

    Dense: corpus scope plus every single-document scope. Rerank: corpus scope only (cost).
    Compare with ``top1_scores`` of answerable questions in the query rows.
    """
    es = build()
    ctx = Ctx(eval_db_url())
    ids = await ctx.doc_ids("parent_child")
    owner = owner_for("parent_child")
    out: dict = {}
    for rerank in (False, True):
        neg = []
        for q in es.negatives:
            ctx.embedder.cache.clear()
            scopes = [list(ids.values())] + ([] if rerank else [[d] for d in ids.values()])
            for scope_ids in scopes:
                async with ctx.db.sessionmaker() as s:
                    res = await ctx.retriever.retrieve(s, owner, scope_ids, q, mode="hybrid", rerank=rerank)
                neg.append(res.top_rerank if rerank else res.top_dense)
        out["rerank" if rerank else "dense"] = {"negatives_top1": sorted(round(x, 4) for x in neg)}
    (ROWS / "calibration.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({k: {"max_negative": max(v["negatives_top1"])} for k, v in out.items()}), flush=True)
    await ctx.db.dispose()


def cmd_report() -> None:
    es = build()
    rows = [json.loads(p.read_text()) for p in sorted(ROWS.glob("*__*__*.json"))]
    report = {
        "questions": len(es.items),
        "negatives": len(es.negatives),
        "skipped": es.skipped,
        "corpus_documents": len(corpus_files()),
        "ingest_seconds": {s: json.loads((ROWS / f"ingest__{s}.json").read_text()) for s in STRATEGIES},
        "results": [{k: v for k, v in r.items() if not isinstance(v, (dict, list))} for r in rows],
        "calibration": json.loads((ROWS / "calibration.json").read_text())
        if (ROWS / "calibration.json").exists()
        else None,
        "rows": rows,
    }
    (RESULTS / "retrieval.json").write_text(json.dumps(report, indent=2))
    header = "| chunking | retrieval | scope | R@1 | R@5 | R@10 | P@5 | MRR@10 | nDCG@10 | p50 ms | p95 ms |"
    print(header)
    print("|" + "---|" * 11)
    for r in report["results"]:
        print(
            f"| {r['chunking']} | {r['retrieval']} | {r['scope']} | "
            f"{r['recall@1']:.3f} | {r['recall@5']:.3f} | "
            f"{r['recall@10']:.3f} | {r['p@5']:.3f} | {r['mrr@10']:.3f} | {r['ndcg@10']:.3f} | "
            f"{r['latency_p50_ms']} | {r['latency_p95_ms']} |"
        )


async def cmd_all(reset: bool) -> None:
    for strategy in STRATEGIES:
        await cmd_ingest(strategy, budget_s=float("inf"), reset=reset and strategy == STRATEGIES[0])
        for config in CONFIGS:
            await cmd_query(strategy, config, ("corpus", "document"))
    await cmd_calibrate()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_all = sub.add_parser("all")
    p_all.add_argument("--reset", action="store_true")
    p_ing = sub.add_parser("ingest")
    p_ing.add_argument("--strategy", choices=STRATEGIES, required=True)
    p_ing.add_argument("--budget-seconds", type=float, default=float("inf"))
    p_ing.add_argument("--reset", action="store_true")
    p_q = sub.add_parser("query")
    p_q.add_argument("--strategy", choices=STRATEGIES, required=True)
    p_q.add_argument("--config", choices=list(CONFIGS), required=True)
    p_q.add_argument("--scope", choices=["corpus", "document", "both"], default="both")
    sub.add_parser("calibrate")
    sub.add_parser("report")
    args = parser.parse_args()
    ROWS.mkdir(parents=True, exist_ok=True)
    if args.cmd == "all":
        asyncio.run(cmd_all(args.reset))
        cmd_report()
    elif args.cmd == "ingest":
        asyncio.run(cmd_ingest(args.strategy, args.budget_seconds, args.reset))
    elif args.cmd == "query":
        scopes = ("corpus", "document") if args.scope == "both" else (args.scope,)
        asyncio.run(cmd_query(args.strategy, args.config, scopes))
    elif args.cmd == "calibrate":
        asyncio.run(cmd_calibrate())
    else:
        cmd_report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
