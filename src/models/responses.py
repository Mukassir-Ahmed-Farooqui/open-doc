from pydantic import BaseModel, Field
from typing import List, Optional


class Citation(BaseModel):
    document: str = Field(..., description="The filename of the source document.")
    page: int = Field(..., description="The page number of the source document.")
    section: str = Field(..., description="The section heading of the citation.")


class QueryResponse(BaseModel):
    answer: str = Field(
        ...,
        description="The generated answer from the legal RAG model.",
    )
    citations: List[Citation] = Field(
        default_factory=list,
        description="The source citations used to answer the question.",
    )


class HealthResponse(BaseModel):
    status: str = Field(..., description="Overall API service health status.")
    version: str = Field(..., description="API software version.")
    qdrant_status: str = Field(
        ...,
        description="Connectivity status to the Qdrant vector database.",
    )


class UploadResponse(BaseModel):
    doc_id: str
    filename: str
    sections: int
    sentences: int
    num_pages: int
    status: str


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    citations: Optional[List[Citation]] = None
    latency_ms: Optional[int] = None
    timestamp: str


class ChatResponse(BaseModel):
    id: str
    title: str
    selected_doc_ids: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ChatDetailResponse(BaseModel):
    id: str
    title: str
    selected_doc_ids: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str
    messages: List[MessageResponse] = []


class StatusResponse(BaseModel):
    status: str
    message: Optional[str] = None

