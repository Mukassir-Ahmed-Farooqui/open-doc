from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from src.services.document_service import (
    list_documents,
    delete_document,
)
from src.auth import get_current_user
from src.db import get_db
from src.db.models import User

router = APIRouter()


@router.get("")
def get_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return list_documents(db=db, user_id=current_user.id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.delete("/{doc_id}")
def remove_document(
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return delete_document(db=db, doc_id=doc_id, user_id=current_user.id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )
