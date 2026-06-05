from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv
from typing import Generator
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session and ensures cleanup."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Initialize the database:
    1. Enable uuid-ossp extension for gen_random_uuid().
    2. Run ALTER TABLE migrations to ensure columns exist.
    3. Create all tables from Base metadata.
    """
    from src.db.base import Base
    # Import models so Base.metadata knows about them
    import src.db.models  # noqa: F401

    with engine.begin() as conn:
        conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
        conn.execute(text('ALTER TABLE chats ADD COLUMN IF NOT EXISTS selected_doc_ids JSONB DEFAULT \'[]\'::jsonb;'))
        conn.execute(text('ALTER TABLE documents ADD COLUMN IF NOT EXISTS num_pages INTEGER DEFAULT 1;'))

    Base.metadata.create_all(bind=engine)
