import os
import sys
import uuid
import pytest
from fastapi.testclient import TestClient

# Ensure src is in PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.api.main import app
from src.db.database import SessionLocal
from src.db.models import User, Document

client = TestClient(app)

def test_document_ownership_and_corpus_isolation():
    pdf_path = os.path.join("data", "uploads", "test_agreement.pdf")
    if not os.path.exists(pdf_path):
        print(f"Warning: test PDF at {pdf_path} not found. Skipping ownership integration test.")
        return

    # 1. Register & Login User A
    email_a = f"user_a_{uuid.uuid4().hex[:8]}@example.com"
    pw_a = "Password123_A"
    
    assert client.post("/api/v1/auth/register", json={"email": email_a, "password": pw_a}).status_code == 201
    res_login_a = client.post("/api/v1/auth/login", json={"email": email_a, "password": pw_a})
    assert res_login_a.status_code == 200
    token_a = res_login_a.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # 2. Register & Login User B
    email_b = f"user_b_{uuid.uuid4().hex[:8]}@example.com"
    pw_b = "Password123_B"
    
    assert client.post("/api/v1/auth/register", json={"email": email_b, "password": pw_b}).status_code == 201
    res_login_b = client.post("/api/v1/auth/login", json={"email": email_b, "password": pw_b})
    assert res_login_b.status_code == 200
    token_b = res_login_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # Fetch User IDs from database for later verification / clean up
    db = SessionLocal()
    try:
        user_a = db.query(User).filter(User.email == email_a).first()
        user_b = db.query(User).filter(User.email == email_b).first()
        user_a_id = user_a.id
        user_b_id = user_b.id
    finally:
        db.close()

    doc_id_a = None

    try:
        # 3. User A uploads a document
        print("Uploading document for User A...")
        with open(pdf_path, "rb") as f:
            res_upload = client.post(
                "/api/v1/upload",
                files={"file": ("agreement_a.pdf", f, "application/pdf")},
                headers=headers_a
            )
        assert res_upload.status_code == 200
        doc_id_a = res_upload.json()["doc_id"]
        print(f"Uploaded: doc_id_a={doc_id_a}")

        # 4. List Isolation: User B lists documents (should be empty)
        print("Verifying List Isolation...")
        res_list_b = client.get("/api/v1/documents", headers=headers_b)
        assert res_list_b.status_code == 200
        assert len(res_list_b.json()) == 0

        # User A lists documents (should see agreement_a.pdf)
        res_list_a = client.get("/api/v1/documents", headers=headers_a)
        assert res_list_a.status_code == 200
        docs_a = res_list_a.json()
        assert len(docs_a) == 1
        assert docs_a[0]["doc_id"] == doc_id_a

        # 5. Delete Protection: User B attempts to delete User A's document (should be 404)
        print("Verifying Delete Protection...")
        res_del_unauth = client.delete(f"/api/v1/documents/{doc_id_a}", headers=headers_b)
        assert res_del_unauth.status_code == 404

        # Verify it is still active and visible to User A
        res_list_a_check = client.get("/api/v1/documents", headers=headers_a)
        assert len(res_list_a_check.json()) == 1

        # 6. Query Protection: User B queries restricting to User A's doc_id (should be 404)
        print("Verifying Query Protection...")
        res_query_unauth = client.post(
            "/api/v1/query",
            json={"question": "What is the referral fee?", "doc_id": doc_id_a},
            headers=headers_b
        )
        assert res_query_unauth.status_code == 404

        # 7. Corpus Isolation: User B queries without doc_id (should not fetch User A's document)
        print("Verifying Corpus Isolation (no doc_id scope)...")
        res_query_b = client.post(
            "/api/v1/query",
            json={"question": "What is the referral fee?"},
            headers=headers_b
        )
        assert res_query_b.status_code == 200
        data_b = res_query_b.json()
        # Should return the fallback/empty message and no citations
        assert "not uploaded any documents" in data_b["answer"].lower()
        assert len(data_b["citations"]) == 0

        # User A queries and gets actual citations and answers
        res_query_a = client.post(
            "/api/v1/query",
            json={"question": "What is the referral fee?"},
            headers=headers_a
        )
        assert res_query_a.status_code == 200
        data_a = res_query_a.json()
        assert len(data_a["citations"]) > 0
        assert len(data_a["answer"]) > 0

        # 8. User A successfully deletes their own document
        print("User A deleting their own document...")
        res_del_auth = client.delete(f"/api/v1/documents/{doc_id_a}", headers=headers_a)
        assert res_del_auth.status_code == 200
        assert res_del_auth.json()["status"] == "deleted"

        # Verify it is gone
        res_list_a_post = client.get("/api/v1/documents", headers=headers_a)
        assert len(res_list_a_post.json()) == 0

    finally:
        # DB Cleanup
        db = SessionLocal()
        try:
            if doc_id_a:
                db.query(Document).filter(Document.doc_id == uuid.UUID(doc_id_a)).delete()
            db.query(User).filter(User.id == user_a_id).delete()
            db.query(User).filter(User.id == user_b_id).delete()
            db.commit()
        except Exception as e:
            print("DB Cleanup failed:", str(e))
            db.rollback()
        finally:
            db.close()

if __name__ == "__main__":
    print("Running ownership and corpus isolation integration tests...")
    test_document_ownership_and_corpus_isolation()
    print("Ownership and corpus isolation integration tests passed successfully!")
