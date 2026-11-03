"""LLM providers over plain HTTPS (httpx), no vendor SDKs.

* ``GroqLLM``   – OpenAI-compatible chat completions API, streaming via SSE (default).
* ``GeminiLLM`` – Gemini ``generateContent`` / ``streamGenerateContent?alt=sse``.
* ``FallbackLLM`` – tries providers in order. For streams, falls back only if the primary
  fails before emitting its first token, so a user never sees two half-answers spliced.

429 and 5xx responses are retried with backoff (honouring ``Retry-After``).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ChatMessage:
    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass(slots=True)
class LLMResult:
    text: str
    model: str


@dataclass(slots=True)
class LLMDelta:
    text: str
    model: str


class LLMError(Exception):
    pass


class LLMProvider(Protocol):
    model: str

    async def complete(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> LLMResult: ...

    def stream(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> AsyncIterator[LLMDelta]: ...


_RETRYABLE = {429, 500, 502, 503, 504}


def _retry_delay(resp: httpx.Response | None, attempt: int) -> float:
    if resp is not None:
        header = resp.headers.get("retry-after")
        if header:
            try:
                return min(float(header), 30.0)
            except ValueError:
                pass
    return min(2.0 * (2**attempt), 20.0)


class _HTTPProvider:
    max_retries = 3

    def __init__(
        self,
        timeout: float,
        max_tokens: int,
        temperature: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._timeout = httpx.Timeout(timeout, connect=10.0)
        self._transport = transport
        self._max_tokens = max_tokens
        self._temperature = temperature
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout, transport=self._transport)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def _post_json(self, url: str, body: dict, headers: dict[str, str]) -> dict:
        for attempt in range(self.max_retries + 1):
            resp = await self.client.post(url, json=body, headers=headers)
            if resp.status_code in _RETRYABLE and attempt < self.max_retries:
                delay = _retry_delay(resp, attempt)
                logger.warning("llm_retry", extra={"status": resp.status_code, "delay_s": delay})
                await asyncio.sleep(delay)
                continue
            if resp.status_code >= 400:
                raise LLMError(f"{type(self).__name__} HTTP {resp.status_code}: {resp.text[:300]}")
            return resp.json()
        raise LLMError(f"{type(self).__name__}: retries exhausted")

    async def _stream_lines(self, url: str, body: dict, headers: dict[str, str]) -> AsyncIterator[str]:
        for attempt in range(self.max_retries + 1):
            async with self.client.stream("POST", url, json=body, headers=headers) as resp:
                if resp.status_code in _RETRYABLE and attempt < self.max_retries:
                    await resp.aread()
                    delay = _retry_delay(resp, attempt)
                    logger.warning("llm_retry", extra={"status": resp.status_code, "delay_s": delay})
                    await asyncio.sleep(delay)
                    continue
                if resp.status_code >= 400:
                    text = (await resp.aread()).decode("utf-8", "ignore")
                    raise LLMError(f"{type(self).__name__} HTTP {resp.status_code}: {text[:300]}")
                async for line in resp.aiter_lines():
                    if line.startswith("data:"):
                        yield line[5:].strip()
                return
        raise LLMError(f"{type(self).__name__}: retries exhausted")


class GroqLLM(_HTTPProvider):
    def __init__(
        self, settings: Settings, model: str | None = None, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(
            settings.llm_timeout_seconds, settings.llm_max_tokens, settings.llm_temperature, transport
        )
        if not settings.groq_api_key:
            raise ValueError("GROQ_API_KEY is not set")
        self.model = model or settings.groq_model
        self._url = f"{settings.groq_base_url}/chat/completions"
        self._headers = {"Authorization": f"Bearer {settings.groq_api_key}"}

    def _body(self, messages: list[ChatMessage], max_tokens: int | None, temperature: float | None) -> dict:
        return {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "max_tokens": max_tokens or self._max_tokens,
            "temperature": self._temperature if temperature is None else temperature,
        }

    async def complete(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> LLMResult:
        data = await self._post_json(self._url, self._body(messages, max_tokens, temperature), self._headers)
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError) as exc:
            raise LLMError(f"Unexpected Groq response: {str(data)[:300]}") from exc
        return LLMResult(text=text.strip(), model=data.get("model", self.model))

    async def stream(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> AsyncIterator[LLMDelta]:
        body = self._body(messages, max_tokens, temperature) | {"stream": True}
        async for payload in self._stream_lines(self._url, body, self._headers):
            if payload == "[DONE]":
                return
            try:
                event = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if event.get("error"):
                raise LLMError(f"Groq stream error: {event['error']}")
            for choice in event.get("choices", []):
                delta = (choice.get("delta") or {}).get("content")
                if delta:
                    yield LLMDelta(delta, event.get("model", self.model))


class GeminiLLM(_HTTPProvider):
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__(
            settings.llm_timeout_seconds, settings.llm_max_tokens, settings.llm_temperature, transport
        )
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is not set")
        self.model = settings.gemini_model
        base = f"{settings.gemini_base_url}/models/{self.model}"
        self._url = f"{base}:generateContent"
        self._stream_url = f"{base}:streamGenerateContent?alt=sse"
        self._headers = {"x-goog-api-key": settings.gemini_api_key}

    def _body(self, messages: list[ChatMessage], max_tokens: int | None, temperature: float | None) -> dict:
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        contents = [
            {"role": "model" if m.role == "assistant" else "user", "parts": [{"text": m.content}]}
            for m in messages
            if m.role != "system"
        ]
        body: dict = {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": max_tokens or self._max_tokens,
                "temperature": self._temperature if temperature is None else temperature,
            },
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        return body

    @staticmethod
    def _text(event: dict) -> str:
        parts = []
        for cand in event.get("candidates", []):
            for part in (cand.get("content") or {}).get("parts", []):
                if "text" in part:
                    parts.append(part["text"])
        return "".join(parts)

    async def complete(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> LLMResult:
        data = await self._post_json(self._url, self._body(messages, max_tokens, temperature), self._headers)
        return LLMResult(text=self._text(data).strip(), model=self.model)

    async def stream(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> AsyncIterator[LLMDelta]:
        body = self._body(messages, max_tokens, temperature)
        async for payload in self._stream_lines(self._stream_url, body, self._headers):
            try:
                event = json.loads(payload)
            except json.JSONDecodeError:
                continue
            text = self._text(event)
            if text:
                yield LLMDelta(text, self.model)


class FallbackLLM:
    def __init__(self, providers: list[LLMProvider]) -> None:
        if not providers:
            raise ValueError("FallbackLLM needs at least one provider")
        self.providers = providers
        self.model = providers[0].model

    async def complete(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> LLMResult:
        errors: list[str] = []
        for provider in self.providers:
            try:
                return await provider.complete(messages, max_tokens, temperature)
            except (LLMError, httpx.HTTPError) as exc:
                logger.warning(
                    "llm_provider_failed", extra={"model": provider.model, "error": str(exc)[:200]}
                )
                errors.append(f"{provider.model}: {exc}")
        raise LLMError("; ".join(errors))

    async def stream(
        self, messages: list[ChatMessage], max_tokens: int | None = None, temperature: float | None = None
    ) -> AsyncIterator[LLMDelta]:
        errors: list[str] = []
        for provider in self.providers:
            started = False
            try:
                async for delta in provider.stream(messages, max_tokens, temperature):
                    started = True
                    yield delta
                return
            except (LLMError, httpx.HTTPError) as exc:
                if started:
                    raise
                logger.warning(
                    "llm_provider_failed", extra={"model": provider.model, "error": str(exc)[:200]}
                )
                errors.append(f"{provider.model}: {exc}")
        raise LLMError("; ".join(errors))

    async def aclose(self) -> None:
        for provider in self.providers:
            close = getattr(provider, "aclose", None)
            if close is not None:
                await close()


def build_llm(settings: Settings) -> FallbackLLM | None:
    providers: list[LLMProvider] = []
    if settings.groq_api_key:
        providers.append(GroqLLM(settings))
    if settings.gemini_api_key:
        providers.append(GeminiLLM(settings))
    return FallbackLLM(providers) if providers else None
