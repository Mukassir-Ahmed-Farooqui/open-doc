import { ArrowRight, ArrowUpRight, Database, FileSearch, GitMerge, Lock, Menu, Moon, SearchX, Smartphone, Sun, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/layout/Logo";
import { buttonClass } from "@/components/ui/buttonStyles";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { ProductPreview } from "./ProductPreview";

const REPO = "https://github.com/Mukassir-Ahmed-Farooqui/open-doc";
const BENCH = `${REPO}/blob/main/docs/BENCHMARKS.md`;
const LICENSE = `${REPO}/blob/main/LICENSE`;

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#benchmarks", label: "Benchmarks" },
  { href: "#open-source", label: "Open source" },
];

function GitHubMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/* ---------- content: every claim traceable to README.md / docs/BENCHMARKS.md ---------- */

const STEPS = [
  { title: "Upload", body: "PDF, Word, Markdown or plain text. File type is checked, duplicates are skipped, and a background worker indexes each file." },
  { title: "Ask", body: "Pick which documents to search and ask in plain language. Hybrid retrieval finds the passages; the answer streams back." },
  { title: "Read the note", body: "Each sentence ends with a numbered source. Only sources the answer actually cites are listed." },
  { title: "Open the page", body: "A source opens the original document at that page, with the passage marked." },
];

const DIFFERENCES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: FileSearch, title: "Page-level citations", body: "PDFs are cited to the page with the passage highlighted; Word, Markdown and text files to the section or passage." },
  { icon: SearchX, title: "It abstains instead of guessing", body: "When the selected documents don't support an answer, it says “not enough evidence” rather than filling the gap." },
  { icon: GitMerge, title: "Hybrid retrieval", body: "Dense vectors (pgvector HNSW) and Postgres full-text search, fused with Reciprocal Rank Fusion, with an optional cross-encoder reranker." },
  { icon: Lock, title: "Your documents stay yours", body: "Every query, including vector and full-text search, is filtered to the signed-in owner. Another user's document is a 404." },
  { icon: Database, title: "One database, no extra infrastructure", body: "Postgres holds vectors, full-text and the job queue. No separate vector store or queue to run." },
  { icon: Smartphone, title: "Works on your phone", body: "Responsive down to small screens, light and dark themes, and installable as an app from the browser menu." },
];

const FORMATS = [
  ["PDF", "Page + highlighted passage"],
  ["DOCX", "Section"],
  ["Markdown", "Section (heading tree)"],
  ["TXT", "Passage"],
];

/* From docs/BENCHMARKS.md (generation run, live Groq API). Labels say exactly what was measured. */
const METRICS = [
  { value: "97.3%", label: "Faithfulness", note: "36 of 37 answered questions judged fully supported by their sources" },
  { value: "94.6%", label: "Gold-cited", note: "35 of 37 answers cite a source that holds the gold evidence" },
  { value: "8 / 8", label: "Abstention", note: "out-of-scope questions answered with “not enough evidence”" },
];

