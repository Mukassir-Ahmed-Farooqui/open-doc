"""HTTP-layer tests for Groq and Gemini providers (no network: httpx.MockTransport)."""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.providers.embeddings import FastEmbedEmbeddings, GeminiEmbeddings
from app.providers.llm import ChatMessage, FallbackLLM, GeminiLLM, GroqLLM, LLMError

SETTINGS = Settings(groq_api_key="gk", gemini_api_key="gm", llm_timeout_seconds=5)
MSGS = [ChatMessage("system", "sys"), ChatMessage("user", "hi")]


def _sse(events: list[dict | str]) -> bytes:
    lines = [f"data: {e if isinstance(e, str) else json.dumps(e)}\n\n" for e in events]
    return "".join(lines).encode()


async def test_groq_complete_and_auth_header() -> None:
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["auth"] = req.headers["authorization"]
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"model": "m1", "choices": [{"message": {"content": " Hello "}}]})

    llm = GroqLLM(SETTINGS, transport=httpx.MockTransport(handler))
    result = await llm.complete(MSGS)
    assert result.text == "Hello" and result.model == "m1"
    assert seen["auth"] == "Bearer gk"
    assert seen["body"]["messages"][0] == {"role": "system", "content": "sys"}


async def test_groq_stream_parses_sse() -> None:
    body = _sse(
        [
            {"model": "m1", "choices": [{"delta": {"role": "assistant"}}]},
            {"model": "m1", "choices": [{"delta": {"content": "Hel"}}]},
            {"model": "m1", "choices": [{"delta": {"content": "lo"}}]},
            "[DONE]",
        ]
    )
    llm = GroqLLM(SETTINGS, transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body)))
    out = [d.text async for d in llm.stream(MSGS)]
    assert "".join(out) == "Hello"


async def test_groq_retries_429_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": "rate"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    llm = GroqLLM(SETTINGS, transport=httpx.MockTransport(handler))
    assert (await llm.complete(MSGS)).text == "ok"
    assert calls["n"] == 2


async def test_groq_4xx_raises() -> None:
    llm = GroqLLM(
        SETTINGS, transport=httpx.MockTransport(lambda r: httpx.Response(401, json={"error": "bad"}))
    )
    with pytest.raises(LLMError, match="401"):
        await llm.complete(MSGS)


async def test_gemini_complete_maps_roles_and_system() -> None:
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        seen["key"] = req.headers["x-goog-api-key"]
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Hi there"}]}}]})

    llm = GeminiLLM(SETTINGS, transport=httpx.MockTransport(handler))
    msgs = [*MSGS, ChatMessage("assistant", "prev"), ChatMessage("user", "again")]
    result = await llm.complete(msgs)
    assert result.text == "Hi there"
    assert seen["url"].endswith(":generateContent") and seen["key"] == "gm"
    assert seen["body"]["systemInstruction"]["parts"][0]["text"] == "sys"
    assert [c["role"] for c in seen["body"]["contents"]] == ["user", "model", "user"]


async def test_gemini_stream() -> None:
    body = _sse(
        [
            {"candidates": [{"content": {"parts": [{"text": "A"}]}}]},
            {"candidates": [{"content": {"parts": [{"text": "B"}]}}]},
        ]
    )
    llm = GeminiLLM(SETTINGS, transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body)))
    assert "".join([d.text async for d in llm.stream(MSGS)]) == "AB"


async def test_fallback_before_first_token_and_not_after() -> None:
    failing = GroqLLM(SETTINGS, transport=httpx.MockTransport(lambda r: httpx.Response(400, json={})))
    ok_body = _sse([{"candidates": [{"content": {"parts": [{"text": "from gemini"}]}}]}])
    backup = GeminiLLM(
        SETTINGS, transport=httpx.MockTransport(lambda r: httpx.Response(200, content=ok_body))
    )
    llm = FallbackLLM([failing, backup])
    assert "".join([d.text async for d in llm.stream(MSGS)]) == "from gemini"
    assert (
        await FallbackLLM(
            [
                failing,
                GeminiLLM(
                    SETTINGS,
                    transport=httpx.MockTransport(
                        lambda r: httpx.Response(
                            200, json={"candidates": [{"content": {"parts": [{"text": "c"}]}}]}
                        )
                    ),
                ),
            ]
        ).complete(MSGS)
    ).text == "c"

    class Partial:
        model = "partial"

        async def stream(self, *a, **k):
            yield type("D", (), {"text": "half", "model": "partial"})()
            raise LLMError("cut")

    with pytest.raises(LLMError):
        async for _ in FallbackLLM([Partial(), backup]).stream(MSGS):
            pass


async def test_gemini_embeddings_batch_request_and_cache() -> None:
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        body = json.loads(req.content)
        assert body["requests"][0]["outputDimensionality"] == 8
        task = body["requests"][0]["taskType"]
        return httpx.Response(
            200, json={"embeddings": [{"values": [0.1] * 8, "task": task} for _ in body["requests"]]}
        )

    emb = GeminiEmbeddings(
        Settings(gemini_api_key="gm", embedding_dim=8), transport=httpx.MockTransport(handler)
    )
    vecs = await emb.embed_documents(["a", "b", "c"])
    assert len(vecs) == 3 and len(vecs[0]) == 8
    await emb.embed_query("q")
    await emb.embed_query("q")
    assert calls["n"] == 2  # second query served from the LRU cache


async def test_fastembed_dimension_and_query_cache() -> None:
    emb = FastEmbedEmbeddings(Settings())
    v1 = await emb.embed_query("governing law")
    assert len(v1) == 384
    assert emb.cache.get("governing law") is v1
    docs = await emb.embed_documents(["one", "two"])
    assert len(docs) == 2
