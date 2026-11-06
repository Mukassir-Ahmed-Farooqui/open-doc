import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import { QuestionHeading } from "@/components/chat/Messages";
import { SourcePanel } from "@/components/chat/SourcePanel";
import { DocIcon } from "@/components/documents/DocIcon";
import { ProgressBar, StatusBadge } from "@/components/ui/StatusBadge";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { Citation, DocumentStatus, SummaryStyle } from "@/lib/api/schemas";
import { citationMap } from "@/lib/citations";
import { cn } from "@/lib/cn";

/*
  Live preview built from the app's real components (Composer, research-note Markdown with
  citation chips, SourcePanel, DocIcon, StatusBadge) fed static demo data. The question and
  passages come from frontend/e2e/fixtures/services-agreement.pdf. No network calls.
*/

const DOC = "services-agreement.pdf";
const QUESTION = "How much notice is needed to terminate the agreement for convenience?";
const ANSWER =
  "Either party can end the agreement for convenience with **ninety days' written notice** to the other party【S1】. " +
  "A material breach is different: termination can be immediate if the breach isn't remedied within thirty days of written notice【S1】. " +
  "The agreement began on 1 March 2026 for an initial term of twenty-four months【S2】.";
const CITATIONS: Citation[] = [
  {
    source_id: "S1",
    doc_id: "demo",
    document: DOC,
    page: 2,
    section: "3. Termination",
    snippet: "Either party may terminate this Agreement for convenience on ninety days written notice to the other party.",
  },
  {
    source_id: "S2",
    doc_id: "demo",
    document: DOC,
    page: 1,
    section: "2. Term",
    snippet: "The Agreement starts on 1 March 2026 and continues for an initial term of twenty-four months, renewing automatically for successive twelve-month periods.",
  },
];
const PAGES: Record<number, { heading: string; paras: string[] }> = {
  1: {
    heading: "MASTER SERVICES AGREEMENT",
    paras: [
      "1. Parties. This Master Services Agreement is entered into between Northwind Analytics Ltd (the Supplier) and Contoso Retail plc (the Customer).",
      CITATIONS[1].snippet,
    ],
  },
  2: {
    heading: "3. TERMINATION",
    paras: [
      CITATIONS[0].snippet,
      "Either party may terminate immediately if the other party commits a material breach that is not remedied within thirty days of written notice.",
    ],
  },
};

const STEPS = ["Ingest", "Ask", "Cited answer", "Open page"] as const;
type Step = 0 | 1 | 2 | 3;

export function ProductPreview() {
  const [step, setStep] = useState<Step>(2);
  const [active, setActive] = useState<string>("S1");
  const page = CITATIONS.find((c) => c.source_id === active)?.page ?? 2;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
      <div role="tablist" aria-label="Product preview steps" className="flex overflow-x-auto border-b border-line bg-surface-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            role="tab"
            id={`preview-tab-${i}`}
            aria-selected={step === i}
            aria-controls="preview-panel"
            onClick={() => setStep(i as Step)}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm whitespace-nowrap transition-colors",
              step === i ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            <span className="font-mono text-2xs text-fg-subtle tabular-nums">{i + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <div id="preview-panel" role="tabpanel" aria-labelledby={`preview-tab-${step}`} className="h-[30rem] sm:h-[27rem]">
        {step === 0 && <IngestStep onDone={() => setStep(1)} />}
        {step === 1 && <AskStep onAsk={() => setStep(2)} />}
        {step === 2 && (
          <AnswerStep
            active={active}
            onCite={setActive}
            onOpen={(id) => {
              setActive(id);
              setStep(3);
            }}
          />
        )}
        {step === 3 && <PageStep page={page} onBack={() => setStep(2)} />}
      </div>
    </div>
  );
}

