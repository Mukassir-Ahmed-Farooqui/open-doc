import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { errorMessage, isColdStartError } from "@/lib/api/errors";
import { Button } from "./Button";

/**
 * Empty state: a plain statement and one next step. No icon tile; an optional inline icon sits
 * beside the heading so the state reads as text, not as a card template.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 text-fg-subtle [&_svg]:size-6" aria-hidden>{icon}</div>}
      <h3 className="font-serif text-xl font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  title = "Something went wrong",
  onRetry,
  className,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const cold = isColdStartError(error);
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <h3 className="font-serif text-xl font-semibold text-fg">{cold ? "The server is still waking up" : title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-fg-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-5" variant="outline" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  );
}
