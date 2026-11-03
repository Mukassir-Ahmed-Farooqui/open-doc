from __future__ import annotations

from app.ingestion.chunking import (
    ChunkingConfig,
    build_sections,
    chunk_parent_child,
    chunk_recursive,
    content_hash,
    count_tokens,
    split_sentences,
)
from app.ingestion.parsers import Block, parse
from tests.helpers import make_contract_pdf

CFG = ChunkingConfig(
    child_target_tokens=60, child_overlap_tokens=15, child_min_tokens=10, parent_max_tokens=200
)


def _sentences(n: int, word: str = "clause") -> str:
    return " ".join(f"Sentence {i} describes the {word} in detail." for i in range(n))


def test_count_tokens_and_hash() -> None:
    assert count_tokens("Hello, world!") == 4
    assert content_hash("A  b\nC") == content_hash("a b c")


def test_split_sentences_keeps_abbreviations() -> None:
    parts = split_sentences("The U.S. Fund pays fees. See Sec. 4 for details. Done.")
    assert parts == ["The U.S. Fund pays fees.", "See Sec. 4 for details.", "Done."]


def test_sections_heading_path_and_merge() -> None:
    blocks = [
        Block("AGREEMENT", 1, 1),
        Block("ARTICLE I", 1, 2),
        Block("DEFINITIONS", 1, 2),
        Block(_sentences(5), 1),
        Block("1.1 Tiny", 2, 3),
        Block("Short.", 2),
        Block("ARTICLE II", 2, 2),
        Block(_sentences(5, "payment"), 3),
    ]
    sections = build_sections(blocks, "Doc", CFG)
    assert sections[0].heading == "AGREEMENT ARTICLE I DEFINITIONS"  # consecutive headings fold together
    assert "1.1 Tiny" in sections[0].text  # tiny section merged into predecessor
    assert sections[1].heading_path == "AGREEMENT ARTICLE I DEFINITIONS > ARTICLE II"
    assert sections[1].page_start == 2 and sections[1].page_end == 3


def test_parent_child_sizes_and_overlap() -> None:
    blocks = [Block("Heading", 1, 1), Block(_sentences(40), 1)]
    sections = chunk_parent_child(blocks, "Doc", CFG)
    assert all(s.tokens <= CFG.parent_max_tokens for s in sections)
    children = [c for s in sections for c in s.children]
    assert len(children) > 3
    assert all(c.token_count <= CFG.child_target_tokens + 15 for c in children)
    assert all(c.token_count >= CFG.child_min_tokens for c in children)
    first, second = sections[0].children[0].text, sections[0].children[1].text
    assert split_sentences(first)[-1] in second  # sentence-aligned overlap


def test_large_section_split_into_parts() -> None:
    blocks = [Block("Big", 1, 1)] + [Block(_sentences(8), 1) for _ in range(6)]
    sections = chunk_parent_child(blocks, "Doc", CFG)
    assert len(sections) > 1
    assert sections[1].heading.startswith("Big (part 2)")


def test_recursive_baseline_one_parent_per_chunk() -> None:
    blocks = [Block("Heading", 1, 1), Block(_sentences(40), 1), Block(_sentences(10), 2)]
    sections = chunk_recursive(blocks, "Doc", CFG)
    assert all(len(s.children) == 1 for s in sections)
    assert sections[-1].page_start == 2


def test_contract_pdf_end_to_end_chunking() -> None:
    doc = parse("c.pdf", make_contract_pdf())
    sections = chunk_parent_child(doc.blocks, "c", ChunkingConfig())
    paths = [s.heading_path for s in sections]
    assert any(p.endswith("3. Termination") for p in paths)
    termination = next(s for s in sections if s.heading_path.endswith("3. Termination"))
    assert termination.children[0].page == 2
