"""Cheap pre-ingestion checks run at upload time, before anything is stored or queued.

Rejects encrypted, malformed and over-long PDFs and DOCX zip bombs so that expensive parsing and
embedding never start on them. Parsing itself is further bounded in the pipeline (timeout and
extracted-text cap).
"""

from __future__ import annotations

import io
import zipfile

import pymupdf

from app.config import Settings


class UploadRejectedError(Exception):
    """The upload is not acceptable. ``message`` is safe to show to the user."""


def validate_pdf(data: bytes, settings: Settings) -> int:
    """Return the page count or raise ``UploadRejectedError``."""
    if b"%%EOF" not in data[-2048:] and b"%%EOF" not in data:
        raise UploadRejectedError("This PDF looks incomplete or damaged. Please re-export it and try again.")
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise UploadRejectedError("This PDF can't be opened. It may be damaged.") from None
    try:
        if doc.needs_pass or doc.is_encrypted:
            raise UploadRejectedError(
                "This PDF is password-protected. Remove the password and upload it again."
            )
        pages = doc.page_count
        if pages <= 0:
            raise UploadRejectedError("This PDF has no pages.")
        if pages > settings.max_pdf_pages:
            raise UploadRejectedError(
                f"This PDF has {pages} pages. The beta limit is {settings.max_pdf_pages} pages per document."
            )
        return pages
    finally:
        doc.close()


def validate_docx(data: bytes, settings: Settings) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
            total = sum(i.file_size for i in infos)
            if len(infos) > 5000 or total > settings.max_docx_uncompressed_mb * 1024 * 1024:
                raise UploadRejectedError("This DOCX expands to an unusually large size and was rejected.")
            if "word/document.xml" not in zf.namelist():
                raise UploadRejectedError("This file isn't a valid Word document.")
    except zipfile.BadZipFile:
        raise UploadRejectedError("This file isn't a valid Word document.") from None


def validate_upload(ext: str, data: bytes, settings: Settings) -> int | None:
    if ext == ".pdf":
        return validate_pdf(data, settings)
    if ext == ".docx":
        validate_docx(data, settings)
    return None
