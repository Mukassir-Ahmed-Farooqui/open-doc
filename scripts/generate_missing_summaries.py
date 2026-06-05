# scripts/generate_missing_summaries.py
import sys
import os
import uuid

# Add the workspace root to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.db.database import SessionLocal
from src.db.models import Document
from src.storage.qdrant_store import COLLECTION_SECTIONS, COLLECTION_SENTENCES, get_client
from src.ingestion.summarizer import generate_summary_for_document
from qdrant_client.models import Filter, FieldCondition

def main():
    client = get_client()
    db = SessionLocal()
    
    try:
        documents = db.query(Document).filter(Document.is_deleted == False).all()
        print(f"Checking {len(documents)} documents for missing summaries...")
        
        for doc in documents:
            doc_id_str = str(doc.doc_id)
            print(f"\nDocument: {doc.filename} (ID: {doc_id_str})")
            
            # Check if summary exists by scrolling 1 point in COLLECTION_SECTIONS
            scroll_filter = Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id_str})])
            hits = client.scroll(
                collection_name=COLLECTION_SECTIONS,
                scroll_filter=scroll_filter,
                limit=1,
                with_payload=True
            )[0]
            
            if not hits:
                print(f"  No chunks found in Qdrant for document {doc.filename}. Skipping.")
                continue
                
            payload = hits[0].payload
            if payload.get("document_summary"):
                print(f"  Summary already exists for {doc.filename}.")
                continue
                
            print(f"  Summary missing. Generating summary...")
            
            # Retrieve ALL section chunks for this document
            all_hits = client.scroll(
                collection_name=COLLECTION_SECTIONS,
                scroll_filter=scroll_filter,
                limit=100,
                with_payload=True
            )[0]
            
            # Convert to simple section objects
            sections = []
            for h in all_hits:
                p = h.payload
                class TempSec:
                    def __init__(self, heading, text):
                        self.heading = heading
                        self.text = text
                sections.append(TempSec(p.get("heading", ""), p.get("text", "")))
                
            # Generate summary
            try:
                summary = generate_summary_for_document(sections)
                print(f"  Successfully generated summary ({len(summary)} chars)")
            except Exception as e:
                print(f"  Failed to generate summary: {e}")
                continue
                
            # Update payloads in Qdrant (both sections and sentences collections)
            print(f"  Updating payloads in Qdrant...")
            
            section_ids = [h.id for h in all_hits]
            client.set_payload(
                collection_name=COLLECTION_SECTIONS,
                payload={"document_summary": summary},
                points=section_ids
            )
            
            # Fetch all sentence point IDs for this document
            sent_hits = client.scroll(
                collection_name=COLLECTION_SENTENCES,
                scroll_filter=scroll_filter,
                limit=1000,
                with_payload=False
            )[0]
            
            sentence_ids = [h.id for h in sent_hits]
            if sentence_ids:
                client.set_payload(
                    collection_name=COLLECTION_SENTENCES,
                    payload={"document_summary": summary},
                    points=sentence_ids
                )
                
            print(f"  Successfully migrated {doc.filename}.")
            
    finally:
        db.close()

if __name__ == "__main__":
    main()
