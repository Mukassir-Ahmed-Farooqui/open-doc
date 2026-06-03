from src.retrieval.bm25 import BM25Retriever

docs = [
    "Restrictions on Transfer",
    "Transfer Under Rule 145(d)",
    "Filing of Reports by PSS",
]

bm25 = BM25Retriever(docs)

print(
    bm25.search(
        "transfer restrictions"
    )
)