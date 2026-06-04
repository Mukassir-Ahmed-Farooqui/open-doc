import os
import sys
import uuid
from fastapi.testclient import TestClient

# Ensure src is in PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.api.main import app
from src.storage.qdrant_store import get_client, COLLECTION_SECTIONS, COLLECTION_SENTENCES
from src.db.database import SessionLocal
from src.db.models import User, Document

client = TestClient(app)

def test_uuid_isolation_and_lifecycle():
    q_client = get_client()

    # We use a real contract PDF from our uploads directory
    pdf_path = os.path.join("data", "uploads", "test_agreement.pdf")
    if not os.path.exists(pdf_path):
        print(f"Warning: test PDF at {pdf_path} not found. Skipping test.")
        return

    # 0. Register and login test user
    email = f"uuid_test_{uuid.uuid4().hex[:8]}@example.com"
    password = "TestPassword123!"
    
    reg_res = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert reg_res.status_code == 201
    
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Fetch user ID from database
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        user_id = user.id
    finally:
        db.close()

    doc_id1 = None
    doc_id2 = None

    try:
        print("Uploading the first document...")
        with open(pdf_path, "rb") as f:
            res1 = client.post(
                "/api/v1/upload",
                files={"file": ("duplicate_agreement.pdf", f, "application/pdf")},
                headers=headers
            )
        assert res1.status_code == 200
        data1 = res1.json()
        doc_id1 = data1["doc_id"]
        filename1 = data1["filename"]
        
        print(f"First upload success: doc_id={doc_id1}, filename={filename1}")
        assert doc_id1 != "duplicate_agreement"  # Assure it is a UUID and not stem-based

        print("Uploading the second document with the identical filename...")
        with open(pdf_path, "rb") as f:
            res2 = client.post(
                "/api/v1/upload",
                files={"file": ("duplicate_agreement.pdf", f, "application/pdf")},
                headers=headers
            )
        assert res2.status_code == 200
        data2 = res2.json()
        doc_id2 = data2["doc_id"]
        filename2 = data2["filename"]
        
        print(f"Second upload success: doc_id={doc_id2}, filename={filename2}")
        
        # Assert they are distinct UUIDs despite identical filenames
        assert doc_id1 != doc_id2
        assert filename1 == filename2

        # Check GET /documents list
        list_res = client.get("/api/v1/documents", headers=headers)
        assert list_res.status_code == 200
        docs = list_res.json()
        
        doc_ids_in_db = [d["doc_id"] for d in docs]
        assert doc_id1 in doc_ids_in_db
        assert doc_id2 in doc_ids_in_db
        print("Verified both UUIDs are present in GET /documents")

        # Run queries with doc_id restriction and verify isolation
        print("Testing isolated retrieval for first UUID...")
        query_res1 = client.post(
            "/api/v1/query",
            json={"question": "What is the referral fee?", "doc_id": doc_id1},
            headers=headers
        )
        assert query_res1.status_code == 200
        citations1 = query_res1.json().get("citations", [])
        
        # Direct Qdrant check for isolation: query sentences with doc_id1 filter
        from qdrant_client.models import Filter, FieldCondition
        hits1, _ = q_client.scroll(
            collection_name=COLLECTION_SENTENCES,
            scroll_filter=Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id1})]),
            limit=10
        )
        assert len(hits1) > 0
        assert all(h.payload["doc_id"] == doc_id1 for h in hits1)
        print(f"Verified Qdrant contains {len(hits1)} sentences for doc_id1")

        hits2, _ = q_client.scroll(
            collection_name=COLLECTION_SENTENCES,
            scroll_filter=Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id2})]),
            limit=10
        )
        assert len(hits2) > 0
        assert all(h.payload["doc_id"] == doc_id2 for h in hits2)
        print(f"Verified Qdrant contains {len(hits2)} sentences for doc_id2")

        # Delete the first document
        print(f"Deleting the first document: {doc_id1}")
        del_res = client.delete(f"/api/v1/documents/{doc_id1}", headers=headers)
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "deleted"

        # Verify first doc is deleted but second is still present
        list_res_after = client.get("/api/v1/documents", headers=headers)
        docs_after = list_res_after.json()
        doc_ids_after = [d["doc_id"] for d in docs_after]
        assert doc_id1 not in doc_ids_after
        assert doc_id2 in doc_ids_after
        print("Verified document list after deleting first document")

        # Scroll Qdrant to ensure no points for doc_id1 remain, but doc_id2 points are untouched
        sec_hits1_post, _ = q_client.scroll(
            collection_name=COLLECTION_SECTIONS,
            scroll_filter=Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id1})])
        )
        assert len(sec_hits1_post) == 0

        sent_hits1_post, _ = q_client.scroll(
            collection_name=COLLECTION_SENTENCES,
            scroll_filter=Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id1})])
        )
        assert len(sent_hits1_post) == 0
        print("Verified first document points are completely deleted from Qdrant")

        # Verify second doc points still exist
        sec_hits2_post, _ = q_client.scroll(
            collection_name=COLLECTION_SECTIONS,
            scroll_filter=Filter(must=[FieldCondition(key="doc_id", match={"value": doc_id2})])
        )
        assert len(sec_hits2_post) > 0
        print(f"Verified second document sections ({len(sec_hits2_post)}) still exist in Qdrant")

        # Clean up second document
        print(f"Cleaning up second document: {doc_id2}")
        del_res2 = client.delete(f"/api/v1/documents/{doc_id2}", headers=headers)
        assert del_res2.status_code == 200

    finally:
        # Clean up database records
        db = SessionLocal()
        try:
            if doc_id1:
                db.query(Document).filter(Document.doc_id == uuid.UUID(doc_id1)).delete()
            if doc_id2:
                db.query(Document).filter(Document.doc_id == uuid.UUID(doc_id2)).delete()
            db.query(User).filter(User.id == user_id).delete()
            db.commit()
        except Exception as e:
            print("DB Cleanup failed:", str(e))
            db.rollback()
        finally:
            db.close()

if __name__ == "__main__":
    print("Running UUID isolation and document lifecycle integration test...")
    test_uuid_isolation_and_lifecycle()
    print("UUID isolation integration test passed successfully!")
