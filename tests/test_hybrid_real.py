from src.storage.qdrant_store import (
    get_client,
    get_embedder,
)
from src.retrieval.retriever import HierarchicalRetriever
from src.retrieval.bm25 import BM25Retriever

retriever = HierarchicalRetriever(
    get_client(),
    get_embedder(),
)

results = retriever.retrieve(
    "What transfer restrictions apply?"
)

docs = [
    s.text
    for s in results.sections
]

bm25 = BM25Retriever(docs)

print("\nSECTIONS\n")

for i, s in enumerate(results.sections):
    print(i, s.heading)

print("\nBM25\n")

print(
    bm25.search(
        "transfer restrictions"
    )
)