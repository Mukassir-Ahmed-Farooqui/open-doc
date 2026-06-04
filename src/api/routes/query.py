import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from src.api.dependencies import get_rag_pipeline
from src.chain import LegalRAG
from src.models.requests import QueryRequest
from src.models.responses import QueryResponse
from src.auth import get_current_user
from src.db import get_db
from src.db.models import User, Document

router = APIRouter()


@router.post("", response_model=QueryResponse)
def query_rag(
    request: QueryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    rag: LegalRAG = Depends(get_rag_pipeline),
) -> QueryResponse:
    """
    Query the legal RAG pipeline with a specific question.
    Optionally restrict search to a specific document ID.
    """
    try:
        if request.doc_id:
            try:
                target_uuid = uuid.UUID(request.doc_id)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid doc_id format.",
                )

            # Check if document exists and is owned by the current user
            doc = db.query(Document).filter(
                Document.doc_id == target_uuid,
                Document.owner_id == current_user.id,
                Document.is_deleted == False
            ).first()

            if not doc:
                raise HTTPException(
                    status_code=404,
                    detail="Document not found.",
                )

            allowed_doc_ids = str(doc.doc_id)
        else:
            # Fetch all active documents owned by this user
            user_docs = db.query(Document).filter(
                Document.owner_id == current_user.id,
                Document.is_deleted == False
            ).all()

            if not user_docs:
                return QueryResponse(
                    answer="You have not uploaded any documents yet. Please upload a PDF before querying.",
                    citations=[],
                )

            allowed_doc_ids = [str(d.doc_id) for d in user_docs]

        result = rag.ask(request.question, doc_id=allowed_doc_ids)
        return QueryResponse(
            answer=result["answer"],
            citations=result["citations"],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing the request: {str(e)}",
        )

