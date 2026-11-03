# Benchmarks

Every number on this page is copied from the committed result files of the retrieval benchmark:
`scripts/eval/results/retrieval.json` (summary) and `scripts/eval/results/rows/*.json` (one file per
configuration, plus `calibration.json` and `ingest__*.json`). Nothing here is estimated. The memory
numbers are the one exception, and they are labelled as such (see [Memory](#memory)).

Reproduce with `python scripts/eval/fetch_corpus.py` and then `python scripts/eval/run_retrieval.py all`
(needs a Postgres with pgvector in `EVAL_DATABASE_URL`). The script's docstring defines every metric.

## Eval set

| | |
|---|---|
| Corpus | 8 PDFs: `tests/fixtures/alpha_contract.pdf` plus 7 CUAD development agreements (CC BY 4.0, pinned revision, fetched by `scripts/eval/fetch_corpus.py`) |
| Scored questions | **38** (34 golden + 4 fact questions, each with one gold evidence span) |
| Out-of-scope negatives | 8 (`scripts/eval/negatives.json`), used only for abstention calibration |
| Relevance | binary: a chunk is relevant when it comes from the question's document and contains the gold evidence (`scripts/eval/dataset.py`) |
| Top-k | 10 |

### Excluded items (and why)

| Excluded | Count | Reason |
|---|---|---|
| Golden items on `Eslab (2).pdf` | 9 | PDF is not in the repo or in CUAD |
| Fact questions on `beta_contract.pdf` | 3 | PDF is not in the repo or in CUAD |
| Golden `Cross-Document` items | 5 | Gold answers contradict the fixture text (e.g. they say Alpha is governed by New York law; the PDF says California) |
| Comparison questions | 4 | No evidence span to score retrieval against |
| Summary questions | 6 | No evidence span to score retrieval against |

So 12 questions reference missing PDFs and 5 cross-document items were dropped as wrong. One scored
item (`golden-28`) has no chunk that matches its evidence span under `parent_child` chunking, so
recall for every `parent_child` row is capped at 37/38 = 0.974.

### Scopes

* **corpus**: all 8 documents selected. Harder, and it separates the configurations.
* **document**: only the question's own document selected. This is how the app is normally used.

## Retrieval results

Configurations (from `CONFIGS` in `scripts/eval/run_retrieval.py`; all other settings are the
`app.config.Settings` defaults):

| Name | What it is |
|---|---|
| `dense` | pgvector HNSW cosine, bge-small-en-v1.5 with the BGE query instruction |
| `dense_no_query_prefix` | same, with `EMBEDDING_QUERY_PREFIX=""` |
| `sparse` | Postgres full-text (`tsvector` + GIN, `ts_rank`) |
| `hybrid_rrf` | dense + sparse, 30 candidates each, Reciprocal Rank Fusion (k=60) |
| `hybrid_rrf_rerank` | `hybrid_rrf`, then cross-encoder (ms-marco-MiniLM-L-6-v2) over the top 12, heading + first 160 words. **Production default** |
| `hybrid_rrf_rerank20_full` | rerank over the top 20 with the full passage text |

Chunking: `parent_child` is production (structure-aware sections with ~300-token children);
`recursive` is the fixed-size baseline.

Latency is the wall time of one `retrieve()` call with the query-embedding cache cleared, measured on
the CPU-only sandbox the benchmark ran in. Treat it as relative, not as a production SLA.

| chunking | retrieval | scope | R@1 | R@5 | R@10 | P@5 | MRR@10 | nDCG@10 | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|
| parent_child | dense | corpus | 0.474 | 0.500 | 0.605 | 0.100 | 0.493 | 0.519 | 17.2 | 26.5 |
| parent_child | dense_no_query_prefix | corpus | 0.368 | 0.500 | 0.658 | 0.100 | 0.440 | 0.491 | 14.2 | 23.7 |
| parent_child | hybrid_rrf | corpus | 0.447 | 0.684 | 0.816 | 0.142 | 0.547 | 0.614 | 54.6 | 70.3 |
| parent_child | hybrid_rrf_rerank | corpus | 0.605 | 0.763 | 0.816 | 0.158 | 0.663 | 0.695 | 900.2 | 987.3 |
| parent_child | hybrid_rrf_rerank20_full | corpus | 0.605 | 0.816 | 0.842 | 0.168 | 0.691 | 0.724 | 1953.6 | 2133.1 |
| parent_child | sparse | corpus | 0.447 | 0.816 | 0.895 | 0.174 | 0.593 | 0.667 | 4.8 | 10.0 |
| recursive | dense | corpus | 0.211 | 0.553 | 0.632 | 0.121 | 0.353 | 0.396 | 17.0 | 21.3 |
| recursive | hybrid_rrf | corpus | 0.342 | 0.658 | 0.737 | 0.153 | 0.475 | 0.513 | 56.4 | 83.6 |
| recursive | hybrid_rrf_rerank | corpus | 0.526 | 0.658 | 0.763 | 0.147 | 0.582 | 0.585 | 981.1 | 2210.6 |
| recursive | sparse | corpus | 0.447 | 0.658 | 0.816 | 0.163 | 0.531 | 0.590 | 6.5 | 16.7 |
| parent_child | dense | document | 0.842 | 0.895 | 0.921 | 0.184 | 0.857 | 0.872 | 16.5 | 26.0 |
| parent_child | dense_no_query_prefix | document | 0.737 | 0.868 | 0.895 | 0.179 | 0.793 | 0.818 | 12.5 | 26.2 |
| parent_child | hybrid_rrf | document | 0.842 | 0.947 | 0.947 | 0.200 | 0.873 | 0.893 | 43.9 | 62.5 |
| parent_child | hybrid_rrf_rerank | document | 0.816 | 0.895 | 0.921 | 0.184 | 0.846 | 0.860 | 872.4 | 966.5 |
| parent_child | hybrid_rrf_rerank20_full | document | 0.842 | 0.947 | 0.947 | 0.195 | 0.882 | 0.894 | 1681.0 | 1878.0 |
| parent_child | sparse | document | 0.605 | 0.974 | 0.974 | 0.205 | 0.757 | 0.812 | 1.9 | 2.3 |
| recursive | dense | document | 0.579 | 0.974 | 0.974 | 0.216 | 0.729 | 0.773 | 14.9 | 22.8 |
| recursive | hybrid_rrf | document | 0.711 | 0.974 | 1.000 | 0.226 | 0.828 | 0.855 | 40.2 | 60.8 |
| recursive | hybrid_rrf_rerank | document | 0.816 | 0.868 | 1.000 | 0.200 | 0.855 | 0.854 | 917.3 | 1741.3 |
| recursive | sparse | document | 0.789 | 1.000 | 1.000 | 0.242 | 0.862 | 0.890 | 2.3 | 8.1 |

### What the numbers say

* **Corpus scope (the discriminating case).** Reranking is the biggest single gain:
  `parent_child` R@1 goes from 0.447 (`hybrid_rrf`) to 0.605 (`hybrid_rrf_rerank`), MRR@10 from 0.547
  to 0.663, nDCG@10 from 0.614 to 0.695. `sparse` alone has the best R@10 (0.895) but a weak R@1 (0.447).
* **Document scope (normal app use).** Everything is close. `hybrid_rrf` (MRR@10 0.873) and
  `hybrid_rrf_rerank20_full` (0.882) lead; the production rerank setting (12 candidates, 160 words) is
  slightly lower at 0.846. In a single document reranking costs a little quality and ~0.85 s.
* **Wider rerank** (`rerank20_full`) is the best row in both scopes but roughly doubles rerank latency
  (p50 1953.6 ms corpus / 1681.0 ms document vs 900.2 / 872.4 ms).
* **BGE query instruction helps:** dense R@1 0.474 vs 0.368 (corpus) and 0.842 vs 0.737 (document)
  with vs without the prefix, which is why `EMBEDDING_QUERY_PREFIX` defaults to it.
* **Parent-child chunking beats recursive** on corpus scope for dense, hybrid and rerank
  (e.g. `hybrid_rrf_rerank` MRR@10 0.663 vs 0.582). On document scope `recursive` + `sparse` is
  strong (MRR@10 0.862), but parent-child is kept because parents give the LLM whole clauses with
  headings for citations.

### Default configuration

`hybrid_rrf_rerank` on `parent_child` chunks, i.e. the `Settings` defaults
(`RERANKER_PROVIDER=fastembed`, `RERANK_CANDIDATES=12`, `RERANK_PASSAGE_WORDS=160`, `RRF_K=60`,
`RETRIEVAL_CANDIDATES=30`). Reasons:

1. Best R@1 / MRR / nDCG on corpus-wide questions among the configurations under ~1 s.
2. The rerank score is the only score that separates answerable from out-of-scope questions
   (next section), which is what abstention relies on.
3. The cost (~0.85-0.95 s/query in the table above; ~140 MB RAM per the `.env.example` note) is acceptable on a 1 GB instance. On 512 MB hosts set
   `RERANKER_PROVIDER=none`; retrieval falls back to `hybrid_rrf` (document-scope MRR@10 0.873,
   corpus 0.547) and abstention to the weaker dense threshold.

## Abstention calibration

From `rows/calibration.json` (8 negatives, `parent_child`, hybrid retrieval) compared with the
`top1_scores` of the 38 answerable questions in the query rows.

| Score | Negatives (top-1) | Answerable questions (top-1) | Threshold | Result |
|---|---|---|---|---|
| Cross-encoder rerank | 8 values (corpus scope), **-11.032 to -9.555** | `hybrid_rrf_rerank`: min -4.805 (corpus), -8.155 (document); max 9.444 | `MIN_RERANK_SCORE=-9.0` | Clean separation on this set: 0/8 negatives above the threshold, 0/38 answerable below it, in both scopes |
| Dense cosine | 72 values (8 negatives x corpus + each single-document scope), **0.384 to 0.608** | `hybrid_rrf`: min 0.633 (corpus), 0.547 (document); max 0.894 | `MIN_DENSE_SCORE=0.50` | Overlaps: 29/72 negative scores are >= 0.50 (would not abstain); in document scope 5/38 answerable scores are <= the highest negative (0.608), so no cosine threshold separates them |

The rerank threshold sits in the gap between the highest negative (-9.555) and the lowest answerable
question (-8.155). Eight negatives is a small sample, so treat -9.0 as a starting point. The dense
threshold only applies with `RERANKER_PROVIDER=none` and lets many out-of-scope questions through to
the LLM, where the prompt's "insufficient evidence" instruction is the remaining guard.

## Ingestion timings

Wall time of `ingest_document()` per file (parse, chunk, embed, write), from `rows/ingest__*.json`,
in the same sandbox as the latency numbers.

| document | recursive (s) | parent_child (s) |
|---|---|---|
| alpha_contract.pdf | 0.83 | 0.69 |
| AimmuneTherapeuticsInc_20200205_8-K_EX-10.3_11967170_EX-10.3_Development Agreement.pdf | 30.67 | 25.0 |
| ArcaUsTreasuryFund_20200207_N-2_EX-99.K5_11971930_EX-99.K5_Development Agreement.pdf | 3.0 | 2.71 |
| ConformisInc_20191101_10-Q_EX-10.6_11861402_EX-10.6_Development Agreement.pdf | 7.41 | 7.78 |
| EtonPharmaceuticalsInc_20191114_10-Q_EX-10.1_11893941_EX-10.1_Development Agreement.pdf | 10.92 | 9.38 |
| LiquidmetalTechnologiesInc_20200205_8-K_EX-10.1_11968198_EX-10.1_Development Agreement.pdf | 15.5 | 13.47 |
| PelicanDeliversInc_20200211_S-1_EX-10.3_11975895_EX-10.3_Development Agreement2.pdf | 6.06 | 5.78 |
| ReedsInc_20191113_10-Q_EX-10.4_11888303_EX-10.4_Development Agreement.pdf | 4.09 | 3.77 |
| **total** | 78.48 | 68.58 |


## Memory

These numbers are **not** in the committed result files. They were measured during development as
process RSS of the API (`psutil`, one uvicorn worker, `MALLOC_ARENA_MAX=2`) and are reproduced here as
reported:

| State | RSS |
|---|---|
| Idle, models lazy-loaded (`WARM_MODELS_ON_STARTUP=false`, default) | 104 MB |
| Idle, embedder + reranker warmed (`WARM_MODELS_ON_STARTUP=true`) | 374 MB |
| Peak while ingesting a PDF, reranker enabled | 476 MB |

**ONNX arena fix.** ONNX Runtime's CPU memory arena keeps peak activation buffers allocated. The
comment on `onnx_mem_arena` in `backend/app/config.py` records ~700 MB RSS after one embedding batch with
the arena vs ~230 MB without it, so `ONNX_MEM_ARENA=false` is the default, together with small embedding
batches (`EMBEDDING_BATCH_SIZE=4`).

Sizing that follows: 1 GB leaves headroom with the reranker on; 512 MB is tight with it, so use
`RERANKER_PROVIDER=none` there (see [DEPLOY.md](DEPLOY.md)).

## Generation metrics: NOT YET RUN

`scripts/eval/run_generation.py` measures faithfulness (LLM judge), answer correctness, citation
accuracy (gold-cited rate and citation precision), abstention rates, TTFT and end-to-end latency
against the live Groq API. It has **not been run yet**, so there are no numbers for:

| Metric | Status |
|---|---|
| Faithfulness | NOT YET RUN |
| Answer correctness | NOT YET RUN |
| Citation accuracy | NOT YET RUN |
| Abstention on negatives / false abstention | NOT YET RUN |
| TTFT | NOT YET RUN |
| End-to-end latency | NOT YET RUN |

Run it with `GROQ_API_KEY` set after `run_retrieval.py ingest --strategy parent_child`; results land in
`scripts/eval/results/rows/gen__*.json`.
