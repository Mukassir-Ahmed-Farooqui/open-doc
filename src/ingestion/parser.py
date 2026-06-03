# src/ingestion/parser.py
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from docling.document_converter import DocumentConverter
from docling.datamodel.pipeline_options import PdfPipelineOptions


@dataclass
class DocElement:
    element_type: str
    text: str
    page_num: int
    level: Optional[int] = None
    bbox: Optional[dict] = None
    parent_heading: Optional[str] = None


@dataclass
class ParsedDocument:
    doc_id: str
    source_path: str
    num_pages: int
    elements: list[DocElement] = field(default_factory=list)


def parse_pdf(pdf_path: Path) -> ParsedDocument:
    """
    Parse a PDF with Docling, returning structured elements
    (headings, paragraphs, tables) with page numbers and bboxes.
    """
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = False
    pipeline_options.do_table_structure = True

    converter = DocumentConverter()
    result = converter.convert(str(pdf_path))
    doc = result.document

    elements = []
    current_heading: Optional[str] = None

    for element, _level in doc.iterate_items():
        label = str(getattr(element, "label", "text"))
        text = getattr(element, "text", "").strip()

        # Promote legal clause titles to headings
        if label == "list_item":
            first_sentence = text.split(".")[0].strip()

            if (
                len(first_sentence) < 80
                and first_sentence[0].isupper()
            ):
                label = "heading_1"

        if not text:
            continue

        page_num = 1
        bbox = None
        if hasattr(element, "prov") and element.prov:
            prov = element.prov[0]
            page_num = getattr(prov, "page_no", 1)
            if hasattr(prov, "bbox"):
                b = prov.bbox
                bbox = {"x0": b.l, "y0": b.t, "x1": b.r, "y1": b.b}

        level = None
        is_heading = "heading" in label.lower()
        if is_heading:
            try:
                level = int(label.split("_")[-1])
            except (ValueError, IndexError):
                level = 1
            current_heading = text

        elements.append(DocElement(
            element_type=label,
            text=text,
            page_num=page_num,
            level=level,
            bbox=bbox,
            parent_heading=current_heading if not is_heading else None,
        ))

    return ParsedDocument(
        doc_id=pdf_path.stem,
        source_path=str(pdf_path),
        num_pages=len(doc.pages) if hasattr(doc, "pages") else 0,
        elements=elements,
    )
