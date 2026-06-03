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

print("\nHYBRID SECTIONS\n")

for s in results.sections:
    print(s.heading)