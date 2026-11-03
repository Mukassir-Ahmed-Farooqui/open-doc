from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator


def _bcrypt_limit(v: str) -> str:
    if len(v.encode("utf-8")) > 72:
        raise ValueError("password must be at most 72 bytes")
    return v


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str | None = Field(None, min_length=1, max_length=255)

    _pw = field_validator("password")(_bcrypt_limit)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


class RegisterResponse(BaseModel):
    message: str = "user created"
    user_id: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105
    expires_in: int


class UserUpdateRequest(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=255)


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None
    created_at: str
