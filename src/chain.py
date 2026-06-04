
# src/chain.py
from typing import Optional
from src.workflows.legal_graph import legal_graph, retriever


class LegalRAG:

    def __init__(self):
        self.retriever = retriever

    def ask(self, question: str, doc_id: Optional[str | list[str]] = None):
        state = legal_graph.invoke({"question": question, "doc_id": doc_id})
        return {
            "answer": state.get("answer", ""),
            "citations": state.get("citations", []),
        }