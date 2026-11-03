from __future__ import annotations

import asyncio
import json
import re

import pytest

from app.generation.prompts import INSUFFICIENT_EVIDENCE
from tests.conftest import register_and_login, upload_and_ingest
from tests.fakes import FakeLLM
from tests.helpers import make_contract_pdf

pytestmark = pytest.mark.db


def citing_responder(messages) -> str:
    """Answers from the source that mentions 'ninety', citing only that source."""
    prompt = messages[-1].content
    if "Standalone query" in prompt:
        return "What is the termination notice period?"
    if "chat that starts with" in messages[0].content:
        return '"Termination Notice Question"'
    for sid, body in re.findall(r'<source id="(S\d+)"[^>]*>\n(.*?)\n</source>', prompt, re.S):
        if "ninety (90) days" in body:
            return f"Either party may terminate on ninety (90) days written notice [{sid}]."
    return INSUFFICIENT_EVIDENCE


async def _setup(app, client, auth):
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    chat = (
        await client.post("/api/v1/chats", headers=auth, json={"selected_doc_ids": [doc["doc_id"]]})
    ).json()
    llm = FakeLLM(citing_responder)
    app.state.rag.llm = llm
    return doc, chat, llm


async def test_chat_crud(app, client, auth) -> None:
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    chat = (await client.post("/api/v1/chats", headers=auth, json={"selected_doc_ids": []})).json()
    assert chat["title"] == "New Chat" and chat["selected_doc_ids"] == []
    r = await client.patch(f"/api/v1/chats/{chat['id']}", headers=auth, json={"title": "Renamed"})
    assert r.json()["title"] == "Renamed"
    r = await client.patch(
        f"/api/v1/chats/{chat['id']}/documents", headers=auth, json={"selected_doc_ids": [doc["doc_id"]]}
    )
    assert r.json()["selected_doc_ids"] == [doc["doc_id"]]
    assert len((await client.get("/api/v1/chats", headers=auth)).json()) == 1
    r = await client.delete(f"/api/v1/chats/{chat['id']}", headers=auth)
    assert r.json()["status"] == "success"
    assert (await client.get(f"/api/v1/chats/{chat['id']}", headers=auth)).status_code == 404


async def test_chat_ownership(app, client, auth) -> None:
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    chat = (await client.post("/api/v1/chats", headers=auth, json={})).json()
    mallory = await register_and_login(client, "mallory@example.com")
    assert (await client.get(f"/api/v1/chats/{chat['id']}", headers=mallory)).status_code == 404
    r = await client.post("/api/v1/chats", headers=mallory, json={"selected_doc_ids": [doc["doc_id"]]})
    assert r.status_code == 404
    r = await client.post(
        "/api/v1/query", headers=mallory, json={"question": "x", "selected_doc_ids": [doc["doc_id"]]}
    )
    assert r.status_code == 404
    assert (await client.get("/api/v1/chats/not-a-uuid", headers=auth)).status_code == 400


async def test_message_cites_only_used_source_and_titles(app, client, auth) -> None:
    doc, chat, llm = await _setup(app, client, auth)
    r = await client.post(
        f"/api/v1/chats/{chat['id']}/messages",
        headers=auth,
        json={"question": "How much notice is needed to terminate?"},
    )
    assert r.status_code == 200, r.text
    msg = r.json()
    assert "ninety (90) days" in msg["content"]
    assert len(msg["citations"]) == 1
    cite = msg["citations"][0]
    assert cite["doc_id"] == doc["doc_id"] and cite["document"] == "msa.pdf"
    assert cite["page"] == 2 and cite["section"].endswith("3. Termination")
    assert "ninety" in cite["snippet"]
    await asyncio.gather(*app.state.background_tasks)
    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=auth)).json()
    assert detail["title"] == "Termination Notice Question"
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]


async def test_follow_up_is_reformulated(app, client, auth) -> None:
    _, chat, llm = await _setup(app, client, auth)
    await client.post(
        f"/api/v1/chats/{chat['id']}/messages", headers=auth, json={"question": "Tell me about termination."}
    )
    llm.calls.clear()
    await client.post(
        f"/api/v1/chats/{chat['id']}/messages", headers=auth, json={"question": "And how many days?"}
    )
    assert any("Standalone query" in c[-1].content for c in llm.calls)


async def test_abstains_without_llm_call_when_evidence_weak(app, client, auth) -> None:
    _, chat, llm = await _setup(app, client, auth)
    r = await client.post(
        f"/api/v1/chats/{chat['id']}/messages",
        headers=auth,
        json={"question": "What is the boiling point of tungsten in kelvin?"},
    )
    body = r.json()
    assert body["content"] == INSUFFICIENT_EVIDENCE and body["citations"] == []
    assert not any("<source" in c[-1].content for c in llm.calls)


async def test_stream_endpoint_sse(app, client, auth) -> None:
    _, chat, _ = await _setup(app, client, auth)
    events = []
    async with client.stream(
        "POST",
        f"/api/v1/chats/{chat['id']}/messages/stream",
        headers=auth,
        json={"question": "What notice is required for termination?"},
    ) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        raw = (await r.aread()).decode()
    for block in raw.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    kinds = [e for e, _ in events]
    assert kinds[0] == "meta" and kinds[-1] == "done" and kinds.count("token") > 1
    text = "".join(d["delta"] for e, d in events if e == "token")
    done = events[-1][1]
    assert done["content"] == text.strip() and len(done["citations"]) == 1
    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=auth)).json()
    assert detail["messages"][-1]["id"] == done["id"]


async def test_query_endpoint_and_states(app, client, auth) -> None:
    r = await client.post(
        "/api/v1/query", headers=auth, json={"question": "anything", "selected_doc_ids": []}
    )
    assert r.json()["answer"].startswith("You have not uploaded")
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    r = await client.post("/api/v1/query", headers=auth, json={"question": "q", "selected_doc_ids": []})
    assert r.status_code == 400
    r = await client.post(
        "/api/v1/query", headers=auth, json={"question": "q", "selected_doc_ids": [doc["doc_id"]]}
    )
    assert r.status_code == 503  # no LLM configured
    app.state.rag.llm = FakeLLM(citing_responder)
    r = await client.post(
        "/api/v1/query",
        headers=auth,
        json={"question": "termination notice period?", "selected_doc_ids": [doc["doc_id"]]},
    )
    body = r.json()
    assert r.status_code == 200 and body["citations"][0]["page"] == 2 and body["abstained"] is False


async def test_processing_documents_are_not_queryable(app, client, auth) -> None:
    r = await client.post(
        "/api/v1/upload", headers=auth, files={"file": ("a.pdf", make_contract_pdf(), "application/pdf")}
    )
    doc_id = r.json()["doc_id"]
    app.state.rag.llm = FakeLLM(citing_responder)
    r = await client.post("/api/v1/query", headers=auth, json={"question": "q", "selected_doc_ids": [doc_id]})
    assert r.status_code == 409
    while await app.state.worker.run_once():
        pass
