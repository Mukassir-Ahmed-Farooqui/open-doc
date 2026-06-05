# src/retrieval/debug_logger.py
import os
import json
from datetime import datetime

LOG_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "retrieval_debug.log"))

def log_debug_info(
    query: str,
    doc_id: any,
    sections: list,
    bm25_results: list,
    fused: list,
    top_sections: list,
    sentences: list,
    context_sent: str = None,
    generated_answer: str = None,
    citations: list = None
):
    """
    Log retrieval, fusion, and generation details to a local audit log file.
    """
    now = datetime.now().isoformat()
    
    # Format sections
    sections_log = []
    for idx, s in enumerate(sections):
        sections_log.append({
            "rank": idx + 1,
            "chunk_id": s.chunk_id,
            "heading": s.heading,
            "page_num": s.page_num,
            "dense_score": s.score
        })
        
    # Format BM25 results
    bm25_log = []
    for rank, (idx, score) in enumerate(bm25_results):
        if idx < len(sections):
            s = sections[idx]
            bm25_log.append({
                "rank": rank + 1,
                "chunk_id": s.chunk_id,
                "heading": s.heading,
                "score": float(score)
            })
            
    # Format fusion results
    fusion_log = []
    for rank, (chunk_id, score) in enumerate(fused):
        fusion_log.append({
            "rank": rank + 1,
            "chunk_id": chunk_id,
            "fusion_score": float(score)
        })
        
    # Format top sections selected
    top_sections_log = []
    for s in top_sections:
        top_sections_log.append({
            "chunk_id": s.chunk_id,
            "heading": s.heading,
            "page_num": s.page_num,
            "dense_score": s.score
        })
        
    # Format sentences
    sentences_log = []
    for idx, sent in enumerate(sentences):
        sentences_log.append({
            "rank": idx + 1,
            "chunk_id": sent.chunk_id,
            "section_id": sent.section_id,
            "heading": sent.heading,
            "page_num": sent.page_num,
            "dense_score": sent.score,
            "text": sent.text[:120] + "..." if len(sent.text) > 120 else sent.text
        })

    log_entry = {
        "timestamp": now,
        "query": query,
        "doc_id": doc_id,
        "retrieved_sections_count": len(sections),
        "retrieved_sections": sections_log,
        "bm25_scores": bm25_log,
        "rrf_fusion": fusion_log,
        "top_sections_selected": top_sections_log,
        "retrieved_sentences_count": len(sentences),
        "retrieved_sentences": sentences_log,
        "context_sent_to_llm": context_sent,
        "generated_answer": generated_answer,
        "citations": citations
    }
    
    # Append to file
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry, indent=2) + "\n" + "="*80 + "\n")
    except Exception as e:
        print(f"Error writing debug log: {e}")
