import { FileText, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "./useLanding";

/*
  Interactive product preview. The question, answer and passages are built from the repo's own
  e2e fixture (frontend/e2e/fixtures/services-agreement.pdf, page 2), so nothing is invented.
  The answer "streams" on a timer; citation chips switch the source panel, like the real app.
*/
const SOURCES = {
  S1: {
    page: 2,
    section: "3. Termination",
    text: "Either party may terminate this Agreement for convenience on ninety days written notice to the other party.",
  },
  S2: {
    page: 2,
    section: "3. Termination",
    text: "Either party may terminate immediately if the other party commits a material breach that is not remedied within thirty days of written notice.",
  },
} as const;
type SourceId = keyof typeof SOURCES;

const PARTS: Array<{ text: string } | { cite: SourceId }> = [
  { text: "Yes. Either party can terminate for convenience on ninety days' written notice to the other party" },
  { cite: "S1" },
  { text: ". For a material breach, termination is immediate only if the breach is not remedied within thirty days of written notice" },
  { cite: "S2" },
  { text: "." },
];
const SIZES = PARTS.map((p) => ("text" in p ? p.text.length : 1));
const STARTS = SIZES.map((_, i) => SIZES.slice(0, i).reduce((a, b) => a + b, 0));
const TOTAL = SIZES.reduce((a, b) => a + b, 0);

export function HeroDemo() {
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);
  const [run, setRun] = useState(0);
  const [active, setActive] = useState<SourceId>("S1");
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = reduced ? TOTAL : progress;
  const done = shown >= TOTAL;

  useEffect(() => {
    if (reduced) return;
    const el = rootRef.current;
    let timer = 0;
    let start = 0;
    const tick = () => {
      start += 3;
      setProgress(Math.min(start, TOTAL));
      if (start < TOTAL) timer = window.setTimeout(tick, 28);
    };
    const begin = () => {
      start = 0;
      setProgress(0);
      timer = window.setTimeout(tick, 900);
    };
    if (!el || typeof IntersectionObserver === "undefined") {
      begin();
      return () => window.clearTimeout(timer);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          begin();
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [reduced, run]);

  const src = SOURCES[active];

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-2xl border border-line bg-surface/90 text-left shadow-lg backdrop-blur-sm"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2/70 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="ml-2 truncate font-mono text-2xs text-fg-subtle">open-doc · chat · services-agreement.pdf</span>
      </div>

      <div className="grid md:grid-cols-[1.35fr_1fr]">
        {/* Chat column */}
        <div className="space-y-4 p-4 sm:p-5">
          <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-surface-3 px-3.5 py-2 text-sm text-fg">
            Can either party terminate for convenience?
          </div>
          <div className="text-sm leading-6 text-fg" aria-live="polite" aria-atomic="false">
            <p className="sr-only">Example answer from OpenDoc with two citations.</p>
            <p aria-hidden={!done}>
              {PARTS.map((p, i) => {
                const avail = shown - STARTS[i];
                if ("text" in p) {
                  const take = Math.max(0, Math.min(p.text.length, avail));
                  return take > 0 ? <span key={i}>{p.text.slice(0, take)}</span> : null;
                }
                if (avail < 1) return null;
                const n = p.cite.slice(1);
                const isActive = active === p.cite;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActive(p.cite)}
                    aria-pressed={isActive}
                    aria-label={`Source ${n}: services-agreement.pdf, page ${SOURCES[p.cite].page}`}
                    className={cn(
                      "relative mx-0.5 inline-flex h-[1.2rem] min-w-[1.2rem] -translate-y-px items-center justify-center rounded px-1 align-middle font-mono text-2xs font-medium transition-colors",
                      "after:absolute after:-inset-3 after:content-['']",
                      isActive ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-soft-fg hover:bg-accent hover:text-accent-fg",
                    )}
                  >
                    {n}
                  </button>
                );
              })}
              {!done && <span className="landing-caret ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-accent" aria-hidden />}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-subtle">
            <span className="rounded-full border border-line px-2 py-0.5">2 sources cited</span>
            <span className="rounded-full border border-line px-2 py-0.5">Tap a number to open its passage</span>
            {!reduced && (
              <button
                type="button"
                onClick={() => setRun((r) => r + 1)}
                className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <RotateCcw className="size-3.5" aria-hidden /> Replay
              </button>
            )}
          </div>
        </div>

        {/* Source column */}
        <div className="border-t border-line bg-surface-2/50 p-4 sm:p-5 md:border-t-0 md:border-l">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <span className="grid size-7 place-items-center rounded-md bg-danger-soft text-danger">
              <FileText className="size-4" aria-hidden />
            </span>
            <span className="truncate">services-agreement.pdf</span>
          </div>
          <div key={active} className="mt-3 animate-pop-in rounded-xl border border-accent/40 bg-accent-soft/60 p-3">
            <p className="font-mono text-2xs font-medium tracking-wide text-accent-soft-fg uppercase">
              Cited passage · page {src.page}
            </p>
            <p className="mt-1.5 text-sm leading-6 text-fg">&ldquo;{src.text}&rdquo;</p>
          </div>
          <p className="mt-3 text-2xs text-fg-subtle">
            Section <span className="text-fg-muted">{src.section}</span>. In the app, the PDF opens on this page with the
            passage highlighted.
          </p>
        </div>
      </div>
    </div>
  );
}
