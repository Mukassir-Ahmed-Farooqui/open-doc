export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <path d="M10 8h8l5 5v11a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" fill="white" opacity=".95" />
        <circle cx="15.5" cy="18.5" r="3" fill="none" className="stroke-accent" strokeWidth="1.8" />
        <path d="m17.7 20.7 2.3 2.3" className="stroke-accent" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span>OpenDoc</span>
    </span>
  );
}
