"""Builders for small, deterministic test documents."""

from __future__ import annotations

import io

import pymupdf
from docx import Document as DocxDocument


def make_pdf(pages: list[list[tuple[str, float, bool]]], footer: str | None = None) -> bytes:
    """pages: list of [(text, fontsize, bold)] lines."""
    doc = pymupdf.open()
    for pno, lines in enumerate(pages, start=1):
        page = doc.new_page()
        y = 72
        for text, size, bold in lines:
            font = "hebo" if bold else "helv"
            rect = pymupdf.Rect(72, y, 540, y + 400)
            used = page.insert_textbox(rect, text, fontsize=size, fontname=font)
            height = 400 - used if used >= 0 else size * 2
            y += height + size * 0.8
        if footer:
            page.insert_text((72, 780), f"{footer}", fontsize=8, fontname="helv")
            page.insert_text((300, 800), str(pno), fontsize=8, fontname="helv")
    data = doc.tobytes()
    doc.close()
    return data


LOREM = (
    "The supplier shall deliver the goods within the agreed period and shall notify the customer of any "
    "delay without undue hesitation. "
)


def make_contract_pdf() -> bytes:
    return make_pdf(
        [
            [
                ("MASTER SERVICES AGREEMENT", 18, True),
                ("1. Definitions", 11, True),
                (
                    "In this Agreement, Services means the consulting services described in Schedule A. " * 3,
                    10,
                    False,
                ),
                ("2. Payment Terms", 11, True),
                (
                    "The Customer shall pay each invoice within forty-five (45) days of receipt. "
                    + LOREM * 2,
                    10,
                    False,
                ),
            ],
            [
                ("3. Termination", 11, True),
                (
                    "Either party may terminate this Agreement upon ninety (90) days written notice. "
                    + LOREM * 2,
                    10,
                    False,
                ),
                ("4. Governing Law", 11, True),
                ("This Agreement is governed by the laws of the State of Oregon. " + LOREM, 10, False),
            ],
            [
                ("5. Confidentiality", 11, True),
                (
                    "Each party shall keep the other party's Confidential Information secret. " + LOREM * 3,
                    10,
                    False,
                ),
            ],
        ],
        footer="Confidential - Master Services Agreement",
    )


def make_docx() -> bytes:
    doc = DocxDocument()
    doc.add_heading("Employee Handbook", level=0)
    doc.add_heading("Leave Policy", level=1)
    doc.add_paragraph("Employees accrue twenty days of paid leave per year. Unused leave carries over.")
    doc.add_heading("Remote Work", level=2)
    doc.add_paragraph("Remote work requires manager approval and a secure connection.")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Grade"
    table.cell(0, 1).text = "Allowance"
    table.cell(1, 0).text = "G1"
    table.cell(1, 1).text = "500 USD"
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
