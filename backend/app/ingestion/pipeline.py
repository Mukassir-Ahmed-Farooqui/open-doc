"""Turn one stored document into sections + embedded chunks.

Idempotent: a run replaces any sections/chunks previously written for the document inside a
single transaction, so a retried or re-run job never leaves duplicates. Within a document,
child passages with identical normalised text (running boilerplate, repeated clauses) are
stored once.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import PurePath

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.db.models import Chunk, Document, DocumentStatus, Section
from app.ingestion.chunking import STRATEGIES, ChunkingConfig, SectionDraft
from app.ingestion.parsers import ParseError, parse
from app.providers.embeddings import EmbeddingProvider
from app.storage import ObjectStorage

logger = logging.getLogger(__name__)


def chunking_config(settings: Settings) -> ChunkingConfig:
    return ChunkingConfig(
        child_target_tokens=settings.child_target_tokens,
        child_overlap_tokens=settings.child_overlap_tokens,
        child_min_tokens=settings.child_min_tokens,
        section_min_tokens=settings.section_min_tokens,
        parent_max_tokens=settings.parent_max_tokens,
    )


def embedding_text(section: SectionDraft, child_text: str) -> str:
    """Prefix the child with its nearest headings: cheap contextual retrieval."""
    path = " > ".join(section.heading_path.split(" > ")[-2:])
    return f"{path}\n{child_text}" if path else child_text


def build_drafts(filename: str, data: bytes, cfg: ChunkingConfig, strategy: str = "parent_child"):
    parsed = parse(filename, data)
    title = parsed.title or PurePath(filename).stem
    return parsed, STRATEGIES[strategy](parsed.blocks, title, cfg)


async def _set_progress(sm: async_sessionmaker[AsyncSession], doc_id: uuid.UUID, progress: int) -> None:
    async with sm() as session:
        await session.execute(update(Document).where(Document.id == doc_id).values(progress=progress))
        await session.commit()


async def ingest_document(
    *,
    doc_id: uuid.UUID,
    sessionmaker: async_sessionmaker[AsyncSession],
    storage: ObjectStorage,
    embedder: EmbeddingProvider,
    settings: Settings,
    strategy: str = "parent_child",
) -> None:
    """Parse, chunk, embed and persist. Raises on failure; the worker records the error."""
    async with sessionmaker() as session:
        doc = (await session.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        owner_id, filename, storage_key = doc.owner_id, doc.filename, doc.storage_key

    data = await storage.get(storage_key)
    try:
        parsed, drafts = await asyncio.wait_for(
            asyncio.to_thread(build_drafts, filename, data, chunking_config(settings), strategy),
            timeout=settings.parse_timeout_seconds,
        )
    except TimeoutError:
        raise ParseError("Processing this document took too long. Try a simpler or smaller file.") from None
    del data
    if parsed.num_pages > settings.max_pdf_pages and filename.lower().endswith(".pdf"):
        raise ParseError(f"Documents are limited to {settings.max_pdf_pages} pages during the beta.")
    if sum(len(b.text) for b in parsed.blocks) > settings.max_extracted_chars:
        raise ParseError("This document contains too much text for the beta limits.")
    await _set_progress(sessionmaker, doc_id, 25)

    # Deduplicate children within the document before spending compute on embeddings.
    seen: set[str] = set()
    plan: list[tuple[SectionDraft, list]] = []
    texts: list[str] = []
    for sec in drafts:
        kept = []
        for child in sec.children:
            if child.content_hash in seen:
                continue
            seen.add(child.content_hash)
            kept.append(child)
            texts.append(embedding_text(sec, child.text))
        plan.append((sec, kept))

    vectors: list[list[float]] = []
    batch = max(1, settings.embedding_batch_size)
    for i in range(0, len(texts), batch):
        vectors.extend(await embedder.embed_documents(texts[i : i + batch]))
        await _set_progress(
            sessionmaker, doc_id, 25 + int(65 * min(i + batch, len(texts)) / max(len(texts), 1))
        )

    async with sessionmaker() as session, session.begin():
        await session.execute(
            delete(Section).where(Section.document_id == doc_id, Section.owner_id == owner_id)
        )
        vec_iter = iter(vectors)
        n_sections = n_chunks = 0
        section_rows: list[tuple[Section, list]] = []
        for ord_, (sec, children) in enumerate(plan):
            section = Section(
                id=uuid.uuid4(),
                document_id=doc_id,
                owner_id=owner_id,
                ord=ord_,
                heading=sec.heading[:1000],
                heading_path=sec.heading_path[:2000],
                page_start=sec.page_start,
                page_end=sec.page_end,
                text=sec.text,
            )
            session.add(section)
            section_rows.append((section, children))
        await session.flush()  # parents must exist before children (FK)
        for section, children in section_rows:
            n_sections += 1
            for c_ord, child in enumerate(children):
                session.add(
                    Chunk(
                        document_id=doc_id,
                        section_id=section.id,
                        owner_id=owner_id,
                        ord=c_ord,
                        page=child.page,
                        heading=section.heading_path.split(" > ")[-1][:1000],
                        text=child.text,
                        token_count=child.token_count,
                        content_hash=child.content_hash,
                        embedding=next(vec_iter),
                    )
                )
                n_chunks += 1
        await session.execute(
            update(Document)
            .where(Document.id == doc_id, Document.owner_id == owner_id)
            .values(
                status=DocumentStatus.READY,
                progress=100,
                error=None,
                num_pages=parsed.num_pages,
                section_count=n_sections,
                chunk_count=n_chunks,
                embedding_model=embedder.name,
                processing_started_at=None,
            )
        )
    logger.info(
        "document_ingested",
        extra={"doc_id": str(doc_id), "sections": n_sections, "chunks": n_chunks, "pages": parsed.num_pages},
    )
