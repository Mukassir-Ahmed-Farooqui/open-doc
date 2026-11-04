import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  ChartColumn,
  Database,
  FileCode,
  FileText,
  FileType,
  FileUp,
  GitMerge,
  GraduationCap,
  Layers,
  ListOrdered,
  Lock,
  Menu,
  MessageSquareQuote,
  Moon,
  Quote,
  ScanText,
  Scale,
  ScrollText,
  SearchX,
  Server,
  Smartphone,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { HeroDemo } from "./HeroDemo";
import { Pipeline } from "./Pipeline";
import { ProductTour } from "./ProductTour";
import { useParallax, usePrefersReducedMotion, useScrolled, useScrollReveal } from "./useLanding";
import "./landing.css";

const REPO = "https://github.com/Mukassir-Ahmed-Farooqui/open-doc";
const BENCH = `${REPO}/blob/main/docs/BENCHMARKS.md`;

const NAV = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#pipeline", label: "Pipeline" },
  { href: "#product", label: "Product" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#benchmarks", label: "Benchmarks" },
];

/* ---------- small building blocks ---------- */

function GitHubMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-base font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] [&_svg]:size-4";
const btnPrimary = `${btnBase} bg-accent text-accent-fg shadow-[0_8px_24px_-8px_var(--ring)] hover:bg-accent-hover`;
const btnSecondary = `${btnBase} border border-line bg-surface/80 text-fg backdrop-blur hover:border-line-strong hover:bg-surface-2`;

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("relative px-4 py-20 sm:px-6 sm:py-28", className)}>
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <p className="font-mono text-2xs font-medium tracking-[0.18em] text-accent uppercase">{eyebrow}</p>
          <h2 id={`${id}-title`} className="mt-3 text-[clamp(1.75rem,4.2vw,2.75rem)] leading-[1.1] font-semibold tracking-tight text-balance text-fg">
            {title}
          </h2>
          {intro && <p className="mt-4 text-base leading-7 text-pretty text-fg-muted sm:text-lg sm:leading-8">{intro}</p>}
        </div>
        <div className="mt-12 sm:mt-16">{children}</div>
      </div>
    </section>
  );
}

function FeatureCard({ icon: Icon, title, body, tag, i }: { icon: LucideIcon; title: string; body: string; tag?: string; i: number }) {
  return (
    <div
      data-reveal
      style={{ "--i": i % 4 } as CSSProperties}
      className="landing-lift group relative rounded-2xl border border-line bg-surface p-5 shadow-xs hover:border-accent/40 hover:shadow-lg sm:p-6"
    >
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-soft-fg transition-colors group-hover:bg-accent group-hover:text-accent-fg">
          <Icon className="size-5" aria-hidden />
        </span>
        {tag && <span className="rounded-full border border-line px-2 py-0.5 font-mono text-2xs text-fg-subtle">{tag}</span>}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-fg-muted">{body}</p>
    </div>
  );
}

/* ---------- content (every claim traceable to README / docs) ---------- */

const CAPABILITIES: Array<{ icon: LucideIcon; title: string; body: string; tag?: string }> = [
  { icon: FileUp, title: "Ingestion", body: "Drop in several files at once. Type is checked by magic bytes, duplicates are skipped per user, and a background worker processes each file with retries." },
  { icon: ScanText, title: "Structure-aware parsing", body: "Headings, pages and sections are detected; repeated running headers and footers in PDFs are stripped before chunking." },
  { icon: Layers, title: "Parent-child chunking", body: "Search runs on small ~300-token children; the model reads the whole parent section, so clauses arrive intact with their headings." },
  { icon: GitMerge, title: "Hybrid retrieval", body: "Dense vectors (pgvector HNSW) and sparse full-text (Postgres tsvector) are fused with Reciprocal Rank Fusion.", tag: "dense + sparse" },
  { icon: ListOrdered, title: "Reranking", body: "An optional MiniLM cross-encoder rescores the top candidates and powers score-based abstention when enabled.", tag: "optional" },
  { icon: MessageSquareQuote, title: "Contextual answers", body: "Answers stream token by token, grounded only in the passages retrieved from the documents you selected." },
  { icon: Quote, title: "Page-level citations", body: "Every claim carries a numbered source. Only sources the answer actually cites are shown, each linked to its page and section." },
  { icon: SearchX, title: "Honest abstention", body: "When the evidence is weak, OpenDoc says it could not find enough support instead of inventing an answer." },
];

