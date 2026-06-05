# ClauseScope Sprint 2 — Retrieval Improvements & Citation Reliability

This document outlines the architecture, design choices, and implementation details of the Phase 2 retrieval optimizations.

---

## 1. Citation Reliability Fix (Priority 0)

To prevent the generation of misleading citations when the system fails to answer a query, a validation check has been added to the LangGraph node pipeline.
* **Location**: `citation_node` in [legal_graph.py](file:///c:/Users/Mukashifa%20Fatima/OneDrive/Desktop/legal-rag/src/workflows/legal_graph.py)
* **Behavior**:
  - The node reads the final generated answer.
  - If the answer matches the negative fallback response exactly (`"I could not find sufficient evidence in the provided documents."`), the citation node clears all citations and returns `{"citations": []}`.
  - This ensures that UI components never show valid sources next to a failed response.

---

## 2. Zero-Latency Query Classification (Priority 1)

Before retrieval begins, the user's question is classified into a specific query class using lightweight pattern matching.
* **Query Classes**:
  - `SUMMARY`: Triggers the dedicated summary route or coverage-based retrieval.
  - `COMPARE`: Focuses on comparing terms, routing to the multi-document fact-retrieval pipeline.
  - `FACT`: Represents standard factual/retrieval questions.
* **Patterns Used**:
  - **Summary**: `summar`, `overview`, `what is this`, `what is the document`, `about this`, `give me a`, `provide a`, `tell me about`
  - **Compare**: `compare`, `difference between`, `vs`, `versus`
* **Workflow Node Integration**:
  - The classification is performed at the start of `retrieve_node` and saved as `state["query_type"]`. This avoids any LLM call latencies for routing.

---

## 3. Dedicated Summary Routing & Coverage (Priority 2 & 3)

Summary queries on large or medium documents traditionally suffer from retrieval window limitations, missing critical clauses, or hitting LLM context lengths. We address this using a dual-layered summarization and retrieval approach:

### A. Pre-Generated Document Summaries
* During document ingestion, a comprehensive document-wide summary is generated using `src/ingestion/summarizer.py`.
* This summary is attached to the payloads of all section and sentence chunks of that document in Qdrant under the `document_summary` key.
* When a `SUMMARY` query is routed, the retriever scrolls Qdrant for the `document_summary` field. If found, it returns a synthetic chunk containing the summary, which is forwarded directly to the generator.

### B. Page-Balanced Coverage Fallback
* If a pre-generated summary is not found, the retriever falls back to a page-balanced selection.
* It fetches the top 20 candidate sections and distributes the final `top_k=5` sections evenly across the document's page range using a bucketed selection algorithm.
* This guarantees document-wide coverage and prevents bias toward high-density regions (e.g., introduction or definitions sections).

---

## 4. Fallback Query Rewriting (Priority 4)

Vocabulary mismatch or low-quality phrasing can cause retrieval failures for factual queries.
* **Trigger Condition**: If a `FACT` query is executed and the dense similarity score of the top retrieved section falls below `0.7`, the system invokes the query rewriting module.
* **Mechanism**:
  - The Groq LLM (configured to `llama-3.1-8b-instant`) rewrites the query to expand synonyms, clarify intent, and optimize for dense and BM25 indexing.
  - A secondary retrieval step is performed using the rewritten query.
  - If the confidence improves, the rewritten context is passed to the generation stage.

---

## 5. Logging and Evaluation Metrics (Priority 5 & 6)

Every query executed in the RAG pipeline logs diagnostic metrics for downstream observability and analytics.
* **Log Location**: `retrieval_metrics.log`
* **Log Schema**:
  ```json
  {
    "timestamp": "ISO-8601 Timestamp",
    "query_type": "FACT | SUMMARY | COMPARE",
    "original_query": "User question",
    "rewritten_query": "Rewritten query or null",
    "coverage_pct": "Percentage of document pages retrieved",
    "section_coverage": "Count and names of sections retrieved",
    "score_before_rewrite": "Top score before rewrite or null",
    "score_after_rewrite": "Top score after rewrite or null",
    "sections": [{"chunk_id": "...", "heading": "...", "page_num": 0, "score": 0.0}],
    "sentences": [{"chunk_id": "...", "heading": "...", "page_num": 0, "score": 0.0}]
  }
  ```

---

## 6. Verification & Test Datasets

Three benchmark datasets have been created under `tests/evaluation/` to test each route independently:
1. [fact_questions.json](file:///c:/Users/Mukashifa%20Fatima/OneDrive/Desktop/legal-rag/tests/evaluation/fact_questions.json): Fact questions with expected answers, sections, and pages.
2. [summary_questions.json](file:///c:/Users/Mukashifa%20Fatima/OneDrive/Desktop/legal-rag/tests/evaluation/summary_questions.json): Summary-style queries with expected responses.
3. [comparison_questions.json](file:///c:/Users/Mukashifa%20Fatima/OneDrive/Desktop/legal-rag/tests/evaluation/comparison_questions.json): Multi-document comparison questions.
