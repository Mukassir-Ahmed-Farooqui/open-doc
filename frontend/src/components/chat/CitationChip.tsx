import type { Citation } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";

/** Inline [S#] marker. Clickable once the citation's metadata is known (after the stream finishes). */
export function CitationChip({
  id,
  citation,
  onClick,
  active,
}: {
  id: string;
  citation?: Citation;
  onClick?: (id: string) => void;
  active?: boolean;
}) {
  const label = id.replace(/^S/, "");
  if (!citation) {
    return (
      <span
        data-citation={id}
        className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded bg-surface-3 px-1 align-middle font-mono text-2xs text-fg-subtle"
        aria-label={`Source ${label}`}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-citation={id}
      onClick={() => onClick?.(id)}
      title={`${citation.document} · page ${citation.page}`}
      aria-label={`Source ${label}: ${citation.document}, page ${citation.page}`}
      aria-pressed={active}
      className={cn(
        "mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded px-1 align-middle font-mono text-2xs font-medium transition-colors",
        active ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-soft-fg hover:bg-accent hover:text-accent-fg",
      )}
    >
      {label}
    </button>
  );
}
