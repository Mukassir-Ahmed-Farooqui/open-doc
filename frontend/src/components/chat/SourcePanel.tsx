import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import type { Citation } from "@/lib/api/schemas";
import { viewerHref } from "@/lib/citations";
import { cn } from "@/lib/cn";

/**
 * One answer's sources, like margin notes: number, document, page and section, the quoted passage
 * on a highlighter ground, and a link to that exact page. The active source is expanded.
 */
export function SourcePanel({
  citations,
  active,
  onSelect,
  onClose,
  closeLabel = "Close sources",
}: {
  citations: Citation[];
  active: string | null;
  onSelect: (id: string) => void;
  onClose?: () => void;
  closeLabel?: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector(`[data-source="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line pr-2 pl-5">
        <h2 className="text-sm font-semibold">
          Sources <span className="font-mono font-normal text-fg-subtle">{citations.length}</span>
        </h2>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={closeLabel}>
            <X />
          </Button>
        )}
      </header>
      <ol ref={listRef} className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {citations.map((c) => {
          const isActive = c.source_id === active;
          const n = c.source_id.replace(/^S/, "");
          return (
            <li key={c.source_id} data-source={c.source_id} className="py-4">
              <button
                type="button"
                onClick={() => onSelect(c.source_id)}
                className="flex w-full items-start gap-3 text-left"
                aria-expanded={isActive}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-xs px-1 font-mono text-2xs font-medium transition-colors",
                    isActive ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-soft-fg",
                  )}
                >
                  {n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{c.document}</span>
                  <span className="mt-0.5 block truncate font-mono text-2xs text-fg-subtle">
                    p. {c.page}
                    {c.section ? ` · ${c.section}` : ""}
                  </span>
                </span>
              </button>
              <blockquote
                className={cn(
                  "mt-3 ml-8 font-serif text-base leading-7 text-fg",
                  !isActive && "line-clamp-3 text-fg-muted",
                )}
              >
                <span className={cn("box-decoration-clone rounded-xs px-0.5", isActive && "bg-evidence")}>{c.snippet}</span>
              </blockquote>
              <Link
                to={viewerHref(c)}
                aria-label={`Open page ${c.page} in viewer`}
                className="mt-2 ml-8 inline-flex min-h-8 items-center gap-1 text-sm font-medium text-accent-soft-fg hover:underline pointer-coarse:min-h-11"
              >
                Open page {c.page}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