const FORMATS: Array<{ icon: LucideIcon; ext: string; name: string; body: string; cite: string }> = [
  { icon: FileText, ext: "PDF", name: "PDF documents", body: "Parsed with PyMuPDF block by block, headings from font size and the outline, running headers removed.", cite: "Cited to the page, with the passage highlighted" },
  { icon: FileType, ext: "DOCX", name: "Word documents", body: "Headings and paragraphs via python-docx, keeping the document's section structure.", cite: "Cited to the section" },
  { icon: FileCode, ext: "MD", name: "Markdown", body: "Heading hierarchy becomes the section tree, so answers point at the right heading.", cite: "Cited to the section" },
  { icon: ScrollText, ext: "TXT", name: "Plain text", body: "Notes, exports and transcripts are chunked and searchable like everything else.", cite: "Cited to the passage" },
];

const USE_CASES: Array<{ icon: LucideIcon; title: string; q: string }> = [
  { icon: Scale, title: "Legal contracts", q: "What is the notice period for termination for convenience?" },
  { icon: BookOpen, title: "Research papers", q: "Which datasets did the authors evaluate on, and what were the limitations?" },
  { icon: Lock, title: "Policies & handbooks", q: "How many days a week can employees work remotely?" },
  { icon: ChartColumn, title: "Reports", q: "Compare the risk factors listed in these two annual reports." },
  { icon: GraduationCap, title: "Study material", q: "Summarise chapter 3 and cite the pages I should re-read." },
];

const ADVANTAGES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: BadgeCheck, title: "Verifiable by design", body: "Numbered citations open the exact page, so you check an answer in seconds instead of trusting it." },
  { icon: SearchX, title: "Abstains instead of guessing", body: "Out-of-scope questions get an explicit “not enough evidence” answer." },
  { icon: Lock, title: "Your documents stay yours", body: "Every query, including vector and full-text search, is filtered to the signed-in owner. Another user's document is a 404." },
  { icon: Database, title: "One database, no extra infra", body: "Postgres with pgvector holds vectors, full-text and the job queue. No separate vector DB, queue or graph runtime." },
  { icon: Server, title: "Self-hostable", body: "One stateless FastAPI container plus Postgres and S3-compatible storage. Docker Compose included." },
  { icon: Smartphone, title: "Installable app", body: "Add OpenDoc to your home screen or dock. It opens full-screen, like a native app." },
];

/* Numbers copied from docs/BENCHMARKS.md. Labels say exactly what was measured. */
const METRICS = [
  { value: "0.947", label: "Recall@5", note: "hybrid RRF, single-document scope" },
  { value: "0.873", label: "MRR@10", note: "hybrid RRF, single-document scope" },
  { value: "97.3%", label: "Faithfulness", note: "36 of 37 answered questions" },
  { value: "1.94 s", label: "Time to first token", note: "p50, retrieval included" },
];

/* ---------- page ---------- */