/* ---------- page ---------- */

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { resolved, toggle } = useTheme();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b pt-[env(safe-area-inset-top)] transition-colors duration-200",
        scrolled || open ? "border-line bg-bg" : "border-transparent bg-bg/0",
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 safe-x sm:px-6">
        <a href="#top" className="flex min-h-11 items-center rounded-md text-lg" aria-label="OpenDoc home">
          <Logo />
        </a>
        <ul className="ml-8 hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <a href={n.href} className="inline-flex h-11 items-center rounded-md px-3 text-sm text-fg-muted transition-colors hover:text-fg">
                {n.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="grid size-11 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            {resolved === "dark" ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
          </button>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="OpenDoc on GitHub"
            className="hidden size-11 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg sm:grid"
          >
            <GitHubMark className="size-[18px]" />
          </a>
          <Link to="/login" className="hidden h-11 items-center rounded-md px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg sm:inline-flex">
            Sign in
          </Link>
          <Link to="/register" className={buttonClass("primary", "md", "max-sm:hidden")}>
            Get started
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-11 place-items-center rounded-md text-fg transition-colors hover:bg-surface-2 md:hidden"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </nav>
      {open && (
        <div id="mobile-menu" className="animate-fade-in border-t border-line bg-bg px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:hidden">
          <ul className="py-1">
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
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Link to="/login" className={buttonClass("outline", "lg")}>
              Sign in
            </Link>
            <Link to="/register" className={buttonClass("primary", "lg")}>
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="px-4 pt-[calc(7.5rem+env(safe-area-inset-top))] pb-20 safe-x sm:px-6 sm:pt-[calc(9rem+env(safe-area-inset-top))] sm:pb-28">
      <div className="mx-auto grid max-w-[76rem] grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-14">
        <div className="animate-rise-in">
          <h1 id="hero-title" className="font-serif text-[clamp(2.5rem,4.4vw,3.9rem)] leading-[1.04] font-semibold tracking-[-0.02em] text-fg">
            Ask your documents.
            <span className="block text-fg-muted">Check every answer.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-fg-muted">
            OpenDoc answers questions from your PDFs, Word files, Markdown and notes, and pins every claim to the page it came from. When the
            documents don't say, it tells you so.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/register" className={buttonClass("primary", "lg")}>
              Start for free <ArrowRight aria-hidden />
            </Link>
            <Link to="/login" className={buttonClass("outline", "lg")}>
              Sign in
            </Link>
          </div>
          <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-subtle">
            <span>Free</span>
            <span aria-hidden>·</span>
            <a href={LICENSE} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-fg hover:underline">
              MIT open source
            </a>
            <span aria-hidden>·</span>
            <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-fg hover:underline">
              <GitHubMark className="size-3.5" /> GitHub
            </a>
          </p>
        </div>
        <div className="animate-rise-in [animation-delay:120ms]">
          <ProductPreview />
          <p className="mt-3 text-xs text-fg-subtle">
            Live preview built from the app's own components with sample data from the repo's test agreement. Click the numbered sources.
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ id, title, intro }: { id: string; title: ReactNode; intro?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 id={`${id}-title`} className="font-serif text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.015em] text-fg">
        {title}
      </h2>
      {intro && <p className="mt-4 text-lg leading-8 text-fg-muted">{intro}</p>}
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="border-t border-line px-4 py-20 safe-x sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHead id="how" title="From upload to a page you can check" intro="The whole loop takes a minute: index once, then every answer carries its evidence." />
        <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t border-line-strong pt-5">
              <p className="font-mono text-sm text-accent-soft-fg tabular-nums">{i + 1}</p>
              <h3 className="mt-3 text-lg font-semibold text-fg">{s.title}</h3>
              <p className="mt-2 text-base leading-7 text-fg-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Differences() {
  return (
    <section aria-labelledby="diff-title" className="bg-surface-2 px-4 py-20 safe-x sm:px-6 sm:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div>
          <SectionHead id="diff" title="Built to be checked, not trusted" intro="A fluent answer is easy. OpenDoc is designed so you can see where each sentence came from, and notice when nothing supports it." />
          <table className="mt-10 w-full max-w-sm text-sm">
            <caption className="mb-2 text-left text-sm font-semibold text-fg">What a citation points to</caption>
            <tbody className="divide-y divide-line border-y border-line">
              {FORMATS.map(([f, c]) => (
                <tr key={f}>
                  <th scope="row" className="py-2.5 pr-4 text-left font-mono text-xs font-medium text-fg">
                    {f}
                  </th>
                  <td className="py-2.5 text-fg-muted">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {DIFFERENCES.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <dt className="flex items-center gap-2.5 text-base font-semibold text-fg">
                <Icon className="size-[18px] shrink-0 text-accent-soft-fg" aria-hidden />
                {title}
              </dt>
              <dd className="mt-2 text-base leading-7 text-fg-muted">{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Benchmarks() {
  return (
    <section id="benchmarks" aria-labelledby="benchmarks-title" className="px-4 py-20 safe-x sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <SectionHead id="benchmarks" title="Measured on a 46-question benchmark" />
          <a href={BENCH} target="_blank" rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-medium text-accent-soft-fg hover:underline">
            Methodology and raw results <ArrowUpRight className="size-4" aria-hidden />
          </a>
        </div>
        <dl className="mt-12 grid border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
          {METRICS.map((m) => (
            <div key={m.label} className="border-b border-line py-7 last:border-b-0 sm:border-b-0 sm:px-8 sm:first:pl-0">
              <dt className="text-sm font-semibold text-fg">{m.label}</dt>
              <dd className="mt-3 font-serif text-5xl leading-none font-semibold tracking-[-0.02em] text-fg tabular-nums">{m.value}</dd>
              <dd className="mt-3 max-w-[30ch] text-sm leading-6 text-fg-muted">{m.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-3xl text-sm leading-6 text-fg-muted">
          46 questions over 8 contracts (7 from CUAD, CC BY 4.0): 38 answerable, 8 out of scope. Run on the live Groq API with openai/gpt-oss-120b.
          All three scores are <strong className="font-semibold text-fg">LLM-judged by the same model</strong> that wrote the answers, so treat them as
          indicative, not as an independent evaluation.
        </p>
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section id="open-source" aria-labelledby="oss-title" className="border-t border-line px-4 py-20 safe-x sm:px-6 sm:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:items-end">
        <div>
          <SectionHead
            id="oss"
            title="Free, and MIT open source"
            intro="Use the hosted app, or run your own: one stateless FastAPI container, Postgres with pgvector, and any S3-compatible storage. Docker Compose is included."
          />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={REPO} target="_blank" rel="noreferrer" className={buttonClass("outline", "lg")}>
              <GitHubMark /> View on GitHub
            </a>
            <Link to="/register" className={buttonClass("primary", "lg")}>
              Create a free account <ArrowRight aria-hidden />
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg bg-surface-2 p-5 font-mono text-sm leading-7 whitespace-nowrap text-fg">
          <p className="text-fg-subtle"># self-host</p>
          <p>git clone {REPO.replace("https://", "")}</p>
          <p>cd open-doc && docker compose up</p>
        </div>
      </div>
      <p className="mx-auto mt-14 max-w-6xl text-sm text-fg-muted">
        Heads-up: the hosted demo's API runs on a free tier that sleeps when idle, so the first request after a quiet spell can take about a minute.
        The app shows when it's waking up.
      </p>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line px-4 pt-12 pb-[max(2.5rem,env(safe-area-inset-bottom))] safe-x sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-fg-muted">Answers from your documents, with the page they came from.</p>
        </div>
        <ul className="grid grid-cols-2 gap-x-10 gap-y-1 text-sm">
          {[
            ["GitHub", REPO, true],
            ["Benchmarks", BENCH, true],
            ["MIT License", LICENSE, true],
            ["Sign in", "/login", false],
          ].map(([label, href, ext]) => (
            <li key={label as string}>
              {ext ? (
                <a href={href as string} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-fg-muted hover:text-fg">
                  {label}
                </a>
              ) : (
                <Link to={href as string} className="inline-flex min-h-11 items-center text-fg-muted hover:text-fg">
                  {label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="mx-auto mt-10 max-w-6xl text-xs text-fg-subtle">
        © {new Date().getFullYear()} OpenDoc contributors. Benchmark corpus includes contracts from CUAD (CC BY 4.0, The Atticus Project).
      </p>
    </footer>
  );
}

export default function LandingPage() {
  useEffect(() => {
    document.title = "OpenDoc — Answers from your documents, with page-level citations";
  }, []);
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main-content">
        <Hero />
        <HowItWorks />
        <Differences />
        <Benchmarks />
        <OpenSource />
      </main>
      <Footer />
    </div>
  );
}
