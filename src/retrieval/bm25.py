# src/retrieval/bm25.py

from rank_bm25 import BM25Okapi


class BM25Retriever:

    def __init__(self, documents: list[str]):
        self.documents = documents

        tokenized = [
            doc.lower().split()
            for doc in documents
        ]

        self.bm25 = BM25Okapi(tokenized)

    def search(
        self,
        query: str,
        top_k: int = 10,
    ):
        scores = self.bm25.get_scores(
            query.lower().split()
        )

        ranked = sorted(
            enumerate(scores),
            key=lambda x: x[1],
            reverse=True,
        )

        return ranked[:top_k]