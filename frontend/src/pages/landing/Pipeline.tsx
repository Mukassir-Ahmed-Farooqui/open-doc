import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useAutoCycle, usePrefersReducedMotion } from "./useLanding";

/* Stages and details follow README.md / docs/ARCHITECTURE.md / docs/BENCHMARKS.md. */
const STAGES = [
  {
    key: "ingest",
    label: "Ingest",
    tech: "magic-byte check · per-user dedupe",
    detail:
      "Uploads are validated by file signature, deduplicated per user, stored, and acknowledged with 202. A Postgres-backed job queue feeds an in-process worker; failures retry with backoff.",
  },
  {
    key: "parse",
    label: "Parse",
    tech: "PyMuPDF · python-docx",
    detail:
      "PDFs are read block by block with page numbers, heading detection from font size and the outline, and running headers/footers removed. DOCX, Markdown and text keep their heading structure.",
  },
  {
    key: "chunk",
    label: "Parent-child chunk",
    tech: "sections → ~300-token children",
    detail:
      "Structure-aware sections become parents; ~300-token children are what gets searched. Retrieval matches small children, then hands the model the whole parent clause with its heading.",
  },
  {
    key: "embed",
    label: "Embed",
    tech: "bge-small-en-v1.5 · ONNX",
    detail: "Children are embedded locally with fastembed (ONNX, no API key) and written in one transaction to Postgres with pgvector.",
  },
  {
    key: "retrieve",
    label: "Hybrid retrieve",
    tech: "dense HNSW + sparse tsvector",
    detail:
      "Every question runs two searches over your selected documents: pgvector HNSW cosine (dense) and Postgres full-text (sparse), 30 candidates each, always filtered to your own documents.",
  },
  {
    key: "fuse",
    label: "RRF fusion",
    tech: "Reciprocal Rank Fusion, k=60",
    detail: "The two ranked lists are merged with Reciprocal Rank Fusion, so a passage that ranks well in either search rises to the top.",
  },
  {
    key: "rerank",
    label: "Rerank",
    tech: "optional · MiniLM cross-encoder",
    detail:
      "When enabled, a cross-encoder rescores the top candidates and its score drives abstention. It is optional: small hosts (512 MB) run with RERANKER_PROVIDER=none and fall back to hybrid RRF.",
  },
  {
    key: "answer",
    label: "Answer + cite",
    tech: "parent expansion · streaming",
    detail:
      "Child hits expand to their parent sections and stream to the LLM as numbered sources. Only sources the answer actually cites become citations; weak evidence abstains instead of guessing.",
  },
] as const;

export function Pipeline() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useAutoCycle(STAGES.length, 2400, visible && !paused && !reduced);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const stage = STAGES[active];

  return (
    <div ref={ref} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <ol
        className="relative grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8"
        aria-label="OpenDoc retrieval-augmented generation pipeline"
      >
        {/* connector rail (desktop) */}
        <span className="pointer-events-none absolute top-1/2 right-6 left-6 hidden h-px -translate-y-1/2 overflow-hidden bg-line lg:block" aria-hidden>
          <span className="landing-pulse absolute inset-y-0 left-0 w-1/4 bg-linear-to-r from-transparent via-accent to-transparent" />
        </span>
        {STAGES.map((s, i) => {
          const on = i === active;
          const past = i < active;
          return (
            <li key={s.key} className="relative">
              <button
                type="button"
                onClick={() => {
                  setActive(i);
                  setPaused(true);
                }}
                onFocus={() => setPaused(true)}
                aria-pressed={on}
                aria-controls="pipeline-detail"
                className={cn(
                  "relative flex h-full min-h-[5.5rem] w-full flex-col justify-between rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-300",
                  on
                    ? "scale-[1.02] border-accent bg-surface shadow-lg ring-4 ring-accent/15"
                    : past
                      ? "border-accent/30 bg-surface hover:border-accent/60"
                      : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span className={cn("font-mono text-2xs", on ? "text-accent" : "text-fg-subtle")}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mt-2 text-sm leading-5 font-semibold text-fg">{s.label}</span>
                <span className="mt-1 line-clamp-2 text-2xs text-fg-muted">{s.tech}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        id="pipeline-detail"
        aria-live="polite"
        className="mt-5 grid gap-4 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:grid-cols-[auto_1fr] sm:items-start sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-accent font-mono text-sm font-semibold text-accent-fg">
            {String(active + 1).padStart(2, "0")}
          </span>
          <div className="sm:hidden">
            <p className="font-semibold text-fg">{stage.label}</p>
            <p className="font-mono text-2xs text-fg-subtle">{stage.tech}</p>
          </div>
        </div>
        <div>
          <p className="hidden font-semibold text-fg sm:block">
            {stage.label} <span className="ml-2 font-mono text-2xs font-normal text-fg-subtle">{stage.tech}</span>
          </p>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{stage.detail}</p>
        </div>
      </div>
    </div>
  );
}
