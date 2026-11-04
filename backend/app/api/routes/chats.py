"""Chats, messages (JSON and SSE streaming) and stateless one-shot queries."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import ai_question, get_current_user, get_rag, get_session, parse_uuid
from app.config import Settings, get_settings
from app.db.models import Chat, Message, User
from app.errors import AppError
from app.generation.service import Answer, LLMNotConfiguredError, Prepared, RAGService
from app.providers.llm import LLMError
from app.quota import AIReservation
from app.schemas.chat import (
    ChatCreateRequest,
    ChatDetailResponse,
    ChatDocumentsUpdateRequest,
    ChatRenameRequest,
    ChatResponse,
    MessageCreateRequest,
    MessageResponse,
    QueryRequest,
    QueryResponse,
    StatusResponse,
)
from app.services import chats as chat_svc
from app.services import documents as doc_svc

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chats"])

NO_DOCUMENTS_ANSWER = (
    "You have not uploaded any documents yet. Please upload a document before asking questions."
)


# ───────────────────────────── chat CRUD ─────────────────────────────


@router.get("/chats", response_model=list[ChatResponse])
async def list_chats(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> list[ChatResponse]:
    return [chat_svc.chat_response(c) for c in await chat_svc.list_chats(session, user.id)]


@router.post("/chats", response_model=ChatResponse, status_code=status.HTTP_201_CREATED)
async def create_chat(
    body: ChatCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    ids = await doc_svc.resolve_owned_ids(session, user.id, body.selected_doc_ids or [])
    chat = Chat(user_id=user.id, title="New Chat", selected_doc_ids=ids)
    session.add(chat)
    await session.commit()
    await session.refresh(chat)
    return chat_svc.chat_response(chat)


@router.get("/chats/{chat_id}", response_model=ChatDetailResponse)
async def get_chat(
    chat_id: str, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> ChatDetailResponse:
    chat = await chat_svc.get_chat(session, user.id, parse_uuid(chat_id, "chat_id"))
    return await chat_svc.chat_detail(session, chat)


@router.patch("/chats/{chat_id}", response_model=ChatResponse)
async def rename_chat(
    chat_id: str,
    body: ChatRenameRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    chat = await chat_svc.get_chat(session, user.id, parse_uuid(chat_id, "chat_id"))
    chat.title = body.title.strip()
    await session.commit()
    await session.refresh(chat)
    return chat_svc.chat_response(chat)


@router.patch("/chats/{chat_id}/documents", response_model=ChatResponse)
async def update_chat_documents(
    chat_id: str,
    body: ChatDocumentsUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    chat = await chat_svc.get_chat(session, user.id, parse_uuid(chat_id, "chat_id"))
    chat.selected_doc_ids = await doc_svc.resolve_owned_ids(session, user.id, body.selected_doc_ids)
    await session.commit()
    await session.refresh(chat)
    return chat_svc.chat_response(chat)


@router.delete("/chats/{chat_id}", response_model=StatusResponse)
async def delete_chat(
    chat_id: str, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> StatusResponse:
    chat = await chat_svc.get_chat(session, user.id, parse_uuid(chat_id, "chat_id"))
    await session.delete(chat)
    await session.commit()
    return StatusResponse(status="success", message="Chat session deleted successfully.")


# ───────────────────────────── shared turn logic ─────────────────────────────


async def _queryable_docs(
    session: AsyncSession, user_id: uuid.UUID, selected: list[str]
) -> list[uuid.UUID] | None:
    """Ready, owned docs to search; None means the user has no documents at all."""
    if not selected:
        if await doc_svc.count_documents(session, user_id) == 0:
            return None
        raise AppError(400, "No documents selected. Please select at least one document.")
    ready = await doc_svc.ready_subset(session, user_id, selected)
    if not ready:
        raise AppError(409, "The selected documents are still processing or failed to process.")
    return ready


async def _prepare(
    rag: RAGService,
    session: AsyncSession,
    user_id: uuid.UUID,
    doc_ids: list[uuid.UUID],
    question: str,
    history: list[tuple[str, str]],
    style: str | None,
) -> Prepared:
    try:
        return await rag.prepare(session, user_id, doc_ids, question, history, style)
    except LLMNotConfiguredError as exc:
        raise AppError(503, str(exc)) from None


@dataclass(slots=True)
class Turn:
    chat: Chat
    user_message: Message
    doc_ids: list[uuid.UUID] | None
    history: list[tuple[str, str]]
    is_first: bool
    started: float


async def _begin_turn(
    session: AsyncSession, user: User, chat_id: str, question: str, settings: Settings, rag: RAGService
) -> Turn:
    started = time.perf_counter()
    chat = await chat_svc.get_chat(session, user.id, parse_uuid(chat_id, "chat_id"))
    doc_ids = await _queryable_docs(session, user.id, list(chat.selected_doc_ids or []))
    if doc_ids is not None and rag.llm is None:
        raise AppError(503, "No LLM provider configured (set GROQ_API_KEY or GEMINI_API_KEY)")
    history = await chat_svc.recent_history(session, chat.id, settings.history_turns)
    user_msg = Message(chat_id=chat.id, role="user", content=question)
    session.add(user_msg)
    chat.updated_at = func.now()
    await session.commit()
    await session.refresh(user_msg)
    await session.refresh(chat)
    return Turn(chat, user_msg, doc_ids, history, not history, started)


async def _save_answer(
    session: AsyncSession, user: User, turn: Turn, answer: Answer, doc_ids: list[uuid.UUID]
) -> Message:
    latency_ms = int((time.perf_counter() - turn.started) * 1000)
    msg = Message(
        chat_id=turn.chat.id,
        role="assistant",
        content=answer.text,
        citations=answer.citations,
        latency_ms=latency_ms,
        model=answer.model,
    )
    session.add(msg)
    await session.execute(
        update(Chat).where(Chat.id == turn.chat.id, Chat.user_id == user.id).values(updated_at=func.now())
    )
    chat_svc.add_query_log(
        session,
        user_id=user.id,
        chat_id=turn.chat.id,
        doc_ids=[str(d) for d in doc_ids],
        question=turn.user_message.content,
        query_type=answer.query_type,
        chunks_retrieved=answer.chunks_retrieved,
        abstained=answer.abstained,
        model=answer.model,
        retrieval_ms=answer.retrieval_ms,
        latency_ms=latency_ms,
    )
    await session.commit()
    await session.refresh(msg)
    return msg


def _schedule_title(
    request: Request, rag: RAGService, chat_id: uuid.UUID, user_id: uuid.UUID, question: str
) -> None:
    sessionmaker: async_sessionmaker[AsyncSession] = request.app.state.db.sessionmaker
    tasks: set[asyncio.Task] = request.app.state.background_tasks

    async def run() -> None:
        try:
            title = await rag.chat_title(question)
            async with sessionmaker() as session:
                await session.execute(
                    update(Chat)
                    .where(Chat.id == chat_id, Chat.user_id == user_id, Chat.title == "New Chat")
                    .values(title=title)
                )
                await session.commit()
        except Exception:
            logger.exception("chat_title_failed", extra={"chat_id": str(chat_id)})

    task = asyncio.create_task(run())
    tasks.add(task)
    task.add_done_callback(tasks.discard)


# ───────────────────────────── messages ─────────────────────────────


@router.post(
    "/chats/{chat_id}/messages",
    response_model=MessageResponse,
)
async def create_message(
    chat_id: str,
    body: MessageCreateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    rag: RAGService = Depends(get_rag),
    settings: Settings = Depends(get_settings),
    quota: AIReservation = Depends(ai_question),
) -> MessageResponse:
    turn = await _begin_turn(session, user, chat_id, body.question, settings, rag)
    if turn.is_first:
        _schedule_title(request, rag, turn.chat.id, user.id, body.question)
    if turn.doc_ids is None:
        msg = await _save_answer(session, user, turn, Answer(text=NO_DOCUMENTS_ANSWER), [])
        return chat_svc.message_response(msg)
    prepared = await _prepare(
        rag, session, user.id, turn.doc_ids, body.question, turn.history, body.summary_style
    )
    try:
        answer = await rag.answer(prepared)
    except LLMError:
        logger.exception("llm_failed")
        await quota.refund()
        raise AppError(
            503,
            "The AI service is busy right now. Please try again in a minute.",
            headers={"Retry-After": "30"},
        ) from None
    msg = await _save_answer(session, user, turn, answer, turn.doc_ids)
    return chat_svc.message_response(msg)


def _sse(event: str, data: object) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n".encode()


@router.post(
    "/chats/{chat_id}/messages/stream",
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def stream_message(
    chat_id: str,
    body: MessageCreateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    rag: RAGService = Depends(get_rag),
    settings: Settings = Depends(get_settings),
    quota: AIReservation = Depends(ai_question),
) -> StreamingResponse:
    """Server-Sent Events. Events: ``meta`` (once), ``token`` (many, ``{"delta"}``), then
    ``done`` (the saved assistant message, same shape as the JSON endpoint) or ``error``."""
    turn = await _begin_turn(session, user, chat_id, body.question, settings, rag)
    if turn.is_first:
        _schedule_title(request, rag, turn.chat.id, user.id, body.question)
    prepared = None
    if turn.doc_ids is not None:
        prepared = await _prepare(
            rag, session, user.id, turn.doc_ids, body.question, turn.history, body.summary_style
        )
    sessionmaker: async_sessionmaker[AsyncSession] = request.app.state.db.sessionmaker
    user_msg_id = str(turn.user_message.id)

    async def events() -> AsyncIterator[bytes]:
        if prepared is None:
            yield _sse("meta", {"user_message_id": user_msg_id, "query_type": "none", "abstained": False})
            yield _sse("token", {"delta": NO_DOCUMENTS_ANSWER})
            async with sessionmaker() as s:
                msg = await _save_answer(s, user, turn, Answer(text=NO_DOCUMENTS_ANSWER), [])
            yield _sse("done", chat_svc.message_response(msg).model_dump())
            return
        yield _sse(
            "meta",
            {
                "user_message_id": user_msg_id,
                "query_type": prepared.query_type,
                "search_query": prepared.search_query,
                "abstained": prepared.abstain,
                "sources": len(prepared.blocks),
                "retrieval_ms": prepared.retrieval_ms,
            },
        )
        answer: Answer | None = None
        try:
            async for kind, payload in rag.stream(prepared):
                if kind == "token":
                    yield _sse("token", {"delta": payload})
                else:
                    answer = payload  # type: ignore[assignment]
        except LLMError:
            logger.exception("llm_stream_failed")
            await quota.refund()
            yield _sse(
                "error", {"message": "The AI service is busy right now. Please try again in a minute."}
            )
            return
        if answer is None:
            await quota.refund()
            yield _sse("error", {"message": "No answer was generated"})
            return
        async with sessionmaker() as s:
            msg = await _save_answer(s, user, turn, answer, turn.doc_ids or [])
        yield _sse("done", chat_svc.message_response(msg).model_dump() | {"abstained": answer.abstained})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ───────────────────────────── stateless query ─────────────────────────────


@router.post("/query", response_model=QueryResponse)
async def query(
    body: QueryRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    rag: RAGService = Depends(get_rag),
    quota: AIReservation = Depends(ai_question),
) -> QueryResponse:
    started = time.perf_counter()
    selected = await doc_svc.resolve_owned_ids(session, user.id, body.selected_doc_ids)
    doc_ids = await _queryable_docs(session, user.id, selected)
    if doc_ids is None:
        return QueryResponse(answer=NO_DOCUMENTS_ANSWER, citations=[], query_type="none")
    prepared = await _prepare(rag, session, user.id, doc_ids, body.question, [], None)
    try:
        answer = await rag.answer(prepared)
    except LLMError:
        logger.exception("llm_failed")
        await quota.refund()
        raise AppError(
            503,
            "The AI service is busy right now. Please try again in a minute.",
            headers={"Retry-After": "30"},
        ) from None
    chat_svc.add_query_log(
        session,
        user_id=user.id,
        chat_id=None,
        doc_ids=[str(d) for d in doc_ids],
        question=body.question,
        query_type=answer.query_type,
        chunks_retrieved=answer.chunks_retrieved,
        abstained=answer.abstained,
        model=answer.model,
        retrieval_ms=answer.retrieval_ms,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
    await session.commit()
    return QueryResponse(
        answer=answer.text,
        citations=answer.citations,
        model=answer.model,
        abstained=answer.abstained,
        query_type=answer.query_type,
    )
