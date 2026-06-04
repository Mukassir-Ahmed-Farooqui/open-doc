import os
import sys
import uuid
from fastapi.testclient import TestClient

# Ensure src is in PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.api.main import app
from src.storage.qdrant_store import get_client, COLLECTION_SECTIONS, COLLECTION_SENTENCES
from qdrant_client.models import PointStruct
from src.db.database import SessionLocal
from src.db.models import User, Document

client = TestClient(app)

def test_documents_endpoint_isolated():
    q_client = get_client()

    # 0. Register and login test user
    email = f"doc_test_{uuid.uuid4().hex[:8]}@example.com"
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

    # 1. Get initial documents list
    response = client.get("/api/v1/documents", headers=headers)
    assert response.status_code == 200
    initial_docs = response.json()
    print("Initial docs count:", len(initial_docs))

    # 2. Insert a dummy point to COLLECTION_SECTIONS and database metadata
    dummy_doc_id = str(uuid.uuid4())
    dummy_filename = "test_document_mock.pdf"
    
    # We need a dummy vector of VECTOR_DIM (384)
    dummy_vector = [0.0] * 384
    
    # Save to PostgreSQL Document table first to satisfy DB constraints & API listing
    db = SessionLocal()
    try:
        db_doc = Document(
            doc_id=uuid.UUID(dummy_doc_id),
            owner_id=user_id,
            filename=dummy_filename,
            chunk_count=1,
        )
        db.add(db_doc)
        db.commit()
    finally:
        db.close()

    # We insert into COLLECTION_SECTIONS in Qdrant
    q_client.upsert(
        collection_name=COLLECTION_SECTIONS,
        points=[
            PointStruct(
                id=999999999,
                vector=dummy_vector,
                payload={
                    "doc_id": dummy_doc_id,
                    "filename": dummy_filename,
                    "chunk_id": "test-chunk-1",
                    "text": "This is mock text."
                }
            )
        ]
    )
    print(f"Upserted dummy section point for doc_id: {dummy_doc_id}")

    # Insert into COLLECTION_SENTENCES to ensure we test deletion there too
    q_client.upsert(
        collection_name=COLLECTION_SENTENCES,
        points=[
            PointStruct(
                id=999999998,
                vector=dummy_vector,
                payload={
                    "doc_id": dummy_doc_id,
                    "filename": dummy_filename,
                    "chunk_id": "test-sentence-1",
                    "text": "This is mock sentence."
                }
            )
        ]
    )
    print(f"Upserted dummy sentence point for doc_id: {dummy_doc_id}")

    try:
        # 3. Check list documents endpoint
        response = client.get("/api/v1/documents", headers=headers)
        assert response.status_code == 200
        docs = response.json()
        print("Docs count after insertion:", len(docs))
        assert any(d["doc_id"] == dummy_doc_id for d in docs)
        
        # Verify filename is correct
        test_doc = [d for d in docs if d["doc_id"] == dummy_doc_id][0]
        assert test_doc["filename"] == dummy_filename

        # 4. Call delete endpoint
        response = client.delete(f"/api/v1/documents/{dummy_doc_id}", headers=headers)
        assert response.status_code == 200
        delete_res = response.json()
        assert delete_res["status"] == "deleted"
        assert delete_res["doc_id"] == dummy_doc_id
        print("Deleted document via API")

        # 5. Check list documents endpoint again
        response = client.get("/api/v1/documents", headers=headers)
        assert response.status_code == 200
        docs_after = response.json()
        print("Docs count after deletion:", len(docs_after))
        assert not any(d["doc_id"] == dummy_doc_id for d in docs_after)

        # 6. Check that Qdrant collections do not contain the doc_id points anymore
        sections_scroll, _ = q_client.scroll(
            collection_name=COLLECTION_SECTIONS,
            scroll_filter=None,
            limit=10,
            with_payload=True
        )
        sentences_scroll, _ = q_client.scroll(
            collection_name=COLLECTION_SENTENCES,
            scroll_filter=None,
            limit=10,
            with_payload=True
        )
        
        assert not any(p.payload.get("doc_id") == dummy_doc_id for p in sections_scroll)
        assert not any(p.payload.get("doc_id") == dummy_doc_id for p in sentences_scroll)
        print("Successfully verified points are deleted from Qdrant!")

    finally:
        # Clean up database records
        db = SessionLocal()
        try:
            db.query(Document).filter(Document.doc_id == uuid.UUID(dummy_doc_id)).delete()
            db.query(User).filter(User.id == user_id).delete()
            db.commit()
        except Exception as e:
            print("DB Cleanup failed:", str(e))
            db.rollback()
        finally:
            db.close()

if __name__ == "__main__":
    print("Starting isolated documents API tests...")
    test_documents_endpoint_isolated()
    print("All isolated documents API tests passed successfully!")
