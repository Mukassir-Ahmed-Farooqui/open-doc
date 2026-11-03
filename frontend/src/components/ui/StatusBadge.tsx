import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { DocumentStatus } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

const styles: Record<DocumentStatus, string> = {
  ready: "bg-success-soft text-success",
  processing: "bg-accent-soft text-accent-soft-fg",
  queued: "bg-warning-soft text-warning",
  failed: "bg-danger-soft text-danger",
};
const labels: Record<DocumentStatus, string> = {
  ready: "Ready",
  processing: "Processing",
  queued: "Queued",
  failed: "Failed",
};

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
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs font-medium whitespace-nowrap [&_svg]:size-3",
        styles[status],
        className,
      )}
    >
      {status === "ready" && <CheckCircle2 aria-hidden />}
      {status === "processing" && <Spinner className="size-3" />}
      {status === "queued" && <Clock aria-hidden />}
      {status === "failed" && <AlertCircle aria-hidden />}
      {labels[status]}
      {showPct && <span className="tabular-nums">{Math.round(progress!)}%</span>}
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
      <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${v}%` }} />
    </div>
  );
}
