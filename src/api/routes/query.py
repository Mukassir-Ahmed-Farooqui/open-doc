import time
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from src.api.dependencies import get_rag_pipeline
from src.chain import LegalRAG
from src.models.requests import QueryRequest
from src.models.responses import QueryResponse
from src.auth import get_current_user
from src.db import get_db
from src.db.models import User, Document
from src.services import audit_service

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
    start_time = time.perf_counter()
    document_id_db = None
    try:
        allowed_doc_ids = []
        if not request.selected_doc_ids:
            # Fetch all active documents owned by this user
            user_docs = db.query(Document).filter(
                Document.owner_id == current_user.id,
                Document.is_deleted == False
            ).all()

            if not user_docs:
                answer = "You have not uploaded any documents yet. Please upload a PDF before querying."
                latency_ms = int((time.perf_counter() - start_time) * 1000)
                audit_service.log_query(
                    db=db,
                    user_id=current_user.id,
                    question=request.question,
                    answer=answer,
                    chunks_retrieved=0,
                    latency_ms=latency_ms,
                    document_id=None,
                )
                return QueryResponse(
                    answer=answer,
                    citations=[],
                )

            allowed_doc_ids = [str(d.doc_id) for d in user_docs]
            document_id_db = None
        else:
            for doc_id_str in request.selected_doc_ids:
                try:
                    target_uuid = uuid.UUID(doc_id_str)
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid doc_id format: {doc_id_str}",
                    )

                # Check if document exists regardless of owner
                doc = db.query(Document).filter(
                    Document.doc_id == target_uuid,
                    Document.is_deleted == False
                ).first()

                if not doc:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Document {doc_id_str} not found.",
                    )

                # Check ownership
                if doc.owner_id != current_user.id:
                    latency_ms = int((time.perf_counter() - start_time) * 1000)
                    audit_service.log_auth_failure(
                        db=db,
                        user_id=current_user.id,
                        attempted_doc_id=doc_id_str,
                        reason="Ownership denied. You do not own this document.",
                        latency_ms=latency_ms,
                        action="QUERY",
                    )
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Ownership denied. You do not own this document.",
                    )

                allowed_doc_ids.append(str(doc.doc_id))

            if len(allowed_doc_ids) == 1:
                first_doc = db.query(Document).filter(
                    Document.doc_id == uuid.UUID(allowed_doc_ids[0]),
                    Document.is_deleted == False
                ).first()
                if first_doc:
                    document_id_db = first_doc.id

        result = rag.ask(request.question, selected_doc_ids=allowed_doc_ids)
        latency_ms = int((time.perf_counter() - start_time) * 1000)

        # Log successful query
        audit_service.log_query(
            db=db,
            user_id=current_user.id,
            question=request.question,
            answer=result["answer"],
            chunks_retrieved=result["chunks_retrieved_count"],
            latency_ms=latency_ms,
            document_id=document_id_db,
        )

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

