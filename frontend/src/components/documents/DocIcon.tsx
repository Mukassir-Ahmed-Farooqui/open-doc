import { cn } from "@/lib/cn";
import { docKind } from "@/lib/format";

const label = { pdf: "PDF", docx: "DOC", md: "MD", txt: "TXT", other: "FILE" } as const;
const tone = {
  pdf: "text-danger",
  docx: "text-accent-soft-fg",
  md: "text-success",
  txt: "text-fg-muted",
  other: "text-fg-muted",
} as const;

/** File-type tag: a small paper slip with the format in mono. Reads as a document, not an app icon. */
export function DocIcon({ filename, contentType, className }: { filename: string; contentType?: string; className?: string }) {
  const kind = docKind(filename, contentType);
  return (
    <span
      className={cn(
        "flex h-10 w-9 shrink-0 items-end justify-center rounded-[3px] border border-line-strong bg-surface pb-1.5 font-mono text-2xs leading-none font-medium [clip-path:polygon(0_0,calc(100%-7px)_0,100%_7px,100%_100%,0_100%)]",
        tone[kind],
        className,
      )}
      aria-hidden
    >
      {label[kind]}
    </span>
  );
}
