"""Chunking strategies.

``parent_child``  (production): blocks -> sections (parents, split by headings and capped at
                  ``parent_max_tokens``) -> child passages of ~``child_target_tokens`` tokens
                  with sentence-aligned overlap. Children are the retrieval unit; parents
                  are the context handed to the LLM.
``recursive``     (benchmark baseline): structure-blind recursive character splitting of the
                  whole document into chunks of the same token budget. Each chunk is its
                  own parent, so both strategies feed the retriever identically.

Token counts use a tokenizer-free approximation (words + punctuation marks), which tracks
WordPiece/BPE counts for English prose closely enough for sizing passages and keeps chunking
independent of the embedding provider.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from app.ingestion.parsers import Block

_TOKEN_RE = re.compile(r"\w+|[^\w\s]")
_SENT_SPLIT = re.compile(r"(?<=[.!?;:])\s+(?=[\"'“(\[]?[A-Z0-9])")
_ABBREV = re.compile(
    r"\b(?:[A-Z]|Mr|Mrs|Ms|Dr|No|Nos|Inc|Ltd|Co|Corp|Sec|Art|U\.S|e\.g|i\.e|etc|vs|v|St|Jr|Sr)\.$"
)


def count_tokens(text: str) -> int:
    return len(_TOKEN_RE.findall(text))


def content_hash(text: str) -> str:
    normalised = re.sub(r"\s+", " ", text).strip().lower()
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


def split_sentences(text: str) -> list[str]:
    parts = _SENT_SPLIT.split(text)
    out: list[str] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if out and _ABBREV.search(out[-1]):
            out[-1] = f"{out[-1]} {part}"
        else:
            out.append(part)
    return out


@dataclass(slots=True)
class ChildDraft:
    text: str
    page: int
    token_count: int
    content_hash: str


@dataclass(slots=True)
class SectionDraft:
    heading: str
    heading_path: str
    page_start: int
    page_end: int
    paragraphs: list[tuple[str, int]] = field(default_factory=list)  # (text, page)
    children: list[ChildDraft] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(p for p, _ in self.paragraphs)

    @property
    def tokens(self) -> int:
        return sum(count_tokens(p) for p, _ in self.paragraphs)


@dataclass(slots=True)
class ChunkingConfig:
    child_target_tokens: int = 300
    child_overlap_tokens: int = 50
    child_min_tokens: int = 40
    section_min_tokens: int = 15
    parent_max_tokens: int = 1200


# ───────────────────────────── sections ─────────────────────────────


def build_sections(blocks: list[Block], fallback_title: str, cfg: ChunkingConfig) -> list[SectionDraft]:
    """Group blocks into heading-delimited sections with a heading path."""
    stack: list[tuple[int, str]] = []
    sections: list[SectionDraft] = []
    pending_headings: list[Block] = []

    def path_for(level: int, heading: str) -> str:
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, heading))
        return " > ".join(h for _, h in stack)

    current: SectionDraft | None = None
    for block in blocks:
        if block.is_heading:
            pending_headings.append(block)
            continue
        if pending_headings:
            # Consecutive headings with no body between them ("ARTICLE II" / "TERM") read as one.
            level = min(h.level or 1 for h in pending_headings)
            heading = " ".join(h.text for h in pending_headings)
            path = path_for(level, heading)
            current = SectionDraft(heading, path, pending_headings[0].page, block.page)
            sections.append(current)
            pending_headings = []
        if current is None:
            current = SectionDraft(fallback_title, fallback_title, block.page, block.page)
            sections.append(current)
        current.paragraphs.append((block.text, block.page))
        current.page_end = max(current.page_end, block.page)
    if pending_headings:
        heading = " ".join(h.text for h in pending_headings)
        page = pending_headings[0].page
        if current is not None:
            current.paragraphs.append((heading, page))
        else:
            sections.append(SectionDraft(heading, heading, page, page, [(heading, page)]))

    return _split_large(_merge_small(sections, cfg), cfg)


def _merge_small(sections: list[SectionDraft], cfg: ChunkingConfig) -> list[SectionDraft]:
    """Fold tiny sections (e.g. a run of bold defined terms) into their predecessor.

    Oversized results are split again by ``_split_large``.
    """
    merged: list[SectionDraft] = []
    for sec in sections:
        prev = merged[-1] if merged else None
        if prev is not None and sec.tokens < cfg.section_min_tokens:
            prev.paragraphs.append((sec.heading, sec.page_start))
            prev.paragraphs.extend(sec.paragraphs)
            prev.page_end = max(prev.page_end, sec.page_end)
            continue
        merged.append(sec)
    return merged


def _split_large(sections: list[SectionDraft], cfg: ChunkingConfig) -> list[SectionDraft]:
    """Cap parent size so a parent always fits comfortably in the LLM context."""
    out: list[SectionDraft] = []
    for sec in sections:
        if sec.tokens <= cfg.parent_max_tokens:
            out.append(sec)
            continue
        part: SectionDraft | None = None
        part_no = 0
        for text, page in _paragraph_pieces(sec.paragraphs, cfg.parent_max_tokens):
            if part is None or part.tokens + count_tokens(text) > cfg.parent_max_tokens:
                part_no += 1
                suffix = "" if part_no == 1 else f" (part {part_no})"
                part = SectionDraft(sec.heading + suffix, sec.heading_path + suffix, page, page)
                out.append(part)
            part.paragraphs.append((text, page))
            part.page_end = max(part.page_end, page)
    return out


def _paragraph_pieces(paragraphs: list[tuple[str, int]], max_tokens: int) -> list[tuple[str, int]]:
    """Split any single paragraph larger than ``max_tokens`` at sentence boundaries."""
    pieces: list[tuple[str, int]] = []
    for text, page in paragraphs:
        if count_tokens(text) <= max_tokens:
            pieces.append((text, page))
            continue
        buf: list[str] = []
        for sent in split_sentences(text):
            if buf and count_tokens(" ".join([*buf, sent])) > max_tokens:
                pieces.append((" ".join(buf), page))
                buf = []
            buf.append(sent)
        if buf:
            pieces.append((" ".join(buf), page))
    return pieces


# ───────────────────────────── children ─────────────────────────────


def _units(section: SectionDraft, target: int) -> list[tuple[str, int, int]]:
    """Sentence units (text, page, tokens); over-long sentences are split by words."""
    units: list[tuple[str, int, int]] = []
    for para, page in section.paragraphs:
        for sent in split_sentences(para):
            n = count_tokens(sent)
            if n <= target:
                units.append((sent, page, n))
                continue
            words = sent.split()
            step = max(1, int(len(words) * target / n))
            for i in range(0, len(words), step):
                piece = " ".join(words[i : i + step])
                units.append((piece, page, count_tokens(piece)))
    return units


def build_children(section: SectionDraft, cfg: ChunkingConfig) -> list[ChildDraft]:
    units = _units(section, cfg.child_target_tokens)
    children: list[ChildDraft] = []
    start = 0
    while start < len(units):
        end = start
        tokens = 0
        while end < len(units) and (tokens + units[end][2] <= cfg.child_target_tokens or end == start):
            tokens += units[end][2]
            end += 1
        # Avoid a runt final chunk: absorb it if it is small.
        if end < len(units) and sum(u[2] for u in units[end:]) < cfg.child_min_tokens:
            tokens += sum(u[2] for u in units[end:])
            end = len(units)
        text = " ".join(u[0] for u in units[start:end])
        children.append(ChildDraft(text, units[start][1], tokens, content_hash(text)))
        if end >= len(units):
            break
        # Step back whole sentences to create the overlap.
        overlap = 0
        next_start = end
        while next_start > start + 1 and overlap + units[next_start - 1][2] <= cfg.child_overlap_tokens:
            next_start -= 1
            overlap += units[next_start][2]
        start = next_start
    return _absorb_runts(children, cfg.child_min_tokens)


def _absorb_runts(children: list[ChildDraft], min_tokens: int) -> list[ChildDraft]:
    """Glue fragments (a lone sub-heading before an over-long sentence) onto a neighbour."""
    out: list[ChildDraft] = []
    carry: ChildDraft | None = None
    for child in children:
        if carry is not None:
            text = f"{carry.text} {child.text}"
            child = ChildDraft(text, carry.page, carry.token_count + child.token_count, content_hash(text))
            carry = None
        if child.token_count < min_tokens and len(children) > 1:
            carry = child
            continue
        out.append(child)
    if carry is not None:
        if out:
            last = out.pop()
            text = f"{last.text} {carry.text}"
            out.append(ChildDraft(text, last.page, last.token_count + carry.token_count, content_hash(text)))
        else:
            out.append(carry)
    return out


def chunk_parent_child(blocks: list[Block], title: str, cfg: ChunkingConfig) -> list[SectionDraft]:
    sections = build_sections(blocks, title, cfg)
    for sec in sections:
        sec.children = build_children(sec, cfg)
    return [s for s in sections if s.children]


# ───────────────────────────── recursive baseline ─────────────────────────────

_SEPARATORS = ["\n\n", "\n", ". ", " "]


def _recursive_split(text: str, max_tokens: int, seps: list[str]) -> list[str]:
    if count_tokens(text) <= max_tokens or not seps:
        return [text]
    sep, rest = seps[0], seps[1:]
    pieces = [p for p in text.split(sep) if p.strip()]
    if len(pieces) == 1:
        return _recursive_split(text, max_tokens, rest)
    out: list[str] = []
    buf = ""
    for piece in pieces:
        candidate = f"{buf}{sep}{piece}" if buf else piece
        if count_tokens(candidate) <= max_tokens:
            buf = candidate
            continue
        if buf:
            out.append(buf)
        if count_tokens(piece) > max_tokens:
            out.extend(_recursive_split(piece, max_tokens, rest))
            buf = ""
        else:
            buf = piece
    if buf:
        out.append(buf)
    return out


def chunk_recursive(blocks: list[Block], title: str, cfg: ChunkingConfig) -> list[SectionDraft]:
    """Structure-blind baseline. Returns one pseudo-section per chunk (parent == child)."""
    offsets: list[tuple[int, int]] = []  # (char offset, page)
    parts: list[str] = []
    pos = 0
    for block in blocks:
        offsets.append((pos, block.page))
        parts.append(block.text)
        pos += len(block.text) + 2
    full = "\n\n".join(parts)

    def page_at(offset: int) -> int:
        page = offsets[0][1] if offsets else 1
        for start, pg in offsets:
            if start > offset:
                break
            page = pg
        return page

    raw = _recursive_split(full, cfg.child_target_tokens - cfg.child_overlap_tokens, _SEPARATORS)
    sections: list[SectionDraft] = []
    cursor = 0
    prev_tail = ""
    for piece in raw:
        idx = full.find(piece[:50], cursor)
        idx = cursor if idx < 0 else idx
        cursor = idx + max(1, len(piece) // 2)
        text = f"{prev_tail} {piece}".strip() if prev_tail else piece
        page = page_at(idx)
        words = piece.split()
        tail_words: list[str] = []
        for w in reversed(words):
            if count_tokens(" ".join([w, *tail_words])) > cfg.child_overlap_tokens:
                break
            tail_words.insert(0, w)
        prev_tail = " ".join(tail_words)
        sec = SectionDraft(title, title, page, page, [(text, page)])
        sec.children = [ChildDraft(text, page, count_tokens(text), content_hash(text))]
        sections.append(sec)
    return sections


STRATEGIES = {"parent_child": chunk_parent_child, "recursive": chunk_recursive}