function Nav() {
  const scrolled = useScrolled();
  const [open, setOpen] = useState(false);
  const { resolved, toggle } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)] transition-[background-color,border-color,box-shadow] duration-300",
        scrolled || open ? "border-b border-line bg-bg/80 shadow-xs backdrop-blur-xl" : "border-b border-transparent",
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:px-6">
        <a href="#top" className="flex min-h-11 items-center rounded-lg text-lg" aria-label="OpenDoc home">
          <Logo />
        </a>
        <ul className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <a href={n.href} className="inline-flex h-11 items-center rounded-lg px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
                {n.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="grid size-11 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            {resolved === "dark" ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
          </button>
          <a href={REPO} target="_blank" rel="noreferrer" aria-label="OpenDoc on GitHub" className="hidden size-11 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg sm:grid">
            <GitHubMark className="size-[18px]" />
          </a>
          <Link to="/login" className="hidden h-11 items-center rounded-lg px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg sm:inline-flex">
            Sign in
          </Link>
          <Link to="/register" className="hidden h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg shadow-xs transition-colors hover:bg-accent-hover sm:inline-flex">
            Get started <ArrowRight className="size-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-11 place-items-center rounded-lg text-fg transition-colors hover:bg-surface-2 lg:hidden"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </nav>
      {open && (
        <div id="mobile-menu" className="animate-fade-in border-t border-line bg-bg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:hidden">
          <ul className="mx-auto max-w-6xl py-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center border-b border-line text-base text-fg">
                  {n.label}
                </a>
              </li>
            ))}
            <li>
              <a href={REPO} target="_blank" rel="noreferrer" className="flex min-h-12 items-center gap-2 text-base text-fg">
                <GitHubMark /> GitHub
              </a>
            </li>
          </ul>
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 pt-2">
            <Link to="/login" className={btnSecondary}>
              Sign in
            </Link>
            <Link to="/register" className={btnPrimary}>
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  const reduced = usePrefersReducedMotion();
  const orbs = useRef<HTMLDivElement>(null);
  useParallax(orbs, reduced);
  const line1 = ["Ask", "your", "documents."];
  const line2 = ["Get", "answers", "you", "can"];

  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate px-4 pt-[calc(7rem+env(safe-area-inset-top))] pb-16 sm:px-6 sm:pt-[calc(9rem+env(safe-area-inset-top))] sm:pb-24">
      <div className="landing-ambient -z-10" aria-hidden>
        <div ref={orbs} className="absolute inset-0">
          <div className="landing-orb landing-orb-a" />
          <div className="landing-orb landing-orb-b" />
        </div>
        <div className="landing-grid" />
      </div>

      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-6xl text-center">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="landing-fade inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-fg-muted backdrop-blur transition-colors hover:border-accent/50 hover:text-fg"
            style={{ "--d": "0ms" } as CSSProperties}
          >
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            Free & open source · Document intelligence
            <ArrowRight className="size-3.5" aria-hidden />
          </a>

          <h1 id="hero-title" className="mt-6 text-[clamp(2.4rem,7.4vw,4.6rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance text-fg">
            <span className="block">
              {line1.map((w, i) => (
                <Fragment key={w}>
                {i > 0 && " "}
                <span className="landing-word" style={{ "--w": i } as CSSProperties}>
                  {w}
                </span>
                </Fragment>
              ))}
            </span>
            <span className="block">
              {line2.map((w, i) => (
                <Fragment key={w}>
                  <span className="landing-word" style={{ "--w": i + 3 } as CSSProperties}>
                    {w}
                  </span>{" "}
                </Fragment>
              ))}
              <span className="landing-word" style={{ "--w": 7 } as CSSProperties}>
                <span className="landing-gradient-text">verify.</span>
              </span>
            </span>
          </h1>

          <p className="landing-fade mx-auto mt-6 max-w-2xl text-base leading-7 text-pretty text-fg-muted sm:text-lg sm:leading-8" style={{ "--d": "650ms" } as CSSProperties}>
            Upload PDFs, Word files, Markdown or text and ask in plain language. OpenDoc searches them with hybrid retrieval and streams back an answer
            where every claim cites the page it came from.
          </p>

          <div className="landing-fade mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center" style={{ "--d": "800ms" } as CSSProperties}>
            <Link to="/register" className={cn(btnPrimary, "h-12 px-6")}>
              Start for free <ArrowRight aria-hidden />
            </Link>
            <Link to="/login" className={cn(btnSecondary, "h-12 px-6")}>
              Sign in
            </Link>
          </div>
          <p className="landing-fade mt-4 text-xs text-fg-subtle" style={{ "--d": "900ms" } as CSSProperties}>
            No credit card. PDF · DOCX · MD · TXT.
          </p>
        </div>

        <div className="landing-fade relative mx-auto mt-14 max-w-5xl sm:mt-20" style={{ "--d": "700ms" } as CSSProperties}>
          <div className="absolute -inset-x-6 -inset-y-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_50%_40%,var(--landing-glow-a),transparent)] blur-2xl" aria-hidden />
          <HeroDemo />
          <p className="mt-3 text-center text-2xs text-fg-subtle">
            Interactive preview. Question and passages from the sample agreement in the project's test fixtures.
          </p>
        </div>
      </div>
    </section>
  );
}

