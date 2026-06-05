# scratch/inspect_70b_runs.py
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
    
    print("=== INSPECTING FIRST 4 RUNS (70B) ===")
    for i in range(min(4, len(entries))):
        entry = entries[i].strip()
        if not entry:
            continue
        try:
            data = json.loads(entry)
            query = data.get("query")
            ts = data.get("timestamp")
            ans = data.get("generated_answer", "")
            top_sec = [s.get("heading") for s in data.get("top_sections_selected", [])]
            top_scores = [s.get("dense_score") for s in data.get("top_sections_selected", [])]
            
            print(f"\n[{i+1}] Query: {ascii(query)} at {ts}")
            print(f"Top 3 Sections: {ascii(top_sec)}")
            print(f"Dense Scores  : {ascii(top_scores)}")
            print(f"Answer        : {ascii(ans.strip())}")
            print("-" * 80)
        except Exception as e:
            print(f"Error parsing entry {i+1}: {ascii(str(e))}")

if __name__ == "__main__":
    main()
