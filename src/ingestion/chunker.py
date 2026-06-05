# src/ingestion/chunker.py
import hashlib
from dataclasses import dataclass, field
from typing import Optional

import nltk
import tiktoken

try:
    nltk.data.find("tokenizers/punkt_tab")
except LookupError:
    nltk.download("punkt_tab", quiet=True)

_enc = tiktoken.get_encoding("cl100k_base")


def _token_count(text: str) -> int:
    return len(_enc.encode(text))


def _chunk_id(doc_id: str, kind: str, index: int) -> str:
    raw = f"{doc_id}:{kind}:{index}"
    return f"{kind[:3]}_{hashlib.md5(raw.encode()).hexdigest()[:8]}"


@dataclass
class SectionChunk:
    filename: str
    chunk_id: str
    doc_id: str
    chunk_type: str = "section"
    text: str = ""
    heading: str = ""
    page_num: int = 1
    end_page_num: int = 1
    bbox: Optional[dict] = None
    section_index: int = 0
    token_count: int = 0
    document_summary: Optional[str] = None


@dataclass
class SentenceChunk:
    filename: str
    chunk_id: str
    doc_id: str
    section_id: str
    chunk_type: str = "sentence"
    text: str = ""
    heading: str = ""
    page_num: int = 1
    bbox: Optional[dict] = None
    sentence_index: int = 0
    token_count: int = 0
    document_summary: Optional[str] = None



def chunk_document(
    elements: list,
    doc_id: str,
    filename: str,
    max_section_tokens: int = 800,
    max_sentence_tokens: int = 150,
    min_tokens: int = 50,
) -> tuple[list[SectionChunk], list[SentenceChunk]]:
    """
    Build section + sentence chunks from a list of DocElements.

    Section chunks: all paragraphs under one heading, 500-800 tokens.
    Sentence chunks: 2-3 sentence windows per section, 50-150 tokens.
    Each chunk keeps page_num and section_id for hierarchical retrieval.
    """
    section_chunks = _build_sections(
        elements,
        doc_id,
        filename,
        max_section_tokens,
        min_tokens,
    )
    
    if len(section_chunks) == 0 and elements:
        # Fallback for small valid documents
        texts = []
        heading = "Preamble"
        heading_page = 1
        heading_bbox = None
        first_heading_seen = False
        
        for el in elements:
            text = el.text.strip() if hasattr(el, "text") else el.get("text", "").strip()
            if not text:
                continue
            el_type = el.element_type if hasattr(el, "element_type") else el.get("element_type", "")
            page = el.page_num if hasattr(el, "page_num") else el.get("page_num", 1)
            bbox = el.bbox if hasattr(el, "bbox") else el.get("bbox")

            if "heading" in el_type.lower() or "section_header" in el_type.lower():
                if not first_heading_seen:
                    heading = text
                    heading_page = page
                    heading_bbox = bbox
                    first_heading_seen = True
                else:
                    texts.append(text)
            else:
                texts.append(text)
                
        merged_text = "\n\n".join(texts)
        if not merged_text and heading != "Preamble":
            merged_text = heading
            
        tokens = _token_count(merged_text)
        if tokens >= 10:  # Minimum fallback threshold to ignore tiny noise
            section_chunks.append(SectionChunk(
                filename=filename,
                chunk_id=_chunk_id(doc_id, "section", 0),
                doc_id=doc_id,
                text=merged_text,
                heading=heading,
                page_num=heading_page,
                end_page_num=heading_page,
                bbox=heading_bbox,
                section_index=0,
                token_count=tokens,
            ))
            
    sentence_chunks = _build_sentences(
        section_chunks,
        doc_id,
        filename,
        max_sentence_tokens,
        min_tokens,
    )
    return section_chunks, sentence_chunks


# ── Section chunking ──────────────────────────────────────────────────────────

