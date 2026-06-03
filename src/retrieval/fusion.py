# src/retrieval/fusion.py


def rrf_fusion(
    dense_ids: list[str],
    sparse_ids: list[str],
    k: int = 60,
):
    scores = {}

    for rank, doc_id in enumerate(dense_ids):
        scores[doc_id] = (
            scores.get(doc_id, 0)
            + 1 / (k + rank + 1)
        )

    for rank, doc_id in enumerate(sparse_ids):
        scores[doc_id] = (
            scores.get(doc_id, 0)
            + 1 / (k + rank + 1)
        )

    return sorted(
        scores.items(),
        key=lambda x: x[1],
        reverse=True,
    )