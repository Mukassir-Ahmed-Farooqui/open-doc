"""File parsers: PDF (PyMuPDF), DOCX (python-docx), Markdown and plain text.

Each parser returns a flat list of ``Block``s in reading order. A block is either a heading
(``level`` set) or a body paragraph, and carries the 1-based page it starts on. Structure
(sections) is built from these blocks by ``app.ingestion.chunking``.
"""

from __future__ import annotations

import io
import re
import statistics
import zipfile
from collections import Counter
from dataclasses import dataclass, field

import pymupdf
from docx import Document as DocxDocument
from docx.table import Table
from docx.text.paragraph import Paragraph


class ParseError(Exception):
    """The file cannot be parsed into text. Retrying will not help."""


@dataclass(slots=True)
class Block:
    text: str
    page: int
    level: int | None = None  # heading level (1 = top), None for body text

    @property
    def is_heading(self) -> bool:
        return self.level is not None


@dataclass(slots=True)
class ParsedDocument:
    blocks: list[Block]
    num_pages: int
    title: str | None = None
    warnings: list[str] = field(default_factory=list)


SUPPORTED_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
}

_WS = re.compile(r"[ \t\u00a0\u2000-\u200b]+")
_PAGE_NUM = re.compile(r"^(page\s*)?\d{1,4}(\s*(of|/)\s*\d{1,4})?$", re.IGNORECASE)
_NUMBERED_HEADING = re.compile(
    r"^((ARTICLE|SECTION|Article|Section|SCHEDULE|Schedule|EXHIBIT|Exhibit|APPENDIX|Appendix)\s+[\dIVXLC]+[A-Z]?\b"
    r"|\d{1,2}(\.\d{1,2}){0,3}\.?\s+\S)"
)


def clean_text(text: str) -> str:
    return _WS.sub(" ", text).strip()


def detect_type(filename: str, data: bytes) -> str:
    """Return the canonical extension for a supported upload or raise ``ParseError``."""
    name = filename.lower()
    ext = next((e for e in SUPPORTED_TYPES if name.endswith(e)), None)
    if ext is None:
        raise ParseError("Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.")
    if ext == ".pdf" and not data.startswith(b"%PDF"):
        raise ParseError("File has a .pdf extension but is not a PDF.")
    if ext == ".docx" and not data.startswith(b"PK"):
        raise ParseError("File has a .docx extension but is not a DOCX document.")
    if ext in {".txt", ".md", ".markdown"} and b"\x00" in data[:4096]:
        raise ParseError("Text file contains binary data.")
    return ".md" if ext == ".markdown" else ext


def parse(filename: str, data: bytes) -> ParsedDocument:
    ext = detect_type(filename, data)
    if ext == ".pdf":
        doc = parse_pdf(data)
    elif ext == ".docx":
        doc = parse_docx(data)
    elif ext == ".md":
        doc = parse_markdown(_decode(data))
    else:
        doc = parse_text(_decode(data))
    if sum(len(b.text) for b in doc.blocks) < 20:
        raise ParseError("No extractable text found (scanned PDFs need OCR, which is not supported).")
    return doc


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


# ───────────────────────────── PDF ─────────────────────────────


@dataclass(slots=True)
class _Line:
    text: str
    page: int
    size: float
    bold: bool
    block_no: int


def _norm_boilerplate(text: str) -> str:
    return re.sub(r"\d+", "#", text.lower()).strip()


def _is_heading_line(line: _Line, body_size: float) -> int | None:
    """Return a heading level for a line, or None if it is body text."""
    text = line.text
    words = text.split()
    if not words or len(words) > 18 or len(text) > 140:
        return None
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 3:
        return None
    if text.endswith((",", ";")) or text[0].islower():
        return None
    if line.size >= body_size * 1.25:
        return 1
    if line.size >= body_size * 1.1:
        return 2
    upper_ratio = sum(c.isupper() for c in letters) / len(letters)
    numbered = bool(_NUMBERED_HEADING.match(text))
    if line.bold and len(words) <= 14:
        return 2 if not numbered else 2 + min(text.split()[0].count("."), 2)
    if numbered and upper_ratio > 0.6 and len(words) <= 12:
        return 3
    return None


