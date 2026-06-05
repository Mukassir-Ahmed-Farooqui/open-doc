# scratch/list_pelican_sections.py
import sys
import os

# Add the workspace root to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition
from src.storage.qdrant_store import COLLECTION_SECTIONS, get_client

def main():
    client = get_client()
    
    doc_id = "1799460c-12d1-474a-b8a0-e09fb0743968"
    
    hits = client.scroll(
        collection_name=COLLECTION_SECTIONS,
        scroll_filter=Filter(
            must=[FieldCondition(key="doc_id", match={"value": doc_id})]
        ),
        limit=100,
        with_payload=True
    )[0]
    
    print(f"Total sections found in Pelican: {len(hits)}")
    sections = []
    for h in hits:
        p = h.payload
        sections.append({
            "chunk_id": p.get("chunk_id"),
            "heading": p.get("heading"),
            "page_num": p.get("page_num"),
            "text_preview": p.get("text", "")[:100]
        })
        
    # Sort by page_num and chunk_id
    sections.sort(key=lambda x: (x["page_num"], x["chunk_id"]))
    for s in sections:
        print(f"Page {s['page_num']}: {ascii(s['heading'])} (preview: {ascii(s['text_preview'])})")

if __name__ == "__main__":
    main()
