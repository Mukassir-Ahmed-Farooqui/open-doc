import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session

from src.models.responses import UploadResponse
from src.services.upload_service import ingest_uploaded_pdf
from src.auth import get_current_user
from src.db import get_db
from src.db.models import User, Document

router = APIRouter()


@router.post("", response_model=UploadResponse)
def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are currently supported.",
        )

    try:
        result = ingest_uploaded_pdf(file)
        
        # Save to PostgreSQL
        new_doc = Document(
            doc_id=uuid.UUID(result["doc_id"]),
            owner_id=current_user.id,
            filename=result["filename"],
            content_type=file.content_type,
            file_size_bytes=result.get("file_size"),
            chunk_count=result.get("sections", 0),
            num_pages=result.get("num_pages", 1),
        )
        db.add(new_doc)
        db.commit()
        
        return UploadResponse(**result)

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )
