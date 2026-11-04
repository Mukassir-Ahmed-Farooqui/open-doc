"""In-process asyncio ingestion worker backed by the ``documents`` table as a job queue.

* Claims jobs with ``FOR UPDATE SKIP LOCKED`` so several API instances can share the queue.
* Retries failures with exponential backoff up to ``WORKER_MAX_ATTEMPTS``; parse errors
  (corrupt/scanned/unsupported files) fail immediately because retrying cannot help.
* Requeues jobs stuck in ``processing`` (instance killed mid-job, e.g. scale-to-zero).
* Woken immediately by uploads via ``notify()``; otherwise polls every ``WORKER_POLL_SECONDS``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid

from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.db.models import Document, DocumentStatus
from app.ingestion.parsers import ParseError
from app.ingestion.pipeline import ingest_document
from app.providers.embeddings import EmbeddingProvider
from app.storage import ObjectNotFoundError, ObjectStorage

logger = logging.getLogger(__name__)

# One ingestion at a time across the whole application (Render free = 512 MB RAM): a
# transaction-scoped advisory lock serializes claims, and a job is only claimed when no other
# document is currently processing, whichever instance or worker owns it.
_CLAIM_LOCK_SQL = text("SELECT pg_try_advisory_xact_lock(727274)")
_CLAIM_SQL = text(
    """
    UPDATE documents
    SET status = 'processing', attempts = attempts + 1, progress = 5,
        processing_started_at = now(), updated_at = now(), error = NULL
    WHERE id = (
        SELECT id FROM documents
        WHERE status = 'queued' AND next_attempt_at <= now()
          AND NOT EXISTS (SELECT 1 FROM documents p WHERE p.status = 'processing')
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING id, attempts
    """
)

_REQUEUE_STALE_SQL = text(
    """
    UPDATE documents
    SET status = CASE WHEN attempts >= :max_attempts THEN 'failed' ELSE 'queued' END,
        error = CASE WHEN attempts >= :max_attempts
                     THEN 'Processing was interrupted too many times' ELSE error END,
        next_attempt_at = now(), processing_started_at = NULL, updated_at = now()
    WHERE status = 'processing'
      AND processing_started_at < now() - make_interval(mins => :stale_minutes)
    """
)


class IngestionWorker:
    def __init__(
        self,
        settings: Settings,
        sessionmaker: async_sessionmaker[AsyncSession],
        storage: ObjectStorage,
        embedder: EmbeddingProvider,
    ) -> None:
        self.settings = settings
        self.sessionmaker = sessionmaker
        self.storage = storage
        self.embedder = embedder
        self._wake = asyncio.Event()
        self._tasks: list[asyncio.Task] = []
        self._stopping = False

    @property
    def running(self) -> bool:
        return bool(self._tasks) and not all(t.done() for t in self._tasks)

    def start(self) -> None:
        if self._tasks:
            return
        self._stopping = False
        self._tasks = [
            asyncio.create_task(self._loop(i), name=f"ingestion-worker-{i}")
            for i in range(max(1, self.settings.worker_concurrency))
        ]

    async def stop(self) -> None:
        self._stopping = True
        self._wake.set()
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks = []

    def notify(self) -> None:
        self._wake.set()

    async def _loop(self, index: int) -> None:
        while not self._stopping:
            try:
                if index == 0:
                    await self.requeue_stale()
                worked = await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("worker_loop_error")
                worked = False
            if worked:
                continue
            self._wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=self.settings.worker_poll_seconds)

    async def requeue_stale(self) -> None:
        async with self.sessionmaker() as session:
            await session.execute(
                _REQUEUE_STALE_SQL,
                {
                    "max_attempts": self.settings.worker_max_attempts,
                    "stale_minutes": self.settings.worker_stale_minutes,
                },
            )
            await session.commit()

    async def claim(self) -> tuple[uuid.UUID, int] | None:
        async with self.sessionmaker() as session:
            locked = (await session.execute(_CLAIM_LOCK_SQL)).scalar()
            row = (await session.execute(_CLAIM_SQL)).first() if locked else None
            await session.commit()
        return (row.id, row.attempts) if row else None

    async def run_once(self) -> bool:
        """Process at most one job. Returns True if a job was claimed."""
        claimed = await self.claim()
        if claimed is None:
            return False
        doc_id, attempts = claimed
        try:
            await ingest_document(
                doc_id=doc_id,
                sessionmaker=self.sessionmaker,
                storage=self.storage,
                embedder=self.embedder,
                settings=self.settings,
            )
        except asyncio.CancelledError:
            await self._release(doc_id)
            raise
        except (ParseError, ObjectNotFoundError) as exc:
            await self._fail(doc_id, str(exc) or type(exc).__name__, permanent=True, attempts=attempts)
        except Exception as exc:
            logger.exception("ingestion_failed", extra={"doc_id": str(doc_id), "attempt": attempts})
            await self._fail(doc_id, f"{type(exc).__name__}: {exc}"[:500], permanent=False, attempts=attempts)
        return True

    async def _release(self, doc_id: uuid.UUID) -> None:
        """Put an interrupted job back without counting the attempt."""
        async with self.sessionmaker() as session:
            await session.execute(
                update(Document)
                .where(Document.id == doc_id, Document.status == DocumentStatus.PROCESSING)
                .values(
                    status=DocumentStatus.QUEUED,
                    attempts=Document.attempts - 1,
                    processing_started_at=None,
                )
            )
            await session.commit()

    async def _fail(self, doc_id: uuid.UUID, message: str, *, permanent: bool, attempts: int) -> None:
        final = permanent or attempts >= self.settings.worker_max_attempts
        backoff_s = 30 * (2 ** (attempts - 1))
        async with self.sessionmaker() as session:
            await session.execute(
                update(Document)
                .where(Document.id == doc_id)
                .values(
                    status=DocumentStatus.FAILED if final else DocumentStatus.QUEUED,
                    error=message,
                    progress=0,
                    processing_started_at=None,
                    next_attempt_at=text(f"now() + interval '{int(backoff_s)} seconds'"),
                )
            )
            await session.commit()
        logger.warning(
            "ingestion_attempt_failed",
            extra={"doc_id": str(doc_id), "attempt": attempts, "final": final, "error": message[:200]},
        )