def parse_pdf(data: bytes) -> ParsedDocument:
    try:
        pdf = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # PyMuPDF raises several exception types for corrupt files
        raise ParseError(f"Could not open PDF: {exc}") from exc
    if pdf.needs_pass:
        raise ParseError("PDF is password-protected.")

    lines: list[_Line] = []
    try:
        for pno, page in enumerate(pdf, start=1):
            info = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
            for bno, block in enumerate(info.get("blocks", [])):
                for raw in block.get("lines", []):
                    spans = [s for s in raw.get("spans", []) if s.get("text", "").strip()]
                    if not spans:
                        continue
                    text = clean_text("".join(s["text"] for s in raw["spans"]))
                    if not text:
                        continue
                    weight = sum(len(s["text"]) for s in spans)
                    size = sum(s["size"] * len(s["text"]) for s in spans) / max(weight, 1)
                    bold = all((s["flags"] & 16) or "bold" in s["font"].lower() for s in spans)
                    lines.append(_Line(text, pno, round(size, 1), bold, bno))
        toc = pdf.get_toc(simple=True)
        num_pages = pdf.page_count
        title = (pdf.metadata or {}).get("title") or None
    finally:
        pdf.close()

    if not lines:
        raise ParseError("No extractable text found (scanned PDFs need OCR, which is not supported).")

    # Drop running headers/footers: identical (digit-normalised) lines on many pages.
    if num_pages >= 3:
        pages_per_line: dict[str, set[int]] = {}
        for ln in lines:
            pages_per_line.setdefault(_norm_boilerplate(ln.text), set()).add(ln.page)
        threshold = max(3, int(num_pages * 0.5))
        boilerplate = {k for k, pages in pages_per_line.items() if len(pages) >= threshold}
        lines = [ln for ln in lines if _norm_boilerplate(ln.text) not in boilerplate]
    lines = [ln for ln in lines if not _PAGE_NUM.match(ln.text)]

    sizes = Counter()
    for ln in lines:
        sizes[ln.size] += len(ln.text)
    body_size = sizes.most_common(1)[0][0] if sizes else statistics.median(ln.size for ln in lines)

    toc_titles: dict[tuple[int, str], int] = {}
    for level, ttl, page in toc:
        toc_titles[(page, clean_text(ttl).lower())] = max(1, min(level, 6))

    blocks: list[Block] = []
    para: list[str] = []
    para_page = 1
    last_key: tuple[int, int] | None = None

    def flush() -> None:
        nonlocal para
        if para:
            blocks.append(Block(_join_lines(para), para_page))
            para = []

    for ln in lines:
        level = toc_titles.get((ln.page, ln.text.lower())) if toc_titles else None
        if level is None and not toc_titles:
            level = _is_heading_line(ln, body_size)
        if level is not None:
            flush()
            # Consecutive heading lines in the same PDF block are one wrapped heading.
            prev = blocks[-1] if blocks else None
            if prev and prev.is_heading and last_key == (ln.page, ln.block_no) and prev.level == level:
                prev.text = f"{prev.text} {ln.text}"
            else:
                blocks.append(Block(ln.text, ln.page, level))
            last_key = (ln.page, ln.block_no)
            continue
        key = (ln.page, ln.block_no)
        if key != last_key:
            flush()
            para_page = ln.page
        para.append(ln.text)
        last_key = key
    flush()
    return ParsedDocument(blocks=blocks, num_pages=num_pages, title=title)


def _join_lines(lines: list[str]) -> str:
    out = ""
    for ln in lines:
        if not out:
            out = ln
        elif out.endswith("-") and ln[:1].islower():
            out = out[:-1] + ln
        else:
            out = f"{out} {ln}"
    return out


# ───────────────────────────── DOCX ─────────────────────────────


