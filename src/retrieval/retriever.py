# src/retrieval/retriever.py
from dataclasses import dataclass
from typing import Any, Optional, Union
import json
from datetime import datetime

from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchAny

from src.retrieval.bm25 import BM25Retriever
from src.retrieval.fusion import rrf_fusion
from src.storage.qdrant_store import (
    COLLECTION_SECTIONS,
    COLLECTION_SENTENCES,
    embed_query,
)




@dataclass
class Chunk:
    chunk_id: str
    chunk_type: str
    text: str
    heading: str
    page_num: int
    doc_id: str
    filename: str = ""
    score: float = 0.0
    section_id: Optional[str] = None
    section_index: int = 0


@dataclass
class RetrievalResult:
    query: str
    sections: list[Chunk]
    sentences: list[Chunk]
    raw_sections: Optional[list[Chunk]] = None
    bm25_results: Optional[list] = None
    fused: Optional[list] = None
    coverage_pct: float = 0.0
    section_coverage: str = ""
    rewritten_query: Optional[str] = None


METRICS_LOG_FILE = "retrieval_metrics.log"


def log_retrieval_metrics(
    query_type: str,
    original_query: str,
    rewritten_query: Optional[str],
    retrieved_sections: list[Chunk],
    retrieved_sentences: list[Chunk],
    coverage_pct: float,
    section_coverage: str,
    score_before: Optional[float] = None,
    score_after: Optional[float] = None
):
    entry = {
        "timestamp": datetime.now().isoformat(),
        "query_type": query_type,
        "original_query": original_query,
        "rewritten_query": rewritten_query,
        "coverage_pct": round(coverage_pct, 2),
        "section_coverage": section_coverage,
        "score_before_rewrite": score_before,
        "score_after_rewrite": score_after,
        "sections": [
            {
                "chunk_id": s.chunk_id,
                "heading": s.heading,
                "page_num": s.page_num,
                "score": s.score
            }
            for s in retrieved_sections
        ],
        "sentences": [
            {
                "chunk_id": s.chunk_id,
                "heading": s.heading,
                "page_num": s.page_num,
                "score": s.score
            }
            for s in retrieved_sentences
        ]
    }
    try:
        with open(METRICS_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def get_document_summary(client: QdrantClient, doc_id: Optional[Union[str, list[str]]]) -> Optional[tuple[str, str]]:
    """Tries to retrieve the pre-generated document_summary for the doc_id(s) from Qdrant payloads."""
    if not doc_id:
        return None
    target_ids = doc_id if isinstance(doc_id, list) else [doc_id]
    summaries = []
    filenames = []
    for d_id in target_ids:
        try:
            hits = client.scroll(
                collection_name=COLLECTION_SECTIONS,
                scroll_filter=Filter(must=[FieldCondition(key="doc_id", match={"value": d_id})]),
                limit=1,
                with_payload=True
            )[0]
            if hits and hits[0].payload.get("document_summary"):
                summaries.append(hits[0].payload["document_summary"])
                filenames.append(hits[0].payload.get("filename", "Document"))
        except Exception:
            pass
    if not summaries:
        return None

    if len(summaries) == 1:
        return summaries[0], filenames[0]
    else:
        # Combined summaries formatting for multi-document mode
        text = f"Documents Analyzed: {len(summaries)}\n\n"
        for fn, summ in zip(filenames, summaries):
            text += f"Document: {fn}\n{summ}\n\n"
        text += "Overall Findings:\nPlease compile a synthesized workspace overview based on the document summaries above."
        return text, ", ".join(filenames)


def get_document_total_pages(client: QdrantClient, doc_id: Optional[Union[str, list[str]]]) -> int:
    """Scroll chunks to find maximum page number in the document(s)."""
    if not doc_id:
        return 1
    target_ids = doc_id if isinstance(doc_id, list) else [doc_id]
    max_pages = []
    for d_id in target_ids:
        try:
            hits = client.scroll(
                collection_name=COLLECTION_SECTIONS,
                scroll_filter=Filter(must=[FieldCondition(key="doc_id", match={"value": d_id})]),
                limit=100,
                with_payload=True
            )[0]
            if hits:
                max_pages.append(max((h.payload.get("page_num", 1) for h in hits), default=1))
        except Exception:
            pass
    return sum(max_pages) if max_pages else 1


def select_coverage_balanced_sections(sections: list[Chunk], top_k: int = 5) -> list[Chunk]:
    """Select sections evenly distributed across the pages of a document to ensure global coverage."""
    if not sections:
        return []
    if len(sections) <= top_k:
        return sorted(sections, key=lambda s: (s.page_num, s.section_index))

    pages = [s.page_num for s in sections]
    min_page, max_page = min(pages), max(pages)

    if min_page == max_page:
        return sections[:top_k]

    bucket_size = (max_page - min_page + 1) / top_k
    buckets = [[] for _ in range(top_k)]

    for s in sections:
        b_idx = int((s.page_num - min_page) / bucket_size)
        if b_idx >= top_k:
            b_idx = top_k - 1
        buckets[b_idx].append(s)

    selected = []
    for bucket in buckets:
        if bucket:
            selected.append(bucket[0])

    selected_ids = {s.chunk_id for s in selected}
    for s in sections:
        if len(selected) >= top_k:
            break
        if s.chunk_id not in selected_ids:
            selected.append(s)
            selected_ids.add(s.chunk_id)

    selected.sort(key=lambda s: (s.page_num, s.section_index))
    return selected


def rewrite_query(query: str) -> str:
    """Use the LLM to rewrite a query for optimal keyword and vector search recall."""
    from src.llm.groq_client import generate
    prompt = (
        "Rewrite the query to maximize retrieval quality.\n"
        "Preserve user intent.\n"
        "Expand relevant synonyms.\n"
        "Do not answer the question.\n"
        "Return only the rewritten query.\n\n"
        f"Query: {query}\n\nRewritten Query:"
    )
    try:
        rewritten = generate(prompt).strip()
        if rewritten.startswith('"') and rewritten.endswith('"'):
            rewritten = rewritten[1:-1].strip()
        return rewritten
    except Exception:
        return query


class HierarchicalRetriever:
    """
    Two-step retrieval with custom route handling for SUMMARY and FACT queries.
    """

    def __init__(
        self,
        client: QdrantClient,
        model: Any,
        top_sections: int = 3,
        top_sentences: int = 20,
    ):
        self.client = client
        self.model = model
        self.top_sections = top_sections
        self.top_sentences = top_sentences

    def _get_section_filter(self, doc_id: Optional[Union[str, list[str]]]) -> Optional[Filter]:
        if isinstance(doc_id, list):
            return Filter(must=[FieldCondition(key="doc_id", match=MatchAny(any=doc_id))])
        elif doc_id:
            return Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id})])
        return None

    def _append_doc_filter(self, sentence_filter: Filter, doc_id: Optional[Union[str, list[str]]]):
        if isinstance(doc_id, list):
            sentence_filter.must.append(FieldCondition(key="doc_id", match=MatchAny(any=doc_id)))
        elif doc_id:
            sentence_filter.must.append(FieldCondition(key="doc_id", match={"value": doc_id}))

    def retrieve(
        self,
        query: str,
        doc_id: Optional[Union[str, list[str]]] = None,
        query_type: str = "FACT",
        rewrite_threshold: float = 0.7,
    ) -> RetrievalResult:

        # Step 0 — SUMMARY Query Route
        if query_type == "SUMMARY":
            summary_info = get_document_summary(self.client, doc_id)
            if summary_info:
                doc_summary, filename = summary_info
                target_doc_id = doc_id[0] if isinstance(doc_id, list) else (doc_id or "corpus")
                summary_chunk = Chunk(
                    chunk_id=f"summary_{target_doc_id}",
                    chunk_type="summary",
                    text=doc_summary,
                    heading="Document Summary",
                    page_num=1,
                    doc_id=target_doc_id,
                    filename=filename,
                    score=1.0
                )
                res = RetrievalResult(
                    query=query,
                    sections=[summary_chunk],
                    sentences=[summary_chunk],
                    raw_sections=[summary_chunk],
                    bm25_results=[],
                    fused=[],
                    coverage_pct=100.0,
                    section_coverage="1/1 docs"
                )
                log_retrieval_metrics(
                    query_type=query_type,
                    original_query=query,
                    rewritten_query=None,
                    retrieved_sections=[summary_chunk],
                    retrieved_sentences=[summary_chunk],
                    coverage_pct=100.0,
                    section_coverage="1/1 docs"
                )
                return res

            # Fallback to Coverage-Based Retrieval Mode
            query_vec = embed_query(self.model, query)
            section_filter = self._get_section_filter(doc_id)
            section_hits = self.client.query_points(
                collection_name=COLLECTION_SECTIONS,
                query=query_vec,
                query_filter=section_filter,
                limit=20,
                with_payload=True,
            ).points
            raw_sections = [_to_chunk(h) for h in section_hits]
            if not raw_sections:
                return RetrievalResult(query=query, sections=[], sentences=[], raw_sections=[], bm25_results=[], fused=[])

            sections = select_coverage_balanced_sections(raw_sections, top_k=5)
            section_ids = [s.chunk_id for s in sections]
            sentence_filter = Filter(
                must=[FieldCondition(key="section_id", match=MatchAny(any=section_ids))]
            )
            self._append_doc_filter(sentence_filter, doc_id)

            sentence_hits = self.client.query_points(
                collection_name=COLLECTION_SENTENCES,
                query=query_vec,
                query_filter=sentence_filter,
                limit=self.top_sentences,
                with_payload=True,
            ).points
            sentences = [_to_chunk(h) for h in sentence_hits]

            unique_pages = sorted(list(set(chunk.page_num for chunk in sentences)))
            total_pages = get_document_total_pages(self.client, doc_id)
            coverage_pct = (len(unique_pages) / total_pages) * 100 if total_pages > 0 else 0
            
            sec_headings = sorted(list(set(s.heading for s in sections)))
            section_coverage = f"{len(sec_headings)} sections ({', '.join(sec_headings)})"

            res = RetrievalResult(
                query=query,
                sections=sections,
                sentences=sentences,
                raw_sections=raw_sections,
                bm25_results=[],
                fused=[],
                coverage_pct=coverage_pct,
                section_coverage=section_coverage
            )
            log_retrieval_metrics(
                query_type=query_type,
                original_query=query,
                rewritten_query=None,
                retrieved_sections=sections,
                retrieved_sentences=sentences,
                coverage_pct=coverage_pct,
                section_coverage=section_coverage
            )
            return res

        # FACT or COMPARE Query Route
        query_vec = embed_query(self.model, query)
        section_filter = self._get_section_filter(doc_id)

        section_hits = self.client.query_points(
            collection_name=COLLECTION_SECTIONS,
            query=query_vec,
            query_filter=section_filter,
            limit=20,
            with_payload=True,
        ).points
        sections = [_to_chunk(h) for h in section_hits]

        if not sections:
            return RetrievalResult(query=query, sections=[], sentences=[], raw_sections=[], bm25_results=[], fused=[])

        raw_sections = list(sections)

        # Query Rewriting Trigger Condition for Low Confidence Fact Retrieval
        score_before = sections[0].score
        rewritten_query = None
        score_after = None

        if query_type == "FACT" and score_before < rewrite_threshold:
            rewritten_query = rewrite_query(query)
            query_vec = embed_query(self.model, rewritten_query)
            section_hits = self.client.query_points(
                collection_name=COLLECTION_SECTIONS,
                query=query_vec,
                query_filter=section_filter,
                limit=20,
                with_payload=True,
            ).points
            sections = [_to_chunk(h) for h in section_hits]
            if not sections:
                return RetrievalResult(
                    query=query, sections=[], sentences=[], raw_sections=raw_sections,
                    bm25_results=[], fused=[], rewritten_query=rewritten_query
                )
            raw_sections = list(sections)
            score_after = sections[0].score

        # Continue Standard RAG pipeline
        rerank_query = rewritten_query if rewritten_query else query
        bm25 = BM25Retriever(
            [
                f"{s.heading} {s.text}"
                for s in sections
            ]
        )

        bm25_results = bm25.search(rerank_query, top_k=len(sections))

        dense_ids = [s.chunk_id for s in sections]
        sparse_ids = [sections[idx].chunk_id for idx, _ in bm25_results]

        fused = rrf_fusion(dense_ids, sparse_ids)

        section_lookup = {s.chunk_id: s for s in sections}
        sections_selected = [
            section_lookup[chunk_id]
            for chunk_id, _ in fused[: self.top_sections]
        ]

        section_ids = [s.chunk_id for s in sections_selected]

        sentence_filter = Filter(
            must=[
                FieldCondition(
                    key="section_id",
                    match=MatchAny(any=section_ids),
                )
            ]
        )
        self._append_doc_filter(sentence_filter, doc_id)

        sentence_hits = self.client.query_points(
            collection_name=COLLECTION_SENTENCES,
            query=query_vec,
            query_filter=sentence_filter,
            limit=self.top_sentences,
            with_payload=True,
        ).points

        sentences = [_to_chunk(h) for h in sentence_hits]

        unique_pages = sorted(list(set(chunk.page_num for chunk in sentences)))
        total_pages = get_document_total_pages(self.client, doc_id)
        coverage_pct = (len(unique_pages) / total_pages) * 100 if total_pages > 0 else 0
        
        sec_headings = sorted(list(set(s.heading for s in sections_selected)))
        section_coverage = f"{len(sec_headings)} sections ({', '.join(sec_headings)})"

        res = RetrievalResult(
            query=query,
            sections=sections_selected,
            sentences=sentences,
            raw_sections=raw_sections,
            bm25_results=bm25_results,
            fused=fused,
            coverage_pct=coverage_pct,
            section_coverage=section_coverage,
            rewritten_query=rewritten_query
        )
        
        log_retrieval_metrics(
            query_type=query_type,
            original_query=query,
            rewritten_query=rewritten_query,
            retrieved_sections=sections_selected,
            retrieved_sentences=sentences,
            coverage_pct=coverage_pct,
            section_coverage=section_coverage,
            score_before=score_before,
            score_after=score_after
        )
        return res



def _to_chunk(hit) -> Chunk:
    p = hit.payload
    return Chunk(
        chunk_id=p["chunk_id"],
        chunk_type=p["chunk_type"],
        text=p["text"],
        heading=p.get("heading", ""),
        page_num=p.get("page_num", 1),
        doc_id=p["doc_id"],
        filename=p.get("filename", ""),
        score=round(hit.score, 4),
        section_id=p.get("section_id"),
        section_index=p.get("section_index", 0),
    )