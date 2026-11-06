import { AlertTriangle, Check, Copy, RotateCw, SearchX } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ScanBar } from "@/components/ui/StatusBadge";
import type { Citation, Message, StreamMeta } from "@/lib/api/schemas";
import { errorMessage } from "@/lib/api/errors";
import { citationMap, isInsufficientEvidence, orderedCitations } from "@/lib/citations";
import { cn } from "@/lib/cn";
import { Markdown } from "./Markdown";

/** The user's question, set as the heading of its research note. */
export function QuestionHeading({ content, first }: { content: string; first?: boolean }) {
  return (
    <h2
      className={cn(
        "animate-rise-in font-serif text-xl leading-snug font-semibold tracking-[-0.01em] whitespace-pre-wrap text-fg sm:text-2xl sm:leading-tight",
        !first && "mt-12 border-t border-line pt-10",
      )}
    >
      {content}
    </h2>
  );
}

/** Kept for compatibility with older imports; questions now render as headings. */
export const UserBubble = QuestionHeading;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Copied" : "Copy answer"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (insecure context) */
        }
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

/** Abstention is an answer, not an error: it says plainly that the documents don't support one. */
export function InsufficientEvidence({ text }: { text: string }) {
  return (
    <div role="status" className="rounded-lg border border-dashed border-line-strong px-5 py-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-fg">
        <SearchX className="size-4 text-warning" aria-hidden /> Not enough evidence
      </p>
      <p className="mt-2 font-serif text-lg text-fg-muted">{text}</p>
      <ul className="mt-3 space-y-1 text-sm text-fg-muted">
        <li>Ask something narrower, or use the words the document uses.</li>
        <li>Add more documents to the scope below.</li>
        <li>
          Check what's indexed in the{" "}
          <Link to="/documents" className="font-medium text-accent-soft-fg underline">
            library
          </Link>
          .
        </li>
      </ul>
    </div>
  );
}

function formatLatency(ms?: number | null) {
  if (!ms) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function AssistantMessage({
  message,
  activeSource,
  onCite,
  onRegenerate,
  isLast,
}: {
  message: Message;
  activeSource: string | null;
  onCite: (messageId: string, sourceId: string) => void;
  onRegenerate?: () => void;
  isLast: boolean;
}) {
  const cites = useMemo(() => citationMap(message.citations), [message.citations]);
  const ordered = useMemo(() => orderedCitations(message.content, message.citations), [message.content, message.citations]);
  const insufficient = isInsufficientEvidence(message.content);
  const meta = [
    ordered.length ? `${ordered.length} ${ordered.length === 1 ? "source" : "sources"}` : null,
    formatLatency(message.latency_ms),
    message.model,
  ].filter(Boolean);
  return (
    <div className="group/msg mt-5 animate-fade-in">
      {insufficient ? (
        <InsufficientEvidence text={message.content} />
      ) : (
        <div className="max-w-[68ch]">
          <Markdown variant="note" content={message.content} citations={cites} onCite={(id) => onCite(message.id, id)} activeCite={activeSource} />
        </div>
      )}
      {ordered.length > 0 && <SourceFootnotes citations={ordered} active={activeSource} onSelect={(id) => onCite(message.id, id)} />}
      <div
        className={cn(
          "mt-3 flex items-center gap-1 text-fg-subtle transition-opacity",
          !isLast && "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
        )}
      >
        <CopyButton text={message.content} />
        {onRegenerate && (
          <Button variant="ghost" size="icon-sm" onClick={onRegenerate} aria-label="Regenerate answer" title="Ask again">
            <RotateCw />
          </Button>
        )}
        {meta.length > 0 && <span className="ml-1 truncate font-mono text-2xs">{meta.join(" · ")}</span>}
      </div>
    </div>
  );
}

/** Footnote-style source list under an answer, grouped by document so filenames aren't repeated. */
function SourceFootnotes({ citations, active, onSelect }: { citations: Citation[]; active: string | null; onSelect: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Citation[]>();
    for (const c of citations) m.set(c.document, [...(m.get(c.document) ?? []), c]);
    return [...m.entries()];
  }, [citations]);
  return (
    <div aria-label="Sources" role="group" className="mt-5 space-y-1.5 border-l border-line pl-4">
      {groups.map(([doc, list]) => (
        <p key={doc} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="truncate font-medium text-fg-muted">{doc}</span>
          {list.map((c) => (
            <Fragment key={c.source_id}>
              <button
                type="button"
                onClick={() => onSelect(c.source_id)}
                aria-pressed={active === c.source_id}
                aria-label={`Show source ${c.source_id.replace(/^S/, "")}, page ${c.page}`}
                className={cn(
                  "hit inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 font-mono text-2xs transition-colors",
                  active === c.source_id ? "bg-accent-soft text-accent-soft-fg" : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-xs px-1",
                    active === c.source_id ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-soft-fg",
                  )}
                >
                  {c.source_id.replace(/^S/, "")}
                </span>
                p.{c.page}
              </button>
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

/** Live answer: names the phase (searching → writing), then streams text with a soft caret. */
export function StreamingAnswer({ text, meta, scopeCount }: { text: string; meta?: StreamMeta; scopeCount?: number }) {
  const phase = !meta
    ? `Searching ${scopeCount && scopeCount > 1 ? `${scopeCount} documents` : "your documents"}…`
    : meta.abstained
      ? "Checking the evidence…"
      : `Writing from ${meta.sources ?? "the"} ${meta.sources === 1 ? "source" : "sources"}…`;
  return (
    <div className="mt-5" aria-busy="true">
      <div role="status" aria-live="polite" className="max-w-xs">
        <p className="text-sm text-fg-muted">{phase}</p>
        {!text && <ScanBar className="mt-2" label={phase} />}
      </div>
      {text && (
        <div className="is-streaming mt-3 max-w-[68ch]" aria-live="off">
          <Markdown variant="note" content={text} citations={new Map()} />
        </div>
      )}
    </div>
  );
}

export function TurnError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-5 flex items-start gap-3 rounded-lg bg-danger-soft px-4 py-3.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <p className="text-sm font-semibold text-fg">The answer couldn't be generated</p>
        <p className="mt-0.5 text-sm text-fg-muted">{errorMessage(error)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw /> Retry
      </Button>
    </div>
  );
}
