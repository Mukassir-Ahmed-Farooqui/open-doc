"""Password hashing (bcrypt) and JWT access tokens (PyJWT)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from app.config import Settings


def _hash_sync(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_sync(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hash_sync, password)


async def verify_password(password: str, hashed: str) -> bool:
    return await asyncio.to_thread(_verify_sync, password, hashed)


# A real hash used to equalise timing when the email does not exist.
DUMMY_HASH = _hash_sync("timing-equaliser-not-a-real-password")


def create_access_token(settings: Settings, user_id: str, email: str) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(settings: Settings, token: str) -> dict[str, Any]:
    """Return the token payload. Raises ``jwt.InvalidTokenError`` on any problem."""
    payload = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "email", "exp"]},
    )
    return payload
