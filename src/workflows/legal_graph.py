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
    doc_id: Optional[str | list[str]]
    retrieved_chunks: list[Any]
    answer: str
    citations: list[dict]

# Instantiate retriever once globally to share across calls
retriever = HierarchicalRetriever(
    get_client(),
    get_embedder(),
)

def retrieve_node(state: LegalState) -> LegalState:
    question = state.get("question", "")
    doc_id = state.get("doc_id", None)
    
    if not question:
        return {"retrieved_chunks": []}
        
    results = retriever.retrieve(question, doc_id=doc_id)
    
    safe_chunks = []
    for chunk in results.sentences:
        if contains_prompt_injection(chunk.text):
            continue
        safe_chunks.append(chunk)
        
    return {"retrieved_chunks": safe_chunks}

def generate_node(state: LegalState) -> LegalState:
    question = state.get("question", "")
    retrieved_chunks = state.get("retrieved_chunks", [])
    
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
        context=context,
        question=question,
    )

    answer = generate(prompt)
    return {"answer": answer}

def citation_node(state: LegalState) -> LegalState:
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
