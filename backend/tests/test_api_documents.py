from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.db.models import Chunk, Section
from tests.conftest import FIXTURES, register_and_login, upload_and_ingest
from tests.helpers import make_contract_pdf, make_docx

pytestmark = pytest.mark.db


async def test_upload_is_async_then_ready(app, client, auth) -> None:
    r = await client.post(
        "/api/v1/upload",
        headers=auth,
        files={"file": ("contract.pdf", make_contract_pdf(), "application/pdf")},
    )
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued" and body["duplicate"] is False
    assert await app.state.worker.run_once() is True
    doc = (await client.get(f"/api/v1/documents/{body['doc_id']}", headers=auth)).json()
    assert doc["status"] == "ready" and doc["progress"] == 100
    assert doc["num_pages"] == 3 and doc["section_count"] >= 5 and doc["chunk_count"] >= 5
    listed = (await client.get("/api/v1/documents", headers=auth)).json()
    assert [d["doc_id"] for d in listed] == [body["doc_id"]]


async def test_docx_txt_md_ingest(app, client, auth) -> None:
    docx = await upload_and_ingest(
        app, client, auth, "handbook.docx", make_docx(), "application/octet-stream"
    )
    md = await upload_and_ingest(
        app, client, auth, "notes.md", b"# Notes\n\nThe launch date is March 3.\n", "text/markdown"
    )
    txt = await upload_and_ingest(
        app, client, auth, "plain.txt", b"OVERVIEW\n\nPlain text body for testing ingestion.", "text/plain"
    )
    assert {docx["status"], md["status"], txt["status"]} == {"ready"}


async def test_duplicate_upload_is_idempotent(app, client, auth) -> None:
    data = make_contract_pdf()
    first = await upload_and_ingest(app, client, auth, "a.pdf", data)
    r = await client.post(
        "/api/v1/upload", headers=auth, files={"file": ("renamed.pdf", data, "application/pdf")}
    )
    assert r.status_code == 200 and r.json()["duplicate"] is True and r.json()["doc_id"] == first["doc_id"]
    assert len((await client.get("/api/v1/documents", headers=auth)).json()) == 1


async def test_duplicate_upload_restores_missing_file(app, client, auth) -> None:
    """Regression: re-uploading the same bytes after the stored file vanished left the
    viewer stuck on "File content is missing from storage"."""
    import uuid

    from app.db.models import Document

    data = make_contract_pdf()
    first = await upload_and_ingest(app, client, auth, "a.pdf", data)
    async with app.state.db.sessionmaker() as s:
        key = (await s.get(Document, uuid.UUID(first["doc_id"]))).storage_key
    await app.state.storage.delete(key)
    url = f"/api/v1/documents/{first['doc_id']}/download"
    assert (await client.get(url, headers=auth)).status_code == 404
    r = await client.post("/api/v1/upload", headers=auth, files={"file": ("a.pdf", data, "application/pdf")})
    assert r.status_code == 200 and r.json()["duplicate"] is True
    dl = await client.get(url, headers=auth)
    assert dl.status_code == 200 and dl.content == data


def test_relative_local_storage_dir_is_anchored_to_backend() -> None:
    from pathlib import Path

    from app.storage import resolve_local_root

    backend = Path(__file__).resolve().parents[1]
    assert resolve_local_root("./data/objects") == (backend / "data" / "objects").resolve()
    assert resolve_local_root(str(backend)) == backend


async def test_reingest_replaces_rows(app, client, auth) -> None:
    from app.ingestion.pipeline import ingest_document

    doc = await upload_and_ingest(app, client, auth, "a.pdf", make_contract_pdf())
    state = app.state
    import uuid

    await ingest_document(
        doc_id=uuid.UUID(doc["doc_id"]),
        sessionmaker=state.db.sessionmaker,
        storage=state.storage,
        embedder=state.rag.retriever.embedder,
        settings=state.settings,
    )
    async with state.db.sessionmaker() as s:
        n_chunks = (await s.execute(select(func.count()).select_from(Chunk))).scalar_one()
        n_sections = (await s.execute(select(func.count()).select_from(Section))).scalar_one()
    assert n_chunks == doc["chunk_count"] and n_sections == doc["section_count"]


