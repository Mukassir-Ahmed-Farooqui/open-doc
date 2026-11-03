from __future__ import annotations

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    doc_id: str
    filename: str
    content_type: str
    file_size_bytes: int
    status: str
    progress: int
    error: str | None
    num_pages: int
    section_count: int
    chunk_count: int
    created_at: str
    updated_at: str


class UploadResponse(DocumentResponse):
    duplicate: bool = False


class DeleteResponse(BaseModel):
    status: str = "deleted"
    doc_id: str


class SummaryResponse(BaseModel):
    doc_id: str
    summary: str
    model: str | None
