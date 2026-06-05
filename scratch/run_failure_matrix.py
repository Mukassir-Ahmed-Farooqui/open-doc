# scratch/run_failure_matrix.py
import sys
import os

# Add the workspace root to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.chain import LegalRAG

def main():
    rag = LegalRAG()
    
    # Document mapping:
    # Small: beta_contract.pdf (1 chunk)
    # Medium: ArcaUsTreasuryFund_... (9 chunks)
    # Large: PelicanDeliversInc_... (37 chunks)
    
    docs = {
        "Small": "56404112-e46a-45c9-9493-017b8b163ef3",   # beta_contract.pdf (Owned by userb@test.com / e938d289-af49-4991-b336-9ed076aeebdd)
        "Medium": "2075c7ff-016a-4246-b185-a992195e11c7",  # ArcaUsTreasuryFund (Owned by usera@test.com / 693e7f9b-219f-4347-954a-31482c4c2074)
        "Large": "1799460c-12d1-474a-b8a0-e09fb0743968"   # PelicanDeliversInc (Owned by mukassirahmedfarooqui23@gmail.com / b7bc2151-3928-44d8-b2f0-d803149b5fb5)
    }
    
    # We will run:
    # 1. Single Document Scope tests:
    #    - Small Document: Fact & Summary
    #    - Medium Document: Fact & Summary
    #    - Large Document: Fact & Summary
    # 2. Corpus Scope tests (which query across all active user documents):
    #    - Fact Query
    #    - Summary Query
    # Note: To avoid tenant isolation permissions issues, we can just run queries directly via LegalRAG.ask
    # since retriever.retrieve filters by the passed doc_id. If doc_id is a list of doc_ids, it isolates to those.
    # If doc_id is None, it queries the whole Qdrant collection (corpus).
    
    tests = [
        # (Document Size/Scope, doc_id_parameter, Query Type, Query Text)
        ("Small (Single Doc)", docs["Small"], "Fact", "What is the project codename or title?"),
        ("Small (Single Doc)", docs["Small"], "Summary", "summarize the agreement"),
        
        ("Medium (Single Doc)", docs["Medium"], "Fact", "What is the compensation rate for the blockchain administrator?"),
        ("Medium (Single Doc)", docs["Medium"], "Summary", "summarize the agreement"),
        
        ("Large (Single Doc)", docs["Large"], "Fact", "What is the designer's hourly rate or compensation?"),
        ("Large (Single Doc)", docs["Large"], "Summary", "summarize the agreement"),
        
        ("Corpus Scope", None, "Fact", "What is the fee or compensation rate for the blockchain administrator?"),
        ("Corpus Scope", None, "Summary", "summarize the agreements in the system")
    ]
    
    output_lines = []
    output_lines.append("=== RETRIEVAL FAILURE CONDITIONS MATRIX ===")
    output_lines.append(f"{'Scope/Doc Size':<25} | {'Query Type':<10} | {'Query Text':<60} | {'Status':<10} | {'Citations':<10}")
    output_lines.append("-" * 125)
    
    for label, doc_id, q_type, q_text in tests:
        print(f"Running {label} - {q_type}...")
        try:
            res = rag.ask(q_text, doc_id=doc_id)
            ans = res["answer"]
            cits = len(res["citations"])
            
            success = "SUCCESS" if "could not find sufficient evidence" not in ans.lower() else "FAILED"
            output_lines.append(f"{label:<25} | {q_type:<10} | {q_text:<60} | {success:<10} | {cits:<10}")
        except Exception as e:
            output_lines.append(f"{label:<25} | {q_type:<10} | {q_text:<60} | ERROR      | 0")
            print(f"Error: {e}")
            
    matrix_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "failure_matrix.txt"))
    with open(matrix_path, "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))
    print(f"Done. Matrix written to {matrix_path}")

if __name__ == "__main__":
    main()
