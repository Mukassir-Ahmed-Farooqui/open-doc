# scratch/parse_logs.py
import os
import json

LOG_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "retrieval_debug.log"))

def main():
    if not os.path.exists(LOG_FILE):
        print("Log file not found.")
        return
        
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Split content by the separator
    entries = content.split("=" * 80)
    
    print(f"Total log entries found: {len(entries) - 1}")
    print(f"{'Timestamp':<25} | {'Doc ID':<20} | {'Query':<50} | {'Status':<10} | {'Answer Snippet'}")
    print("-" * 140)
    
    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        try:
            data = json.loads(entry)
            ts = data.get("timestamp", "N/A")[:23]
            doc = data.get("doc_id", "N/A")
            if isinstance(doc, list):
                doc = ",".join(doc)
            # Map doc uuid to a friendly name for readability
            if doc == "2075c7ff-016a-4246-b185-a992195e11c7":
                doc_name = "Arca (Small)"
            elif doc == "1799460c-12d1-474a-b8a0-e09fb0743968":
                doc_name = "Pelican (Medium)"
            else:
                doc_name = doc[:15] + "..." if len(doc) > 15 else doc
                
            query = data.get("query", "N/A")
            ans = data.get("generated_answer", "N/A").strip().replace("\n", " ")
            status = "FAILED" if "could not find sufficient evidence" in ans.lower() else "SUCCESS"
            
            print(f"{ts:<25} | {doc_name:<20} | {query:<50} | {status:<10} | {ans[:50]}")
        except Exception as e:
            # Skip parsing errors (some might be partial blocks)
            pass

if __name__ == "__main__":
    main()
