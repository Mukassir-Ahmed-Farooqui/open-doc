"""Public-beta protections: Postgres-backed quotas, upload validation, single global ingestion."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import pymupdf
import pytest

from app.config import Settings, get_settings
from app.ingestion.validation import UploadRejectedError, validate_upload
from app.quota import ai_limits
from tests.conftest import register_and_login, upload_and_ingest
from tests.fakes import FakeLLM
from tests.helpers import make_contract_pdf


def _pdf(pages: int, password: str | None = None) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"Page {i + 1} body text for testing.")
    kwargs = {}
    if password:
        kwargs = {"encryption": pymupdf.PDF_ENCRYPT_AES_256, "user_pw": password, "owner_pw": password}
    data = doc.tobytes(**kwargs)
    doc.close()
    return data


# ───────────── unit (no database) ─────────────


def test_pdf_page_limit_and_encryption() -> None:
    s = Settings(max_pdf_pages=50)
    assert validate_upload(".pdf", _pdf(50), s) == 50
    with pytest.raises(UploadRejectedError, match="51 pages"):
        validate_upload(".pdf", _pdf(51), s)
    with pytest.raises(UploadRejectedError, match="password"):
        validate_upload(".pdf", _pdf(2, password="secret"), s)
    with pytest.raises(UploadRejectedError):
        validate_upload(".pdf", b"%PDF-1.7\n garbage without structure", s)


def test_docx_zip_bomb_rejected() -> None:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", b"<w/>")
        zf.writestr("big.bin", b"\0" * (2 * 1024 * 1024))
    with pytest.raises(UploadRejectedError, match="large"):
        validate_upload(".docx", buf.getvalue(), Settings(max_docx_uncompressed_mb=1))


def test_ai_limit_windows_and_refundability() -> None:
    s = Settings(ai_questions_per_user_day=30, ai_questions_per_user_minute=5, ai_questions_global_day=300)
    uid = uuid.uuid4()
    lims = ai_limits(s, uid, datetime(2026, 11, 4, 23, 59, 30, tzinfo=UTC))
    by = {lim.reason: lim for lim in lims}
    assert by["user_minute"].limit == 5 and by["user_minute"].retry_after == 30
    assert by["user_day"].limit == 30 and by["user_day"].key.endswith("20261104")
    assert by["global_day"].limit == 300 and not by["global_day"].refundable
    assert by["user_day"].refundable and not by["user_minute"].refundable


# ───────────── integration (Postgres) ─────────────


def _answer(messages) -> str:
    prompt = messages[-1].content
    if "Standalone query" in prompt:
        return "termination notice"
    return "Ninety days [S1]."


async def _ask(client, headers, doc_id: str):
    return await client.post(
        "/api/v1/query", headers=headers, json={"question": "notice period?", "selected_doc_ids": [doc_id]}
    )


@pytest.mark.db
async def test_daily_user_and_global_question_quota(app, client, auth, monkeypatch) -> None:
    s = get_settings()
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    app.state.rag.llm = FakeLLM(_answer)
    monkeypatch.setattr(s, "ai_questions_per_user_day", 2)
    assert (await _ask(client, auth, doc["doc_id"])).status_code == 200
    assert (await _ask(client, auth, doc["doc_id"])).status_code == 200
    r = await _ask(client, auth, doc["doc_id"])
    assert r.status_code == 429 and r.json()["error"]["details"]["reason"] == "user_day"
    assert int(r.headers["Retry-After"]) > 0

    # Global cap applies across users (alice already used 2 of the global budget).
    monkeypatch.setattr(s, "ai_questions_per_user_day", 100)
    monkeypatch.setattr(s, "ai_questions_global_day", 3)
    bob = await register_and_login(client, "bob@example.com")
    bdoc = await upload_and_ingest(app, client, bob, "msa.pdf", make_contract_pdf())
    assert (await _ask(client, bob, bdoc["doc_id"])).status_code == 200
    r = await _ask(client, bob, bdoc["doc_id"])
    assert r.status_code == 429 and r.json()["error"]["details"]["reason"] == "global_day"


@pytest.mark.db
async def test_per_minute_limit_is_atomic_under_concurrency(app, client, auth, monkeypatch) -> None:
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    app.state.rag.llm = FakeLLM(_answer)
    monkeypatch.setattr(get_settings(), "ai_questions_per_user_minute", 5)
    results = await asyncio.gather(*[_ask(client, auth, doc["doc_id"]) for _ in range(12)])
    codes = sorted(r.status_code for r in results)
    assert codes.count(200) <= 5 and codes.count(429) >= 7


@pytest.mark.db
async def test_quota_survives_restart_and_refunds_llm_failure(app, client, auth, monkeypatch) -> None:
    """Counters are rows in Postgres: a new app instance (restart / second worker) sees them."""
    from app.main import create_app
    from app.providers.llm import LLMError

    s = get_settings()
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    monkeypatch.setattr(s, "ai_questions_per_user_day", 1)

    class Failing(FakeLLM):
        async def complete(self, messages, max_tokens=None, temperature=None):
            raise LLMError("HTTP 429")

    app.state.rag.llm = Failing(_answer)
    r = await _ask(client, auth, doc["doc_id"])
    assert r.status_code == 503  # provider trouble is not quota exhaustion, and is refunded
    app.state.rag.llm = FakeLLM(_answer)
    assert (await _ask(client, auth, doc["doc_id"])).status_code == 200

    import httpx

    second = create_app(Settings())
    async with second.router.lifespan_context(second):
        second.state.rag.llm = FakeLLM(_answer)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=second), base_url="http://t") as c2:
            r = await _ask(c2, auth, doc["doc_id"])
    assert r.status_code == 429


@pytest.mark.db
async def test_kill_switch(app, client, auth, monkeypatch) -> None:
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    monkeypatch.setattr(get_settings(), "ai_enabled", False)
    r = await _ask(client, auth, doc["doc_id"])
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_disabled"


@pytest.mark.db
async def test_signup_limit_per_ip(client, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "signups_per_ip_day", 3)
    hdr = {"X-Forwarded-For": "9.9.9.9"}
    for i in range(3):
        r = await client.post(
            "/api/v1/auth/register",
            headers=hdr,
            json={"email": f"u{i}@example.com", "password": "password123"},
        )
        assert r.status_code == 201, r.text
    r = await client.post(
        "/api/v1/auth/register", headers=hdr, json={"email": "u9@example.com", "password": "password123"}
    )
    assert r.status_code == 429
    other = {"X-Forwarded-For": "8.8.8.8"}
    r = await client.post(
        "/api/v1/auth/register", headers=other, json={"email": "u10@example.com", "password": "password123"}
    )
    assert r.status_code == 201


@pytest.mark.db
async def test_document_count_and_storage_quota(client, auth, monkeypatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "max_docs_per_user", 2)

    async def up(name: str, data: bytes):
        return await client.post("/api/v1/upload", headers=auth, files={"file": (name, data, "text/plain")})

    assert (await up("a.txt", b"alpha document text")).status_code == 202
    assert (await up("b.txt", b"beta document text")).status_code == 202
    r = await up("c.txt", b"gamma document text")
    assert r.status_code == 429 and r.json()["error"]["details"]["reason"] == "doc_limit"

    monkeypatch.setattr(s, "max_docs_per_user", 100)
    monkeypatch.setattr(s, "max_storage_mb_per_user", 1)
    r = await up("big.txt", b"x" * (1024 * 1024))
    assert r.status_code == 429 and r.json()["error"]["details"]["reason"] == "storage_limit"


@pytest.mark.db
async def test_concurrent_uploads_cannot_exceed_doc_limit(client, auth, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "max_docs_per_user", 3)
    results = await asyncio.gather(
        *[
            client.post(
                "/api/v1/upload",
                headers=auth,
                files={"file": (f"d{i}.txt", f"doc {i} body".encode(), "text/plain")},
            )
            for i in range(8)
        ]
    )
    assert sum(r.status_code == 202 for r in results) == 3
    assert len((await client.get("/api/v1/documents", headers=auth)).json()) == 3


@pytest.mark.db
async def test_upload_rejects_page_limit_and_content_length(client, auth) -> None:
    r = await client.post(
        "/api/v1/upload", headers=auth, files={"file": ("long.pdf", _pdf(51), "application/pdf")}
    )
    assert r.status_code == 422 and "50 pages" in r.json()["error"]["message"]
    r = await client.post(
        "/api/v1/upload",
        headers={**auth, "Content-Length": str(50 * 1024 * 1024)},
        content=b"x",
    )
    assert r.status_code == 413


@pytest.mark.db
async def test_only_one_global_ingestion_claim(app, client, auth) -> None:
    for i in range(3):
        r = await client.post(
            "/api/v1/upload",
            headers=auth,
            files={"file": (f"q{i}.txt", f"queued body {i}".encode(), "text/plain")},
        )
        assert r.status_code == 202
    worker = app.state.worker
    first = await worker.claim()
    assert first is not None
    # Another worker / instance cannot start a second job while one is processing.
    assert await worker.claim() is None
    claims = await asyncio.gather(*[worker.claim() for _ in range(5)])
    assert all(c is None for c in claims)
