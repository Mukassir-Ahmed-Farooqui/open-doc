# scripts/validate_sprint2.py
import os
import sys
import json
from pathlib import Path

# Force stdout to use UTF-8 encoding to avoid Windows charmap encoding errors
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Add workspace to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.chain import LegalRAG
from src.storage.qdrant_store import COLLECTION_SECTIONS, get_client

def get_document_mappings():
    client = get_client()
    hits = client.scroll(
        collection_name=COLLECTION_SECTIONS,
        limit=1000,
        with_payload=True
    )[0]
    
    file_to_doc_id = {}
    for h in hits:
        p = h.payload
        if p.get("filename") and p.get("doc_id"):
            file_to_doc_id[p["filename"]] = p["doc_id"]
    return file_to_doc_id

def run_validation():
    print("Initializing LegalRAG...")
    rag = LegalRAG()
    
    file_mappings = get_document_mappings()
    print("\nIndexed Documents found in Qdrant:")
    for fn, d_id in file_mappings.items():
        print(f" - {fn}: {d_id}")
        
    beta_fn = "beta_contract.pdf"
    arca_fn = "ArcaUsTreasuryFund_20200207_N-2_EX-99.K5_11971930_EX-99.K5_Development Agreement.pdf"
    pelican_fn = "PelicanDeliversInc_20200211_S-1_EX-10.3_11975895_EX-10.3_Development Agreement2.pdf"
    
    test_cases = [
        # 1. Small Document - Fact Query
        {
            "name": "Small Document (Beta) - Fact Query",
            "question": "What is the project codename for the Beta consulting agreement?",
            "doc_id": file_mappings.get(beta_fn),
            "expected_query_type": "FACT"
        },
        # 2. Small Document - Summary Query
        {
            "name": "Small Document (Beta) - Summary Query",
            "question": "Provide a summary of the Beta consulting agreement.",
            "doc_id": file_mappings.get(beta_fn),
            "expected_query_type": "SUMMARY"
        },
        # 3. Medium/Large Document - Fact Query
        {
            "name": "Medium/Large Document (Arca) - Fact Query",
            "question": "What is the annual rate of the fee that the Fund shall pay to the Blockchain Administrator in the Arca agreement?",
            "doc_id": file_mappings.get(arca_fn),
            "expected_query_type": "FACT"
        },
        # 4. Medium/Large Document - Summary Query
        {
            "name": "Medium/Large Document (Arca) - Summary Query",
            "question": "Summarize the Arca development agreement.",
            "doc_id": file_mappings.get(arca_fn),
            "expected_query_type": "SUMMARY"
        },
        # 5. Multi-Document / Comparison Query
        {
            "name": "Multi-Document - Comparison Query",
            "question": "Compare the governing law of the Beta consulting agreement and the Pelican Delivers agreement.",
            "doc_id": None, # Corpus-wide
            "expected_query_type": "COMPARE"
        },
        # 6. Unanswerable Query (No evidence citation check)
        {
            "name": "Citation Reliability - Failed Query",
            "question": "What is the color of Philip Liu's car?",
            "doc_id": file_mappings.get(arca_fn),
            "expected_query_type": "FACT",
            "check_no_citations": True
        }
    ]
    
    results = []
    
    # Clean/Reset log file if it exists to verify new writes
    log_file_path = Path("retrieval_metrics.log")
    if log_file_path.exists():
        try:
            log_file_path.unlink()
            print("\nCleaned existing retrieval_metrics.log for fresh verification.")
        except Exception as e:
            print(f"Warning: Could not clear retrieval_metrics.log: {e}")
            
    for tc in test_cases:
        name = tc["name"]
        q = tc["question"]
        doc_id = tc["doc_id"]
        
        print(f"\nRunning test: {name}")
        print(f"Question: '{q}'")
        print(f"Doc ID: {doc_id}")
        
        try:
            res = rag.ask(q, doc_id=doc_id)
            print(f"Answer: {res['answer']}")
            print(f"Citations count: {len(res['citations'])}")
            print(f"Citations: {res['citations']}")
            
            passed = True
            reasons = []
            
            # Check citation clearing
            if tc.get("check_no_citations"):
                if len(res["citations"]) > 0:
                    passed = False
                    reasons.append(f"Citations were returned ({res['citations']}) but answer was unanswerable/negative.")
                else:
                    reasons.append("Correctly cleared citations on failed query.")
            else:
                if len(res["citations"]) == 0 and "I could not find sufficient evidence" not in res["answer"]:
                    passed = False
                    reasons.append("No citations returned for successful answer.")
            
            results.append({
                "name": name,
                "passed": passed,
                "reasons": reasons
            })
            
        except Exception as e:
            print(f"Error running test case: {e}")
            results.append({
                "name": name,
                "passed": False,
                "reasons": [str(e)]
            })
            
    # Check metrics log file
    print("\nChecking retrieval_metrics.log...")
    if log_file_path.exists():
        with open(log_file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        print(f"Log contains {len(lines)} lines.")
        if len(lines) >= len(test_cases):
            print("Successfully verified retrieval_metrics.log contains logged queries.")
            # Verify one JSON line is valid
            try:
                last_log = json.loads(lines[-1])
                print(f"Sample Log Entry Query Type: {last_log.get('query_type')}")
                print(f"Sample Log Entry Coverage %: {last_log.get('coverage_pct')}%")
            except Exception as e:
                print(f"Error reading metrics log entry: {e}")
        else:
            print(f"Warning: expected at least {len(test_cases)} log lines, got {len(lines)}.")
    else:
        print("FAIL: retrieval_metrics.log was not created!")
        
    print("\n=== Validation Summary ===")
    all_passed = True
    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        if not r["passed"]:
            all_passed = False
        print(f"[{status}] {r['name']}")
        for reason in r["reasons"]:
            print(f"   -> {reason}")
            
    if all_passed:
        print("\nAll sprint validation tests passed successfully!")
    else:
        print("\nSome validation tests failed. Please review output above.")

if __name__ == "__main__":
    run_validation()
