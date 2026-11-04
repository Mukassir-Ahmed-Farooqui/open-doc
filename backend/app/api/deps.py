"""FastAPI dependencies: settings, DB session, services, current user."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_access_token
from app.config import Settings, get_settings
from app.db.models import User
from app.errors import AppError
from app.generation.service import RAGService
from app.ingestion.worker import IngestionWorker
from app.quota import AIReservation, reserve_ai
from app.storage import ObjectStorage

_bearer = HTTPBearer(auto_error=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.db.sessionmaker() as session:
        yield session


def get_storage(request: Request) -> ObjectStorage:
    return request.app.state.storage


def get_rag(request: Request) -> RAGService:
    return request.app.state.rag


def get_worker(request: Request) -> IngestionWorker:
    return request.app.state.worker


def _unauthorized(message: str) -> AppError:
    return AppError(401, message, headers={"WWW-Authenticate": "Bearer"})


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Not authenticated")
    try:
        payload = decode_access_token(settings, credentials.credentials)
        user_id = uuid.UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, ValueError):
        raise _unauthorized("Invalid or expired token") from None
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise _unauthorized("User not found")
    if not user.is_active:
        raise AppError(403, "User account is deactivated")
    return user


def parse_uuid(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise AppError(400, f"Invalid {what} format") from None


async def ai_question(request: Request, user: User = Depends(get_current_user)) -> AIReservation:
    """Kill switch + per-user minute/day + global day quotas for one AI generation."""
    return await reserve_ai(request, user.id)
