from __future__ import annotations

import uuid

import pytest

from tests.conftest import register_and_login, upload_and_ingest
from tests.helpers import make_contract_pdf, make_pdf

pytestmark = pytest.mark.db

FILLER = "The parties agree to cooperate in good faith on all matters relating to the project. " * 6


async def _user_id(client, headers) -> uuid.UUID:
    return uuid.UUID((await client.get("/api/v1/auth/me", headers=headers)).json()["id"])


async def test_sql_ownership_filter(app, client) -> None:
    alice = await register_and_login(client, "alice@example.com")
    bob = await register_and_login(client, "bob@example.com")
    doc = await upload_and_ingest(app, client, alice, "msa.pdf", make_contract_pdf())
    retriever = app.state.rag.retriever
    async with app.state.db.sessionmaker() as s:
        as_bob = await retriever.retrieve(
            s, await _user_id(client, bob), [uuid.UUID(doc["doc_id"])], "termination notice"
        )
        as_alice = await retriever.retrieve(
            s, await _user_id(client, alice), [uuid.UUID(doc["doc_id"])], "termination notice"
        )
    assert as_bob.hits == []
    assert as_alice.hits and "ninety" in as_alice.hits[0].text


async def test_hybrid_surfaces_keyword_only_match(app, client, auth) -> None:
    """Regression: old 'hybrid' only re-sorted dense top-20 and could never add a keyword hit."""
    sections = [[(f"{i}. Clause {i}", 11, True), (FILLER, 10, False)] for i in range(1, 30)]
    sections[17] = [
        ("18. Reference", 11, True),
        (FILLER + " Internal tracking reference ZQX-77410.", 10, False),
    ]
    doc = await upload_and_ingest(app, client, auth, "long.pdf", make_pdf([s for s in sections]))
    owner = await _user_id(client, auth)
    retriever = app.state.rag.retriever
    async with app.state.db.sessionmaker() as s:
        sparse = await retriever.retrieve(
            s, owner, [uuid.UUID(doc["doc_id"])], "ZQX-77410", mode="sparse", rerank=False
        )
        hybrid = await retriever.retrieve(
            s, owner, [uuid.UUID(doc["doc_id"])], "ZQX-77410", mode="hybrid", rerank=False
        )
    assert "ZQX-77410" in sparse.hits[0].text
    assert any("ZQX-77410" in h.text for h in hybrid.hits[:3])


async def test_rerank_and_parent_expansion(app, client, auth) -> None:
    doc = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    owner = await _user_id(client, auth)
    retriever = app.state.rag.retriever
    async with app.state.db.sessionmaker() as s:
        res = await retriever.retrieve(s, owner, [uuid.UUID(doc["doc_id"])], "Which state's law governs?")
        blocks = await retriever.expand_to_parents(s, owner, res.hits)
    assert res.top_rerank is not None and res.hits[0].rerank_score == res.top_rerank
    assert "Oregon" in res.hits[0].text
    assert blocks[0].source_id == "S1" and blocks[0].section.endswith("4. Governing Law")
    assert len({b.section for b in blocks}) == len(blocks)  # one block per parent section


async def test_comparison_and_overview_modes(app, client, auth) -> None:
    a = await upload_and_ingest(app, client, auth, "msa.pdf", make_contract_pdf())
    b = await upload_and_ingest(
        app,
        client,
        auth,
        "other.md",
        b"# Other Agreement\n\n## Termination\n\nTermination requires thirty days notice.\n",
        "text/markdown",
    )
    owner = await _user_id(client, auth)
    ids = [uuid.UUID(a["doc_id"]), uuid.UUID(b["doc_id"])]
    retriever = app.state.rag.retriever
    async with app.state.db.sessionmaker() as s:
        cmp_ = await retriever.retrieve_comparison(s, owner, ids, "termination notice")
        overview = await retriever.retrieve_overview(s, owner, ids[:1])
    assert {h.document_id for h in cmp_.hits} == set(ids)
    assert len({h.section_id for h in overview.hits}) == len(overview.hits) >= 4
