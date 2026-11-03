import { ArrowUpRight, FileText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import type { Citation } from "@/lib/api/schemas";
import { viewerHref } from "@/lib/citations";
import { cn } from "@/lib/cn";

/** Lists one answer's sources; the active one is expanded and scrolled into view. */
export function SourcePanel({
  citations,
  active,
  onSelect,
  onClose,
}: {
  citations: Citation[];
  active: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector(`[data-source="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-sm font-semibold">Sources <span className="font-normal text-fg-subtle">{citations.length}</span></h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close sources">
          <X />
        </Button>
      </header>
      <ol ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {citations.map((c) => {
          const isActive = c.source_id === active;
          return (
            <li key={c.source_id} data-source={c.source_id}>
              <div
                className={cn(
                  "rounded-xl border p-3 transition-colors",
                  isActive ? "border-accent/50 bg-accent-soft/40 shadow-xs" : "border-line bg-surface hover:bg-surface-2/60",
                )}
              >
                <button type="button" onClick={() => onSelect(c.source_id)} className="flex w-full items-start gap-2 text-left" aria-expanded={isActive}>
                  <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded font-mono text-2xs font-medium", isActive ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-soft-fg")}>
                    {c.source_id.replace(/^S/, "")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <FileText className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                      <span className="truncate">{c.document}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-fg-subtle">
                      Page {c.page}
                      {c.section ? ` · ${c.section}` : ""}
                    </span>
                  </span>
                </button>
                <blockquote className={cn("mt-2 border-l-2 border-accent/40 pl-3 text-sm leading-6 text-fg-muted", !isActive && "line-clamp-3")}>
                  {c.snippet}
                </blockquote>
                <Link
                  to={viewerHref(c)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  Open page {c.page} in viewer <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
