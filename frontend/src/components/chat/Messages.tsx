import { AlertTriangle, Check, Copy, FileSearch, RotateCw, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Citation, Message } from "@/lib/api/schemas";
import { errorMessage } from "@/lib/api/errors";
import { citationMap, isInsufficientEvidence, orderedCitations } from "@/lib/citations";
import { cn } from "@/lib/cn";
import { Markdown } from "./Markdown";

export function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end animate-pop-in">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-base leading-6 whitespace-pre-wrap text-fg">
        {content}
      </div>
    </div>
  );
}

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

export function InsufficientEvidence({ text }: { text: string }) {
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft/60 p-4">
      <SearchX className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">Not enough evidence</p>
        <p className="text-sm text-fg-muted">{text}</p>
        <p className="text-xs text-fg-subtle">Try rephrasing, asking something more specific, or adding documents to the scope.</p>
      </div>
    </div>
  );
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
  return (
    <div className="group/msg animate-fade-in">
      {insufficient ? (
        <InsufficientEvidence text={message.content} />
      ) : (
        <Markdown content={message.content} citations={cites} onCite={(id) => onCite(message.id, id)} activeCite={activeSource} />
      )}
      {ordered.length > 0 && <SourceStrip citations={ordered} active={activeSource} onSelect={(id) => onCite(message.id, id)} />}
      <div className={cn("mt-2 flex items-center gap-0.5 text-fg-subtle transition-opacity", !isLast && "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 max-md:opacity-100")}>
        <CopyButton text={message.content} />
        {onRegenerate && (
          <Button variant="ghost" size="icon-sm" onClick={onRegenerate} aria-label="Regenerate answer" title="Ask again">
            <RotateCw />
          </Button>
        )}
        {(message.model || message.latency_ms) && (
          <span className="ml-1 text-2xs">
            {[message.model, message.latency_ms ? (message.latency_ms < 1000 ? `${message.latency_ms} ms` : `${(message.latency_ms / 1000).toFixed(1)}s`) : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

function SourceStrip({ citations, active, onSelect }: { citations: Citation[]; active: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
      {citations.map((c) => (
        <button
          key={c.source_id}
          type="button"
          onClick={() => onSelect(c.source_id)}
          aria-pressed={active === c.source_id}
          className={cn(
            "inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
            active === c.source_id ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-line bg-surface hover:bg-surface-2",
          )}
        >
          <span className="font-mono text-2xs text-fg-subtle">{c.source_id.replace(/^S/, "")}</span>
          <FileSearch className="size-3 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">{c.document}</span>
          <span className="shrink-0 text-fg-subtle">p.{c.page}</span>
        </button>
      ))}
    </div>
  );
}

export function StreamingAnswer({ text, phase }: { text: string; phase: "retrieving" | "writing" }) {
  if (!text) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-muted" role="status" aria-live="polite">
        <span className="flex gap-1" aria-hidden>
          <span className="size-1.5 animate-bounce rounded-full bg-fg-subtle [animation-delay:-0.2s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-fg-subtle [animation-delay:-0.1s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-fg-subtle" />
        </span>
        {phase === "retrieving" ? "Searching your documents…" : "Writing answer…"}
      </div>
    );
  }
  return (
    <div aria-live="off" aria-busy="true">
      <Markdown content={text + " ▍"} citations={new Map()} />
    </div>
  );
}

export function TurnError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft/60 p-4">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <p className="text-sm font-semibold">The answer couldn't be generated</p>
        <p className="mt-0.5 text-sm text-fg-muted">{errorMessage(error)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw /> Retry
      </Button>
    </div>
  );
}
