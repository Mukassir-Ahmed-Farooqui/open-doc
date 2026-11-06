import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="font-serif text-3xl font-semibold tracking-[-0.015em] text-fg sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-base text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Scrollable page body. Leaves room for the mobile bottom nav and the home indicator. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div
        className={cn(
          "mx-auto w-full max-w-5xl space-y-10 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-12 md:pb-16",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A titled region inside a page: heading row with an optional action, then content. No card. */
export function Section({
  title,
  action,
  children,
  className,
  id,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2.5">
        <h2 id={id} className="text-sm font-semibold text-fg">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
