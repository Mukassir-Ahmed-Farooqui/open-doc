import time
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from src.auth import get_current_user
from src.db import get_db
from src.db.models import User, Chat, Message, Document
from src.models.requests import (
    ChatCreateRequest,
    ChatRenameRequest,
    ChatDocumentsUpdateRequest,
    MessageCreateRequest,
)
from src.models.responses import (
    ChatResponse,
    ChatDetailResponse,
    MessageResponse,
    StatusResponse,
    Citation,
)
from src.api.dependencies import get_rag_pipeline
from src.chain import LegalRAG
from src.services import audit_service
from src.llm.groq_client import generate
from src.db.database import SessionLocal

router = APIRouter()


def generate_chat_title_async(chat_id: str, first_message: str):
    """
    Background task to generate a concise 4-6 word title using Groq
    after the first user message, with zero inline latency.
    """
    db = SessionLocal()
    try:
        chat_uuid = uuid.UUID(chat_id)
        chat = db.query(Chat).filter(Chat.id == chat_uuid).first()
        if chat and chat.title == "New Chat":
            prompt = f"Convert this user question into a concise 4-6 word chat title.\n\nReturn only the title.\n\nQuestion:\n{first_message}"
            new_title = generate(prompt).strip()
            if new_title.startswith('"') and new_title.endswith('"'):
                new_title = new_title[1:-1].strip()
            if new_title.startswith("'") and new_title.endswith("'"):
                new_title = new_title[1:-1].strip()
            chat.title = new_title
            chat.updated_at = func.now()
            db.commit()
    except Exception as e:
        print(f"Failed to generate async chat title: {e}")
    finally:
        db.close()


@router.get("", response_model=List[ChatResponse])
def list_chats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List all chat sessions owned by the current user, ordered by updated_at DESC.
    """
    try:
        chats = (
            db.query(Chat)
            .filter(Chat.user_id == current_user.id)
            .order_by(Chat.updated_at.desc())
            .all()
        )
        return [
            ChatResponse(
                id=str(c.id),
                title=c.title,
                selected_doc_ids=[str(doc_id) for doc_id in (c.selected_doc_ids or [])],
                created_at=c.created_at.isoformat(),
                updated_at=c.updated_at.isoformat(),
            )
            for c in chats
        ]
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list chats: {str(e)}",
        )


@router.post("", response_model=ChatResponse, status_code=status.HTTP_201_CREATED)
def create_chat(
    request: ChatCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a new empty chat session scoped to specific documents.
    """
    try:
        validated_ids = []
        if request.selected_doc_ids:
            for doc_id_str in request.selected_doc_ids:
                try:
                    doc_uuid = uuid.UUID(doc_id_str)
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid document UUID: {doc_id_str}",
                    )
                doc = db.query(Document).filter(
                    Document.doc_id == doc_uuid,
                    Document.is_deleted == False
                ).first()
                if not doc:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Document {doc_id_str} not found.",
                    )
                if doc.owner_id != current_user.id:
                    raise HTTPException(
                        status_code=403,
                        detail="Ownership denied. You do not own this document.",
                    )
                validated_ids.append(str(doc.doc_id))

        new_chat = Chat(
            user_id=current_user.id,
            title="New Chat",
            selected_doc_ids=validated_ids,
        )
        db.add(new_chat)
        db.commit()
        db.refresh(new_chat)

        return ChatResponse(
            id=str(new_chat.id),
            title=new_chat.title,
            selected_doc_ids=[str(doc_id) for doc_id in (new_chat.selected_doc_ids or [])],
            created_at=new_chat.created_at.isoformat(),
            updated_at=new_chat.updated_at.isoformat(),
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create chat: {str(e)}",
        )


@router.get("/{chat_id}", response_model=ChatDetailResponse)
def get_chat_detail(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Load chat metadata and all sorted messages (timestamp ASC).
    """
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid chat_id format.",
        )

    chat = db.query(Chat).filter(Chat.id == chat_uuid).first()
    if not chat:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found.",
        )

    # Multi-tenant ownership verification
    if chat.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Ownership denied. You do not own this chat session.",
        )

    messages_resp = []
    for msg in chat.messages:
        citations_resp = None
        if msg.citations:
            citations_resp = [
                Citation(
                    document=c.get("document", ""),
                    page=c.get("page", 1),
                    section=c.get("section", ""),
                )
                for c in msg.citations
            ]
        messages_resp.append(
            MessageResponse(
                id=str(msg.id),
                role=msg.role,
                content=msg.content,
                citations=citations_resp,
                latency_ms=msg.latency_ms,
                timestamp=msg.timestamp.isoformat(),
            )
        )

    return ChatDetailResponse(
        id=str(chat.id),
        title=chat.title,
        selected_doc_ids=[str(doc_id) for doc_id in (chat.selected_doc_ids or [])],
        created_at=chat.created_at.isoformat(),
        updated_at=chat.updated_at.isoformat(),
        messages=messages_resp,
    )


@router.patch("/{chat_id}", response_model=ChatResponse)
def rename_chat(
    chat_id: str,
    request: ChatRenameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Rename the title of a chat session.
    """
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid chat_id format.",
        )

    chat = db.query(Chat).filter(Chat.id == chat_uuid).first()
    if not chat:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found.",
        )

    if chat.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Ownership denied. You do not own this chat session.",
        )

    try:
        chat.title = request.title
        chat.updated_at = func.now()
        db.commit()
        db.refresh(chat)

        return ChatResponse(
            id=str(chat.id),
            title=chat.title,
            selected_doc_ids=[str(doc_id) for doc_id in (chat.selected_doc_ids or [])],
            created_at=chat.created_at.isoformat(),
            updated_at=chat.updated_at.isoformat(),
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to rename chat: {str(e)}",
        )