function IngestStep({ onDone }: { onDone: () => void }) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [t, setT] = useState(reduced ? 100 : 0);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setT((v) => Math.min(100, v + 4)), 90);
    return () => window.clearInterval(id);
  }, [reduced]);
  const rows: { name: string; type: string; status: DocumentStatus; progress: number; meta: string }[] = [
    { name: DOC, type: "application/pdf", ...phase(t), meta: "3.2 KB · 3 pages" },
    { name: "handbook.md", type: "text/markdown", ...phase(Math.min(100, t * 1.4)), meta: "293 B · 1 page" },
  ];
  return (
    <div className="flex h-full flex-col p-5 sm:p-7">
      <p className="text-sm font-medium text-fg">Upload a few files</p>
      <p className="mt-1 text-sm text-fg-muted">They're parsed by structure, split into sections and indexed for hybrid search.</p>
      <ul className="mt-5 divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3 py-3">
            <DocIcon filename={r.name} contentType={r.type} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="font-mono text-2xs text-fg-subtle">{r.meta}</p>
              {r.status === "processing" && <ProgressBar className="mt-1.5 max-w-48" value={r.progress} label={`Indexing ${r.name}`} />}
            </div>
            <StatusBadge status={r.status} progress={r.progress} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onDone}
        className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-end text-sm font-medium text-accent-soft-fg hover:underline"
      >
        Next: ask a question <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function phase(t: number): { status: DocumentStatus; progress: number } {
  if (t < 18) return { status: "queued", progress: 0 };
  if (t < 100) return { status: "processing", progress: Math.round(((t - 18) / 82) * 100) };
  return { status: "ready", progress: 100 };
}

function AskStep({ onAsk }: { onAsk: () => void }) {
  const [style, setStyle] = useState<SummaryStyle>("executive");
  return (
    <div className="flex h-full flex-col justify-end gap-6 p-5 sm:p-7">
      <div>
        <p className="font-serif text-2xl font-semibold text-fg">What do you want to find out?</p>
        <p className="mt-1.5 text-sm text-fg-muted">Answers come only from the documents in scope. Press Enter to send the sample question.</p>
      </div>
      <Composer
        initialText={QUESTION}
        onSend={onAsk}
        onStop={() => undefined}
        streaming={false}
        style={style}
        onStyleChange={setStyle}
        scope={
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-surface-2 px-2 text-sm text-fg">
            <FileText className="size-3.5" aria-hidden /> {DOC}
          </span>
        }
      />
    </div>
  );
}

function AnswerStep({ active, onCite, onOpen }: { active: string; onCite: (id: string) => void; onOpen: (id: string) => void }) {
  const cites = useMemo(() => citationMap(CITATIONS), []);
  // SourcePanel links to the real viewer; inside the preview, "Open page" moves to step 4 instead.
  const intercept = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a) {
      e.preventDefault();
      onOpen(active);
    }
  };
  return (
    <div className="grid h-full md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="overflow-y-auto p-5 sm:p-7">
        <QuestionHeading content={QUESTION} first compact />
        <div className="preview-note mt-4">
          <Markdown variant="note" content={ANSWER} citations={cites} onCite={onCite} activeCite={active} />
        </div>
        <p className="mt-4 font-mono text-2xs text-fg-subtle">2 sources · {DOC}</p>
      </div>
      <div className="hidden border-l border-line md:block" onClickCapture={intercept}>
        <SourcePanel citations={CITATIONS} active={active} onSelect={onCite} />
      </div>
      <div className="border-t border-line px-5 py-3 md:hidden">
        <button type="button" onClick={() => onOpen(active)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent-soft-fg">
          Open the cited page <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function PageStep({ page, onBack }: { page: number; onBack: () => void }) {
  const content = PAGES[page] ?? PAGES[2];
  const cited = CITATIONS.find((c) => c.page === page) ?? CITATIONS[0];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-line px-5 py-3">
        <span className="mt-1.5 h-3 w-1 shrink-0 rounded-full bg-evidence-strong" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg-muted">
            Cited passage · page {page} · {DOC}
          </p>
          <p className="mt-0.5 line-clamp-1 font-serif text-sm text-fg">“{cited.snippet}”</p>
        </div>
        <button type="button" onClick={onBack} className="inline-flex min-h-9 shrink-0 items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ChevronLeft className="size-4" aria-hidden /> Answer
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-surface-3 px-4 pt-5 sm:px-10">
        <div className="mx-auto h-full max-w-xl rounded-t-xs bg-white px-7 pt-8 text-[oklch(0.2_0_0)] shadow-sm sm:px-12 sm:pt-10">
          <p className="font-sans text-lg tracking-wide">{content.heading}</p>
          {content.paras.map((p) => (
            <p key={p} className="mt-5 font-sans text-sm leading-6">
              {p === cited.snippet ? <mark className="box-decoration-clone rounded-xs bg-[oklch(0.85_0.16_92/0.45)] px-0.5 text-inherit">{p}</mark> : p}
            </p>
          ))}
          <p className="mt-8 text-right font-mono text-2xs text-[oklch(0.45_0_0)]">{page} / 3</p>
        </div>
      </div>
    </div>
  );
}
