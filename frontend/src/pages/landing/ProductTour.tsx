import { useId, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

/* Real screenshots from docs/screenshots (captured from the live stack), re-encoded to WebP in public/landing. */
const SHOTS = [
  {
    key: "cite",
    tab: "Cited passage",
    title: "Open the exact page behind an answer",
    body: "Click a citation and the PDF opens on that page with the passage highlighted, next to the document's details.",
    file: "04-pdf-viewer-citation-highlight-light",
    alt: "OpenDoc PDF viewer showing page 2 of services-agreement.pdf with the cited termination clause highlighted",
  },
  {
    key: "abstain",
    tab: "Honest abstention",
    title: "Says so when the answer isn't there",
    body: "Ask something your documents don't cover and OpenDoc answers “not enough evidence” instead of guessing.",
    file: "05-chat-insufficient-evidence-dark",
    alt: "OpenDoc chat in dark mode answering 'Not enough evidence' to an out-of-scope question",
  },
  {
    key: "home",
    tab: "Workspace",
    title: "Your documents, conversations and status at a glance",
    body: "Drop in several files at once and watch ingestion finish live; recent documents and chats stay one click away.",
    file: "02-dashboard-light",
    alt: "OpenDoc dashboard with document counts, an upload dropzone and recent documents",
  },
  {
    key: "palette",
    tab: "Command palette",
    title: "Keyboard-first when you want it",
    body: "Ctrl/⌘ K jumps to any document, conversation or action.",
    file: "06-command-palette-dark",
    alt: "OpenDoc command palette open over the app in dark mode",
  },
] as const;

export function ProductTour() {
  const [active, setActive] = useState(0);
  const id = useId();
  const shot = SHOTS[active];

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (active + delta + SHOTS.length) % SHOTS.length;
    setActive(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product screenshots"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
      >
        {SHOTS.map((s, i) => (
          <button
            key={s.key}
            id={`${id}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls={`${id}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={onKey}
            className={cn(
              "h-11 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
              i === active
                ? "border-accent bg-accent text-accent-fg"
                : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {s.tab}
          </button>
        ))}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`} className="mt-6">
        <div className="mx-auto max-w-2xl text-center">
          <h3 className="text-lg font-semibold text-fg sm:text-xl">{shot.title}</h3>
          <p className="mt-1 text-sm text-fg-muted sm:text-base">{shot.body}</p>
        </div>
        <figure className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-lg">
          <img
            key={shot.file}
            src={`/landing/${shot.file}-1440.webp`}
            srcSet={`/landing/${shot.file}-720.webp 720w, /landing/${shot.file}-1440.webp 1440w`}
            sizes="(min-width: 1280px) 1152px, 100vw"
            width={1440}
            height={900}
            loading="lazy"
            decoding="async"
            alt={shot.alt}
            className="block h-auto w-full animate-fade-in"
          />
        </figure>
      </div>
    </div>
  );
}
