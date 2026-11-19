"""Authentication: register, login, current user (read/update)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session, get_storage
from app.auth.security import DUMMY_HASH, create_access_token, hash_password, verify_password
from app.config import Settings, get_settings
from app.db.models import Document, User
from app.errors import AppError
from app.quota import check_signup
from app.ratelimit import check_login_allowed, email_hash, rate_limit, record_login_failure
from app.schemas.auth import (
    DeleteAccountRequest,
    DeleteAccountResponse,
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserResponse,
    UserUpdateRequest,
)
from app.storage import ObjectStorage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id), email=user.email, full_name=user.full_name, created_at=user.created_at.isoformat()
    )


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=RegisterResponse,
    dependencies=[Depends(rate_limit("rate_limit_auth"))],
)
async def register(
    body: RegisterRequest, request: Request, session: AsyncSession = Depends(get_session)
) -> RegisterResponse:
    email = body.email.lower()
    # Quota first: every attempt (new or existing email) spends a unit, so the 409 below can't be
    # used to probe more than a few addresses per IP per day.
    await check_signup(request)  # 3 attempts per IP per day (Postgres-backed)
    if (await session.execute(select(User.id).where(User.email == email))).first():
        raise AppError(409, "Email already registered")
    user = User(email=email, hashed_password=await hash_password(body.password), full_name=body.full_name)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "Email already registered") from None
    return RegisterResponse(user_id=str(user.id))


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(rate_limit("rate_limit_auth"))])
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    ehash = email_hash(settings, body.email)
    # Per-account lock-out (same for known and unknown emails, so it reveals nothing).
    await check_login_allowed(request, settings, ehash)
    user = (await session.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    # Always run bcrypt so response time does not reveal whether the email exists.
    valid = await verify_password(body.password, user.hashed_password if user else DUMMY_HASH)
    if user is None or not valid:
        await record_login_failure(request, settings, ehash)
        raise AppError(401, "Invalid credentials")
    if not user.is_active:
        raise AppError(403, "User account is deactivated")
    token = create_access_token(settings, str(user.id), user.email)
    return TokenResponse(access_token=token, expires_in=settings.jwt_expire_minutes * 60)


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)) -> UserResponse:
    return _user_response(user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if body.full_name is not None:
        user.full_name = body.full_name
        await session.commit()
        await session.refresh(user)
    return _user_response(user)


@router.delete(
    "/me", response_model=DeleteAccountResponse, dependencies=[Depends(rate_limit("rate_limit_auth"))]
)
async def delete_me(
    body: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage: ObjectStorage = Depends(get_storage),
) -> DeleteAccountResponse:
    """Delete the account and everything in it. Requires the current password.

    Stored files are removed first (the database cascade can't reach the bucket); if any file
    can't be removed, nothing else is deleted and the user can retry. Then the user row goes, and
    ``ON DELETE CASCADE`` removes documents, sections, chunks, chats, messages and query logs.
    """
    if not await verify_password(body.password, user.hashed_password):
        # 403, not 401: the session is valid, so the client must not sign the user out.
        raise AppError(403, "Incorrect password")
    user_id = user.id
    # Same lock as uploads: no new document can be added for this user while we delete.
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"upload:{user_id}"})
    keys = (
        (await session.execute(select(Document.storage_key).where(Document.owner_id == user_id)))
        .scalars()
        .all()
    )
    failed = 0
    for key in keys:
        try:
            await storage.delete(key)
        except Exception:
            failed += 1
            logger.exception("account_delete_storage_failed", extra={"user_id": str(user_id)})
    if failed:
        await session.rollback()
        raise AppError(
            503, "Couldn't remove your files right now. Nothing else was deleted; please try again."
        )
    await session.execute(delete(User).where(User.id == user_id))
    await session.commit()
    return DeleteAccountResponse()
