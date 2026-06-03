# src/retrieval/retriever.py
from dataclasses import dataclass
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchAny
from sentence_transformers import SentenceTransformer

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
    score: float
    section_id: Optional[str] = None


@dataclass
class RetrievalResult:
    query: str
    sections: list[Chunk]
    sentences: list[Chunk]


class HierarchicalRetriever:
    """
    Two-step retrieval:
      1. Search legal_sections → top-k section IDs
      2. Search legal_sentences filtered to those section IDs → top-n results

    Every result carries page_num for citation.
    """

    def __init__(
        self,
        client: QdrantClient,
        model: SentenceTransformer,
        top_sections: int = 3,
        top_sentences: int = 5,
    ):
        self.client = client
        self.model = model
        self.top_sections = top_sections
        self.top_sentences = top_sentences

    def retrieve(self, query: str, doc_id: Optional[str] = None) -> RetrievalResult:
        query_vec = embed_query(self.model, query)

        # Step 1 — coarse: find relevant sections
        section_filter = (
            Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id})])
            if doc_id else None
        )
        section_hits = self.client.query_points(
            collection_name=COLLECTION_SECTIONS,
            query=query_vec,
            query_filter=section_filter,
            limit=self.top_sections,
            with_payload=True,
        ).points
        sections = [_to_chunk(h) for h in section_hits]

        if not sections:
            return RetrievalResult(query=query, sections=[], sentences=[])

        # Step 2 — fine: search sentences only within retrieved sections
        section_ids = [s.chunk_id for s in sections]
        sentence_filter = Filter(
            must=[FieldCondition(key="section_id", match=MatchAny(any=section_ids))]
        )
        if doc_id:
            sentence_filter.must.append(
                FieldCondition(key="doc_id", match={"value": doc_id})
            )

        sentence_hits = self.client.query_points(
            collection_name=COLLECTION_SENTENCES,
            query=query_vec,
            query_filter=sentence_filter,
            limit=self.top_sentences,
            with_payload=True,
        ).points
        sentences = [_to_chunk(h) for h in sentence_hits]

        return RetrievalResult(query=query, sections=sections, sentences=sentences)


def _to_chunk(hit) -> Chunk:
    p = hit.payload
    return Chunk(
        chunk_id=p["chunk_id"],
        chunk_type=p["chunk_type"],
        text=p["text"],
        heading=p.get("heading", ""),
        page_num=p.get("page_num", 1),
        doc_id=p["doc_id"],
        score=round(hit.score, 4),
        section_id=p.get("section_id"),
    )
