"""Retrieval-augmented answering: retrieve -> decide (answer or abstain) -> generate -> cite."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.generation.prompts import (
    DOC_SUMMARY_PROMPT,
    INSUFFICIENT_EVIDENCE,
    SYSTEM_PROMPT,
    TITLE_PROMPT,
    build_user_prompt,
)
from app.ingestion.chunking import count_tokens
from app.providers.llm import ChatMessage, FallbackLLM, LLMError
from app.retrieval.query import COMPARISON, SUMMARY, classify_query, reformulate
from app.retrieval.retriever import ContextBlock, HybridRetriever, RetrievalResult

_CITE_RE = re.compile(r"\[(S\d+(?:\s*[,;]\s*S?\d+)*)\]")
_HISTORY_CITE_RE = re.compile(r"\s*\[S\d+(?:\s*[,;]\s*S?\d+)*\]")
SNIPPET_CHARS = 400


class LLMNotConfiguredError(Exception):
    pass


@dataclass(slots=True)
class Prepared:
    question: str
    search_query: str
    query_type: str
    style: str | None
    history: list[tuple[str, str]]
    blocks: list[ContextBlock]
    retrieval: RetrievalResult
    abstain: bool
    retrieval_ms: int


@dataclass(slots=True)
class Answer:
    text: str
    citations: list[dict] = field(default_factory=list)
    model: str | None = None
    abstained: bool = False
    query_type: str = "fact"
    chunks_retrieved: int = 0
    retrieval_ms: int = 0


def parse_citations(answer: str, blocks: list[ContextBlock]) -> list[dict]:
    """Citations for exactly the sources the answer cites, in order of first mention."""
    by_id = {b.source_id: b for b in blocks}
    ordered: list[str] = []
    for group in _CITE_RE.findall(answer):
        for raw in re.split(r"\s*[,;]\s*", group):
            sid = raw if raw.startswith("S") else f"S{raw}"
            if sid in by_id and sid not in ordered:
                ordered.append(sid)
    citations = []
    for sid in ordered:
        b = by_id[sid]
        snippet = b.snippet if len(b.snippet) <= SNIPPET_CHARS else b.snippet[: SNIPPET_CHARS - 1] + "…"
        citations.append(
            {
                "source_id": sid,
                "doc_id": str(b.document_id),
                "document": b.filename,
                "page": b.page,
                "section": b.section,
                "snippet": snippet,
                "preview": snippet,
                "score": round(b.score, 4),
            }
        )
    return citations


def is_abstention(answer: str) -> bool:
    return INSUFFICIENT_EVIDENCE.lower().rstrip(".") in answer.lower()


class RAGService:
    def __init__(self, settings: Settings, retriever: HybridRetriever, llm: FallbackLLM | None) -> None:
        self.settings = settings
        self.retriever = retriever
        self.llm = llm

    def _require_llm(self) -> FallbackLLM:
        if self.llm is None:
            raise LLMNotConfiguredError("No LLM provider configured (set GROQ_API_KEY or GEMINI_API_KEY)")
        return self.llm

    def should_abstain(self, result: RetrievalResult, query_type: str) -> bool:
        if not result.hits:
            return True
        if query_type == SUMMARY:
            return False
        if result.top_rerank is not None:
            return result.top_rerank < self.settings.min_rerank_score
        if result.top_dense is not None:
            return result.top_dense < self.settings.min_dense_score
        return False

    async def prepare(
        self,
        session: AsyncSession,
        owner_id: uuid.UUID,
        doc_ids: list[uuid.UUID],
        question: str,
        history: list[tuple[str, str]] | None = None,
        style: str | None = None,
    ) -> Prepared:
        self._require_llm()
        history = history or []
        t0 = time.perf_counter()
        query_type = classify_query(question, len(doc_ids))
        search_query = await reformulate(self.llm, question, history) if history else question
        if query_type == SUMMARY:
            result = await self.retriever.retrieve_overview(session, owner_id, doc_ids)
        elif query_type == COMPARISON:
            result = await self.retriever.retrieve_comparison(session, owner_id, doc_ids, search_query)
        else:
            result = await self.retriever.retrieve(session, owner_id, doc_ids, search_query)
        abstain = self.should_abstain(result, query_type)
        blocks = (
            []
            if abstain
            else await self.retriever.expand_to_parents(
                session, owner_id, result.hits, whole_sections=query_type != SUMMARY
            )
        )
        return Prepared(
            question=question,
            search_query=search_query,
            query_type=query_type,
            style=style,
            history=history,
            blocks=blocks,
            retrieval=result,
            abstain=abstain or not blocks,
            retrieval_ms=int((time.perf_counter() - t0) * 1000),
        )

    def _messages(self, p: Prepared) -> list[ChatMessage]:
        messages = [ChatMessage("system", SYSTEM_PROMPT)]
        for role, content in p.history[-self.settings.history_turns :]:
            clean = _HISTORY_CITE_RE.sub("", content)[:1500]
            messages.append(ChatMessage("assistant" if role == "assistant" else "user", clean))
        messages.append(ChatMessage("user", build_user_prompt(p.question, p.blocks, p.query_type, p.style)))
        return messages

    def _finish(self, p: Prepared, text: str, model: str | None) -> Answer:
        abstained = is_abstention(text)
        return Answer(
            text=text,
            citations=[] if abstained else parse_citations(text, p.blocks),
            model=model,
            abstained=abstained,
            query_type=p.query_type,
            chunks_retrieved=len(p.retrieval.hits),
            retrieval_ms=p.retrieval_ms,
        )

    def _abstain_answer(self, p: Prepared) -> Answer:
        return Answer(
            text=INSUFFICIENT_EVIDENCE,
            abstained=True,
            query_type=p.query_type,
            chunks_retrieved=len(p.retrieval.hits),
            retrieval_ms=p.retrieval_ms,
        )

    async def answer(self, p: Prepared) -> Answer:
        if p.abstain:
            return self._abstain_answer(p)
        result = await self._require_llm().complete(self._messages(p))
        return self._finish(p, result.text, result.model)

    async def stream(self, p: Prepared) -> AsyncIterator[tuple[str, object]]:
        """Yield ("token", str) events, then a final ("answer", Answer)."""
        if p.abstain:
            answer = self._abstain_answer(p)
            yield "token", answer.text
            yield "answer", answer
            return
        parts: list[str] = []
        model: str | None = None
        async for delta in self._require_llm().stream(self._messages(p)):
            parts.append(delta.text)
            model = delta.model
            yield "token", delta.text
        yield "answer", self._finish(p, "".join(parts).strip(), model)

    async def chat_title(self, question: str) -> str:
        fallback = " ".join(question.split()[:6])[:80] or "New Chat"
        if self.llm is None:
            return fallback
        try:
            result = await self.llm.complete(
                [ChatMessage("system", TITLE_PROMPT), ChatMessage("user", question[:1000])],
                max_tokens=24,
                temperature=0.2,
            )
        except LLMError:
            return fallback
        title = result.text.strip().strip("\"'").strip().rstrip(".")
        return title[:80] if title else fallback

    async def document_summary(self, section_texts: list[tuple[str, str]]) -> tuple[str, str]:
        """One LLM call over the opening of each section (bounded by the context budget)."""
        llm = self._require_llm()
        parts: list[str] = []
        used = 0
        for heading, body in section_texts:
            excerpt = body[:1200]
            cost = count_tokens(excerpt)
            if used + cost > self.settings.max_context_tokens:
                break
            parts.append(f"## {heading}\n{excerpt}")
            used += cost
        result = await llm.complete(
            [ChatMessage("system", DOC_SUMMARY_PROMPT), ChatMessage("user", "\n\n".join(parts))],
            max_tokens=500,
        )
        return result.text, result.model