async def test_same_filename_two_users_isolated(app, client) -> None:
    """Regression: uploads used to be stored by original filename and overwrite each other."""
    alice = await register_and_login(client, "alice@example.com")
    bob = await register_and_login(client, "bob@example.com")
    a = await upload_and_ingest(
        app, client, alice, "contract.pdf", (FIXTURES / "alpha_contract.pdf").read_bytes()
    )
    bob_pdf = make_contract_pdf()
    b = await upload_and_ingest(app, client, bob, "contract.pdf", bob_pdf)
    ra = await client.get(f"/api/v1/documents/{a['doc_id']}/download", headers=alice)
    rb = await client.get(f"/api/v1/documents/{b['doc_id']}/download", headers=bob)
    assert ra.content == (FIXTURES / "alpha_contract.pdf").read_bytes()
    assert rb.content == bob_pdf
    assert 'filename="contract.pdf"' in ra.headers["content-disposition"]
    # Bob cannot see, download or delete Alice's document (404, no existence leak).
    assert (await client.get(f"/api/v1/documents/{a['doc_id']}", headers=bob)).status_code == 404
    # Local storage issues no direct URL (client falls back to /download); others' docs stay hidden.
    fu = await client.get(f"/api/v1/documents/{a['doc_id']}/file-url", headers=alice)
    assert fu.status_code == 200 and fu.json() == {"url": None, "expires_in": None}
    assert (await client.get(f"/api/v1/documents/{a['doc_id']}/file-url", headers=bob)).status_code == 404
    assert (await client.get(f"/api/v1/documents/{a['doc_id']}/download", headers=bob)).status_code == 404
    assert (await client.delete(f"/api/v1/documents/{a['doc_id']}", headers=bob)).status_code == 404
    assert [d["doc_id"] for d in (await client.get("/api/v1/documents", headers=bob)).json()] == [b["doc_id"]]


async def test_path_traversal_filename_is_display_only(app, client, auth) -> None:
    doc = await upload_and_ingest(
        app, client, auth, "../../etc/passwd.txt", b"HELLO\n\nharmless text content here"
    )
    assert doc["filename"] == "passwd.txt"


async def test_rejects_unsupported_and_oversize(client, auth, monkeypatch) -> None:
    r = await client.post(
        "/api/v1/upload", headers=auth, files={"file": ("x.exe", b"MZ....", "application/octet-stream")}
    )
    assert r.status_code == 415
    r = await client.post(
        "/api/v1/upload", headers=auth, files={"file": ("x.pdf", b"not a pdf", "application/pdf")}
    )
    assert r.status_code == 415
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    r = await client.post(
        "/api/v1/upload", headers=auth, files={"file": ("a.txt", b"some text", "text/plain")}
    )
    assert r.status_code == 413


async def test_corrupt_pdf_fails_permanently(app, client, auth) -> None:
    doc = await upload_and_ingest(app, client, auth, "broken.pdf", b"%PDF-1.4 this is not really a pdf")
    assert doc["status"] == "failed" and doc["error"]


async def test_delete_removes_chunks_object_and_chat_refs(app, client, auth) -> None:
    doc = await upload_and_ingest(app, client, auth, "a.pdf", make_contract_pdf())
    chat = (
        await client.post("/api/v1/chats", headers=auth, json={"selected_doc_ids": [doc["doc_id"]]})
    ).json()
    r = await client.delete(f"/api/v1/documents/{doc['doc_id']}", headers=auth)
    assert r.status_code == 200 and r.json() == {"status": "deleted", "doc_id": doc["doc_id"]}
    async with app.state.db.sessionmaker() as s:
        assert (await s.execute(select(func.count()).select_from(Chunk))).scalar_one() == 0
    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=auth)).json()
    assert detail["selected_doc_ids"] == []
    assert (await client.get(f"/api/v1/documents/{doc['doc_id']}/download", headers=auth)).status_code == 404


def test_s3_presigned_url_is_inline_and_signed() -> None:
    import asyncio
    from types import SimpleNamespace

    from app.storage.s3 import S3Storage

    st = S3Storage(
        SimpleNamespace(
            s3_bucket="b",
            s3_endpoint_url="https://example.com/s3",
            s3_region="ap-south-1",
            s3_access_key_id="AKIDEXAMPLE",
            s3_secret_access_key="secret",
        )
    )
    url = asyncio.run(
        st.presigned_url("u/1/a.pdf", content_type="application/pdf", filename='r"x.pdf', expires_s=600)
    )
    assert url.startswith("https://example.com/s3/b/u/1/a.pdf?")
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=600" in url
    assert "response-content-disposition=inline" in url