@router.patch("/{chat_id}/documents", response_model=ChatResponse)
def update_chat_documents(
    chat_id: str,
    request: ChatDocumentsUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update the list of selected document IDs for a chat session.
    """
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid chat_id format.",
        )

    chat = db.query(Chat).filter(Chat.id == chat_uuid).first()
    if not chat:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found.",
        )

    if chat.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Ownership denied. You do not own this chat session.",
        )

    try:
        validated_ids = []
        if request.selected_doc_ids:
            for doc_id_str in request.selected_doc_ids:
                try:
                    doc_uuid = uuid.UUID(doc_id_str)
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid document UUID: {doc_id_str}",
                    )
                doc = db.query(Document).filter(
                    Document.doc_id == doc_uuid,
                    Document.is_deleted == False
                ).first()
                if not doc:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Document {doc_id_str} not found.",
                    )
                if doc.owner_id != current_user.id:
                    raise HTTPException(
                        status_code=403,
                        detail="Ownership denied. You do not own this document.",
                    )
                validated_ids.append(str(doc.doc_id))

        chat.selected_doc_ids = validated_ids
        chat.updated_at = func.now()
        db.commit()
        db.refresh(chat)

        return ChatResponse(
            id=str(chat.id),
            title=chat.title,
            selected_doc_ids=[str(doc_id) for doc_id in (chat.selected_doc_ids or [])],
            created_at=chat.created_at.isoformat(),
            updated_at=chat.updated_at.isoformat(),
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update chat workspace: {str(e)}",
        )


@router.delete("/{chat_id}", response_model=StatusResponse)
def delete_chat(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Delete a chat session and cascade delete all its messages.
    """
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid chat_id format.",
        )

    chat = db.query(Chat).filter(Chat.id == chat_uuid).first()
    if not chat:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found.",
        )

    if chat.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Ownership denied. You do not own this chat session.",
        )

    try:
        db.delete(chat)
        db.commit()
        return StatusResponse(
            status="success",
            message="Chat session deleted successfully.",
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete chat: {str(e)}",
        )


def _format_history_block(messages: List[Message], max_chars: int = 6000) -> str:
    """
    Formats messages list into:
    User: [Question]
    Assistant: [Answer]
    Ensures the history block fits within character token constraints.
    """
    lines = []
    for msg in messages:
        role_label = "User" if msg.role == "user" else "Assistant"
        lines.append(f"{role_label}: {msg.content}")
    block = "\n".join(lines)
    return block


