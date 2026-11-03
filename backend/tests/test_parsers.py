from __future__ import annotations

import pytest

from app.ingestion.parsers import ParseError, detect_type, parse, parse_markdown, parse_text
from tests.conftest import FIXTURES
from tests.helpers import make_contract_pdf, make_docx, make_pdf


def test_pdf_fixture_heading_and_text() -> None:
    doc = parse("alpha_contract.pdf", (FIXTURES / "alpha_contract.pdf").read_bytes())
    assert doc.num_pages == 1
    assert doc.blocks[0].is_heading and doc.blocks[0].text == "ALPHA SOFTWARE AGREEMENT"
    body = " ".join(b.text for b in doc.blocks if not b.is_heading)
    assert "BANANA-123" in body and "$10,000" in body


def test_pdf_headings_pages_and_boilerplate_removed() -> None:
    doc = parse("contract.pdf", make_contract_pdf())
    headings = [(b.text, b.page) for b in doc.blocks if b.is_heading]
    assert ("MASTER SERVICES AGREEMENT", 1) in headings
    assert ("3. Termination", 2) in headings
    assert ("5. Confidentiality", 3) in headings
    all_text = " ".join(b.text for b in doc.blocks)
    assert "Confidential - Master Services Agreement" not in all_text  # running footer dropped
    term = next(b for b in doc.blocks if "ninety (90) days" in b.text)
    assert term.page == 2
    title = next(b for b in doc.blocks if b.text == "MASTER SERVICES AGREEMENT")
    section = next(b for b in doc.blocks if b.text == "1. Definitions")
    assert title.level < section.level  # bigger font -> higher level


def test_docx_headings_and_table() -> None:
    doc = parse("handbook.docx", make_docx())
    headings = {b.text: b.level for b in doc.blocks if b.is_heading}
    assert headings["Employee Handbook"] == 1
    assert headings["Leave Policy"] == 1
    assert headings["Remote Work"] == 2
    assert any("G1 | 500 USD" in b.text for b in doc.blocks)


def test_markdown_and_code_fences() -> None:
    doc = parse_markdown("# Title\n\nIntro text here.\n\n## Part\n\n```\n# not a heading\n```\nBody line.\n")
    assert [(b.text, b.level) for b in doc.blocks if b.is_heading] == [("Title", 1), ("Part", 2)]


def test_text_pages_and_headings() -> None:
    doc = parse_text("TERMS OF USE\n\nYou agree to the terms.\fSECOND PAGE TITLE\n\nMore text on page two.")
    assert doc.num_pages == 2
    assert doc.blocks[0].is_heading
    assert doc.blocks[-1].page == 2


@pytest.mark.parametrize(
    ("name", "data", "message"),
    [
        ("x.exe", b"MZ", "Unsupported"),
        ("fake.pdf", b"hello", "not a PDF"),
        ("fake.docx", b"hello", "not a DOCX"),
        ("bin.txt", b"\x00\x01\x02", "binary"),
    ],
)
def test_detect_type_rejects(name: str, data: bytes, message: str) -> None:
    with pytest.raises(ParseError, match=message):
        detect_type(name, data)


def test_pdf_without_text_is_parse_error() -> None:
    with pytest.raises(ParseError, match="No extractable text"):
        parse("blank.pdf", make_pdf([[]]))


def test_corrupt_pdf_is_parse_error() -> None:
    with pytest.raises(ParseError):
        parse("broken.pdf", b"%PDF-1.7 garbage that is not a pdf")
