import uuid as _uuid
from datetime import datetime

from sqlalchemy import String, Text, Boolean, Integer, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.db.base import Base


class User(Base):
    """
    Represents a platform user.
    No auth logic — this is the schema-only layer.
    """
    __tablename__ = "users"

    id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )
    hashed_password: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    full_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        server_default=text("true"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # ── Relationships ──
    documents: Mapped[list["Document"]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    query_logs: Mapped[list["QueryLog"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r}>"


class Document(Base):
    """
    Tracks every uploaded document.
    Stores metadata only — vectors live in Qdrant.
    """
    __tablename__ = "documents"

    id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    doc_id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        unique=True,
        nullable=False,
        index=True,
        server_default=text("gen_random_uuid()"),
        comment="Qdrant document identifier — the UUID used in vector payloads",
    )
    owner_id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )
    content_type: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )
    file_size_bytes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    chunk_count: Mapped[int] = mapped_column(
        Integer,
        server_default=text("0"),
        nullable=False,
    )
    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        server_default=text("false"),
        nullable=False,
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # ── Relationships ──
    owner: Mapped["User"] = relationship(
        back_populates="documents",
    )
    query_logs: Mapped[list["QueryLog"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Document id={self.id} doc_id={self.doc_id} filename={self.filename!r}>"


class QueryLog(Base):
    """
    Logs every RAG query for analytics and auditing.
    """
    __tablename__ = "query_logs"

    id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    question: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    answer: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    chunks_retrieved: Mapped[int] = mapped_column(
        Integer,
        server_default=text("0"),
        nullable=False,
    )
    latency_ms: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # ── Relationships ──
    user: Mapped["User"] = relationship(
        back_populates="query_logs",
    )
    document: Mapped["Document | None"] = relationship(
        back_populates="query_logs",
    )

    def __repr__(self) -> str:
        return f"<QueryLog id={self.id} question={self.question[:40]!r}>"
