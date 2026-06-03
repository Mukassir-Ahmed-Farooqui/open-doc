# src/__init__.py


class LegalRAG:

    def __init__(self):
        self.retriever = HierarchicalRetriever(
            get_client(),
            get_embedder(),
        )

        self.reranker = Reranker()