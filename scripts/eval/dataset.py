"""Build the retrieval eval set from tests/evaluation/*.json and the fixture corpus.

Labels: a retrieved chunk is *relevant* to a question when it comes from the question's
document and contains the gold evidence:
  * golden_dataset.json  -> the ``context`` span (exact normalised substring, or >= 70% of the
                            span's content tokens present when the span crosses a chunk boundary)
  * fact_questions.json  -> the ``expected_answer`` (>= 80% of its content tokens present)

Items are skipped (and counted) when they cannot be labelled honestly:
  * the document is not available (``Eslab (2).pdf``, ``beta_contract.pdf`` are not in the repo
    or in CUAD),
  * ``Cross-Document`` golden items: their gold answers contradict the actual fixture text
    (e.g. they state Alpha is governed by New York law, the PDF says California),
  * summary questions (no evidence span to score retrieval against).
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EVAL_DIR = REPO / "tests" / "evaluation"
FIXTURES = REPO / "tests" / "fixtures"

_STOP = {
    "the",
    "a",
    "an",
    "of",
    "to",
    "and",
    "or",
    "in",
    "on",
    "for",
    "by",
    "with",
    "as",
    "at",
    "is",
    "be",
    "that",
    "this",
    "its",
    "it",
    "any",
    "such",
    "shall",
    "from",
    "are",
    "was",
    "were",
    "which",
}


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\u037e", ";")
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    return re.sub(r"\s+", " ", text).strip().lower()


def content_tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9$%.\-]+", normalise(text)) if t not in _STOP and t.strip(".-")]


def corpus_files() -> dict[str, Path]:
    files = {"alpha_contract.pdf": FIXTURES / "alpha_contract.pdf"}
    cuad = FIXTURES / "cuad"
    if cuad.is_dir():
        files.update({p.name: p for p in sorted(cuad.glob("*.pdf"))})
    return files


@dataclass
class EvalItem:
    qid: str
    question: str
    filename: str
    source: str
    evidence: str
    mode: str  # "span" | "answer"
    _tokens: list[str] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        self._norm = normalise(self.evidence)
        self._tokens = content_tokens(self.evidence)

    def is_relevant(self, filename: str, chunk_text: str) -> bool:
        if filename != self.filename:
            return False
        norm = normalise(chunk_text)
        if self._norm and self._norm in norm:
            return True
        if not self._tokens:
            return False
        present = set(content_tokens(chunk_text))
        coverage = sum(t in present for t in self._tokens) / len(self._tokens)
        threshold = 0.7 if self.mode == "span" else 0.8
        return coverage >= threshold and (self.mode == "answer" or len(self._tokens) >= 4)


@dataclass
class EvalSet:
    items: list[EvalItem]
    skipped: dict[str, int]
    negatives: list[str]


def build() -> EvalSet:
    available = corpus_files()
    items: list[EvalItem] = []
    skipped: dict[str, int] = {}

    def skip(reason: str) -> None:
        skipped[reason] = skipped.get(reason, 0) + 1

    for i, row in enumerate(json.loads((EVAL_DIR / "golden_dataset.json").read_text())):
        if row["filename"] == "Cross-Document":
            skip("golden: Cross-Document (gold answers contradict fixture text)")
        elif row["filename"] not in available:
            skip(f"golden: document unavailable ({row['filename']})")
        else:
            items.append(
                EvalItem(f"golden-{i}", row["question"], row["filename"], "golden", row["context"], "span")
            )

    for i, row in enumerate(json.loads((EVAL_DIR / "fact_questions.json").read_text())):
        if row["filename"] not in available:
            skip(f"fact: document unavailable ({row['filename']})")
        else:
            items.append(
                EvalItem(
                    f"fact-{i}", row["question"], row["filename"], "fact", row["expected_answer"], "answer"
                )
            )

    for name in ("comparison_questions.json", "summary_questions.json"):
        for _ in json.loads((EVAL_DIR / name).read_text()):
            skip(f"{name.split('_')[0]}: no evidence span for retrieval scoring")

    negatives = [n["question"] for n in json.loads((Path(__file__).parent / "negatives.json").read_text())]
    return EvalSet(items, skipped, negatives)


if __name__ == "__main__":
    es = build()
    print(f"{len(es.items)} labelled questions, {len(es.negatives)} negatives")
    for reason, n in sorted(es.skipped.items()):
        print(f"  skipped {n:>2}: {reason}")
