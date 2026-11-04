"""Shared fixtures.

Integration tests need Postgres with pgvector. Point TEST_DATABASE_URL at a server you can
create databases on (default: local socket on port 5433); a fresh `opendoc_test` database is
created and migrated with Alembic once per session, and tables are truncated between tests.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import httpx
import pytest
from sqlalchemy.engine import make_url

ADMIN_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@/postgres?host=/tmp&port=5433")
_TEST_DB = "opendoc_test"
_url = make_url(ADMIN_URL.replace("postgresql+asyncpg://", "postgresql://"))
TEST_DB_URL = _url.set(database=_TEST_DB).render_as_string(hide_password=False)

_TMP = Path(tempfile.mkdtemp(prefix="opendoc-tests-"))
os.environ.update(
    {
        "APP_ENV": "test",
        "DATABASE_URL": TEST_DB_URL,
        "LOCAL_STORAGE_DIR": str(_TMP / "objects"),
        "WORKER_ENABLED": "false",
        "LOG_JSON": "false",
        "LOG_LEVEL": "WARNING",
        "GROQ_API_KEY": "",
        "GEMINI_API_KEY": "",
        "JWT_SECRET_KEY": "test-secret-key-that-is-long-enough-123456",
        "RATE_LIMIT_AUTH": "1000/minute",
        "RATE_LIMIT_QUERY": "1000/minute",
        "RATE_LIMIT_UPLOAD": "1000/minute",
        "AI_QUESTIONS_PER_USER_MINUTE": "1000",
        "AI_QUESTIONS_PER_USER_DAY": "1000",
        "AI_QUESTIONS_GLOBAL_DAY": "100000",
        "SIGNUPS_PER_IP_DAY": "1000",
        "MAX_DOCS_PER_USER": "1000",
        "MAX_STORAGE_MB_PER_USER": "1000",
    }
)
os.environ.setdefault("FASTEMBED_CACHE_DIR", str(Path.home() / ".cache" / "fastembed"))

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
FIXTURES = REPO / "tests" / "fixtures"


def _asyncpg_dsn(url: str) -> dict:
    u = make_url(url)
    kwargs: dict = {"user": u.username, "password": u.password, "database": u.database}
    host = u.query.get("host") or u.host
    if host:
        kwargs["host"] = host
    port = u.query.get("port") or u.port
    if port:
        kwargs["port"] = int(port)
    return kwargs


@pytest.fixture(scope="session")
def database() -> str:
    import asyncio

    async def recreate() -> None:
        conn = await asyncpg.connect(**_asyncpg_dsn(ADMIN_URL))
        try:
            await conn.execute(f'DROP DATABASE IF EXISTS "{_TEST_DB}" WITH (FORCE)')
            await conn.execute(f'CREATE DATABASE "{_TEST_DB}"')
        finally:
            await conn.close()

    asyncio.run(recreate())
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True, env=os.environ.copy()
    )
    return TEST_DB_URL


@pytest.fixture(scope="session")
async def app(database: str):
    from app.config import Settings
    from app.main import create_app

    application = create_app(Settings())
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    from sqlalchemy import text

    from app.ratelimit import limiter

    async with app.state.db.sessionmaker() as s:
        await s.execute(
            text(
                "TRUNCATE users, documents, sections, chunks, chats, messages, query_logs, "
                "usage_counters CASCADE"
            )
        )
        await s.commit()
    app.state.rag.llm = None
    limiter.reset()


async def register_and_login(client: httpx.AsyncClient, email: str, password: str = "password123") -> dict:
    r = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password, "full_name": "T"}
    )
    assert r.status_code == 201, r.text
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
async def auth(client: httpx.AsyncClient) -> dict:
    return await register_and_login(client, "alice@example.com")


async def upload_and_ingest(
    app, client, headers: dict, filename: str, data: bytes, ctype: str = "application/pdf"
) -> dict:
    r = await client.post("/api/v1/upload", headers=headers, files={"file": (filename, data, ctype)})
    assert r.status_code in (200, 202), r.text
    body = r.json()
    while await app.state.worker.run_once():
        pass
    r = await client.get(f"/api/v1/documents/{body['doc_id']}", headers=headers)
    return r.json()
