"""Account deletion (DELETE /auth/me) and document-delete cleanup of chat/query-log references."""

from __future__ import annotations

import logging

import pytest
from sqlalchemy import func, select

from app.db.models import Chat, Chunk, Document, Message, QueryLog, Section, User
from tests.conftest import register_and_login, upload_and_ingest
from tests.fakes import FakeLLM
from tests.helpers import make_contract_pdf
from tests.test_api_chats import citing_responder

pytestmark = pytest.mark.db


async def _counts(app, user_id=None) -> dict[str, int]:
    out = {}
    async with app.state.db.sessionmaker() as s:
        for model in (User, Document, Section, Chunk, Chat, Message, QueryLog):
            out[model.__tablename__] = (await s.execute(select(func.count()).select_from(model))).scalar_one()
    return out


async def _ask(client, headers, chat_id: str):
    r = await client.post(
        f"/api/v1/chats/{chat_id}/messages", headers=headers, json={"question": "What is the notice period?"}
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


async def test_delete_account_removes_everything(app, client, auth, caplog) -> None:
    caplog.set_level(logging.INFO, logger="app")
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    chat = (await client.post("/api/v1/chats", headers=auth, json={"selected_doc_ids": [doc["doc_id"]]})).json()
    app.state.rag.llm = FakeLLM(citing_responder)
    await _ask(client, auth, chat["id"])
    async with app.state.db.sessionmaker() as s:
        key = (await s.execute(select(Document.storage_key))).scalar_one()
    assert await app.state.storage.get(key)

    # Bob's data must survive Alice's deletion.
    bob = await register_and_login(client, "bob@example.com")
    await upload_and_ingest(app, client, bob, "b.pdf", make_contract_pdf())

    # Wrong password: 403 (not 401, so the client keeps the session), nothing deleted.
    r = await client.request("DELETE", "/api/v1/auth/me", headers=auth, json={"password": "wrong-password"})
    assert r.status_code == 403
    assert (await client.get("/api/v1/auth/me", headers=auth)).status_code == 200
    # Password is required.
    r = await client.request("DELETE", "/api/v1/auth/me", headers=auth, json={})
    assert r.status_code == 422

    alice_id = (await client.get("/api/v1/auth/me", headers=auth)).json()["id"]
    before = await _counts(app)
    r = await client.request("DELETE", "/api/v1/auth/me", headers=auth, json={"password": "password123"})
    assert r.status_code == 200 and r.json() == {"status": "deleted"}
    deleted = [rec for rec in caplog.records if rec.getMessage() == "account_deleted"]
    assert len(deleted) == 1 and deleted[0].user_id == alice_id
    after = await _counts(app)
    assert after["users"] == 1 and after["documents"] == 1 and after["chats"] == 0
    assert after["messages"] == 0 and after["query_logs"] == 0
    assert 0 < after["chunks"] < before["chunks"] and 0 < after["sections"] < before["sections"]

    from app.storage import ObjectNotFoundError

    with pytest.raises(ObjectNotFoundError):
        await app.state.storage.get(key)
    # Old token no longer works; the account can't sign in.
    assert (await client.get("/api/v1/auth/me", headers=auth)).status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "password123"})
    assert r.status_code == 401
    assert (await client.get("/api/v1/documents", headers=bob)).json()[0]["filename"] == "b.pdf"


async def test_delete_account_keeps_everything_when_storage_fails(app, client, auth, monkeypatch) -> None:
    await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())

    async def boom(key: str) -> None:
        raise RuntimeError("storage down")

    monkeypatch.setattr(app.state.storage, "delete", boom)
    r = await client.request("DELETE", "/api/v1/auth/me", headers=auth, json={"password": "password123"})
    assert r.status_code == 503
    counts = await _counts(app)
    assert counts["users"] == 1 and counts["documents"] == 1


async def test_delete_account_requires_auth(client) -> None:
    r = await client.request("DELETE", "/api/v1/auth/me", json={"password": "password123"})
    assert r.status_code == 401


async def test_document_delete_strips_citations_and_query_logs(app, client, auth) -> None:
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    chat = (await client.post("/api/v1/chats", headers=auth, json={"selected_doc_ids": [doc["doc_id"]]})).json()
    app.state.rag.llm = FakeLLM(citing_responder)
    answer = await _ask(client, auth, chat["id"])
    cited = answer.get("citations") or answer.get("assistant_message", {}).get("citations")
    assert cited, answer
    async with app.state.db.sessionmaker() as s:
        assert (await s.execute(select(func.count()).select_from(QueryLog))).scalar_one() == 1

    assert (await client.delete(f"/api/v1/documents/{doc['doc_id']}", headers=auth)).status_code == 200
    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=auth)).json()
    for m in detail["messages"]:
        assert not any(c["doc_id"] == doc["doc_id"] for c in (m.get("citations") or []))
    async with app.state.db.sessionmaker() as s:
        assert (await s.execute(select(func.count()).select_from(QueryLog))).scalar_one() == 0