def _build_sections(
    elements: list,
    doc_id: str,
    filename: str,
    max_tokens: int,
    min_tokens: int,
) -> list[SectionChunk]:
    chunks = []
    idx = 0

    heading = "Preamble"
    heading_page = 1
    heading_bbox = None
    texts: list[str] = []
    pages: list[int] = []

    def flush():
        nonlocal idx
        if not texts:
            return
        merged = "\n\n".join(texts)
        tokens = _token_count(merged)
        if tokens < min_tokens:
            return
        if tokens <= max_tokens:
            chunks.append(SectionChunk(
                filename=filename,
                chunk_id=_chunk_id(doc_id, "section", idx),
                doc_id=doc_id,
                text=merged,
                heading=heading,
                page_num=heading_page,
                end_page_num=pages[-1] if pages else heading_page,
                bbox=heading_bbox,
                section_index=idx,
                token_count=tokens,
            ))
            idx += 1
        else:
            for sub in _split_section(merged, heading, heading_page, heading_bbox, doc_id, filename, idx, max_tokens):
                chunks.append(sub)
                idx += 1

    for el in elements:
        text = el.text.strip() if hasattr(el, "text") else el.get("text", "").strip()
        if not text:
            continue
        el_type = el.element_type if hasattr(el, "element_type") else el.get("element_type", "")
        page = el.page_num if hasattr(el, "page_num") else el.get("page_num", 1)
        bbox = el.bbox if hasattr(el, "bbox") else el.get("bbox")

        if "heading" in el_type.lower() or "section_header" in el_type.lower():
            flush()
            heading = text
            heading_page = page
            heading_bbox = bbox
            texts, pages = [], []
        else:
            texts.append(text)
            pages.append(page)

    flush()
    return chunks


def _split_section(
    text: str,
    heading: str,
    page_num: int,
    bbox: Optional[dict],
    doc_id: str,
    filename: str,
    start_idx: int,
    target_tokens: int,
) -> list[SectionChunk]:
    chunks = []
    sentences = nltk.sent_tokenize(text)
    buffer, buffer_tokens, sub = [], 0, 0

    def emit():
        nonlocal sub
        t = " ".join(buffer)
        chunks.append(SectionChunk(
            filename=filename,
            chunk_id=_chunk_id(doc_id, "section", start_idx + sub),
            doc_id=doc_id,
            text=t,
            heading=heading,
            page_num=page_num,
            end_page_num=page_num,
            bbox=bbox,
            section_index=start_idx + sub,
            token_count=_token_count(t),
        ))
        sub += 1

    for sent in sentences:
        n = _token_count(sent)
        if buffer and buffer_tokens + n > target_tokens:
            emit()
            buffer, buffer_tokens = [sent], n
        else:
            buffer.append(sent)
            buffer_tokens += n

    if buffer:
        emit()

    return chunks


# ── Sentence chunking ─────────────────────────────────────────────────────────

def _build_sentences(
    sections: list[SectionChunk],
    doc_id: str,
    filename: str,
    max_tokens: int,
    min_tokens: int,
) -> list[SentenceChunk]:
    chunks = []

    for section in sections:
        sentences = nltk.sent_tokenize(section.text)
        buffer, buffer_tokens, idx = [], 0, 0

        def emit():
            nonlocal idx
            t = " ".join(buffer)
            current_min = 10 if section.token_count < min_tokens else min_tokens
            if _token_count(t) < current_min:
                return
            chunks.append(SentenceChunk(
                filename=section.filename,
                chunk_id=_chunk_id(doc_id, "sentence", section.section_index * 1000 + idx),
                doc_id=doc_id,
                section_id=section.chunk_id,
                text=t,
                heading=section.heading,
                page_num=section.page_num,
                bbox=section.bbox,
                sentence_index=idx,
                token_count=_token_count(t),
            ))
            idx += 1

        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            n = _token_count(sent)
            if buffer and buffer_tokens + n > max_tokens:
                emit()
                buffer, buffer_tokens = [sent], n
            else:
                buffer.append(sent)
                buffer_tokens += n

        if buffer:
            emit()

    return chunks