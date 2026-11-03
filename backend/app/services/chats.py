"""Chat and message persistence. Every query is scoped by ``user_id``."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chat, Message, QueryLog
from app.errors import not_found
from app.schemas.chat import ChatDetailResponse, ChatResponse, Citation, MessageResponse


def chat_response(chat: Chat) -> ChatResponse:
    return ChatResponse(
        id=str(chat.id),
        title=chat.title,
        selected_doc_ids=list(chat.selected_doc_ids or []),
        created_at=chat.created_at.isoformat(),
        updated_at=chat.updated_at.isoformat(),
    )


def message_response(msg: Message) -> MessageResponse:
    citations = None
    if msg.citations is not None:
        citations = [Citation(**c) for c in msg.citations]
    return MessageResponse(
        id=str(msg.id),
        role=msg.role,
        content=msg.content,
        citations=citations,
        latency_ms=msg.latency_ms,
        timestamp=msg.created_at.isoformat(),
        model=msg.model,
    )


async def list_chats(session: AsyncSession, user_id: uuid.UUID) -> list[Chat]:
    rows = await session.execute(select(Chat).where(Chat.user_id == user_id).order_by(Chat.updated_at.desc()))
    return list(rows.scalars())


async def get_chat(session: AsyncSession, user_id: uuid.UUID, chat_id: uuid.UUID) -> Chat:
    chat = (
        await session.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    ).scalar_one_or_none()
    if chat is None:
        raise not_found("Chat")
    return chat


async def chat_detail(session: AsyncSession, chat: Chat) -> ChatDetailResponse:
    msgs = await session.execute(
        select(Message).where(Message.chat_id == chat.id).order_by(Message.created_at)
    )
    base = chat_response(chat)
    return ChatDetailResponse(**base.model_dump(), messages=[message_response(m) for m in msgs.scalars()])


async def recent_history(session: AsyncSession, chat_id: uuid.UUID, limit: int) -> list[tuple[str, str]]:
    rows = await session.execute(
        select(Message.role, Message.content)
        .where(Message.chat_id == chat_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    return [(r.role, r.content) for r in reversed(rows.all())]


async def message_count(session: AsyncSession, chat_id: uuid.UUID) -> int:
    return int((await session.execute(select(func.count()).where(Message.chat_id == chat_id))).scalar_one())


def add_query_log(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    chat_id: uuid.UUID | None,
    doc_ids: list[str],
    question: str,
    query_type: str,
    chunks_retrieved: int,
    abstained: bool,
    model: str | None,
    retrieval_ms: int | None,
    latency_ms: int,
) -> None:
    session.add(
        QueryLog(
            user_id=user_id,
            chat_id=chat_id,
            document_ids=doc_ids,
            question=question,
            query_type=query_type,
            chunks_retrieved=chunks_retrieved,
            abstained=abstained,
            model=model,
            retrieval_ms=retrieval_ms,
            latency_ms=latency_ms,
        )
    )
