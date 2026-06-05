from pathlib import Path
import uuid
from fastapi import UploadFile

from src.ingestion.parser import parse_pdf
from src.ingestion.chunker import chunk_document
from src.storage.qdrant_store import (
    COLLECTION_SECTIONS,
    COLLECTION_SENTENCES,
    get_client,
    get_embedder,
    upsert_chunks,
)


UPLOAD_DIR = Path("data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def ingest_uploaded_pdf(file: UploadFile) -> dict:

    file_path = UPLOAD_DIR / file.filename

    with open(file_path, "wb") as buffer:
        buffer.write(file.file.read())

    client = get_client()
    model = get_embedder()

    doc_id = str(uuid.uuid4())
    parsed = parse_pdf(file_path, doc_id=doc_id)

    sections, sentences = chunk_document(
        parsed.elements,
        parsed.doc_id,
        parsed.filename,
    )

    from src.ingestion.summarizer import generate_summary_for_document
    doc_summary = generate_summary_for_document(sections)
    
    for s in sections:
        s.document_summary = doc_summary
    for sent in sentences:
        sent.document_summary = doc_summary


    n_sections = upsert_chunks(
        client,
        model,
        sections,
        COLLECTION_SECTIONS,
    )

    n_sentences = upsert_chunks(
        client,
        model,
        sentences,
        COLLECTION_SENTENCES,
    )

    file_size = file_path.stat().st_size

    return {
        "doc_id": parsed.doc_id,
        "filename": parsed.filename,
        "sections": n_sections,
        "sentences": n_sentences,
        "file_size": file_size,
        "num_pages": parsed.num_pages,
        "status": "indexed",
    }
