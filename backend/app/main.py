"""FastAPI application factory and lifespan wiring."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import auth, chats, documents, health
from app.config import Settings, get_settings
from app.db.session import Database
from app.errors import install_error_handlers
from app.generation.service import RAGService
from app.ingestion.worker import IngestionWorker
from app.logging_setup import configure_logging, request_id_var
from app.providers.embeddings import build_embedder
from app.providers.llm import build_llm
from app.providers.rerank import build_reranker
from app.retrieval.retriever import HybridRetriever
from app.storage import build_storage

logger = logging.getLogger("app")


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(p) for p in version.split(".") if p.isdigit())


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db = Database(settings)
        storage = build_storage(settings)
        embedder = build_embedder(settings)
        reranker = build_reranker(settings)
        llm = build_llm(settings)
        retriever = HybridRetriever(settings, embedder, reranker)
        async with db.sessionmaker() as session:
            version = (
                await session.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))
            ).scalar()
        if version is None:
            logger.error("pgvector_missing: run `alembic upgrade head` before starting the API")
        retriever.iterative_scan = version is not None and _version_tuple(version) >= (0, 8)
        worker = IngestionWorker(settings, db.sessionmaker, storage, embedder)

        app.state.settings = settings
        app.state.db = db
        app.state.storage = storage
        app.state.rag = RAGService(settings, retriever, llm)
        app.state.worker = worker
        app.state.background_tasks = set()

        if settings.warm_models_on_startup:
            await asyncio.to_thread(embedder.warm)
            if reranker is not None:
                await asyncio.to_thread(reranker.warm)
        if settings.worker_enabled:
            worker.start()
        logger.info(
            "startup",
            extra={
                "env": settings.app_env,
                "embedder": embedder.name,
                "llm": llm.model if llm else None,
                "storage": str(getattr(storage, "root", settings.storage_backend)),
            },
        )
        try:
            yield
        finally:
            await worker.stop()
            for task in list(app.state.background_tasks):
                task.cancel()
            if llm is not None:
                await llm.aclose()
            await db.dispose()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    install_error_handlers(app)

    # Reject oversized uploads from Content-Length before the multipart body is read.
    # Registered before CORS so the 413 still carries CORS headers for the browser.
    upload_ceiling = settings.max_upload_bytes + 64 * 1024  # multipart framing overhead

    @app.middleware("http")
    async def upload_size_guard(request: Request, call_next):
        if request.method == "POST" and request.url.path.endswith("/upload"):
            try:
                declared = int(request.headers.get("content-length", "0"))
            except ValueError:
                declared = 0
            if declared > upload_ceiling:
                logger.warning("upload_rejected", extra={"reason": "content_length", "bytes": declared})
                msg = f"That file is over the {settings.max_upload_mb} MB limit. Try a smaller PDF."
                return JSONResponse(
                    status_code=413,
                    content={"error": {"code": "payload_too_large", "message": msg}, "detail": msg},
                )
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After", "Content-Disposition"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_var.set(rid[:64])
        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid[:64]
        if request.url.path not in ("/health", "/ready"):
            logger.info(
                "request",
                extra={
                    "request_id": rid[:64],
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                },
            )
        return response

    app.include_router(health.router)
    for module in (auth, documents, chats):
        app.include_router(module.router, prefix="/api/v1")

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"name": settings.app_name, "version": settings.app_version, "docs": "/docs"}

    return app


app = create_app()
