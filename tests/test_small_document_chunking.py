import os
import sys
import pytest
from pathlib import Path

# Ensure src is in PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.ingestion.parser import parse_pdf, DocElement
from src.ingestion.chunker import chunk_document

def test_chunking_case_a_large_document():
    """
    Case A — Large Document
    Input: Arca agreement
    Expected: Existing section count unchanged (9 sections), sentence count unchanged (20 sentences).
    """
    pdf_path = Path("data/uploads/ArcaUsTreasuryFund_20200207_N-2_EX-99.K5_11971930_EX-99.K5_Development Agreement.pdf")
    assert pdf_path.exists(), "Arca agreement PDF not found"

    parsed = parse_pdf(pdf_path)
    section_chunks, sentence_chunks = chunk_document(
        parsed.elements,
        parsed.doc_id,
        parsed.filename,
    )

    assert len(section_chunks) == 9
    assert len(sentence_chunks) == 20

def test_chunking_case_b_small_valid_document():
    """
    Case B — Small Valid Document
    Input: alpha_contract.pdf
    Expected: At least 1 section chunk and at least 1 sentence chunk (specifically 1 of each for alpha_contract.pdf).
    """
    pdf_path = Path("scratch/alpha_contract.pdf")
    assert pdf_path.exists(), "alpha_contract.pdf not found in scratch"

    parsed = parse_pdf(pdf_path)
    section_chunks, sentence_chunks = chunk_document(
        parsed.elements,
        parsed.doc_id,
        parsed.filename,
    )

    assert len(section_chunks) == 1
    assert len(sentence_chunks) == 1
    
    # Verify metadata and content
    sec = section_chunks[0]
    assert sec.heading == "ALPHA SOFTWARE AGREEMENT"
    assert "BANANA-123" in sec.text
    assert sec.token_count == 41

    sen = sentence_chunks[0]
    assert sen.heading == "ALPHA SOFTWARE AGREEMENT"
    assert sen.section_id == sec.chunk_id
    assert "BANANA-123" in sen.text

def test_chunking_case_c_empty_document():
    """
    Case C — Empty Document
    Input: no extractable text
    Expected: no chunks generated
    """
    elements = []
    section_chunks, sentence_chunks = chunk_document(
        elements,
        "empty-doc-id",
        "empty.pdf",
    )
    assert len(section_chunks) == 0
    assert len(sentence_chunks) == 0

    # Also test elements with only whitespace text
    whitespace_elements = [
        DocElement(element_type="text", text="   ", page_num=1),
        DocElement(element_type="heading_1", text=" \n ", page_num=1),
    ]
    section_chunks_ws, sentence_chunks_ws = chunk_document(
        whitespace_elements,
        "ws-doc-id",
        "whitespace.pdf",
    )
    assert len(section_chunks_ws) == 0
    assert len(sentence_chunks_ws) == 0

def test_chunking_case_d_very_small_noise_document():
    """
    Case D — Very Small Noise Document
    Input: "Hello"
    Expected: no fallback chunk generated (below 10 tokens threshold)
    """
    noise_elements = [
        DocElement(element_type="text", text="Hello", page_num=1),
    ]
    section_chunks, sentence_chunks = chunk_document(
        noise_elements,
        "noise-doc-id",
        "noise.pdf",
    )
    assert len(section_chunks) == 0
    assert len(sentence_chunks) == 0

    # Test slightly larger noise but still below 10 tokens (e.g. 5 tokens)
    short_elements = [
        DocElement(element_type="text", text="This is short.", page_num=1), # 4 tokens
    ]
    section_chunks_s, sentence_chunks_s = chunk_document(
        short_elements,
        "short-doc-id",
        "short.pdf",
    )
    assert len(section_chunks_s) == 0
    assert len(sentence_chunks_s) == 0
