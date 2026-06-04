import uuid
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from src.db.models import Document
from src.storage.qdrant_store import (
    get_client,
    COLLECTION_SECTIONS,
    COLLECTION_SENTENCES,
)
from qdrant_client.models import Filter, FieldCondition


def list_documents(db: Session, user_id: uuid.UUID):
    """
    List active documents belonging to the specified user.
    """
    docs = db.query(Document).filter(
        Document.owner_id == user_id,
        Document.is_deleted == False
    ).all()

    return [
        {
            "doc_id": str(doc.doc_id),
            "filename": doc.filename,
        }
        for doc in docs
    ]


def delete_document(db: Session, doc_id: str, user_id: uuid.UUID):
    """
    Soft-delete a document in PostgreSQL and remove vectors from Qdrant,
    verifying that the document belongs to the specified user.
    """
    try:
        doc_uuid = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid doc_id format. Must be a valid UUID.",
        )

    # Find the document
    doc = db.query(Document).filter(
        Document.doc_id == doc_uuid,
        Document.owner_id == user_id,
        Document.is_deleted == False
    ).first()

    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or not owned by user.",
        )

    # Soft delete in PostgreSQL
    doc.is_deleted = True
    db.commit()

    # Hard delete vectors from Qdrant
    client = get_client()
    doc_filter = Filter(
        must=[
            FieldCondition(
                key="doc_id",
                match={"value": doc_id},
            )
        ]
    )

    client.delete(
        collection_name=COLLECTION_SECTIONS,
        points_selector=doc_filter,
    )

    client.delete(
        collection_name=COLLECTION_SENTENCES,
        points_selector=doc_filter,
    )

    return {
        "status": "deleted",
        "doc_id": doc_id,
    }
