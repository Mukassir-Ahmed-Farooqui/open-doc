"""End-to-end generation eval against the live LLM (Groq). Needs GROQ_API_KEY.

Runs the production pipeline (parent-child chunks, hybrid RRF + rerank, parent expansion,
streaming generation) on the labelled questions (document scope, as in the app) and on the
out-of-scope negatives (corpus scope), then measures:

  TTFT            time from request start (incl. retrieval) to the first streamed token
  E2E latency     time to the last token
  faithfulness    LLM judge: every claim in the answer is supported by the provided sources
  correctness     LLM judge: the answer states the gold answer
  citation        gold-cited rate (answer cites a source containing the gold evidence) and
                  citation precision (share of citations whose source contains the evidence;
                  a strict lower bound, since a non-gold source can still support a claim)
  abstention      negatives that abstain (want 1.0) and answerable questions that abstain (want 0)

Results are cached per question under results/rows/gen__*.json so the run can be resumed
(``--limit N`` processes at most N new questions per invocation). The corpus must already be
ingested by run_retrieval.py (``ingest --strategy parent_child``).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(REPO))

from scripts.eval.dataset import build, normalise  # noqa: E402
from scripts.eval.run_retrieval import RESULTS, ROWS, eval_db_url, owner_for  # noqa: E402

JUDGE_SYSTEM = (
    "You are a strict evaluator of answers produced by a document question-answering system. "
    "Reply with a single JSON object and nothing else."
)
JUDGE_TEMPLATE = """Sources given to the system:
{sources}

Question: {question}
Gold answer: {gold}
System answer: {answer}

Evaluate:
- "faithful": true if every factual claim in the system answer is supported by the sources
  (ignore citation markers like [S1]); false if any claim is unsupported or contradicted.
