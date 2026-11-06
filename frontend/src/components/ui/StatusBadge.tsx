import type { DocumentStatus } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

const tone: Record<DocumentStatus, string> = {
  ready: "text-success",
  processing: "text-accent-soft-fg",
  queued: "text-warning",
  failed: "text-danger",
};
const dot: Record<DocumentStatus, string> = {
  ready: "bg-success",
  processing: "bg-accent",
  queued: "bg-warning",
  failed: "bg-danger",
};
const labels: Record<DocumentStatus, string> = {
  ready: "Ready",
  processing: "Indexing",
  queued: "Queued",
  failed: "Failed",
};

/** Quiet status: a dot (or spinner while indexing) and a word. Colour is never the only signal. */
export function StatusBadge({
  status,
  progress,
  className,
}: {
  status: DocumentStatus;
  progress?: number;
  className?: string;
}) {
  const showPct = status === "processing" && typeof progress === "number" && progress > 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", tone[status], className)}>
      {status === "processing" ? (
        <Spinner className="size-3" />
      ) : (
        <span className={cn("size-1.5 rounded-full", dot[status])} aria-hidden />
      )}
      {labels[status]}
      {showPct && <span className="font-mono tabular-nums">{Math.round(progress!)}%</span>}
    </span>
  );
}

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${v}%` }} />
    </div>
  );
}

/** Indeterminate progress for work with no percentage (searching, waiting). */
export function ScanBar({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn("relative h-0.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-label={label}>
      <div className="absolute inset-y-0 left-0 w-2/5 animate-scan rounded-full bg-accent" />
    </div>
  );
}
