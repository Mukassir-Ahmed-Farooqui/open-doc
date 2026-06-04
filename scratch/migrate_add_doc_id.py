"""Migrate: Add doc_id column to documents table."""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text
from src.db.database import engine

with engine.begin() as conn:
    # Add column if it doesn't exist
    conn.execute(text(
        "ALTER TABLE documents "
        "ADD COLUMN IF NOT EXISTS doc_id UUID NOT NULL DEFAULT gen_random_uuid()"
    ))
    # Create unique index
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_documents_doc_id ON documents (doc_id)"
    ))

print("Migration complete: doc_id column added with unique index")
