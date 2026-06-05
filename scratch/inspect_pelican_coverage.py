# scratch/inspect_pelican_coverage.py
import os
import json

LOG_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "retrieval_debug.log"))

def main():
    if not os.path.exists(LOG_FILE):
        print("Log file not found.")
        return
        
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    
    entries = content.split("=" * 80)
    
    print("=== PelicanDeliversInc Page Coverage Analysis ===")
    for idx, entry in enumerate(entries):
        entry = entry.strip()
        if not entry:
            continue
        try:
            data = json.loads(entry)
            doc_id = data.get("doc_id")
            # Filter for Pelican document (doc_id = "1799460c-12d1-474a-b8a0-e09fb0743968")
            if doc_id != "1799460c-12d1-474a-b8a0-e09fb0743968":
                continue
                
            query = data.get("query")
            sentences = data.get("retrieved_sentences", [])
            pages = [s.get("page_num") for s in sentences]
            sections = [s.get("heading") for s in data.get("top_sections_selected", [])]
            
            print(f"\nQuery: '{query}'")
            print(f"Top 3 Selected Sections: {sections}")
            print(f"Retrieved Sentences Count: {len(sentences)}")
            print(f"Retrieved Pages: {pages} (Unique: {sorted(list(set(pages)))})")
            
        except Exception as e:
            pass

if __name__ == "__main__":
    main()
