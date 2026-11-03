"""Alembic environment (async). Uses DATABASE_URL from app settings.

A Postgres advisory lock serialises concurrent `alembic upgrade` runs, so several
containers starting at once (Cloud Run / Railway replicas) cannot race on migrations.
"""

from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db.models import Base

config = context.config
target_metadata = Base.metadata
_LOCK_ID = 7_340_201  # arbitrary, stable


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(get_settings().database_url)
    async with engine.connect() as connection:
        await connection.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _LOCK_ID})
        await connection.commit()
        try:
            await connection.run_sync(_run)
        finally:
            await connection.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": _LOCK_ID})
            await connection.commit()
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
