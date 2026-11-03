"""Cross-encoder reranking via fastembed ONNX (default Xenova/ms-marco-MiniLM-L-6-v2)."""

from __future__ import annotations

import asyncio
import threading
from typing import Protocol

from app.config import Settings


class Reranker(Protocol):
    name: str

    async def score(self, query: str, passages: list[str]) -> list[float]: ...

    def warm(self) -> None: ...


class FastEmbedReranker:
    def __init__(self, settings: Settings) -> None:
        self.name = f"fastembed:{settings.reranker_model}"
        self._model_name = settings.reranker_model
        self._cache_dir = settings.fastembed_cache_dir
        self._threads = settings.onnx_threads
        self._mem_arena = settings.onnx_mem_arena
        self._model = None
        self._lock = threading.Lock()

    def _get_model(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from fastembed.rerank.cross_encoder import TextCrossEncoder

                    self._model = TextCrossEncoder(
                        self._model_name,
                        cache_dir=self._cache_dir,
                        threads=self._threads,
                        enable_cpu_mem_arena=self._mem_arena,
                    )
        return self._model

    def warm(self) -> None:
        self._get_model()

    def _score_sync(self, query: str, passages: list[str]) -> list[float]:
        model = self._get_model()
        with self._lock:
            return [float(s) for s in model.rerank(query, passages, batch_size=16)]

    async def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        return await asyncio.to_thread(self._score_sync, query, passages)


def build_reranker(settings: Settings) -> Reranker | None:
    if settings.reranker_provider == "fastembed":
        return FastEmbedReranker(settings)
    return None
