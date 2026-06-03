from src.retrieval.bm25 import BM25Retriever
from src.retrieval.fusion import rrf_fusion


class HybridSectionRetriever:

    def __init__(self, sections):
        self.sections = sections

        self.bm25 = BM25Retriever(
            [s.text for s in sections]
        )

    def fuse(
        self,
        dense_sections,
        query,
    ):
        dense_ids = [
            s.chunk_id
            for s in dense_sections
        ]

        bm25_results = self.bm25.search(
            query,
            top_k=len(dense_sections),
        )

        sparse_ids = [
            self.sections[idx].chunk_id
            for idx, _ in bm25_results
        ]

        fused = rrf_fusion(
            dense_ids,
            sparse_ids,
        )

        return fused