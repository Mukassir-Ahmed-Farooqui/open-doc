from __future__ import annotations

import pytest

from app.config import Settings
from app.ratelimit import SlidingWindowLimiter, parse_limit
from app.storage import ObjectNotFoundError
from app.storage.local import LocalStorage


def test_database_url_normalised() -> None:
    assert Settings(database_url="postgres://u:p@h/db").database_url == "postgresql+asyncpg://u:p@h/db"
    assert Settings(database_url="postgresql://u@h/db").database_url.startswith("postgresql+asyncpg://")


def test_database_url_libpq_options_translated_for_asyncpg() -> None:
    neon = "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require"
    assert (
        Settings(database_url=neon).database_url == "postgresql+asyncpg://u:p@ep-x.neon.tech/db?ssl=require"
    )
    sock = "postgresql://postgres@/db?host=/tmp&port=5433"
    assert Settings(database_url=sock).database_url == "postgresql+asyncpg://postgres@/db?host=/tmp&port=5433"
    both = "postgresql://u@h/db?ssl=verify-full&sslmode=require"
    assert Settings(database_url=both).database_url == "postgresql+asyncpg://u@h/db?ssl=verify-full"


def test_cors_origins_from_comma_list() -> None:
    s = Settings(cors_origins="https://a.app, https://b.app")
    assert s.cors_origins == ["https://a.app", "https://b.app"]


def test_production_requires_real_secret() -> None:
    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        Settings(app_env="production", jwt_secret_key="short")
    Settings(app_env="production", jwt_secret_key="x" * 40)


def test_parse_limit() -> None:
    assert parse_limit("30/minute") == (30, 60)
    assert parse_limit("5/hours") == (5, 3600)
    with pytest.raises(ValueError):
        parse_limit("5/fortnight")


async def test_sliding_window() -> None:
    lim = SlidingWindowLimiter()
    assert await lim.hit("k", 2, 60) is None
    assert await lim.hit("k", 2, 60) is None
    wait = await lim.hit("k", 2, 60)
    assert wait is not None and 0 < wait <= 60
    assert await lim.hit("other", 2, 60) is None


async def test_local_storage_roundtrip_and_key_validation(tmp_path) -> None:
    st = LocalStorage(str(tmp_path))
    await st.put("documents/abc123", b"data", "application/pdf")
    assert await st.get("documents/abc123") == b"data"
    await st.delete("documents/abc123")
    with pytest.raises(ObjectNotFoundError):
        await st.get("documents/abc123")
    for bad in ("../etc/passwd", "/abs", "documents/../../x", "Upper/Case"):
        with pytest.raises(ValueError):
            await st.put(bad, b"x", "text/plain")
