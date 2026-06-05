from pydantic import BaseModel, Field
from typing import Optional, List


class QueryRequest(BaseModel):
    question: str = Field(
        ...,
        description="The question to ask the legal RAG pipeline.",
    )
    selected_doc_ids: List[str] = Field(
        default_factory=list,
        description="List of document IDs to restrict retrieval to specific documents.",
    )


class ChatCreateRequest(BaseModel):
    selected_doc_ids: Optional[List[str]] = Field(
        default_factory=list,
        description="List of document IDs to scope this chat session to."
    )


class ChatRenameRequest(BaseModel):
    title: str = Field(..., description="New title of the chat session")


class ChatDocumentsUpdateRequest(BaseModel):
    selected_doc_ids: List[str] = Field(
        default_factory=list,
        description="List of document IDs to update in this chat workspace."
    )


class MessageCreateRequest(BaseModel):
    question: str = Field(..., description="User question to ask")
