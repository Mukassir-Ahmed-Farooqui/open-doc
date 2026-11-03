"""Embedding providers.

* ``FastEmbedEmbeddings``: local ONNX model via fastembed (default BAAI/bge-small-en-v1.5,
  384-d, ~70 MB, no API key). Loaded lazily on first use; inference runs in a worker thread.
* ``GeminiEmbeddings``: Google Gemini embedding API over HTTPS (``batchEmbedContents``).

Query embeddings are cached in a bounded LRU because chat users repeat and refine questions.
"""

from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from typing import Protocol

import httpx

from app.config import Settings


class EmbeddingProvider(Protocol):
    name: str
    dim: int

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...

    def warm(self) -> None: ...


class _LRU:
    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self._data: OrderedDict[str, list[float]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> list[float] | None:
        with self._lock:
            value = self._data.get(key)
            if value is not None:
                self._data.move_to_end(key)
            return value

    def put(self, key: str, value: list[float]) -> None:
        if self.capacity <= 0:
            return
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.capacity:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


class FastEmbedEmbeddings:
    def __init__(self, settings: Settings) -> None:
        self.name = f"fastembed:{settings.embedding_model}"
        self.dim = settings.embedding_dim
        self._model_name = settings.embedding_model
        self._cache_dir = settings.fastembed_cache_dir
        self._threads = settings.onnx_threads
        self._mem_arena = settings.onnx_mem_arena
        self._batch_size = settings.embedding_batch_size
        self._query_prefix = settings.embedding_query_prefix
        self._model = None
        self._load_lock = threading.Lock()
        # ONNX sessions are thread-safe, but serialising inference bounds peak memory.
        self._infer_lock = threading.Lock()
        self.cache = _LRU(settings.embedding_cache_size)

    def _get_model(self):
        if self._model is None:
            with self._load_lock:
                if self._model is None:
                    from fastembed import TextEmbedding

                    model = TextEmbedding(
                        self._model_name,
                        cache_dir=self._cache_dir,
                        threads=self._threads,
                        enable_cpu_mem_arena=self._mem_arena,
                    )
                    probe = next(iter(model.embed(["probe"])))
                    if len(probe) != self.dim:
                        raise ValueError(
                            f"EMBEDDING_DIM={self.dim} but {self._model_name} produces {len(probe)}-d vectors"
                        )
                    self._model = model
        return self._model

    def warm(self) -> None:
        self._get_model()

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        model = self._get_model()
        with self._infer_lock:
            return [vec.tolist() for vec in model.embed(texts, batch_size=self._batch_size)]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await asyncio.to_thread(self._embed_sync, texts)

    async def embed_query(self, text: str) -> list[float]:
        key = text.strip()
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        vec = (await asyncio.to_thread(self._embed_sync, [self._query_prefix + key]))[0]
        self.cache.put(key, vec)
        return vec


class GeminiEmbeddings:
    _MAX_BATCH = 100

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required for Gemini embeddings")
        self.name = f"gemini:{settings.gemini_embedding_model}"
        self.dim = settings.embedding_dim
        self._model = settings.gemini_embedding_model
        self._url = f"{settings.gemini_base_url}/models/{self._model}:batchEmbedContents"
        self._headers = {"x-goog-api-key": settings.gemini_api_key}
        self._timeout = settings.llm_timeout_seconds
        self._transport = transport
        self.cache = _LRU(settings.embedding_cache_size)

    def warm(self) -> None:
        return None

    async def _embed(self, texts: list[str], task: str) -> list[list[float]]:
        out: list[list[float]] = []
        async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
            for i in range(0, len(texts), self._MAX_BATCH):
                batch = texts[i : i + self._MAX_BATCH]
                body = {
                    "requests": [
                        {
                            "model": f"models/{self._model}",
                            "content": {"parts": [{"text": t}]},
                            "taskType": task,
                            "outputDimensionality": self.dim,
                        }
                        for t in batch
                    ]
                }
                resp = await client.post(self._url, json=body, headers=self._headers)
                resp.raise_for_status()
                out.extend(e["values"] for e in resp.json()["embeddings"])
        return out

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await self._embed(texts, "RETRIEVAL_DOCUMENT")

    async def embed_query(self, text: str) -> list[float]:
        key = text.strip()
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        vec = (await self._embed([key], "RETRIEVAL_QUERY"))[0]
        self.cache.put(key, vec)
        return vec


def build_embedder(settings: Settings) -> EmbeddingProvider:
    if settings.embedding_provider == "gemini":
        return GeminiEmbeddings(settings)
    return FastEmbedEmbeddings(settings)
