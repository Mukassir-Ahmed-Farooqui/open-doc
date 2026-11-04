import { UploadCloud } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useUploads } from "./UploadProvider";

/** Drag-and-drop target for one or many files; clicking opens the file picker. */
export function Dropzone({ compact, className, children }: { compact?: boolean; className?: string; children?: ReactNode }) {
  const { uploadFiles, openPicker } = useUploads();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={onDrop}
      data-testid="dropzone"
      className={cn(
        "relative rounded-xl border border-dashed transition-colors duration-150",
        over ? "border-accent bg-accent-soft/60" : "border-line-strong bg-surface-2/50 hover:bg-surface-2",
        compact ? "px-4 py-4" : "px-6 py-10",
        className,
      )}
    >
      {children ?? (
        <div className={cn("flex items-center gap-4", compact ? "flex-row" : "flex-col text-center")}>
          <div className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface text-fg-muted shadow-xs">
            <UploadCloud className="size-5" />
          </div>
          <div className={cn(compact ? "flex-1" : "")}>
            <p className="text-base font-medium">{over ? "Drop to upload" : "Drop files here to upload"}</p>
            <p className="text-sm text-fg-muted">PDF, DOCX, TXT or Markdown. Up to 10 MB and 50 pages each, 5 documents per account.</p>
          </div>
          <Button variant="outline" onClick={openPicker}>
            Browse files
          </Button>
        </div>
      )}
    </div>
  );
}
