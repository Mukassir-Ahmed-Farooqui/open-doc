"""Liveness (/health) and readiness (/ready) probes, mounted at the root (not under /api/v1)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    settings = request.app.state.settings
    return {"status": "ok", "version": settings.app_version}


@router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    state = request.app.state
    checks: dict[str, str] = {}
    try:
        async with state.db.sessionmaker() as session:
            version = (
                await session.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))
            ).scalar()
        checks["database"] = "ok"
        checks["pgvector"] = version or "missing"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
    try:
        await state.storage.check()
        checks["storage"] = "ok"
    except Exception as exc:
        checks["storage"] = f"error: {type(exc).__name__}"
    if state.settings.worker_enabled:
        checks["worker"] = "ok" if state.worker.running else "stopped"
    checks["llm"] = "configured" if state.rag.llm is not None else "not configured"
    healthy = (
        checks.get("database") == "ok"
        and checks.get("pgvector") not in (None, "missing")
        and checks.get("storage") == "ok"
        and checks.get("worker", "ok") == "ok"
    )
    return JSONResponse(
        {"status": "ready" if healthy else "not_ready", "checks": checks}, status_code=200 if healthy else 503
    )
