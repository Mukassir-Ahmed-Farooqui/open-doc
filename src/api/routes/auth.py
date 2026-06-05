"""
Authentication routes: register and login.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.auth.schemas import RegisterRequest, LoginRequest, TokenResponse
from src.auth.security import hash_password, verify_password
from src.auth.jwt import create_access_token
from src.db.database import get_db
from src.db.models import User
from src.auth import get_current_user

router = APIRouter()


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=dict,
    summary="Register a new user",
)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """
    Create a new user account.

    - Validates email format (via Pydantic EmailStr)
    - Checks for duplicate email → 409
    - Hashes password with bcrypt
    - Creates user row
    """
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"message": "user created", "user_id": str(user.id)}


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login and receive JWT",
)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate a user and return a JWT access token.

    - Finds user by email
    - Verifies password → 401 on mismatch
    - Issues signed JWT with sub + email claims
    """
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated",
        )

    access_token = create_access_token(
        user_id=str(user.id),
        email=user.email,
    )

    return TokenResponse(access_token=access_token)


@router.get(
    "/me",
    summary="Get current user details",
)
def get_me(current_user: User = Depends(get_current_user)):
    """
    Get email, full name, and creation date of the current logged-in user.
    """
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "full_name": current_user.full_name,
        "created_at": current_user.created_at.isoformat(),
    }
