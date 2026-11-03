from __future__ import annotations

import pytest
from sqlalchemy import text, update

from app.db.models import Document
from tests.conftest import upload_and_ingest
from tests.helpers import make_contract_pdf

pytestmark = pytest.mark.db


async def test_transient_failure_is_retried(app, client, auth, monkeypatch) -> None:
    embedder = app.state.worker.embedder
    original = embedder.embed_documents
    calls = {"n": 0}

    async def flaky(texts):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        return await original(texts)

    monkeypatch.setattr(embedder, "embed_documents", flaky)
    doc = await upload_and_ingest(app, client, auth, "a.pdf", make_contract_pdf())
    assert doc["status"] == "queued" and "transient" in doc["error"]
    async with app.state.db.sessionmaker() as s:
        await s.execute(update(Document).values(next_attempt_at=text("now()")))
        await s.commit()
    assert await app.state.worker.run_once()
    doc = (await client.get(f"/api/v1/documents/{doc['doc_id']}", headers=auth)).json()
    assert doc["status"] == "ready" and doc["error"] is None


async def test_stale_processing_job_is_requeued(app, client, auth) -> None:
    r = await client.post(
        "/api/v1/upload", headers=auth, files={"file": ("a.pdf", make_contract_pdf(), "application/pdf")}
    )
    doc_id = r.json()["doc_id"]
    async with app.state.db.sessionmaker() as s:
        await s.execute(
            update(Document).values(
                status="processing", attempts=1, processing_started_at=text("now() - interval '1 hour'")
            )
        )
        await s.commit()
    await app.state.worker.requeue_stale()
    doc = (await client.get(f"/api/v1/documents/{doc_id}", headers=auth)).json()
    assert doc["status"] == "queued"
    while await app.state.worker.run_once():
        pass


async def test_background_worker_processes_upload(app, client, auth) -> None:
    import asyncio

    worker = app.state.worker
    worker.start()
    try:
        r = await client.post(
            "/api/v1/upload", headers=auth, files={"file": ("a.pdf", make_contract_pdf(), "application/pdf")}
        )
        doc_id = r.json()["doc_id"]
        for _ in range(100):
            doc = (await client.get(f"/api/v1/documents/{doc_id}", headers=auth)).json()
            if doc["status"] == "ready":
                break
            await asyncio.sleep(0.1)
        assert doc["status"] == "ready"
    finally:
        await worker.stop()
