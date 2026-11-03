import { FileText, FileType2, FileCode2, File } from "lucide-react";
import { cn } from "@/lib/cn";
import { docKind } from "@/lib/format";

const tone = {
  pdf: "text-danger bg-danger-soft",
  docx: "text-accent-soft-fg bg-accent-soft",
  md: "text-success bg-success-soft",
  txt: "text-fg-muted bg-surface-3",
  other: "text-fg-muted bg-surface-3",
} as const;

export function DocIcon({ filename, contentType, className }: { filename: string; contentType?: string; className?: string }) {
  const kind = docKind(filename, contentType);
  const Icon = kind === "pdf" ? FileText : kind === "docx" ? FileType2 : kind === "md" ? FileCode2 : File;
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tone[kind], className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}
