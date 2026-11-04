"""Authentication: register, login, current user (read/update)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session
from app.auth.security import DUMMY_HASH, create_access_token, hash_password, verify_password
from app.config import Settings, get_settings
from app.db.models import User
from app.errors import AppError
from app.quota import check_signup
from app.ratelimit import rate_limit
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserResponse,
    UserUpdateRequest,
)

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
    if (await session.execute(select(User.id).where(User.email == email))).first():
        raise AppError(409, "Email already registered")
    await check_signup(request)  # 3 accounts per IP per day (Postgres-backed)
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
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    user = (await session.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    # Always run bcrypt so response time does not reveal whether the email exists.
    valid = await verify_password(body.password, user.hashed_password if user else DUMMY_HASH)
    if user is None or not valid:
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
