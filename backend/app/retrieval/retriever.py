"""Hybrid retrieval over pgvector (dense, HNSW cosine) and Postgres full-text search (sparse).

Every SQL statement filters on ``owner_id`` *and* the caller's document ids, so a query can
only ever touch chunks the requesting user owns.

Pipeline: dense top-N  ∥  sparse top-N  ->  RRF fusion  ->  optional cross-encoder rerank
          ->  top-k children  ->  parent (section) expansion into context blocks.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.ingestion.chunking import count_tokens
from app.providers.embeddings import EmbeddingProvider
from app.providers.rerank import Reranker
from app.retrieval.fusion import rrf

Mode = Literal["dense", "sparse", "hybrid"]


@dataclass(slots=True)
class Hit:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    section_id: uuid.UUID
    filename: str
    heading: str
    page: int
    text: str
    dense_score: float | None = None
    sparse_score: float | None = None
    fused_score: float = 0.0
    rerank_score: float | None = None


@dataclass(slots=True)
class RetrievalResult:
    hits: list[Hit]
    top_dense: float | None
    top_rerank: float | None
    timings_ms: dict[str, float] = field(default_factory=dict)


@dataclass(slots=True)
class ContextBlock:
    source_id: str
    document_id: uuid.UUID
    filename: str
    section: str
    page: int
    text: str
    snippet: str
    score: float


def vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


_DENSE_SQL = text(
    """
    SELECT c.id, 1 - (c.embedding <=> CAST(:qvec AS vector)) AS score
    FROM chunks c
    WHERE c.owner_id = :owner AND c.document_id = ANY(:docs)
    ORDER BY c.embedding <=> CAST(:qvec AS vector)
    LIMIT :k
    """
)

# plainto_tsquery parses free text safely (no operator injection); swapping AND for OR gives
# recall-oriented keyword matching, and ts_rank orders by weighted term frequency.
_SPARSE_SQL = text(
    """
    WITH q AS (
        SELECT NULLIF(replace(plainto_tsquery('english', :qtext)::text, '&', '|'), '')::tsquery AS query
    )
    SELECT c.id, ts_rank(c.tsv, q.query, 1) AS score
    FROM chunks c, q
    WHERE q.query IS NOT NULL
      AND c.owner_id = :owner AND c.document_id = ANY(:docs)
      AND c.tsv @@ q.query
    ORDER BY score DESC
    LIMIT :k
    """
)

_DETAILS_SQL = text(
    """
    SELECT c.id, c.document_id, c.section_id, c.page, c.heading, c.text, d.filename
    FROM chunks c JOIN documents d ON d.id = c.document_id AND d.owner_id = c.owner_id
    WHERE c.owner_id = :owner AND c.id = ANY(:ids)
    """
)

_SECTIONS_SQL = text(
    """
    SELECT s.id, s.heading_path, s.text, s.page_start
    FROM sections s
    WHERE s.owner_id = :owner AND s.id = ANY(:ids)
    """
)

_SUMMARY_SQL = text(
    """
    SELECT DISTINCT ON (s.document_id, s.ord)
           c.id, c.document_id, c.section_id, c.page, c.heading, c.text, d.filename, s.ord
    FROM sections s
    JOIN chunks c ON c.section_id = s.id AND c.owner_id = s.owner_id
    JOIN documents d ON d.id = s.document_id AND d.owner_id = s.owner_id
    WHERE s.owner_id = :owner AND s.document_id = ANY(:docs)
    ORDER BY s.document_id, s.ord, c.ord
    """
)


class HybridRetriever:
    def __init__(self, settings: Settings, embedder: EmbeddingProvider, reranker: Reranker | None) -> None:
        self.settings = settings
        self.embedder = embedder
        self.reranker = reranker
        self.iterative_scan = True  # pgvector >= 0.8; disabled at startup on older versions

    async def _set_search_params(self, session: AsyncSession) -> None:
        await session.execute(text("SET LOCAL hnsw.ef_search = 100"))
        if self.iterative_scan:
            await session.execute(text("SET LOCAL hnsw.iterative_scan = relaxed_order"))

    async def dense(
        self, session: AsyncSession, owner_id: uuid.UUID, doc_ids: list[uuid.UUID], query: str, k: int
    ) -> list[tuple[uuid.UUID, float]]:
        qvec = await self.embedder.embed_query(query)
        await self._set_search_params(session)
        rows = await session.execute(
            _DENSE_SQL, {"qvec": vector_literal(qvec), "owner": owner_id, "docs": doc_ids, "k": k}
        )
        return [(r.id, float(r.score)) for r in rows]

    async def sparse(
        self, session: AsyncSession, owner_id: uuid.UUID, doc_ids: list[uuid.UUID], query: str, k: int
    ) -> list[tuple[uuid.UUID, float]]:
        rows = await session.execute(
            _SPARSE_SQL, {"qtext": query, "owner": owner_id, "docs": doc_ids, "k": k}
        )
        return [(r.id, float(r.score)) for r in rows]

    async def _details(
        self, session: AsyncSession, owner_id: uuid.UUID, ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, Hit]:
        rows = await session.execute(_DETAILS_SQL, {"owner": owner_id, "ids": ids})
        return {
            r.id: Hit(r.id, r.document_id, r.section_id, r.filename, r.heading, r.page, r.text) for r in rows
        }

    async def retrieve(
        self,
        session: AsyncSession,
        owner_id: uuid.UUID,
        doc_ids: list[uuid.UUID],
        query: str,
        *,
        mode: Mode = "hybrid",
        rerank: bool = True,
        top_k: int | None = None,
    ) -> RetrievalResult:
        s = self.settings
        top_k = top_k or s.context_top_k
        timings: dict[str, float] = {}
        if not doc_ids:
            return RetrievalResult([], None, None, timings)

        t0 = time.perf_counter()
        dense: list[tuple[uuid.UUID, float]] = []
        sparse: list[tuple[uuid.UUID, float]] = []
        if mode in ("dense", "hybrid"):
            dense = await self.dense(session, owner_id, doc_ids, query, s.retrieval_candidates)
            timings["dense_ms"] = (time.perf_counter() - t0) * 1000
        if mode in ("sparse", "hybrid"):
            t1 = time.perf_counter()
            sparse = await self.sparse(session, owner_id, doc_ids, query, s.retrieval_candidates)
            timings["sparse_ms"] = (time.perf_counter() - t1) * 1000

        if mode == "hybrid":
            fused = rrf([[i for i, _ in dense], [i for i, _ in sparse]], k=s.rrf_k)
        elif mode == "dense":
            fused = {i: score for i, score in dense}
        else:
            fused = {i: score for i, score in sparse}
        ordered = sorted(fused, key=fused.__getitem__, reverse=True)

        use_rerank = rerank and self.reranker is not None and bool(ordered)
        pool = ordered[: s.rerank_candidates] if use_rerank else ordered[:top_k]
        details = await self._details(session, owner_id, pool)
        dense_map, sparse_map = dict(dense), dict(sparse)
        hits: list[Hit] = []
        for cid in pool:
            hit = details.get(cid)
            if hit is None:
                continue
            hit.dense_score = dense_map.get(cid)
            hit.sparse_score = sparse_map.get(cid)
            hit.fused_score = fused[cid]
            hits.append(hit)

        top_rerank: float | None = None
        if use_rerank and hits and self.reranker is not None:
            t2 = time.perf_counter()
            words = s.rerank_passage_words
            passages = [f"{h.heading}\n{' '.join(h.text.split()[:words])}" for h in hits]
            scores = await self.reranker.score(query, passages)
            for hit, score in zip(hits, scores, strict=True):
                hit.rerank_score = score
            hits.sort(key=lambda h: h.rerank_score or 0.0, reverse=True)
            top_rerank = hits[0].rerank_score
            timings["rerank_ms"] = (time.perf_counter() - t2) * 1000
        hits = hits[:top_k]
        timings["total_ms"] = (time.perf_counter() - t0) * 1000
        top_dense = max((d for _, d in dense), default=None)
        return RetrievalResult(hits, top_dense, top_rerank, timings)

    async def retrieve_comparison(
        self,
        session: AsyncSession,
        owner_id: uuid.UUID,
        doc_ids: list[uuid.UUID],
        query: str,
        *,
        rerank: bool = True,
    ) -> RetrievalResult:
        """Retrieve per document and interleave, so every compared document is represented."""
        per_doc = max(2, self.settings.context_top_k // max(len(doc_ids), 1))
        results = [
            await self.retrieve(session, owner_id, [d], query, rerank=rerank, top_k=per_doc) for d in doc_ids
        ]
        interleaved: list[Hit] = []
        for i in range(per_doc):
            interleaved.extend(r.hits[i] for r in results if i < len(r.hits))
        dense_tops = [r.top_dense for r in results if r.top_dense is not None]
        rerank_tops = [r.top_rerank for r in results if r.top_rerank is not None]
        timings = {"total_ms": sum(r.timings_ms.get("total_ms", 0.0) for r in results)}
        return RetrievalResult(
            interleaved,
            max(dense_tops) if dense_tops else None,
            max(rerank_tops) if rerank_tops else None,
            timings,
        )

    async def retrieve_overview(
        self, session: AsyncSession, owner_id: uuid.UUID, doc_ids: list[uuid.UUID]
    ) -> RetrievalResult:
        """For summaries: the opening passage of sections spread evenly across each document."""
        t0 = time.perf_counter()
        rows = list(await session.execute(_SUMMARY_SQL, {"owner": owner_id, "docs": doc_ids}))
        budget = max(2, self.settings.summary_max_sections // max(len(doc_ids), 1))
        by_doc: dict[uuid.UUID, list] = {}
        for r in rows:
            by_doc.setdefault(r.document_id, []).append(r)
        hits: list[Hit] = []
        for doc_rows in by_doc.values():
            if len(doc_rows) > budget:
                step = len(doc_rows) / budget
                doc_rows = [doc_rows[int(i * step)] for i in range(budget)]
            hits.extend(
                Hit(r.id, r.document_id, r.section_id, r.filename, r.heading, r.page, r.text)
                for r in doc_rows
            )
        return RetrievalResult(hits, None, None, {"total_ms": (time.perf_counter() - t0) * 1000})

    async def expand_to_parents(
        self, session: AsyncSession, owner_id: uuid.UUID, hits: list[Hit], *, whole_sections: bool = True
    ) -> list[ContextBlock]:
        """Replace child hits by their parent sections (deduplicated) within a token budget."""
        section_ids = list(dict.fromkeys(h.section_id for h in hits))
        rows = await session.execute(_SECTIONS_SQL, {"owner": owner_id, "ids": section_ids})
        sections = {r.id: r for r in rows}
        blocks: list[ContextBlock] = []
        seen: set[uuid.UUID] = set()
        used = 0
        for hit in hits:
            if hit.section_id in seen:
                continue
            sec = sections.get(hit.section_id)
            body = sec.text if (sec is not None and whole_sections) else hit.text
            heading = sec.heading_path if sec is not None else hit.heading
            cost = count_tokens(body)
            if blocks and used + cost > self.settings.max_context_tokens:
                body = hit.text  # fall back to the child passage when the parent does not fit
                cost = count_tokens(body)
                if used + cost > self.settings.max_context_tokens:
                    continue
            seen.add(hit.section_id)
            used += cost
            score = hit.rerank_score if hit.rerank_score is not None else (hit.dense_score or hit.fused_score)
            blocks.append(
                ContextBlock(
                    source_id=f"S{len(blocks) + 1}",
                    document_id=hit.document_id,
                    filename=hit.filename,
                    section=heading,
                    page=hit.page,
                    text=body,
                    snippet=hit.text,
                    score=float(score),
                )
            )
        return blocks