function Metrics() {
  return (
    <section id="benchmarks" aria-labelledby="benchmarks-title" className="relative px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between" data-reveal>
          <div>
            <p className="font-mono text-2xs font-medium tracking-[0.18em] text-accent uppercase">Measured, not claimed</p>
            <h2 id="benchmarks-title" className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              Benchmarked on a 38-question contract set
            </h2>
          </div>
          <a href={BENCH} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            Full methodology <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
        <dl className="mt-8 grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-line [gap:1px] lg:grid-cols-4">
          {METRICS.map((m, i) => (
            <div key={m.label} data-reveal style={{ "--i": i } as CSSProperties} className="bg-surface p-5 sm:p-7">
              <dt className="text-sm font-medium text-fg-muted">{m.label}</dt>
              <dd className="mt-2 font-mono text-[clamp(1.75rem,5vw,2.75rem)] leading-none font-semibold tracking-tight text-fg">{m.value}</dd>
              <dd className="mt-3 text-2xs leading-4 text-fg-subtle">{m.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-5 text-fg-subtle" data-reveal>
          38 labelled questions over 8 contracts (CUAD, CC BY 4.0). Retrieval: parent-child chunks, hybrid RRF, question's own document selected.
          Generation: openai/gpt-oss-120b, answer correctness 100% (37/37 answered), self-judged by the same model; abstained correctly on 8 of 8
          out-of-scope questions. Latency measured on the benchmark run, not a production SLA.
        </p>
      </div>
    </section>
  );
}

function InstallSection() {
  return (
    <section aria-labelledby="install-title" className="landing-hide-standalone relative px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div data-reveal>
          <p className="font-mono text-2xs font-medium tracking-[0.18em] text-accent uppercase">Works everywhere</p>
          <h2 id="install-title" className="mt-3 text-[clamp(1.75rem,4.2vw,2.75rem)] leading-[1.1] font-semibold tracking-tight text-balance text-fg">
            From a phone on the train to an ultrawide at your desk
          </h2>
          <p className="mt-4 text-base leading-7 text-fg-muted sm:text-lg sm:leading-8">
            The interface is responsive down to small phones, has light and dark themes, and installs as an app. Add it to your home screen from
            your browser's menu and it opens full-screen with its own icon.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-fg-muted">
            {["Installable web app; the app shell is cached for fast repeat visits", "Keyboard shortcuts and a command palette on desktop", "Touch-friendly library, chat and source drawer on mobile"].map((t) => (
              <li key={t} className="flex gap-3">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-center" data-reveal style={{ "--i": 2 } as CSSProperties}>
          <div className="landing-phone w-[min(78vw,300px)]">
            <img
              src="/landing/09-mobile-library-light-390.webp"
              width={390}
              height={844}
              loading="lazy"
              decoding="async"
              alt="OpenDoc library on a phone, listing uploaded documents with their status"
              className="block h-auto w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  useScrollReveal(root);

  useEffect(() => {
    const prev = document.title;
    document.title = "OpenDoc — Answers from your documents, with page-level citations";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div ref={root} className="landing bg-bg text-fg">
      <a href="#main" className="sr-only z-[60] rounded-lg bg-accent px-4 py-3 text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />

        <Section
          id="capabilities"
          eyebrow="Capabilities"
          title="A complete RAG pipeline, tuned for documents you need to trust"
          intro="Every stage, from parsing to citation, is built so the answer can be traced back to its source."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((c, i) => (
              <FeatureCard key={c.title} {...c} i={i} />
            ))}
          </div>
        </Section>

        <Section
          id="pipeline"
          eyebrow="How it works"
          title="From upload to cited answer"
          intro="Tap any stage to see what happens there."
          className="bg-surface-2/50"
        >
          <div data-reveal>
            <Pipeline />
          </div>
        </Section>

        <Metrics />

        <Section id="product" eyebrow="Product" title="See it in the real app" intro="Screenshots from the running stack: no mockups.">
          <div data-reveal>
            <ProductTour />
          </div>
        </Section>

        <Section
          id="formats"
          eyebrow="Document workflows"
          title="Bring the files you already have"
          intro="Upload several at once. Each one is parsed, chunked and indexed in the background, and becomes searchable as soon as it is ready."
          className="bg-surface-2/50"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FORMATS.map((f, i) => (
              <div key={f.ext} data-reveal style={{ "--i": i } as CSSProperties} className="landing-lift flex flex-col rounded-2xl border border-line bg-surface p-5 hover:border-accent/40 sm:p-6">
                <div className="flex items-center gap-3">
                  <f.icon className="size-6 text-accent" aria-hidden />
                  <span className="font-mono text-sm font-semibold text-fg">.{f.ext.toLowerCase()}</span>
                </div>
                <h3 className="mt-4 font-semibold text-fg">{f.name}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-6 text-fg-muted">{f.body}</p>
                <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent-soft-fg">
                  <Quote className="size-3.5" aria-hidden /> {f.cite}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="use-cases" eyebrow="Use cases" title="Built for documents where the details matter">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {USE_CASES.map((u, i) => (
              <div key={u.title} data-reveal style={{ "--i": i } as CSSProperties} className="landing-lift rounded-2xl border border-line bg-surface p-5 hover:border-accent/40">
                <u.icon className="size-6 text-accent" aria-hidden />
                <h3 className="mt-4 font-semibold text-fg">{u.title}</h3>
                <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm leading-6 text-fg-muted">&ldquo;{u.q}&rdquo;</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="why" eyebrow="Why OpenDoc" title="Answers you can check, on infrastructure you can run" className="bg-surface-2/50">
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {ADVANTAGES.map((a, i) => (
              <div key={a.title} data-reveal style={{ "--i": i % 3 } as CSSProperties} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-accent">
                  <a.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold text-fg">{a.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-fg-muted">{a.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <InstallSection />

        <section aria-labelledby="cta-title" className="px-4 pb-20 sm:px-6 sm:pb-28">
          <div data-reveal className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl bg-accent px-6 py-14 text-center text-white sm:px-12 sm:py-20 dark:bg-[oklch(0.42_0.17_277)]">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_80%_0%,oklch(0.7_0.18_305/0.55),transparent),radial-gradient(50%_70%_at_0%_100%,oklch(0.45_0.2_265/0.6),transparent)]" aria-hidden />
            <h2 id="cta-title" className="mx-auto max-w-2xl text-[clamp(1.75rem,4.5vw,3rem)] leading-[1.1] font-semibold tracking-tight text-balance">
              Stop skimming. Start asking.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-white/85 sm:text-lg">
              Create a free account, upload your first document, and ask your first question.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link to="/register" className={cn(btnBase, "h-12 bg-white px-6 text-[oklch(0.3_0.15_277)] shadow-lg hover:bg-white/90")}>
                Create free account <ArrowRight aria-hidden />
              </Link>
              <a href={REPO} target="_blank" rel="noreferrer" className={cn(btnBase, "h-12 border border-white/30 px-6 text-white hover:bg-white/10")}>
                <GitHubMark /> View source
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-4 pt-12 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm leading-6 text-fg-muted">Citation-grounded answers over your own documents.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-1 text-sm">
            <a className="flex min-h-11 items-center text-fg-muted hover:text-fg" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
            <Link className="flex min-h-11 items-center text-fg-muted hover:text-fg" to="/login">Sign in</Link>
            <a className="flex min-h-11 items-center text-fg-muted hover:text-fg" href={BENCH} target="_blank" rel="noreferrer">Benchmarks</a>
            <Link className="flex min-h-11 items-center text-fg-muted hover:text-fg" to="/register">Create account</Link>
            <a className="flex min-h-11 items-center text-fg-muted hover:text-fg" href={`${REPO}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">Architecture</a>
            <a className="flex min-h-11 items-center text-fg-muted hover:text-fg" href={`${REPO}/blob/main/docs/API.md`} target="_blank" rel="noreferrer">API</a>
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl text-xs text-fg-subtle">
          © {new Date().getFullYear()} OpenDoc. Benchmark corpus from CUAD (CC BY 4.0, The Atticus Project).
        </p>
      </footer>
    </div>
  );
}
