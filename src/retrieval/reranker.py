from sentence_transformers import CrossEncoder


class Reranker:

    def __init__(self):
        self.model = CrossEncoder(
            "cross-encoder/ms-marco-MiniLM-L-6-v2"
        )

    def rerank(
        self,
        query: str,
        chunks,
        top_k: int = 5,
    ):
        pairs = [
            (query, chunk.text)
            for chunk in chunks
        ]

        scores = self.model.predict(
            pairs
        )

        ranked = sorted(
            zip(chunks, scores),
            key=lambda x: x[1],
            reverse=True,
        )

        return [
            chunk
            for chunk, _
            in ranked[:top_k]
        ]