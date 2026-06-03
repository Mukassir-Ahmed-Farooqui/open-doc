from src.retrieval.reranker import Reranker
from src.retrieval.retriever import HierarchicalRetriever
from src.storage.qdrant_store import (
    get_client,
    get_embedder,
)

retriever = HierarchicalRetriever(
    get_client(),
    get_embedder(),
)

results = retriever.retrieve(
    "What transfer restrictions apply?"
)

print("\nBEFORE\n")

for s in results.sentences:
    print(s.score, s.heading)

reranker = Reranker()

reranked = reranker.rerank(
    "What transfer restrictions apply?",
    results.sentences,
)

print("\nAFTER\n")

for s in reranked:
    print(s.heading)

pairs = [
    ("What transfer restrictions apply?", chunk.text)
    for chunk in results.sentences
]

scores = reranker.model.predict(pairs)

for chunk, score in zip(results.sentences, scores):
    print("\n----------------")
    print(score)
    print(chunk.heading)
    print(chunk.text[:250])