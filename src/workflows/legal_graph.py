from typing import TypedDict, Optional, Any
from langgraph.graph import StateGraph, START, END
from src.security.guards import contains_prompt_injection
from src.llm.groq_client import generate
from src.prompts.legal_qa import LEGAL_QA_PROMPT
from src.retrieval.retriever import HierarchicalRetriever
from src.storage.qdrant_store import (
    get_client,
    get_embedder,
)

class LegalState(TypedDict, total=False):
    question: str
    selected_doc_ids: Optional[list[str]]
    retrieved_chunks: list[Any]
    answer: str
    citations: list[dict]
    chat_history: Optional[str]
    retrieval_metadata: Optional[Any]
    formatted_context: Optional[str]
    query_type: Optional[str]

# Instantiate retriever once globally to share across calls
retriever = HierarchicalRetriever(
    get_client(),
    get_embedder(),
)

SUMMARY_PATTERNS = [
    "summar",
    "overview",
    "what is this",
    "what is the document",
    "about this",
    "give me a",
    "provide a",
    "tell me about"
]

COMPARE_PATTERNS = [
    "compare",
    "difference between",
    "vs",
    "versus"
]

def classify_query(question: str) -> str:
    q = question.lower()

    if any(p in q for p in COMPARE_PATTERNS):
        return "COMPARE"

    if any(p in q for p in SUMMARY_PATTERNS):
        return "SUMMARY"

    return "FACT"

def retrieve_node(state: LegalState) -> LegalState:
    question = state.get("question", "")
    selected_doc_ids = state.get("selected_doc_ids", None)
    
    if not question:
        return {"retrieved_chunks": [], "retrieval_metadata": {}, "query_type": "FACT"}
        
    query_type = classify_query(question)
    results = retriever.retrieve(question, doc_id=selected_doc_ids, query_type=query_type)
    
    safe_chunks = []
    for chunk in results.sentences:
        if contains_prompt_injection(chunk.text):
            continue
        safe_chunks.append(chunk)
        
    metadata = {
        "raw_sections": results.raw_sections,
        "bm25_results": results.bm25_results,
        "fused": results.fused,
        "sections": results.sections,
        "sentences": results.sentences,
        "retrieved_pages": results.sections and sorted(list(set(s.page_num for s in results.sections))) or [],
        "coverage_pct": getattr(results, "coverage_pct", 0.0),
        "section_coverage": getattr(results, "section_coverage", ""),
        "rewritten_query": getattr(results, "rewritten_query", None),
    }
        
    return {"retrieved_chunks": safe_chunks, "retrieval_metadata": metadata, "query_type": query_type}


def generate_node(state: LegalState) -> LegalState:
    question = state.get("question", "")
    retrieved_chunks = state.get("retrieved_chunks", [])
    chat_history = state.get("chat_history", None) or "No previous conversation history."
    
    context = "\n\n".join(
        f"""
Document: {chunk.filename}
Section: {chunk.heading}
Page: {chunk.page_num}

{chunk.text}
"""
        for chunk in retrieved_chunks
    )

    prompt = LEGAL_QA_PROMPT.format(
        chat_history=chat_history,
        context=context,
        question=question,
    )

    answer = generate(prompt)
    return {"answer": answer, "formatted_context": context}



def citation_node(state: LegalState) -> LegalState:
    answer = state.get("answer", "")
    if answer.strip() == "I could not find sufficient evidence in the provided documents.":
        return {"citations": []}

    retrieved_chunks = state.get("retrieved_chunks", [])
    
    if not retrieved_chunks:
        return {"citations": []}

        
    citations = []
    seen = set()

    for chunk in retrieved_chunks:
        key = (
            chunk.page_num,
            chunk.heading,
        )

        if key in seen:
            continue

        seen.add(key)

        citations.append(
            {
                "document": chunk.filename,
                "page": chunk.page_num,
                "section": chunk.heading,
            }
        )
        
    return {"citations": citations}

builder = StateGraph(LegalState)
builder.add_node("retrieve", retrieve_node)
builder.add_node("generate", generate_node)
builder.add_node("citations", citation_node)

builder.add_edge(START, "retrieve")
builder.add_edge("retrieve", "generate")
builder.add_edge("generate", "citations")
builder.add_edge("citations", END)

legal_graph = builder.compile()
