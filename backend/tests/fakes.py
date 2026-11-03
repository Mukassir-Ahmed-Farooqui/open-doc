"""Test doubles for the LLM provider (tests only; never imported by the app)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable

from app.providers.llm import ChatMessage, LLMDelta, LLMResult


class FakeLLM:
    """Records calls; answers via a function of the messages."""

    def __init__(self, responder: Callable[[list[ChatMessage]], str]) -> None:
        self.model = "fake-llm"
        self.responder = responder
        self.calls: list[list[ChatMessage]] = []

    async def complete(self, messages, max_tokens=None, temperature=None) -> LLMResult:
        self.calls.append(messages)
        return LLMResult(self.responder(messages), self.model)

    async def stream(self, messages, max_tokens=None, temperature=None) -> AsyncIterator[LLMDelta]:
        self.calls.append(messages)
        text = self.responder(messages)
        for i in range(0, len(text), 7):
            yield LLMDelta(text[i : i + 7], self.model)

    async def aclose(self) -> None:
        return None
