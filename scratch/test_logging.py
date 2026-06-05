# scratch/test_logging.py
import sys
import os

# Add the workspace root to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.chain import LegalRAG

def test_queries():
    rag = LegalRAG()
    
    # Doc ID of ArcaUsTreasuryFund Development Agreement
    doc_id = "2075c7ff-016a-4246-b185-a992195e11c7"
    
    # Delete retrieval_debug.log if it exists to start fresh
    log_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "retrieval_debug.log"))
    if os.path.exists(log_path):
        os.remove(log_path)
        print("Removed old debug log.")

    # Query A
    query_a = "summary of the agreement"
    print(f"Running Query A: '{query_a}'...")
    res_a = rag.ask(query_a, doc_id=doc_id)
    print("Answer A:", res_a["answer"])
    print("-" * 50)
    
    # Query B
    query_b = "for the whole big document can u provide me with the summary???"
    print(f"Running Query B: '{query_b}'...")
    res_b = rag.ask(query_b, doc_id=doc_id)
    print("Answer B:", res_b["answer"])
    print("-" * 50)

if __name__ == "__main__":
    test_queries()
