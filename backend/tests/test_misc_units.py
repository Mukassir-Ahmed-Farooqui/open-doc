from __future__ import annotations

import pytest

from app.config import Settings
from app.ratelimit import _window, parse_limit
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


def test_cors_origins_from_env_plain_and_json(monkeypatch: pytest.MonkeyPatch) -> None:
    # Env values are what .env.example / docker-compose use; pydantic-settings used to JSON-decode them.
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")
    assert Settings().cors_origins == ["http://localhost:5173"]
    monkeypatch.setenv("CORS_ORIGINS", "https://a.app,https://b.app")
    assert Settings().cors_origins == ["https://a.app", "https://b.app"]
    monkeypatch.setenv("CORS_ORIGINS", '["https://a.app", "https://b.app"]')
    assert Settings().cors_origins == ["https://a.app", "https://b.app"]


def test_production_requires_real_secret() -> None:
    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        Settings(app_env="production", jwt_secret_key="short")
    Settings(app_env="production", jwt_secret_key="x" * 40)


def test_parse_limit() -> None:
    assert parse_limit("30/minute") == (30, 60)
    assert parse_limit("5/hours") == (5, 3600)
    with pytest.raises(ValueError):
        parse_limit("5/fortnight")


def test_fixed_window() -> None:
    start, end, left = _window(60, now=1_000_030.5)
    assert start == 1_000_020 and end.timestamp() == 1_000_080 and left == 50
    assert _window(60, now=1_000_079.9)[0] == start and _window(60, now=1_000_080)[0] == start + 60


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



async def test_api_docs_hidden_in_production() -> None:
    import httpx

    from app.main import create_app

    async def statuses(settings: Settings) -> dict[str, int]:
        # No lifespan needed: these routes don't touch app.state.
        transport = httpx.ASGITransport(app=create_app(settings))
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            return {p: (await c.get(p)).status_code for p in ("/docs", "/redoc", "/openapi.json")}

    assert await statuses(Settings(app_env="development")) == {"/docs": 200, "/redoc": 200, "/openapi.json": 200}
    prod = Settings(app_env="production", jwt_secret_key="x" * 40)
    assert await statuses(prod) == {"/docs": 404, "/redoc": 404, "/openapi.json": 404}


async def test_security_headers_on_responses_and_cors_preflight() -> None:
    import httpx

    from app.main import create_app

    expected = {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin-when-cross-origin",
    }
    app = create_app(Settings(cors_origins="https://a.app"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        ok = await c.get("/")
        missing = await c.get("/api/v1/nope")
        preflight = await c.options(
            "/api/v1/auth/login",
            headers={"Origin": "https://a.app", "Access-Control-Request-Method": "POST"},
        )
    for r in (ok, missing, preflight):
        assert {k: r.headers.get(k) for k in expected} == expected
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "https://a.app"