def _docx_page_count(data: bytes) -> int:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml = zf.read("docProps/app.xml").decode("utf-8", "ignore")
        match = re.search(r"<Pages>(\d+)</Pages>", xml)
        return max(1, int(match.group(1))) if match else 1
    except (KeyError, zipfile.BadZipFile, ValueError):
        return 1


def parse_docx(data: bytes) -> ParsedDocument:
    """DOCX has no fixed pagination, so every block is reported on page 1."""
    try:
        doc = DocxDocument(io.BytesIO(data))
    except Exception as exc:  # python-docx raises several types for corrupt archives
        raise ParseError(f"Could not open DOCX: {exc}") from exc

    blocks: list[Block] = []
    body = doc.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, doc)
            text = clean_text(para.text)
            if not text:
                continue
            style = (para.style.name if para.style is not None else "") or ""
            level: int | None = None
            if style.lower() == "title":
                level = 1
            elif style.lower().startswith("heading"):
                digits = re.findall(r"\d+", style)
                level = int(digits[0]) if digits else 1
            elif (
                len(text.split()) <= 14
                and para.runs
                and all(r.bold for r in para.runs if r.text.strip())
                and not text.endswith((".", ",", ";", ":"))
            ):
                level = 3
            blocks.append(Block(text, 1, level))
        elif tag == "tbl":
            table = Table(child, doc)
            rows = []
            for row in table.rows:
                cells = []
                for cell in row.cells:
                    value = clean_text(cell.text)
                    if value and (not cells or cells[-1] != value):
                        cells.append(value)
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                blocks.append(Block("\n".join(rows), 1))
    core_title = doc.core_properties.title or None
    return ParsedDocument(blocks=blocks, num_pages=_docx_page_count(data), title=core_title)


# ───────────────────────────── Markdown / text ─────────────────────────────

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


def parse_markdown(text: str) -> ParsedDocument:
    blocks: list[Block] = []
    para: list[str] = []
    in_code = False

    def flush() -> None:
        if para:
            blocks.append(Block(clean_text(" ".join(para)), 1))
            para.clear()

    for raw in text.splitlines():
        line = raw.rstrip()
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        match = None if in_code else _MD_HEADING.match(line)
        if match:
            flush()
            blocks.append(Block(clean_text(match.group(2)), 1, len(match.group(1))))
        elif not line.strip():
            flush()
        else:
            para.append(line.strip())
    flush()
    return ParsedDocument(blocks=[b for b in blocks if b.text], num_pages=1)


def _text_heading_level(line: str) -> int | None:
    words = line.split()
    if (
        not words
        or len(words) > 12
        or (line.endswith((".", ",", ";", ":")) and not _NUMBERED_HEADING.match(line))
    ):
        return None
    letters = [c for c in line if c.isalpha()]
    if len(letters) < 3:
        return None
    upper_ratio = sum(c.isupper() for c in letters) / len(letters)
    if upper_ratio > 0.8:
        return 2
    if _NUMBERED_HEADING.match(line) and len(words) <= 10 and not line.endswith("."):
        return 3
    return None


def parse_text(text: str) -> ParsedDocument:
    """Plain text: paragraphs split on blank lines, form feeds mark page breaks."""
    blocks: list[Block] = []
    pages = text.split("\f")
    for pno, page_text in enumerate(pages, start=1):
        for para in re.split(r"\n\s*\n", page_text):
            lines = [clean_text(ln) for ln in para.splitlines() if ln.strip()]
            if not lines:
                continue
            if len(lines) == 1 and (level := _text_heading_level(lines[0])) is not None:
                blocks.append(Block(lines[0], pno, level))
                continue
            if (level := _text_heading_level(lines[0])) is not None and len(lines) > 1:
                blocks.append(Block(lines[0], pno, level))
                lines = lines[1:]
            blocks.append(Block(_join_lines(lines), pno))
    return ParsedDocument(blocks=blocks, num_pages=max(1, len(pages)))