- "correct": true if the system answer contains the information in the gold answer (paraphrase is fine).
- "unsupported": list of unsupported claims (empty if none).
Return JSON: {{"faithful": bool, "correct": bool, "unsupported": [str]}}"""


def parse_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError(f"no JSON in judge output: {text[:200]}")
    return json.loads(match.group(0))


async def judge(llm, question: str, gold: str, answer: str, sources: str) -> dict:
    from app.providers.llm import ChatMessage

    prompt = JUDGE_TEMPLATE.format(sources=sources[:12000], question=question, gold=gold, answer=answer)
    for attempt in range(3):
        result = await llm.complete(
            [ChatMessage("system", JUDGE_SYSTEM), ChatMessage("user", prompt)],
            max_tokens=400,
            temperature=0.0,
        )
        try:
            return parse_json(result.text) | {"judge_model": result.model}
        except (ValueError, json.JSONDecodeError):
            if attempt == 2:
                raise
    raise RuntimeError("unreachable")


async def run(limit: int, judge_model: str | None, pause_s: float) -> None:
    from app.config import Settings
    from app.db.session import Database
    from app.generation.prompts import render_sources
    from app.generation.service import RAGService
    from app.providers.embeddings import FastEmbedEmbeddings
    from app.providers.llm import FallbackLLM, GroqLLM
    from app.providers.rerank import FastEmbedReranker
    from app.retrieval.retriever import HybridRetriever
    from scripts.eval.run_retrieval import Ctx

    settings = Settings(database_url=eval_db_url(), worker_enabled=False)
    if not settings.groq_api_key:
        raise SystemExit("GROQ_API_KEY is not set")
    db = Database(settings)
    embedder = FastEmbedEmbeddings(settings)
    reranker = FastEmbedReranker(settings)
    llm = FallbackLLM([GroqLLM(settings)])
    judge_llm = FallbackLLM([GroqLLM(settings, model=judge_model)]) if judge_model else llm
    rag = RAGService(settings, HybridRetriever(settings, embedder, reranker), llm)
    ids = await Ctx(eval_db_url()).doc_ids("parent_child")
    owner = owner_for("parent_child")
    es = build()

    work = [("pos", it.qid, it.question, it.filename, it) for it in es.items]
    work += [("neg", f"neg-{i}", q, None, None) for i, q in enumerate(es.negatives)]
    done = 0
    for kind, qid, question, filename, item in work:
        path = ROWS / f"gen__{qid}.json"
        if path.exists():
            continue
        if done >= limit:
            break
        doc_ids = [ids[filename]] if filename else list(ids.values())
        t0 = time.perf_counter()
        async with db.sessionmaker() as s:
            prepared = await rag.prepare(s, owner, doc_ids, question)
        ttft = None
        answer = None
        async for event, payload in rag.stream(prepared):
            if event == "token" and ttft is None:
                ttft = (time.perf_counter() - t0) * 1000
            elif event == "answer":
                answer = payload
        e2e = (time.perf_counter() - t0) * 1000
        blocks = {b.source_id: b for b in prepared.blocks}
        row = {
            "qid": qid,
            "kind": kind,
            "question": question,
            "answer": answer.text,
            "abstained": answer.abstained,
            "retrieval_abstained": prepared.abstain,
            "model": answer.model,
            "ttft_ms": round(ttft or e2e, 1),
            "e2e_ms": round(e2e, 1),
            "retrieval_ms": prepared.retrieval_ms,
            "citations": [c["source_id"] for c in answer.citations],
        }
        if item is not None:
            gold_blocks = [sid for sid, b in blocks.items() if item.is_relevant(b.filename, b.text)]
            row["gold_in_context"] = bool(gold_blocks)
            row["cited_gold"] = any(c in gold_blocks for c in row["citations"])
            row["citation_precision"] = (
                sum(c in gold_blocks for c in row["citations"]) / len(row["citations"])
                if row["citations"]
                else None
            )
            golden_answer = next(
                (
                    g["answer"]
                    for g in json.loads((REPO / "tests/evaluation/golden_dataset.json").read_text())
                    if normalise(g["question"]) == normalise(question)
                ),
                item.evidence,
            )
            if not answer.abstained:
                await asyncio.sleep(pause_s)
                verdict = await judge(
                    judge_llm, question, golden_answer, answer.text, render_sources(prepared.blocks)
                )
                row |= {
                    "faithful": bool(verdict.get("faithful")),
                    "correct": bool(verdict.get("correct")),
                    "unsupported": verdict.get("unsupported", []),
                    "judge_model": verdict.get("judge_model"),
                }
        path.write_text(json.dumps(row, indent=2))
        print(
            json.dumps({k: row.get(k) for k in ("qid", "abstained", "faithful", "correct", "ttft_ms")}),
            flush=True,
        )
        done += 1
        await asyncio.sleep(pause_s)
    await llm.aclose()
    await db.dispose()


def report() -> dict:
    rows = [json.loads(p.read_text()) for p in sorted(ROWS.glob("gen__*.json"))]
    pos = [r for r in rows if r["kind"] == "pos"]
    neg = [r for r in rows if r["kind"] == "neg"]
    answered = [r for r in pos if not r["abstained"]]
    judged = [r for r in answered if "faithful" in r]
    cited = [r for r in answered if r["citation_precision"] is not None]

    def mean(xs: list[float]) -> float | None:
        return round(statistics.mean(xs), 3) if xs else None

    def p(xs: list[float], q: float) -> float | None:
        if not xs:
            return None
        xs = sorted(xs)
        return round(xs[min(len(xs) - 1, round(q * (len(xs) - 1)))], 1)

    summary = {
        "answerable_questions": len(pos),
        "negatives": len(neg),
        "answer_model": next((r["model"] for r in answered if r.get("model")), None),
        "judge_model": next((r["judge_model"] for r in judged if r.get("judge_model")), None),
        "faithfulness": mean([float(r["faithful"]) for r in judged]),
        "correctness": mean([float(r["correct"]) for r in judged]),
        "correct_over_all_answerable": round(sum(r.get("correct", False) for r in pos) / len(pos), 3)
        if pos
        else None,
        "gold_cited_rate": mean([float(r["cited_gold"]) for r in answered]),
        "citation_precision": mean([r["citation_precision"] for r in cited]),
        "answers_without_citations": sum(1 for r in answered if not r["citations"]),
        "false_abstention_rate": mean([float(r["abstained"]) for r in pos]),
        "negative_abstention_rate": mean([float(r["abstained"]) for r in neg]),
        "gold_in_context_rate": mean([float(r["gold_in_context"]) for r in pos]),
        "ttft_ms_p50": p([r["ttft_ms"] for r in rows if not r["retrieval_abstained"]], 0.5),
        "ttft_ms_p95": p([r["ttft_ms"] for r in rows if not r["retrieval_abstained"]], 0.95),
        "e2e_ms_p50": p([r["e2e_ms"] for r in rows if not r["retrieval_abstained"]], 0.5),
        "e2e_ms_p95": p([r["e2e_ms"] for r in rows if not r["retrieval_abstained"]], 0.95),
    }
    (RESULTS / "generation.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    print(json.dumps(summary, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("cmd", choices=["run", "report"])
    parser.add_argument("--limit", type=int, default=10_000)
    parser.add_argument(
        "--judge-model", default=None, help="Groq model id for the judge (default: answer model)"
    )
    parser.add_argument("--pause", type=float, default=1.0, help="seconds between LLM calls (rate limits)")
    args = parser.parse_args()
    ROWS.mkdir(parents=True, exist_ok=True)
    if args.cmd == "run":
        asyncio.run(run(args.limit, args.judge_model, args.pause))
    report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
