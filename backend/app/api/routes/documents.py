"""Upload, list, status, download, delete and (lazy) summary of documents."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, File, UploadFile, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_rag, get_session, get_storage, get_worker, parse_uuid
from app.config import Settings, get_settings
from app.db.models import DocumentStatus, User
from app.errors import AppError
from app.generation.service import LLMNotConfiguredError, RAGService
from app.ingestion.worker import IngestionWorker
from app.providers.llm import LLMError
from app.ratelimit import rate_limit
from app.schemas.documents import DeleteResponse, DocumentResponse, SummaryResponse, UploadResponse
from app.services import documents as svc
from app.storage import ObjectNotFoundError, ObjectStorage

router = APIRouter(tags=["documents"])

_READ_CHUNK = 1024 * 1024


@router.post(
    "/upload",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=UploadResponse,
    dependencies=[Depends(rate_limit("rate_limit_upload"))],
)
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage: ObjectStorage = Depends(get_storage),
    worker: IngestionWorker = Depends(get_worker),
    settings: Settings = Depends(get_settings),
) -> JSONResponse:
    """Store the file and queue it for ingestion. Returns 202 immediately; poll
    ``GET /documents/{doc_id}`` for ``status`` / ``progress``. Re-uploading identical bytes
    returns the existing document with ``duplicate: true`` (200)."""
    buf = bytearray()
    while chunk := await file.read(_READ_CHUNK):
        buf.extend(chunk)
        if len(buf) > settings.max_upload_bytes:
            raise AppError(413, f"File exceeds the {settings.max_upload_mb} MB limit")
    doc, duplicate = await svc.create_document(session, storage, user.id, file.filename or "", bytes(buf))
    if doc.status == DocumentStatus.QUEUED:
        worker.notify()
    body = svc.to_response(doc) | {"duplicate": duplicate}
    return JSONResponse(body, status_code=200 if duplicate else 202)


@router.get("/documents", response_model=list[DocumentResponse])
async def list_documents(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> list[dict]:
    return [svc.to_response(d) for d in await svc.list_documents(session, user.id)]


@router.get("/documents/{doc_id}", response_model=DocumentResponse)
async def get_document(
    doc_id: str, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> dict:
    return svc.to_response(await svc.get_document(session, user.id, parse_uuid(doc_id, "doc_id")))


@router.get("/documents/{doc_id}/download")
async def download_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage: ObjectStorage = Depends(get_storage),
) -> Response:
    doc = await svc.get_document(session, user.id, parse_uuid(doc_id, "doc_id"))
    try:
        data = await storage.get(doc.storage_key)
    except ObjectNotFoundError:
        raise AppError(404, "File content is missing from storage") from None
    quoted = doc.filename.replace('"', "").encode("ascii", "ignore").decode() or "document"
    return Response(
        content=data,
        media_type=doc.content_type,
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{quoted}\"; filename*=UTF-8''{quote(doc.filename)}"
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/documents/{doc_id}", response_model=DeleteResponse)
async def delete_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage: ObjectStorage = Depends(get_storage),
) -> DeleteResponse:
    uid = parse_uuid(doc_id, "doc_id")
    await svc.delete_document(session, storage, user.id, uid)
    return DeleteResponse(doc_id=str(uid))


@router.get(
    "/documents/{doc_id}/summary",
    response_model=SummaryResponse,
    dependencies=[Depends(rate_limit("rate_limit_query"))],
)
async def document_summary(
    doc_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    rag: RAGService = Depends(get_rag),
) -> SummaryResponse:
    """Generated on first request with one LLM call, then cached on the document."""
    doc = await svc.get_document(session, user.id, parse_uuid(doc_id, "doc_id"))
    if doc.summary:
        return SummaryResponse(doc_id=str(doc.id), summary=doc.summary, model=None)
    if doc.status != DocumentStatus.READY:
        raise AppError(409, "Document is not ready yet")
    try:
        summary, model = await rag.document_summary(await svc.section_openings(session, user.id, doc.id))
    except LLMNotConfiguredError as exc:
        raise AppError(503, str(exc)) from None
    except LLMError:
        raise AppError(503, "The language model is unavailable, try again shortly") from None
    doc.summary = summary
    await session.commit()
    return SummaryResponse(doc_id=str(doc.id), summary=summary, model=model)
