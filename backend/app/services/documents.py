"""Document operations. Every query is scoped by ``owner_id``."""

from __future__ import annotations

import hashlib
import logging
import uuid

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chat, Document, DocumentStatus, Section
from app.errors import AppError, not_found
from app.ingestion.parsers import SUPPORTED_TYPES, ParseError, detect_type
from app.schemas.documents import DocumentResponse
from app.storage import ObjectNotFoundError, ObjectStorage

logger = logging.getLogger(__name__)


def to_response(doc: Document) -> dict:
    return DocumentResponse(
        doc_id=str(doc.id),
        filename=doc.filename,
        content_type=doc.content_type,
        file_size_bytes=doc.file_size_bytes,
        status=doc.status,
        progress=doc.progress,
        error=doc.error,
        num_pages=doc.num_pages,
        section_count=doc.section_count,
        chunk_count=doc.chunk_count,
        created_at=doc.created_at.isoformat(),
        updated_at=doc.updated_at.isoformat(),
    ).model_dump()


def safe_filename(name: str | None) -> str:
    """Display name only (never used as a storage path): strip directories and control chars."""
    base = (name or "document").replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in base if ch.isprintable()).strip()
    return base[:255] or "document"


async def list_documents(session: AsyncSession, owner_id: uuid.UUID) -> list[Document]:
    rows = await session.execute(
        select(Document).where(Document.owner_id == owner_id).order_by(Document.created_at.desc())
    )
    return list(rows.scalars())


async def get_document(session: AsyncSession, owner_id: uuid.UUID, doc_id: uuid.UUID) -> Document:
    doc = (
        await session.execute(select(Document).where(Document.id == doc_id, Document.owner_id == owner_id))
    ).scalar_one_or_none()
    if doc is None:
        raise not_found("Document")
    return doc


async def create_document(
    session: AsyncSession,
    storage: ObjectStorage,
    owner_id: uuid.UUID,
    filename: str,
    data: bytes,
) -> tuple[Document, bool]:
    """Store the file and enqueue ingestion. Returns (document, is_duplicate)."""
    display_name = safe_filename(filename)
    try:
        ext = detect_type(display_name, data)
    except ParseError as exc:
        raise AppError(415, str(exc)) from None
    if not data:
        raise AppError(400, "Uploaded file is empty")

    digest = hashlib.sha256(data).hexdigest()
    existing = (
        await session.execute(
            select(Document).where(Document.owner_id == owner_id, Document.content_hash == digest)
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Same bytes again: if the stored object went missing (e.g. a wiped local dir),
        # re-uploading repairs it instead of returning a document whose file is gone.
        try:
            await storage.get(existing.storage_key)
        except ObjectNotFoundError:
            await storage.put(existing.storage_key, data, existing.content_type)
            logger.warning("storage_object_restored", extra={"doc_id": str(existing.id)})
        if existing.status == DocumentStatus.FAILED:
            existing.status = DocumentStatus.QUEUED
            existing.attempts = 0
            existing.error = None
            existing.next_attempt_at = func.now()
            await session.commit()
            await session.refresh(existing)
        return existing, True

    doc_id = uuid.uuid4()
    storage_key = f"documents/{doc_id.hex}"
    await storage.put(storage_key, data, SUPPORTED_TYPES[ext])
    doc = Document(
        id=doc_id,
        owner_id=owner_id,
        filename=display_name,
        content_type=SUPPORTED_TYPES[ext],
        file_size_bytes=len(data),
        storage_key=storage_key,
        content_hash=digest,
    )
    session.add(doc)
    try:
        await session.commit()
    except IntegrityError:
        # Concurrent upload of the same bytes by the same user: keep the first one.
        await session.rollback()
        await storage.delete(storage_key)
        existing = (
            await session.execute(
                select(Document).where(Document.owner_id == owner_id, Document.content_hash == digest)
            )
        ).scalar_one()
        return existing, True
    await session.refresh(doc)
    return doc, False


async def delete_document(
    session: AsyncSession, storage: ObjectStorage, owner_id: uuid.UUID, doc_id: uuid.UUID
) -> None:
    doc = await get_document(session, owner_id, doc_id)
    key = doc.storage_key
    await session.execute(delete(Document).where(Document.id == doc_id, Document.owner_id == owner_id))
    # Remove the id from this user's chat workspaces.
    await session.execute(
        update(Chat)
        .where(Chat.user_id == owner_id, Chat.selected_doc_ids.contains([str(doc_id)]))
        .values(selected_doc_ids=Chat.selected_doc_ids.op("-")(str(doc_id)))
    )
    await session.commit()
    try:
        await storage.delete(key)
    except Exception:
        logger.exception("storage_delete_failed", extra={"doc_id": str(doc_id)})


async def resolve_owned_ids(session: AsyncSession, owner_id: uuid.UUID, raw_ids: list[str]) -> list[str]:
    """Validate ids are UUIDs owned by the user. Unknown or foreign ids -> 404 (no existence leak)."""
    ids: list[uuid.UUID] = []
    for raw in dict.fromkeys(raw_ids):
        try:
            ids.append(uuid.UUID(raw))
        except (ValueError, AttributeError, TypeError):
            raise AppError(400, f"Invalid document id: {raw}") from None
    if not ids:
        return []
    found = set(
        (
            await session.execute(
                select(Document.id).where(Document.owner_id == owner_id, Document.id.in_(ids))
            )
        ).scalars()
    )
    missing = [str(i) for i in ids if i not in found]
    if missing:
        raise AppError(404, "Document not found", details={"doc_ids": missing})
    return [str(i) for i in ids]


async def count_documents(session: AsyncSession, owner_id: uuid.UUID) -> int:
    return int(
        (await session.execute(select(func.count()).where(Document.owner_id == owner_id))).scalar_one()
    )


async def ready_subset(session: AsyncSession, owner_id: uuid.UUID, ids: list[str]) -> list[uuid.UUID]:
    """Of the given ids, those owned by the user and ready for querying (existing order kept)."""
    if not ids:
        return []
    wanted = [uuid.UUID(i) for i in ids]
    ready = set(
        (
            await session.execute(
                select(Document.id).where(
                    Document.owner_id == owner_id,
                    Document.id.in_(wanted),
                    Document.status == DocumentStatus.READY,
                )
            )
        ).scalars()
    )
    return [i for i in wanted if i in ready]


async def section_openings(
    session: AsyncSession, owner_id: uuid.UUID, doc_id: uuid.UUID
) -> list[tuple[str, str]]:
    rows = await session.execute(
        select(Section.heading_path, Section.text)
        .where(Section.owner_id == owner_id, Section.document_id == doc_id)
        .order_by(Section.ord)
    )
    return [(r.heading_path, r.text) for r in rows]
