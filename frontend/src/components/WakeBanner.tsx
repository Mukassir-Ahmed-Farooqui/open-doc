import { useEffect, useState } from "react";
import { useWakeState } from "@/hooks/useWakeState";

/** Seconds since the waking period began, ticking once a second while waking. */
function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

/**
 * Calm, global status while the free-tier API wakes up. Requests keep retrying underneath; nothing
 * for the user to do. Announced politely to screen readers once, not every second.
 */
export function WakeBanner() {
  const { waking, since } = useWakeState();
  const elapsed = useElapsed(waking ? since : null);
  if (!waking) return null;
  // A cold start usually takes ~60 s; ease the bar towards 92% so it never claims to be done.
  const pct = Math.min(92, Math.round((1 - Math.exp(-elapsed / 30)) * 100));
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto animate-pop-in w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-lg"
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Waking up the server… (free tier, ~1 min)</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              OpenDoc's API sleeps when idle. Your request will go through on its own
              <span className="font-mono tabular-nums" aria-hidden>
                {elapsed > 0 ? ` · ${elapsed}s` : ""}
              </span>
            </p>
          </div>
        </div>
        <div className="h-0.5 bg-surface-3" aria-hidden>
          <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
