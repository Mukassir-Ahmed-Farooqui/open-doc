from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Citation(BaseModel):
    source_id: str = Field(..., description="Marker used in the answer text, e.g. 'S1'")
    doc_id: str
    document: str = Field(..., description="Filename of the source document")
    page: int
    section: str
    snippet: str
    preview: str = Field(..., description="Deprecated alias of snippet, kept for older clients")
    score: float | None = None


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    selected_doc_ids: list[str] = Field(default_factory=list)


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    model: str | None = None
    abstained: bool = False
    query_type: str = "fact"


class ChatCreateRequest(BaseModel):
    selected_doc_ids: list[str] | None = Field(default_factory=list)


class ChatRenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)


class ChatDocumentsUpdateRequest(BaseModel):
    selected_doc_ids: list[str] = Field(default_factory=list)


SummaryStyle = Literal["executive", "detailed", "highlights"]


class MessageCreateRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    summary_style: SummaryStyle | None = "executive"


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    citations: list[Citation] | None = None
    latency_ms: int | None = None
    timestamp: str
    model: str | None = None


class ChatResponse(BaseModel):
    id: str
    title: str
    selected_doc_ids: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ChatDetailResponse(ChatResponse):
    messages: list[MessageResponse] = Field(default_factory=list)


class StatusResponse(BaseModel):
    status: str
    message: str | None = None
