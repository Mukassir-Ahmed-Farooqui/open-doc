
# src/chain.py
from typing import Optional
from src.workflows.legal_graph import legal_graph, retriever


class LegalRAG:

    def __init__(self):
        self.retriever = retriever

    def ask(self, question: str, selected_doc_ids: Optional[list[str]] = None, chat_history: Optional[str] = None):
        state = legal_graph.invoke({"question": question, "selected_doc_ids": selected_doc_ids, "chat_history": chat_history})
        
        # Log retrieval and generation details for auditing purposes
        from src.retrieval.debug_logger import log_debug_info
        metadata = state.get("retrieval_metadata", {})
        log_debug_info(
            query=question,
            doc_id=selected_doc_ids,
            sections=metadata.get("raw_sections", []),
            bm25_results=metadata.get("bm25_results", []),
            fused=metadata.get("fused", []),
            top_sections=metadata.get("sections", []),
            sentences=metadata.get("sentences", []),
            context_sent=state.get("formatted_context", ""),
            generated_answer=state.get("answer", ""),
            citations=state.get("citations", [])
        )

        return {
            "answer": state.get("answer", ""),
            "citations": state.get("citations", []),
            "chunks_retrieved_count": len(state.get("retrieved_chunks", [])),
            "contexts": [c.text for c in state.get("retrieved_chunks", [])],
        }
