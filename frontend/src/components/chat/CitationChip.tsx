import type { Citation } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";

const chip =
  "hit mx-[0.15em] inline-flex h-5 min-w-5 -translate-y-[0.1em] items-center justify-center rounded-xs px-1 align-middle font-mono text-2xs leading-none font-medium tabular-nums";

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
      <span data-citation={id} className={cn(chip, "bg-surface-3 text-fg-muted")} aria-label={`Source ${label}`}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-citation={id}
      onClick={() => onClick?.(id)}
      title={`${citation.document} · page ${citation.page}${citation.section ? ` · ${citation.section}` : ""}`}
      aria-label={`Source ${label}: ${citation.document}, page ${citation.page}`}
      aria-pressed={active}
      className={cn(
        chip,
        "transition-colors duration-150",
        active ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-soft-fg hover:bg-accent hover:text-accent-fg",
      )}
    >
      {label}
    </button>
  );
}
