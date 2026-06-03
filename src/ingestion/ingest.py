"""
Ingestion pipeline: PDF → parse → chunk → embed → Qdrant.

Usage:
    python -m src.ingestion.ingest                  # ingest all PDFs in data/cuad/
    python -m src.ingestion.ingest --pdf path/to.pdf
    python -m src.ingestion.ingest --limit 10       # first N contracts only
"""

import argparse
from pathlib import Path

from src.ingestion.chunker import chunk_document
from src.ingestion.loader import download_cuad
from src.ingestion.parser import parse_pdf
from src.storage.qdrant_store import (
    COLLECTION_SECTIONS,
    COLLECTION_SENTENCES,
    get_client,
    get_embedder,
    init_collections,
    upsert_chunks,
)


def ingest_pdf(pdf_path: Path, client, model) -> tuple[int, int]:
    """Parse → chunk → upsert one PDF. Returns (n_sections, n_sentences)."""
    print(f"  parsing  {pdf_path.name}")
    parsed = parse_pdf(pdf_path)

    print(f"  chunking {len(parsed.elements)} elements")
    sections, sentences = chunk_document(parsed.elements, parsed.doc_id)

    print(f"  upserting {len(sections)} sections, {len(sentences)} sentences")
    n_s = upsert_chunks(client, model, sections, COLLECTION_SECTIONS)
    n_sent = upsert_chunks(client, model, sentences, COLLECTION_SENTENCES)

    return n_s, n_sent


def run(pdf_path: Path = None, limit: int = None) -> None:
    client = get_client()
    model = get_embedder()
    init_collections(client)

    if pdf_path:
        pdfs = [pdf_path]
    else:
        cuad_dir = download_cuad()
        pdfs = list(cuad_dir.rglob("*.pdf"))
        if limit:
            pdfs = pdfs[:limit]

    print(f"\n→ Ingesting {len(pdfs)} PDFs\n")
    total_s = total_sent = 0

    for i, pdf in enumerate(pdfs, 1):
        print(f"[{i}/{len(pdfs)}] {pdf.name}")
        n_s, n_sent = ingest_pdf(pdf, client, model)
        total_s += n_s
        total_sent += n_sent

    print(f"\n✓ Done — {total_s} sections, {total_sent} sentences in Qdrant")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=None)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    run(pdf_path=args.pdf, limit=args.limit)