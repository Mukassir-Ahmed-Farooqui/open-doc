# scratch/run_all_summary_tests.py
import sys
import os

# Add the workspace root to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.chain import LegalRAG

def main():
    rag = LegalRAG()
    
    # We will test two documents:
    # 1. ArcaUsTreasuryFund (small/medium, 9 chunks) - Owned by usera@test.com
    # 2. PelicanDeliversInc (medium/large, 37 chunks) - Owned by userb@test.com or mukassirahmedfarooqui23@gmail.com
    # Let's run queries. The database contains these doc_ids:
    docs = {
        "ArcaUsTreasuryFund": "2075c7ff-016a-4246-b185-a992195e11c7",
        "PelicanDeliversInc": "1799460c-12d1-474a-b8a0-e09fb0743968"
    }
    
    queries = [
        "summary of the agreement",
        "summarize this document",
        "provide a summary",
        "what is this document about",
        "give me an overview of the agreement",
        "provide a comprehensive summary of the agreement",
        "for the whole big document can u provide me with the summary???" # Include the observed success query too
    ]
    
    # We'll write a clean summary of results to console and scratch/summary_results.txt
    output_lines = []
    output_lines.append("=== SUMMARY QUERY EVALUATION RESULTS ===")
    
    for doc_name, doc_id in docs.items():
        output_lines.append(f"\nDocument: {doc_name} (ID: {doc_id})")
        output_lines.append("="*60)
        
        for q in queries:
            print(f"Running '{q}' on {doc_name}...")
            res = rag.ask(q, doc_id=doc_id)
            answer = res["answer"]
            citations = res["citations"]
            
            # Extract retrieved page distribution from debug log if we want,
            # or just retrieve them from the returned state or logs.
            # Let's read from the logs which we can do by looking at the last entries.
            success = "SUCCESS" if "could not find sufficient evidence" not in answer.lower() else "FAILED"
            
            output_lines.append(f"Query: '{q}'")
            output_lines.append(f"Result Status: {success}")
            output_lines.append(f"Citations count: {len(citations)}")
            output_lines.append(f"Citations details: {citations}")
            output_lines.append(f"Answer snippet: {answer[:150]}...")
            output_lines.append("-" * 40)
            
    # Write summary results
    results_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "summary_results.txt"))
    with open(results_path, "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))
    print(f"Done. Results written to {results_path}")

if __name__ == "__main__":
    main()
