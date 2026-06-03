#test_retrieval.py

from src.retrieval.retriever import HierarchicalRetriever
from src.storage.qdrant_store import get_client, get_embedder

retriever = HierarchicalRetriever(
    get_client(),
    get_embedder(),
)

results = retriever.retrieve(
    "stock transfer restrictions"
)

print("\n=== SECTIONS ===\n")
for s in results.sections:
    print(
        f"[p.{s.page_num}] "
        f"{s.score:.4f} "
        f"{s.heading}"
    )

print("\n=== SENTENCES ===\n")
for s in results.sentences:
    print(
        f"[p.{s.page_num}] "
        f"{s.score:.4f}"
    )
    print(s.text[:300])
    print("-" * 80)