@router.post("/{chat_id}/messages", response_model=MessageResponse)
def create_message(
    chat_id: str,
    request: MessageCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    rag: LegalRAG = Depends(get_rag_pipeline),
):
    """
    Post a user question under a chat session, retrieve previous context turns,
    validate document selections, run RAG, and persist user/assistant dialog turn.
    """
    start_time = time.perf_counter()
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid chat_id format.",
        )

    chat = db.query(Chat).filter(Chat.id == chat_uuid).first()
    if not chat:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found.",
        )

    if chat.user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Ownership denied. You do not own this chat session.",
        )

    allowed_doc_ids = []
    document_id_db = None

    # Load active workspace documents and validate
    if not chat.selected_doc_ids:
        # Corpus mode: retrieve all active documents owned by the user
        user_docs = (
            db.query(Document)
            .filter(Document.owner_id == current_user.id, Document.is_deleted == False)
            .all()
        )
        if not user_docs:
            # Short-circuit if user has no documents uploaded
            answer = "You have not uploaded any documents yet. Please upload a PDF before querying."
            latency_ms = int((time.perf_counter() - start_time) * 1000)

            try:
                # Check if this is first message to trigger title generation
                is_first = db.query(Message).filter(Message.chat_id == chat.id).count() == 0

                user_msg = Message(
                    chat_id=chat.id, role="user", content=request.question
                )
                db.add(user_msg)

                if is_first:
                    background_tasks.add_task(generate_chat_title_async, str(chat.id), request.question)

                chat.updated_at = func.now()
                db.flush()

                assistant_msg = Message(
                    chat_id=chat.id,
                    role="assistant",
                    content=answer,
                    citations=[],
                    latency_ms=latency_ms,
                )
                db.add(assistant_msg)
                db.commit()
                db.refresh(assistant_msg)

                # Log to query audit log
                audit_service.log_query(
                    db=db,
                    user_id=current_user.id,
                    question=request.question,
                    answer=answer,
                    chunks_retrieved=0,
                    latency_ms=latency_ms,
                    document_id=None,
                )

                return MessageResponse(
                    id=str(assistant_msg.id),
                    role=assistant_msg.role,
                    content=assistant_msg.content,
                    citations=[],
                    latency_ms=assistant_msg.latency_ms,
                    timestamp=assistant_msg.timestamp.isoformat(),
                )
            except Exception as e:
                db.rollback()
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to handle empty documents state transaction: {str(e)}",
                )

        allowed_doc_ids = [str(d.doc_id) for d in user_docs]
    else:
        # Validate that all selected documents still exist and are owned by the user
        for doc_id_str in chat.selected_doc_ids:
            try:
                doc_uuid = uuid.UUID(doc_id_str)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid document UUID: {doc_id_str}",
                )
            doc = db.query(Document).filter(
                Document.doc_id == doc_uuid,
                Document.is_deleted == False
            ).first()
            if not doc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Document {doc_id_str} not found or has been deleted.",
                )
            if doc.owner_id != current_user.id:
                raise HTTPException(
                    status_code=403,
                    detail="Ownership denied. You do not own all selected documents.",
                )
            allowed_doc_ids.append(str(doc.doc_id))

        if len(allowed_doc_ids) == 1:
            first_doc = db.query(Document).filter(
                Document.doc_id == uuid.UUID(allowed_doc_ids[0]),
                Document.is_deleted == False
            ).first()
            if first_doc:
                document_id_db = first_doc.id

    # Check if this is the first message in the chat before inserting
    is_first_msg = (
        db.query(Message)
        .filter(Message.chat_id == chat.id)
        .count() == 0
    )

    # Save User Message & Update Title inside a single database transaction.
    try:
        user_msg = Message(chat_id=chat.id, role="user", content=request.question)
        db.add(user_msg)

        if is_first_msg:
            background_tasks.add_task(generate_chat_title_async, str(chat.id), request.question)

        chat.updated_at = func.now()
        db.commit()
        db.refresh(chat)
        db.refresh(user_msg)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to record message turn: {str(e)}",
        )

    # Conversational History windowing
    history_messages = (
        db.query(Message)
        .filter(Message.chat_id == chat.id, Message.id != user_msg.id)
        .order_by(Message.timestamp.desc())
        .limit(6)
        .all()
    )
    history_messages.reverse()

    chat_history_str = _format_history_block(history_messages)
    if len(chat_history_str) > 6000:
        trimmed_messages = (
            db.query(Message)
            .filter(Message.chat_id == chat.id, Message.id != user_msg.id)
            .order_by(Message.timestamp.desc())
            .limit(4)
            .all()
        )
        trimmed_messages.reverse()
        chat_history_str = _format_history_block(trimmed_messages)

    # Run LegalRAG Pipeline
    try:
        result = rag.ask(
            request.question, selected_doc_ids=allowed_doc_ids, chat_history=chat_history_str
        )
        latency_ms = int((time.perf_counter() - start_time) * 1000)

        # Save assistant message response
        assistant_msg = Message(
            chat_id=chat.id,
            role="assistant",
            content=result["answer"],
            citations=result["citations"],
            latency_ms=latency_ms,
        )
        db.add(assistant_msg)
        chat.updated_at = func.now()
        db.commit()
        db.refresh(assistant_msg)

        # Log to query audit logs
        audit_service.log_query(
            db=db,
            user_id=current_user.id,
            question=request.question,
            answer=result["answer"],
            chunks_retrieved=result["chunks_retrieved_count"],
            latency_ms=latency_ms,
            document_id=document_id_db,
        )

        citations_resp = [
            Citation(
                document=c.get("document", ""),
                page=c.get("page", 1),
                section=c.get("section", ""),
            )
            for c in result.get("citations", [])
        ]

        return MessageResponse(
            id=str(assistant_msg.id),
            role=assistant_msg.role,
            content=assistant_msg.content,
            citations=citations_resp,
            latency_ms=assistant_msg.latency_ms,
            timestamp=assistant_msg.timestamp.isoformat(),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while generating RAG response: {str(e)}",
        )
