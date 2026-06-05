# scratch/inspect_fact_failure.py
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
    
    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        try:
            data = json.loads(entry)
            query = data.get("query")
            if "designer's hourly rate" in query:
                print(f"Query: '{query}'")
                print(f"Top Sections: {[s.get('heading') for s in data.get('top_sections_selected', [])]}")
                print(f"Sentences:")
                for s in data.get("retrieved_sentences", []):
                    print(f"  - [{s.get('heading')}] {s.get('text')}")
                print(f"Answer: {data.get('generated_answer')}")
                print("-" * 80)
        except Exception as e:
            pass

if __name__ == "__main__":
    main()
